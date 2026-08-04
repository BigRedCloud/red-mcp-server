import { BlobServiceClient, RestError, } from "@azure/storage-blob";
import { getBrcEduUploadContainer, getBrcEduUploadStorageConnectionString, } from "../../edu/brc_edu_upload_store.js";
import { toSafeVersionedIndexStorageError } from "../help/versioned-index-store.js";
import { createConfiguredFreshdeskIndexContainer, loadFreshdeskArticlesIndex, } from "./freshdesk-index-store.js";
import { DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB, DEFAULT_BRC_FRESHDESK_OVERRIDES_BLOB, DEFAULT_BRC_FRESHDESK_SYNC_STATUS_BLOB, } from "./freshdesk-catalog-types.js";
const SECRET_ERROR_PATTERNS = [
    /AccountKey=/i,
    /DefaultEndpointsProtocol=/i,
    /SharedAccessSignature/i,
    /\bsig=[A-Za-z0-9%+/=]+/i,
    /Authorization:\s*Basic/i,
    /Basic [A-Za-z0-9+/=]{8,}/,
];
export function toSafeFreshdeskCatalogStorageError(error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const pattern of SECRET_ERROR_PATTERNS) {
        if (pattern.test(message)) {
            return "Freshdesk catalogue storage operation failed.";
        }
    }
    return toSafeVersionedIndexStorageError(error);
}
export function getFreshdeskOverridesBlobPath(env = process.env) {
    return (env.BRC_FRESHDESK_OVERRIDES_BLOB?.trim() ||
        DEFAULT_BRC_FRESHDESK_OVERRIDES_BLOB);
}
export function getFreshdeskEffectiveCatalogBlobPath(env = process.env) {
    return (env.BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB?.trim() ||
        DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB);
}
export function getFreshdeskSyncStatusBlobPath(env = process.env) {
    return (env.BRC_FRESHDESK_SYNC_STATUS_BLOB?.trim() ||
        DEFAULT_BRC_FRESHDESK_SYNC_STATUS_BLOB);
}
export function createConfiguredFreshdeskCatalogContainer() {
    return createConfiguredFreshdeskIndexContainer();
}
async function readStreamToString(stream) {
    if (!stream) {
        throw new Error("Freshdesk catalogue download failed.");
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
        let etag = "";
        try {
            const properties = await blobClient.getProperties();
            etag = properties.etag ?? "";
        }
        catch {
            etag = "";
        }
        const response = await blobClient.download(0);
        const text = await readStreamToString(response.readableStreamBody);
        return {
            text,
            etag,
        };
    }
    catch (error) {
        throw new Error(toSafeFreshdeskCatalogStorageError(error));
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
            const conflict = new Error("The Freshdesk catalogue changed in Azure. Refresh and try again.");
            conflict.statusCode = 409;
            throw conflict;
        }
        throw new Error(toSafeFreshdeskCatalogStorageError(error));
    }
}
function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function emptyFreshdeskOverridesDocument(updatedAt = new Date().toISOString()) {
    return { updatedAt, overrides: {} };
}
export function emptyFreshdeskSyncStatus() {
    return {
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastErrorSummary: null,
        lastSource: null,
        lastCounts: null,
    };
}
export function parseFreshdeskOverridesDocument(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.updatedAt !== "string" || !isRecord(value.overrides)) {
        return null;
    }
    const overrides = {};
    for (const [articleId, overrideValue] of Object.entries(value.overrides)) {
        if (!articleId.trim() || !isRecord(overrideValue)) {
            return null;
        }
        if (typeof overrideValue.excluded !== "boolean" ||
            typeof overrideValue.updatedAt !== "string") {
            return null;
        }
        const parsed = {
            excluded: overrideValue.excluded,
            updatedAt: overrideValue.updatedAt,
            excludedAt: asTrimmedString(overrideValue.excludedAt) || undefined,
            excludedBy: asTrimmedString(overrideValue.excludedBy) || undefined,
            reason: asTrimmedString(overrideValue.reason) || undefined,
        };
        overrides[articleId] = parsed;
    }
    return {
        updatedAt: value.updatedAt,
        overrides,
    };
}
export function parseFreshdeskEffectiveCatalog(value) {
    if (!isRecord(value) || typeof value.generatedAt !== "string") {
        return null;
    }
    if (!Array.isArray(value.items)) {
        return null;
    }
    const items = [];
    for (const item of value.items) {
        if (!isRecord(item)) {
            return null;
        }
        if (typeof item.articleId !== "string" ||
            typeof item.freshdeskArticleId !== "number" ||
            typeof item.title !== "string" ||
            typeof item.excluded !== "boolean") {
            return null;
        }
        items.push(item);
    }
    const visibleCount = items.filter((item) => !item.excluded).length;
    return {
        generatedAt: value.generatedAt,
        itemCount: typeof value.itemCount === "number" ? value.itemCount : items.length,
        visibleCount: typeof value.visibleCount === "number" ? value.visibleCount : visibleCount,
        excludedCount: typeof value.excludedCount === "number"
            ? value.excludedCount
            : items.length - visibleCount,
        items,
    };
}
export function parseFreshdeskSyncStatus(value) {
    if (!isRecord(value)) {
        return null;
    }
    const counts = value.lastCounts;
    return {
        lastAttemptAt: typeof value.lastAttemptAt === "string" ? value.lastAttemptAt : null,
        lastSuccessAt: typeof value.lastSuccessAt === "string" ? value.lastSuccessAt : null,
        lastErrorSummary: typeof value.lastErrorSummary === "string"
            ? value.lastErrorSummary
            : null,
        lastSource: value.lastSource === "manual" ||
            value.lastSource === "service" ||
            value.lastSource === "unknown"
            ? value.lastSource
            : null,
        lastCounts: counts && isRecord(counts)
            ? {
                total: Number(counts.total) || 0,
                visible: Number(counts.visible) || 0,
                excluded: Number(counts.excluded) || 0,
            }
            : null,
    };
}
export async function loadFreshdeskOverrides(container) {
    const downloaded = await downloadJsonBlob(container, getFreshdeskOverridesBlobPath());
    if (!downloaded) {
        return {
            document: emptyFreshdeskOverridesDocument(),
            etag: "",
        };
    }
    try {
        const parsed = parseFreshdeskOverridesDocument(JSON.parse(downloaded.text));
        return {
            document: parsed ?? emptyFreshdeskOverridesDocument(),
            etag: downloaded.etag,
        };
    }
    catch {
        return {
            document: emptyFreshdeskOverridesDocument(),
            etag: downloaded.etag,
        };
    }
}
export async function saveFreshdeskOverrides(params) {
    return uploadJsonBlob({
        container: params.container,
        blobPath: getFreshdeskOverridesBlobPath(),
        body: `${JSON.stringify(params.document, null, 2)}\n`,
        ifMatch: params.ifMatch || undefined,
        ifNoneMatch: !params.ifMatch ? "*" : undefined,
    });
}
export async function loadFreshdeskEffectiveCatalog(container) {
    const downloaded = await downloadJsonBlob(container, getFreshdeskEffectiveCatalogBlobPath());
    if (!downloaded) {
        return null;
    }
    try {
        return parseFreshdeskEffectiveCatalog(JSON.parse(downloaded.text));
    }
    catch {
        return null;
    }
}
export async function saveFreshdeskEffectiveCatalog(container, catalog) {
    await uploadJsonBlob({
        container,
        blobPath: getFreshdeskEffectiveCatalogBlobPath(),
        body: `${JSON.stringify(catalog, null, 2)}\n`,
    });
}
export async function loadFreshdeskSyncStatus(container) {
    const downloaded = await downloadJsonBlob(container, getFreshdeskSyncStatusBlobPath());
    if (!downloaded) {
        return emptyFreshdeskSyncStatus();
    }
    try {
        return (parseFreshdeskSyncStatus(JSON.parse(downloaded.text)) ??
            emptyFreshdeskSyncStatus());
    }
    catch {
        return emptyFreshdeskSyncStatus();
    }
}
export async function saveFreshdeskSyncStatus(container, status) {
    await uploadJsonBlob({
        container,
        blobPath: getFreshdeskSyncStatusBlobPath(),
        body: `${JSON.stringify(status, null, 2)}\n`,
    });
}
/** Load raw synced articles from the existing articles index blob. */
export async function loadFreshdeskRawArticles(container) {
    const index = await loadFreshdeskArticlesIndex(container);
    if (!index) {
        return null;
    }
    return {
        articles: index.articles,
        generatedAt: index.generatedAt,
    };
}
export function createFreshdeskCatalogContainer(connectionString, containerName) {
    return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
}
export function getFreshdeskUploadStorageConfig() {
    const connectionString = getBrcEduUploadStorageConnectionString();
    const containerName = getBrcEduUploadContainer();
    if (!connectionString || !containerName) {
        return null;
    }
    return { connectionString, containerName };
}
