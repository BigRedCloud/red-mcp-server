import { Readable } from "node:stream";

import {
  BlobServiceClient,
  type ContainerClient,
} from "@azure/storage-blob";

import {
  getBrcEduUploadContainer,
  getBrcEduUploadStorageConnectionString,
} from "../../edu/brc_edu_upload_store.js";

import type {
  FreshdeskArticleSyncFailure,
  FreshdeskSyncResult,
  SyncedFreshdeskArticle,
} from "./freshdesk-sync-service.js";
import { repairStoredFreshdeskArticlePublicUrl } from "./freshdesk-article-url.js";
import {
  normalizeFreshdeskSyncedImages,
} from "./freshdesk-image-metadata.js";

export const FRESHDESK_ARTICLES_INDEX_BLOB_PATH =
  "brc-edu/freshdesk/latest/articles.json";

export const FRESHDESK_ARTICLES_INDEX_CONTENT_TYPE =
  "application/json; charset=utf-8";

export const FRESHDESK_ARTICLES_INDEX_CACHE_CONTROL = "no-store";

export type FreshdeskArticlesIndex = {
  generatedAt: string;
  articleCount: number;
  failureCount: number;
  articles: SyncedFreshdeskArticle[];
  failures: FreshdeskArticleSyncFailure[];
};

const SECRET_ERROR_PATTERNS = [
  /AccountKey=/i,
  /DefaultEndpointsProtocol=/i,
  /SharedAccessSignature/i,
  /\bsig=[A-Za-z0-9%+/=]+/i,
  /Authorization:\s*Basic/i,
  /Basic [A-Za-z0-9+/=]{8,}/,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toSafeIndexStorageErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of SECRET_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return "Freshdesk articles index storage operation failed.";
    }
  }

  return message;
}

function throwSafeIndexStorageError(error: unknown): never {
  throw new Error(toSafeIndexStorageErrorMessage(error));
}

async function readStreamToString(
  stream: NodeJS.ReadableStream | undefined,
): Promise<string> {
  if (!stream) {
    throw new Error("Freshdesk articles index download failed.");
  }

  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function buildFreshdeskArticlesIndex(
  syncResult: FreshdeskSyncResult,
  generatedAt: Date = new Date(),
): FreshdeskArticlesIndex {
  return {
    generatedAt: generatedAt.toISOString(),
    articleCount: syncResult.articles.length,
    failureCount: syncResult.failures.length,
    articles: syncResult.articles,
    failures: syncResult.failures,
  };
}

export function serializeFreshdeskArticlesIndex(
  index: FreshdeskArticlesIndex,
): string {
  return JSON.stringify(index, null, 2);
}

export function parseFreshdeskArticlesIndex(
  value: unknown,
): FreshdeskArticlesIndex | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.generatedAt !== "string") {
    return null;
  }

  if (typeof value.articleCount !== "number") {
    return null;
  }

  if (typeof value.failureCount !== "number") {
    return null;
  }

  if (!Array.isArray(value.articles) || !Array.isArray(value.failures)) {
    return null;
  }

  for (const article of value.articles) {
    if (!isRecord(article)) {
      return null;
    }

    if (typeof article.id !== "string") {
      return null;
    }

    if (typeof article.freshdeskArticleId !== "number") {
      return null;
    }

    if (!Array.isArray(article.syncedImages)) {
      return null;
    }
  }

  for (const failure of value.failures) {
    if (!isRecord(failure)) {
      return null;
    }

    if (typeof failure.freshdeskArticleId !== "number") {
      return null;
    }

    if (typeof failure.folderId !== "number") {
      return null;
    }

    if (typeof failure.message !== "string") {
      return null;
    }
  }

  return value as FreshdeskArticlesIndex;
}

function repairLoadedFreshdeskArticle(
  article: SyncedFreshdeskArticle,
): SyncedFreshdeskArticle {
  const repaired = repairStoredFreshdeskArticlePublicUrl({
    freshdeskArticleId: article.freshdeskArticleId,
    title: typeof article.title === "string" ? article.title : null,
    publicUrl:
      typeof article.publicUrl === "string"
        ? article.publicUrl
        : typeof (article as { url?: string }).url === "string"
          ? (article as { url?: string }).url
          : null,
    slug: typeof article.slug === "string" ? article.slug : null,
  });

  const syncedImages = normalizeFreshdeskSyncedImages(
    article.syncedImages,
    article.images,
  ).map((image, index) => ({
    sourceUrl: image.sourceUrl ?? "",
    blobName: image.blobName,
    sha256: image.sha256 ?? "",
    contentType: image.mimeType,
    order: image.order ?? index,
    altText: image.altText ?? null,
    sizeBytes: image.sizeBytes,
  }));

  return {
    ...article,
    slug: repaired.slug,
    publicUrl: repaired.publicUrl,
    syncedImages,
  };
}

export function normalizeLoadedFreshdeskArticlesIndex(
  index: FreshdeskArticlesIndex,
): FreshdeskArticlesIndex {
  return {
    ...index,
    articles: index.articles.map(repairLoadedFreshdeskArticle),
  };
}

export function createBrcEduFreshdeskIndexContainer(
  connectionString: string,
  containerName: string,
): ContainerClient {
  return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(
    containerName,
  );
}

export function createConfiguredFreshdeskIndexContainer(): ContainerClient | null {
  const connectionString = getBrcEduUploadStorageConnectionString();
  const containerName = getBrcEduUploadContainer();

  if (!connectionString || !containerName) {
    return null;
  }

  return createBrcEduFreshdeskIndexContainer(connectionString, containerName);
}

export async function saveFreshdeskArticlesIndex(
  container: ContainerClient,
  syncResult: FreshdeskSyncResult,
  options: {
    generatedAt?: Date;
  } = {},
): Promise<FreshdeskArticlesIndex> {
  const index = buildFreshdeskArticlesIndex(
    syncResult,
    options.generatedAt,
  );
  const body = serializeFreshdeskArticlesIndex(index);
  const buffer = Buffer.from(body, "utf8");
  const blobClient = container.getBlockBlobClient(
    FRESHDESK_ARTICLES_INDEX_BLOB_PATH,
  );

  try {
    await blobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: FRESHDESK_ARTICLES_INDEX_CONTENT_TYPE,
        blobCacheControl: FRESHDESK_ARTICLES_INDEX_CACHE_CONTROL,
      },
    });
  } catch (error) {
    throwSafeIndexStorageError(error);
  }

  return index;
}

export async function loadFreshdeskArticlesIndex(
  container: ContainerClient,
): Promise<FreshdeskArticlesIndex | null> {
  const blobClient = container.getBlockBlobClient(
    FRESHDESK_ARTICLES_INDEX_BLOB_PATH,
  );

  try {
    const exists = await blobClient.exists();
    if (!exists) {
      return null;
    }

    const response = await blobClient.download(0);
    const text = await readStreamToString(response.readableStreamBody);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Freshdesk articles index JSON is malformed.");
    }

    const parsedIndex = parseFreshdeskArticlesIndex(parsed);
    if (!parsedIndex) {
      throw new Error("Freshdesk articles index has an invalid shape.");
    }

    return normalizeLoadedFreshdeskArticlesIndex(parsedIndex);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Freshdesk articles index JSON is malformed." ||
        error.message === "Freshdesk articles index has an invalid shape." ||
        error.message === "Freshdesk articles index download failed.")
    ) {
      throw error;
    }

    throwSafeIndexStorageError(error);
  }
}

export function createReadableStreamFromBuffer(buffer: Buffer): Readable {
  return Readable.from([buffer]);
}
