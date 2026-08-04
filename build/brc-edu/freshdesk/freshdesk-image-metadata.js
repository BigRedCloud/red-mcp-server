const SUPPORTED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
]);
const SECRET_PATTERNS = [
    /AccountKey=/i,
    /SharedAccessSignature/i,
    /\bsig=[A-Za-z0-9%+/=]+/i,
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function normalizeFreshdeskImageMimeType(mimeType) {
    if (!mimeType?.trim()) {
        return null;
    }
    const normalized = mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
    if (normalized === "image/jpg") {
        return "image/jpeg";
    }
    return SUPPORTED_MIME_TYPES.has(normalized) ? normalized : null;
}
export function isSupportedFreshdeskImageMimeType(mimeType) {
    return normalizeFreshdeskImageMimeType(mimeType) !== null;
}
export function extractSafeBlobNameFromLegacyAzureUrl(value, options = {}) {
    const trimmed = value.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
        return null;
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        return null;
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "https:") {
            return null;
        }
        const pathname = decodeURIComponent(parsed.pathname);
        const segments = pathname.split("/").filter(Boolean);
        if (segments.length < 2) {
            return null;
        }
        const containerName = segments[0];
        if (options.allowedContainerName &&
            containerName !== options.allowedContainerName) {
            return null;
        }
        const blobName = segments.slice(1).join("/");
        if (!blobName.startsWith("freshdesk/")) {
            return null;
        }
        return blobName;
    }
    catch {
        return null;
    }
}
function readOptionalString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function readOptionalNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function resolveBlobName(entry, allowedContainerName) {
    const blobName = readOptionalString(entry.blobName) ??
        readOptionalString(entry.path) ??
        readOptionalString(entry.key);
    if (blobName) {
        return blobName.replace(/^\/+/, "");
    }
    const azureUrl = readOptionalString(entry.azureUrl) ??
        readOptionalString(entry.storageUrl) ??
        readOptionalString(entry.url);
    if (azureUrl) {
        return extractSafeBlobNameFromLegacyAzureUrl(azureUrl, {
            allowedContainerName,
        });
    }
    return null;
}
function readRawMimeType(entry) {
    const raw = readOptionalString(entry.mimeType) ??
        readOptionalString(entry.contentType) ??
        readOptionalString(entry.mime);
    if (!raw) {
        return null;
    }
    const normalized = raw.trim().toLowerCase().split(";")[0]?.trim() ?? "";
    if (normalized === "image/jpg") {
        return "image/jpeg";
    }
    return normalized || null;
}
function resolveAltText(entry, articleImages, index) {
    const direct = readOptionalString(entry.altText) ?? readOptionalString(entry.alt);
    if (direct) {
        return direct;
    }
    const sourceUrl = readOptionalString(entry.sourceUrl);
    if (sourceUrl) {
        const matched = articleImages.find((image) => image.sourceUrl === sourceUrl);
        if (matched?.altText?.trim()) {
            return matched.altText.trim();
        }
    }
    return articleImages[index]?.altText?.trim() || undefined;
}
export function normalizeFreshdeskSyncedImages(rawImages, articleImages = [], options = {}) {
    if (!Array.isArray(rawImages)) {
        return [];
    }
    const normalized = [];
    rawImages.forEach((rawEntry, index) => {
        if (!isRecord(rawEntry)) {
            return;
        }
        const blobName = resolveBlobName(rawEntry, options.allowedContainerName);
        const mimeType = readRawMimeType(rawEntry);
        if (!blobName || !mimeType) {
            return;
        }
        normalized.push({
            blobName,
            mimeType,
            order: readOptionalNumber(rawEntry.order) ?? index,
            altText: resolveAltText(rawEntry, articleImages, index),
            sizeBytes: readOptionalNumber(rawEntry.sizeBytes),
            sourceUrl: readOptionalString(rawEntry.sourceUrl),
            sha256: readOptionalString(rawEntry.sha256),
        });
    });
    return normalized.sort((left, right) => left.order - right.order);
}
export function freshdeskArticleHasSyncedImages(syncedImages) {
    return syncedImages.some((image) => isSupportedFreshdeskImageMimeType(image.mimeType));
}
