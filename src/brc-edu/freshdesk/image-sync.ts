import { createHash } from "node:crypto";
import path from "node:path";

import {
  BlobServiceClient,
  type ContainerClient,
} from "@azure/storage-blob";

import type {
  FreshdeskImageReference,
} from "./types.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/png":
    default:
      return ".png";
  }
}

function validateImageUrl(sourceUrl: string): URL {
  const parsedUrl = new URL(sourceUrl);

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Freshdesk image URL must use HTTPS.");
  }

  const allowedHosts = new Set([
    "s3.amazonaws.com",
    "cdn.freshdesk.com",
  ]);

  if (!allowedHosts.has(parsedUrl.hostname)) {
    throw new Error(
      `Freshdesk image host is not allowed: ${parsedUrl.hostname}`,
    );
  }

  return parsedUrl;
}

function rethrowWithoutStorageSecrets(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (/AccountKey=|DefaultEndpointsProtocol=/i.test(message)) {
    throw new Error("Freshdesk image upload failed.");
  }

  throw error instanceof Error ? error : new Error(message);
}

async function downloadImage(sourceUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const safeUrl = validateImageUrl(sourceUrl);

  const response = await fetch(safeUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Freshdesk image download failed with status ${response.status}.`,
    );
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ??
    "application/octet-stream";

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported Freshdesk image type: ${contentType}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Freshdesk image exceeds ${MAX_IMAGE_BYTES} bytes.`,
    );
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

export type SyncedFreshdeskImage = {
  sourceUrl: string;
  blobName: string;
  sha256: string;
  contentType: string;
};

export function createFreshdeskImageContainer(
  connectionString: string,
  containerName: string,
): ContainerClient {
  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);

  return blobServiceClient.getContainerClient(containerName);
}

export async function syncFreshdeskImages(
  articleId: number,
  images: FreshdeskImageReference[],
  container: ContainerClient,
): Promise<SyncedFreshdeskImage[]> {
  await container.createIfNotExists();

  const syncedImages: SyncedFreshdeskImage[] = [];

  for (const image of images) {
    const { buffer, contentType } = await downloadImage(
      image.sourceUrl,
    );

    const sha256 = createHash("sha256")
      .update(buffer)
      .digest("hex");

    const extension = extensionForContentType(contentType);

    const blobName = path.posix.join(
      "freshdesk",
      String(articleId),
      `${sha256}${extension}`,
    );

    const blobClient = container.getBlockBlobClient(blobName);

    if (!(await blobClient.exists())) {
      try {
        await blobClient.uploadData(buffer, {
          blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl:
              "private, max-age=31536000, immutable",
          },
          metadata: {
            articleId: String(articleId),
            sha256,
          },
        });
      } catch (error) {
        rethrowWithoutStorageSecrets(error);
      }
    }

    syncedImages.push({
      sourceUrl: image.sourceUrl,
      blobName,
      sha256,
      contentType,
    });
  }

  return syncedImages;
}