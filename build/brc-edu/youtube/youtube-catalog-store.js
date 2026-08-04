import { BlobServiceClient, RestError, } from "@azure/storage-blob";
import { getBrcEduUploadContainer, getBrcEduUploadStorageConnectionString, } from "../../edu/brc_edu_upload_store.js";
import { createHelpIndexContainer, toSafeVersionedIndexStorageError, } from "../help/versioned-index-store.js";
import { DEFAULT_BRC_YOUTUBE_CATALOG_BLOB, DEFAULT_BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB, DEFAULT_BRC_YOUTUBE_OVERRIDES_BLOB, DEFAULT_BRC_YOUTUBE_SYNC_STATUS_BLOB, isYouTubeVideoCategory, } from "./youtube-types.js";
const SECRET_ERROR_PATTERNS = [
    /AccountKey=/i,
    /DefaultEndpointsProtocol=/i,
    /SharedAccessSignature/i,
    /\bsig=[A-Za-z0-9%+/=]+/i,
    /Authorization:\s*Basic/i,
    /Basic [A-Za-z0-9+/=]{8,}/,
    /AIza[0-9A-Za-z_-]{10,}/,
];
export function toSafeYouTubeStorageError(error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const pattern of SECRET_ERROR_PATTERNS) {
        if (pattern.test(message)) {
            return "YouTube catalogue storage operation failed.";
        }
    }
    return toSafeVersionedIndexStorageError(error);
}
export function getYouTubeCatalogBlobPath(env = process.env) {
    return (env.BRC_YOUTUBE_CATALOG_BLOB?.trim() || DEFAULT_BRC_YOUTUBE_CATALOG_BLOB);
}
export function getYouTubeOverridesBlobPath(env = process.env) {
    return (env.BRC_YOUTUBE_OVERRIDES_BLOB?.trim() || DEFAULT_BRC_YOUTUBE_OVERRIDES_BLOB);
}
export function getYouTubeEffectiveCatalogBlobPath(env = process.env) {
    return (env.BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB?.trim() ||
        DEFAULT_BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB);
}
export function getYouTubeSyncStatusBlobPath(env = process.env) {
    return (env.BRC_YOUTUBE_SYNC_STATUS_BLOB?.trim() ||
        DEFAULT_BRC_YOUTUBE_SYNC_STATUS_BLOB);
}
export function createConfiguredYouTubeBlobContainer() {
    const connectionString = getBrcEduUploadStorageConnectionString();
    const containerName = getBrcEduUploadContainer();
    if (!connectionString || !containerName) {
        return null;
    }
    return createHelpIndexContainer(connectionString, containerName);
}
async function readStreamToString(stream) {
    if (!stream) {
        throw new Error("YouTube catalogue download failed.");
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
async function downloadJsonBlob(container, blobPath) {
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
    }
    catch (error) {
        throw new Error(toSafeYouTubeStorageError(error));
    }
}
async function uploadJsonBlob(params) {
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
    }
    catch (error) {
        if (error instanceof RestError && error.statusCode === 412) {
            const conflict = new Error("The YouTube catalogue changed in Azure. Refresh and try again.");
            conflict.statusCode = 409;
            throw conflict;
        }
        throw new Error(toSafeYouTubeStorageError(error));
    }
}
function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
function parseRawVideo(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value;
    const videoId = asTrimmedString(record.videoId);
    const title = asTrimmedString(record.title);
    const url = asTrimmedString(record.url);
    const channelId = asTrimmedString(record.channelId);
    const publishedAt = asTrimmedString(record.publishedAt);
    const lastSyncedAt = asTrimmedString(record.lastSyncedAt);
    const category = record.category;
    if (!videoId ||
        !title ||
        !url ||
        !channelId ||
        !publishedAt ||
        !lastSyncedAt ||
        !isYouTubeVideoCategory(category)) {
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
function parseCatalogVideo(value) {
    const raw = parseRawVideo(value);
    if (!raw) {
        return null;
    }
    const record = value;
    const excluded = Boolean(record.excluded);
    return {
        ...raw,
        excluded,
        excludedAt: asTrimmedString(record.excludedAt) || undefined,
        excludedBy: asTrimmedString(record.excludedBy) || undefined,
        exclusionReason: asTrimmedString(record.exclusionReason) || undefined,
    };
}
export function parseYouTubeRawCatalog(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value;
    if (typeof record.generatedAt !== "string" || !Array.isArray(record.items)) {
        return null;
    }
    const items = [];
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
        itemCount: typeof record.itemCount === "number" ? record.itemCount : items.length,
        items,
    };
}
export function parseYouTubeEffectiveCatalog(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value;
    if (typeof record.generatedAt !== "string" || !Array.isArray(record.items)) {
        return null;
    }
    const items = [];
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
        itemCount: typeof record.itemCount === "number" ? record.itemCount : items.length,
        visibleCount: typeof record.visibleCount === "number" ? record.visibleCount : visibleCount,
        excludedCount: typeof record.excludedCount === "number"
            ? record.excludedCount
            : items.length - visibleCount,
        items,
    };
}
export function parseYouTubeOverridesDocument(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const overridesRaw = record.overrides;
    if (typeof record.updatedAt !== "string" || !overridesRaw || typeof overridesRaw !== "object") {
        return null;
    }
    const overrides = {};
    for (const [videoId, overrideValue] of Object.entries(overridesRaw)) {
        if (!videoId.trim() || !overrideValue || typeof overrideValue !== "object") {
            return null;
        }
        const override = overrideValue;
        if (typeof override.excluded !== "boolean" || typeof override.updatedAt !== "string") {
            return null;
        }
        const parsed = {
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
export function parseYouTubeSyncStatus(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const counts = record.lastCounts;
    return {
        lastAttemptAt: typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : null,
        lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
        lastErrorSummary: typeof record.lastErrorSummary === "string"
            ? record.lastErrorSummary
            : null,
        lastSource: record.lastSource === "timer" ||
            record.lastSource === "webhook" ||
            record.lastSource === "manual" ||
            record.lastSource === "unknown"
            ? record.lastSource
            : null,
        lastCounts: counts && typeof counts === "object"
            ? {
                total: Number(counts.total) || 0,
                visible: Number(counts.visible) || 0,
                excluded: Number(counts.excluded) || 0,
                recordedWebinar: Number(counts.recordedWebinar) || 0,
                youtubeVideo: Number(counts.youtubeVideo) || 0,
            }
            : null,
    };
}
export function emptyYouTubeOverridesDocument(updatedAt = new Date().toISOString()) {
    return { updatedAt, overrides: {} };
}
export function emptyYouTubeSyncStatus() {
    return {
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastErrorSummary: null,
        lastSource: null,
        lastCounts: null,
    };
}
export async function loadYouTubeRawCatalog(container) {
    const downloaded = await downloadJsonBlob(container, getYouTubeCatalogBlobPath());
    if (!downloaded) {
        return null;
    }
    try {
        return parseYouTubeRawCatalog(JSON.parse(downloaded.text));
    }
    catch {
        return null;
    }
}
export async function saveYouTubeRawCatalog(container, catalog) {
    if (catalog.itemCount <= 0 || catalog.items.length <= 0) {
        throw new Error("Refusing to replace the YouTube catalogue with an empty result.");
    }
    await uploadJsonBlob({
        container,
        blobPath: getYouTubeCatalogBlobPath(),
        body: `${JSON.stringify(catalog, null, 2)}\n`,
    });
}
export async function loadYouTubeEffectiveCatalog(container) {
    const downloaded = await downloadJsonBlob(container, getYouTubeEffectiveCatalogBlobPath());
    if (!downloaded) {
        return null;
    }
    try {
        return parseYouTubeEffectiveCatalog(JSON.parse(downloaded.text));
    }
    catch {
        return null;
    }
}
export async function saveYouTubeEffectiveCatalog(container, catalog) {
    await uploadJsonBlob({
        container,
        blobPath: getYouTubeEffectiveCatalogBlobPath(),
        body: `${JSON.stringify(catalog, null, 2)}\n`,
    });
}
export async function loadYouTubeOverrides(container) {
    const downloaded = await downloadJsonBlob(container, getYouTubeOverridesBlobPath());
    if (!downloaded) {
        return {
            document: emptyYouTubeOverridesDocument(),
            etag: "",
        };
    }
    try {
        const parsed = parseYouTubeOverridesDocument(JSON.parse(downloaded.text));
        return {
            document: parsed ?? emptyYouTubeOverridesDocument(),
            etag: downloaded.etag,
        };
    }
    catch {
        return {
            document: emptyYouTubeOverridesDocument(),
            etag: downloaded.etag,
        };
    }
}
export async function saveYouTubeOverrides(params) {
    return uploadJsonBlob({
        container: params.container,
        blobPath: getYouTubeOverridesBlobPath(),
        body: `${JSON.stringify(params.document, null, 2)}\n`,
        ifMatch: params.ifMatch || undefined,
        ifNoneMatch: !params.ifMatch ? "*" : undefined,
    });
}
export async function loadYouTubeSyncStatus(container) {
    const downloaded = await downloadJsonBlob(container, getYouTubeSyncStatusBlobPath());
    if (!downloaded) {
        return emptyYouTubeSyncStatus();
    }
    try {
        return (parseYouTubeSyncStatus(JSON.parse(downloaded.text)) ??
            emptyYouTubeSyncStatus());
    }
    catch {
        return emptyYouTubeSyncStatus();
    }
}
export async function saveYouTubeSyncStatus(container, status) {
    await uploadJsonBlob({
        container,
        blobPath: getYouTubeSyncStatusBlobPath(),
        body: `${JSON.stringify(status, null, 2)}\n`,
    });
}
/** Test helper: create a container client from an explicit connection string. */
export function createYouTubeBlobContainer(connectionString, containerName) {
    return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
}
