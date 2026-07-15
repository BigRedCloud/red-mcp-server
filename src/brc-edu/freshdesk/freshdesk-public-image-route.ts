import type { ContainerClient } from "@azure/storage-blob";
import type { Application, Request, Response } from "express";

import {
  createConfiguredFreshdeskIndexContainer,
  loadFreshdeskArticlesIndex,
} from "./freshdesk-index-store.js";
import {
  FRESHDESK_IMAGE_LOAD_MAX_IMAGE_BYTES,
  getNormalizedFreshdeskSyncedImages,
} from "./freshdesk-image-load.js";
import {
  isSupportedFreshdeskImageMimeType,
  normalizeFreshdeskImageMimeType,
  type FreshdeskSyncedImage,
} from "./freshdesk-image-metadata.js";
import {
  resolveFreshdeskImageKey,
  verifyFreshdeskPublicImageToken,
} from "./freshdesk-public-image-token.js";
import { createConfiguredFreshdeskImageContainer } from "./image-sync.js";
import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";

export const FRESHDESK_PUBLIC_IMAGE_ROUTE =
  "/public/brc-edu/freshdesk-images/:articleId/:imageToken";

export const FRESHDESK_PUBLIC_IMAGE_MAX_BYTES = FRESHDESK_IMAGE_LOAD_MAX_IMAGE_BYTES;

const SECRET_PATTERNS = [
  /AccountKey=/i,
  /DefaultEndpointsProtocol=/i,
  /SharedAccessSignature/i,
  /\bsig=[A-Za-z0-9%+/=]+/i,
  /blob\.core\.windows\.net/i,
];

const SAFE_LOG_IDENTIFIER_PATTERN = /^[a-z0-9-]+$/i;

function setFreshdeskPublicImageSecurityHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
  );
  res.setHeader("Cache-Control", "public, max-age=3600");
}

function sendNotFound(res: Response): void {
  setFreshdeskPublicImageSecurityHeaders(res);
  res.status(404).end();
}

function isSafeArticleId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function findSyncedImageByKey(
  article: SyncedFreshdeskArticle,
  imageKey: string,
): FreshdeskSyncedImage | null {
  const syncedImages = getNormalizedFreshdeskSyncedImages(article);
  return (
    syncedImages.find((image) => resolveFreshdeskImageKey(image) === imageKey) ??
    null
  );
}

async function findFreshdeskArticleById(
  articleId: string,
  indexContainer: ContainerClient | null,
): Promise<SyncedFreshdeskArticle | null> {
  if (!indexContainer) {
    return null;
  }

  try {
    const index = await loadFreshdeskArticlesIndex(indexContainer);
    return (
      index?.articles.find(
        (article) => String(article.freshdeskArticleId) === articleId,
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function readBlobBytes(
  container: ContainerClient,
  blobName: string,
): Promise<Buffer | null> {
  try {
    const blobClient = container.getBlockBlobClient(blobName);
    const exists = await blobClient.exists();
    if (!exists) {
      return null;
    }

    const response = await blobClient.download(0);
    const chunks: Buffer[] = [];
    for await (const chunk of response.readableStreamBody ?? []) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    return buffer.byteLength > 0 ? buffer : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(message))) {
      return null;
    }
    return null;
  }
}

function safeLogIdentifier(articleId: string, imageKey: string): string {
  const articlePart = SAFE_LOG_IDENTIFIER_PATTERN.test(articleId) ? articleId : "invalid";
  const imagePart = imageKey.slice(0, 8);
  return `freshdesk-image:${articlePart}:${imagePart}`;
}

export type FreshdeskPublicImageRouteDeps = {
  freshdeskIndexContainer?: ContainerClient | null;
  freshdeskImageContainer?: ContainerClient | null;
};

export async function handleFreshdeskPublicImageRequest(
  req: Request,
  res: Response,
  deps: FreshdeskPublicImageRouteDeps = {},
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).end();
    return;
  }

  const articleId = String(req.params.articleId ?? "").trim();
  const imageToken = String(req.params.imageToken ?? "").trim();

  if (!isSafeArticleId(articleId) || !imageToken) {
    sendNotFound(res);
    return;
  }

  const tokenPayload = verifyFreshdeskPublicImageToken(imageToken);
  if (!tokenPayload || tokenPayload.articleId !== articleId) {
    sendNotFound(res);
    return;
  }

  const indexContainer =
    deps.freshdeskIndexContainer === undefined
      ? createConfiguredFreshdeskIndexContainer()
      : deps.freshdeskIndexContainer;
  const imageContainer =
    deps.freshdeskImageContainer === undefined
      ? createConfiguredFreshdeskImageContainer()
      : deps.freshdeskImageContainer;

  if (!imageContainer) {
    console.info(
      "Freshdesk public image request:",
      JSON.stringify({
        identifier: safeLogIdentifier(articleId, tokenPayload.imageKey),
        status: 404,
        reason: "image_container_unconfigured",
      }),
    );
    sendNotFound(res);
    return;
  }

  const article = await findFreshdeskArticleById(articleId, indexContainer);
  if (!article) {
    console.info(
      "Freshdesk public image request:",
      JSON.stringify({
        identifier: safeLogIdentifier(articleId, tokenPayload.imageKey),
        status: 404,
        reason: "article_not_found",
      }),
    );
    sendNotFound(res);
    return;
  }

  const syncedImage = findSyncedImageByKey(article, tokenPayload.imageKey);
  if (!syncedImage) {
    console.info(
      "Freshdesk public image request:",
      JSON.stringify({
        identifier: safeLogIdentifier(articleId, tokenPayload.imageKey),
        status: 404,
        reason: "image_not_found",
      }),
    );
    sendNotFound(res);
    return;
  }

  const mimeType = normalizeFreshdeskImageMimeType(syncedImage.mimeType);
  if (!mimeType || !isSupportedFreshdeskImageMimeType(mimeType)) {
    sendNotFound(res);
    return;
  }

  const buffer = await readBlobBytes(imageContainer, syncedImage.blobName);
  if (!buffer || buffer.byteLength > FRESHDESK_PUBLIC_IMAGE_MAX_BYTES) {
    console.info(
      "Freshdesk public image request:",
      JSON.stringify({
        identifier: safeLogIdentifier(articleId, tokenPayload.imageKey),
        status: 404,
        reason: "blob_unavailable",
      }),
    );
    sendNotFound(res);
    return;
  }

  setFreshdeskPublicImageSecurityHeaders(res);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Content-Length", String(buffer.byteLength));

  console.info(
    "Freshdesk public image request:",
    JSON.stringify({
      identifier: safeLogIdentifier(articleId, tokenPayload.imageKey),
      status: 200,
      bytes: buffer.byteLength,
      mimeType,
    }),
  );

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  res.status(200).send(buffer);
}

export function registerFreshdeskPublicImageRoute(app: Application): void {
  const handler = (req: Request, res: Response) => {
    void handleFreshdeskPublicImageRequest(req, res).catch(() => {
      if (!res.headersSent) {
        sendNotFound(res);
      }
    });
  };

  app.route(FRESHDESK_PUBLIC_IMAGE_ROUTE).get(handler).head(handler);
}
