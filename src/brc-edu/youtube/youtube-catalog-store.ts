import {
  BlobServiceClient,
  RestError,
  type ContainerClient,
} from "@azure/storage-blob";

import {
  getBrcEduUploadContainer,
  getBrcEduUploadStorageConnectionString,
} from "../../edu/brc_edu_upload_store.js";
import {
  createHelpIndexContainer,
  toSafeVersionedIndexStorageError,
} from "../help/versioned-index-store.js";
import {
  DEFAULT_BRC_YOUTUBE_CATALOG_BLOB,
  DEFAULT_BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB,
  DEFAULT_BRC_YOUTUBE_OVERRIDES_BLOB,
  DEFAULT_BRC_YOUTUBE_SYNC_STATUS_BLOB,
  isYouTubeVideoCategory,
  type YouTubeCatalogVideo,
  type YouTubeEffectiveCatalog,
  type YouTubeOverridesDocument,
  type YouTubeRawCatalog,
  type YouTubeRawCatalogVideo,
  type YouTubeSyncStatus,
  type YouTubeVideoOverride,
  type YouTubeVideoOverridesMap,
} from "./youtube-types.js";

const SECRET_ERROR_PATTERNS = [
  /AccountKey=/i,
  /DefaultEndpointsProtocol=/i,
  /SharedAccessSignature/i,
  /\bsig=[A-Za-z0-9%+/=]+/i,
  /Authorization:\s*Basic/i,
  /Basic [A-Za-z0-9+/=]{8,}/,
  /AIza[0-9A-Za-z_-]{10,}/,
];

export function toSafeYouTubeStorageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of SECRET_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return "YouTube catalogue storage operation failed.";
    }
  }

  return toSafeVersionedIndexStorageError(error);
}

export function getYouTubeCatalogBlobPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.BRC_YOUTUBE_CATALOG_BLOB?.trim() || DEFAULT_BRC_YOUTUBE_CATALOG_BLOB
  );
}

export function getYouTubeOverridesBlobPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.BRC_YOUTUBE_OVERRIDES_BLOB?.trim() || DEFAULT_BRC_YOUTUBE_OVERRIDES_BLOB
  );
}

export function getYouTubeEffectiveCatalogBlobPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB?.trim() ||
    DEFAULT_BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB
  );
}

export function getYouTubeSyncStatusBlobPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.BRC_YOUTUBE_SYNC_STATUS_BLOB?.trim() ||
    DEFAULT_BRC_YOUTUBE_SYNC_STATUS_BLOB
  );
}

export function createConfiguredYouTubeBlobContainer(): ContainerClient | null {
  const connectionString = getBrcEduUploadStorageConnectionString();
  const containerName = getBrcEduUploadContainer();

  if (!connectionString || !containerName) {
    return null;
  }

  return createHelpIndexContainer(connectionString, containerName);
}

async function readStreamToString(
  stream: NodeJS.ReadableStream | undefined,
): Promise<string> {
  if (!stream) {
    throw new Error("YouTube catalogue download failed.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function downloadJsonBlob(
  container: ContainerClient,
  blobPath: string,
): Promise<{ text: string; etag: string } | null> {
  const blobClient = container.getBlockBlobClient(blobPath);

  try {
    const exists = await blobClient.exists();
    if (!exists) {
      return null;
    }

    const properties = await blobClient.getProperties();
    const response = await blobClient.download(0);
    const text = await readStreamToString(response.readableStreamBody);

    return {
      text,
      etag: properties.etag ?? "",
    };
  } catch (error) {
    throw new Error(toSafeYouTubeStorageError(error));
  }
}

async function uploadJsonBlob(params: {
  container: ContainerClient;
  blobPath: string;
  body: string;
  ifMatch?: string;
  ifNoneMatch?: string;
}): Promise<{ etag: string }> {
  const blobClient = params.container.getBlockBlobClient(params.blobPath);
  const buffer = Buffer.from(params.body, "utf8");

  try {
    await blobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: "application/json; charset=utf-8",
        blobCacheControl: "no-store",
      },
      conditions: {
        ...(params.ifMatch ? { ifMatch: params.ifMatch } : {}),
        ...(params.ifNoneMatch ? { ifNoneMatch: params.ifNoneMatch } : {}),
      },
    });

    const properties = await blobClient.getProperties();
    return { etag: properties.etag ?? "" };
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 412) {
      const conflict = new Error(
        "The YouTube catalogue changed in Azure. Refresh and try again.",
      );
      (conflict as Error & { statusCode?: number }).statusCode = 409;
      throw conflict;
    }

    throw new Error(toSafeYouTubeStorageError(error));
  }
}

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function parseRawVideo(value: unknown): YouTubeRawCatalogVideo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const videoId = asTrimmedString(record.videoId);
  const title = asTrimmedString(record.title);
  const url = asTrimmedString(record.url);
  const channelId = asTrimmedString(record.channelId);
  const publishedAt = asTrimmedString(record.publishedAt);
  const lastSyncedAt = asTrimmedString(record.lastSyncedAt);
  const category = record.category;

  if (
    !videoId ||
    !title ||
    !url ||
    !channelId ||
    !publishedAt ||
    !lastSyncedAt ||
    !isYouTubeVideoCategory(category)
  ) {
    return null;
  }

  const playlistIds = Array.isArray(record.playlistIds)
    ? record.playlistIds
        .map((item) => asTrimmedString(item))
        .filter(Boolean)
    : [];

  return {
    videoId,
    title,
    description: asTrimmedString(record.description),
    url,
    thumbnailUrl: asTrimmedString(record.thumbnailUrl) || undefined,
    publishedAt,
    updatedAt: asTrimmedString(record.updatedAt) || undefined,
    channelId,
    category,
    playlistIds,
    lastSyncedAt,
  };
}

function parseCatalogVideo(value: unknown): YouTubeCatalogVideo | null {
  const raw = parseRawVideo(value);
  if (!raw) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const excluded = Boolean(record.excluded);

  return {
    ...raw,
    excluded,
    excludedAt: asTrimmedString(record.excludedAt) || undefined,
    excludedBy: asTrimmedString(record.excludedBy) || undefined,
    exclusionReason: asTrimmedString(record.exclusionReason) || undefined,
  };
}

export function parseYouTubeRawCatalog(value: unknown): YouTubeRawCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.generatedAt !== "string" || !Array.isArray(record.items)) {
    return null;
  }

  const items: YouTubeRawCatalogVideo[] = [];
  for (const item of record.items) {
    const parsed = parseRawVideo(item);
    if (!parsed) {
      return null;
    }
    items.push(parsed);
  }

  return {
    generatedAt: record.generatedAt,
    channelId: asTrimmedString(record.channelId),
    webinarPlaylistId: asTrimmedString(record.webinarPlaylistId),
    itemCount:
      typeof record.itemCount === "number" ? record.itemCount : items.length,
    items,
  };
}

export function parseYouTubeEffectiveCatalog(
  value: unknown,
): YouTubeEffectiveCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.generatedAt !== "string" || !Array.isArray(record.items)) {
    return null;
  }

  const items: YouTubeCatalogVideo[] = [];
  for (const item of record.items) {
    const parsed = parseCatalogVideo(item);
    if (!parsed) {
      return null;
    }
    items.push(parsed);
  }

  const visibleCount = items.filter((item) => !item.excluded).length;

  return {
    generatedAt: record.generatedAt,
    channelId: asTrimmedString(record.channelId),
    webinarPlaylistId: asTrimmedString(record.webinarPlaylistId),
    itemCount:
      typeof record.itemCount === "number" ? record.itemCount : items.length,
    visibleCount:
      typeof record.visibleCount === "number" ? record.visibleCount : visibleCount,
    excludedCount:
      typeof record.excludedCount === "number"
        ? record.excludedCount
        : items.length - visibleCount,
    items,
  };
}

export function parseYouTubeOverridesDocument(
  value: unknown,
): YouTubeOverridesDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const overridesRaw = record.overrides;
  if (typeof record.updatedAt !== "string" || !overridesRaw || typeof overridesRaw !== "object") {
    return null;
  }

  const overrides: YouTubeVideoOverridesMap = {};
  for (const [videoId, overrideValue] of Object.entries(
    overridesRaw as Record<string, unknown>,
  )) {
    if (!videoId.trim() || !overrideValue || typeof overrideValue !== "object") {
      return null;
    }

    const override = overrideValue as Record<string, unknown>;
    if (typeof override.excluded !== "boolean" || typeof override.updatedAt !== "string") {
      return null;
    }

    const parsed: YouTubeVideoOverride = {
      excluded: override.excluded,
      updatedAt: override.updatedAt,
      excludedAt: asTrimmedString(override.excludedAt) || undefined,
      excludedBy: asTrimmedString(override.excludedBy) || undefined,
      reason: asTrimmedString(override.reason) || undefined,
    };
    overrides[videoId] = parsed;
  }

  return {
    updatedAt: record.updatedAt,
    overrides,
  };
}

export function parseYouTubeSyncStatus(value: unknown): YouTubeSyncStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const counts = record.lastCounts;

  return {
    lastAttemptAt:
      typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : null,
    lastSuccessAt:
      typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
    lastErrorSummary:
      typeof record.lastErrorSummary === "string"
        ? record.lastErrorSummary
        : null,
    lastSource:
      record.lastSource === "timer" ||
      record.lastSource === "webhook" ||
      record.lastSource === "manual" ||
      record.lastSource === "unknown"
        ? record.lastSource
        : null,
    lastCounts:
      counts && typeof counts === "object"
        ? {
            total: Number((counts as Record<string, unknown>).total) || 0,
            visible: Number((counts as Record<string, unknown>).visible) || 0,
            excluded: Number((counts as Record<string, unknown>).excluded) || 0,
            recordedWebinar:
              Number((counts as Record<string, unknown>).recordedWebinar) || 0,
            youtubeVideo:
              Number((counts as Record<string, unknown>).youtubeVideo) || 0,
          }
        : null,
  };
}

export function emptyYouTubeOverridesDocument(
  updatedAt: string = new Date().toISOString(),
): YouTubeOverridesDocument {
  return { updatedAt, overrides: {} };
}

export function emptyYouTubeSyncStatus(): YouTubeSyncStatus {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorSummary: null,
    lastSource: null,
    lastCounts: null,
  };
}

export async function loadYouTubeRawCatalog(
  container: ContainerClient,
): Promise<YouTubeRawCatalog | null> {
  const downloaded = await downloadJsonBlob(container, getYouTubeCatalogBlobPath());
  if (!downloaded) {
    return null;
  }

  try {
    return parseYouTubeRawCatalog(JSON.parse(downloaded.text) as unknown);
  } catch {
    return null;
  }
}

export async function saveYouTubeRawCatalog(
  container: ContainerClient,
  catalog: YouTubeRawCatalog,
): Promise<void> {
  if (catalog.itemCount <= 0 || catalog.items.length <= 0) {
    throw new Error(
      "Refusing to replace the YouTube catalogue with an empty result.",
    );
  }

  await uploadJsonBlob({
    container,
    blobPath: getYouTubeCatalogBlobPath(),
    body: `${JSON.stringify(catalog, null, 2)}\n`,
  });
}

export async function loadYouTubeEffectiveCatalog(
  container: ContainerClient,
): Promise<YouTubeEffectiveCatalog | null> {
  const downloaded = await downloadJsonBlob(
    container,
    getYouTubeEffectiveCatalogBlobPath(),
  );
  if (!downloaded) {
    return null;
  }

  try {
    return parseYouTubeEffectiveCatalog(JSON.parse(downloaded.text) as unknown);
  } catch {
    return null;
  }
}

export async function saveYouTubeEffectiveCatalog(
  container: ContainerClient,
  catalog: YouTubeEffectiveCatalog,
): Promise<void> {
  await uploadJsonBlob({
    container,
    blobPath: getYouTubeEffectiveCatalogBlobPath(),
    body: `${JSON.stringify(catalog, null, 2)}\n`,
  });
}

export type YouTubeOverridesLoadResult = {
  document: YouTubeOverridesDocument;
  etag: string;
};

export async function loadYouTubeOverrides(
  container: ContainerClient,
): Promise<YouTubeOverridesLoadResult> {
  const downloaded = await downloadJsonBlob(
    container,
    getYouTubeOverridesBlobPath(),
  );

  if (!downloaded) {
    return {
      document: emptyYouTubeOverridesDocument(),
      etag: "",
    };
  }

  try {
    const parsed = parseYouTubeOverridesDocument(
      JSON.parse(downloaded.text) as unknown,
    );
    return {
      document: parsed ?? emptyYouTubeOverridesDocument(),
      etag: downloaded.etag,
    };
  } catch {
    return {
      document: emptyYouTubeOverridesDocument(),
      etag: downloaded.etag,
    };
  }
}

export async function saveYouTubeOverrides(params: {
  container: ContainerClient;
  document: YouTubeOverridesDocument;
  ifMatch?: string;
}): Promise<{ etag: string }> {
  return uploadJsonBlob({
    container: params.container,
    blobPath: getYouTubeOverridesBlobPath(),
    body: `${JSON.stringify(params.document, null, 2)}\n`,
    ifMatch: params.ifMatch || undefined,
    ifNoneMatch: !params.ifMatch ? "*" : undefined,
  });
}

export async function loadYouTubeSyncStatus(
  container: ContainerClient,
): Promise<YouTubeSyncStatus> {
  const downloaded = await downloadJsonBlob(
    container,
    getYouTubeSyncStatusBlobPath(),
  );
  if (!downloaded) {
    return emptyYouTubeSyncStatus();
  }

  try {
    return (
      parseYouTubeSyncStatus(JSON.parse(downloaded.text) as unknown) ??
      emptyYouTubeSyncStatus()
    );
  } catch {
    return emptyYouTubeSyncStatus();
  }
}

export async function saveYouTubeSyncStatus(
  container: ContainerClient,
  status: YouTubeSyncStatus,
): Promise<void> {
  await uploadJsonBlob({
    container,
    blobPath: getYouTubeSyncStatusBlobPath(),
    body: `${JSON.stringify(status, null, 2)}\n`,
  });
}

/** Test helper: create a container client from an explicit connection string. */
export function createYouTubeBlobContainer(
  connectionString: string,
  containerName: string,
): ContainerClient {
  return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(
    containerName,
  );
}
