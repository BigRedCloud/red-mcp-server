import { freshdeskArticleHasSyncedImages, isSupportedFreshdeskImageMimeType, normalizeFreshdeskImageMimeType, normalizeFreshdeskSyncedImages, } from "./freshdesk-image-metadata.js";
export const FRESHDESK_IMAGE_LOAD_MAX_IMAGES_DEFAULT = 5;
export const FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD = 8;
export const FRESHDESK_IMAGE_LOAD_MAX_IMAGE_BYTES = 512 * 1024;
export const FRESHDESK_IMAGE_LOAD_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const SECRET_PATTERNS = [
    /AccountKey=/i,
    /DefaultEndpointsProtocol=/i,
    /SharedAccessSignature/i,
    /\bsig=[A-Za-z0-9%+/=]+/i,
];
export function freshdeskArticleImageAvailable(article) {
    return freshdeskArticleHasSyncedImages(normalizeFreshdeskSyncedImages(article.syncedImages, article.images));
}
function incrementSkip(skippedByReason, reason) {
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
}
async function readBlobBytes(container, blobName) {
    try {
        const blobClient = container.getBlockBlobClient(blobName);
        const exists = await blobClient.exists();
        if (!exists) {
            return null;
        }
        const response = await blobClient.download(0);
        const chunks = [];
        for await (const chunk of response.readableStreamBody ?? []) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        return buffer.byteLength > 0 ? buffer : null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (SECRET_PATTERNS.some((pattern) => pattern.test(message))) {
            return null;
        }
        return null;
    }
}
function buildScreenshotCaption(order, altText) {
    const label = altText?.trim()
        ? altText.trim()
        : "relevant article section";
    return `Screenshot ${order + 1}: ${label}`;
}
export function buildFreshdeskImageLoadDiagnostics(article, result, configuredContainerPresent) {
    return {
        freshdeskArticleId: article.freshdeskArticleId,
        storedImageReferences: normalizeFreshdeskSyncedImages(article.syncedImages, article.images).length,
        successfulDownloads: result.imageCount,
        skippedDownloads: result.skippedImageCount,
        configuredContainerPresent,
    };
}
export function logFreshdeskImageLoadDiagnostics(diagnostics) {
    console.info("Freshdesk help image diagnostics:", JSON.stringify(diagnostics));
}
export async function loadFreshdeskImageBlocks(article, container, options = {}) {
    const syncedImages = normalizeFreshdeskSyncedImages(article.syncedImages, article.images);
    const imageAvailable = freshdeskArticleImageAvailable(article);
    const skippedByReason = {};
    const emptyResult = (overrides = {}) => ({
        blocks: [],
        imageAvailable,
        imageCount: 0,
        requestedImageCount: 0,
        skippedImageCount: syncedImages.length,
        skippedByReason,
        ...overrides,
    });
    if (options.includeImages === false) {
        return emptyResult({ requestedImageCount: 0, skippedImageCount: 0 });
    }
    if (!container) {
        return emptyResult({
            storageWarning: "Freshdesk screenshots are temporarily unavailable. The article text is still available.",
        });
    }
    if (syncedImages.length === 0) {
        return emptyResult({ skippedImageCount: 0 });
    }
    const maxImages = Math.min(options.maxImages ?? FRESHDESK_IMAGE_LOAD_MAX_IMAGES_DEFAULT, FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD);
    const maxImageBytes = options.maxImageBytes ?? FRESHDESK_IMAGE_LOAD_MAX_IMAGE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? FRESHDESK_IMAGE_LOAD_MAX_TOTAL_BYTES;
    const requestedImages = syncedImages.slice(0, maxImages);
    const blocks = [];
    let totalBytes = 0;
    for (const [index, image] of requestedImages.entries()) {
        const mimeType = normalizeFreshdeskImageMimeType(image.mimeType);
        if (!mimeType || !isSupportedFreshdeskImageMimeType(mimeType)) {
            incrementSkip(skippedByReason, "unsupported_mime");
            continue;
        }
        const buffer = await readBlobBytes(container, image.blobName);
        if (!buffer) {
            incrementSkip(skippedByReason, "missing_blob");
            continue;
        }
        if (buffer.byteLength > maxImageBytes) {
            incrementSkip(skippedByReason, "oversized");
            continue;
        }
        if (totalBytes + buffer.byteLength > maxTotalBytes) {
            incrementSkip(skippedByReason, "total_limit");
            break;
        }
        totalBytes += buffer.byteLength;
        blocks.push({
            mimeType,
            data: buffer.toString("base64"),
            caption: buildScreenshotCaption(index, image.altText),
            order: image.order,
        });
    }
    const skippedImageCount = requestedImages.length - blocks.length;
    return {
        blocks,
        imageAvailable,
        imageCount: blocks.length,
        requestedImageCount: requestedImages.length,
        skippedImageCount,
        skippedByReason,
    };
}
