import { getCustomerFacingScreenshotBaseUrl } from "../../config/red_public_base_url.js";
import { createFreshdeskPublicImageToken, isFreshdeskPublicImageSigningConfigured, resolveFreshdeskImageKey, } from "./freshdesk-public-image-token.js";
export const FRESHDESK_PUBLIC_IMAGE_ROUTE_PREFIX = "/public/brc-edu/freshdesk-images";
function buildScreenshotCaption(altText) {
    return altText?.trim() || "Freshdesk screenshot";
}
export function buildFreshdeskPublicImagePath(articleId, imageToken) {
    return `${FRESHDESK_PUBLIC_IMAGE_ROUTE_PREFIX}/${encodeURIComponent(String(articleId))}/${encodeURIComponent(imageToken)}`;
}
export function buildFreshdeskPublicImageUrl(articleId, imageToken, baseUrl) {
    const resolvedBaseUrl = baseUrl ?? getCustomerFacingScreenshotBaseUrl();
    if (!resolvedBaseUrl) {
        return null;
    }
    return `${resolvedBaseUrl.replace(/\/$/, "")}${buildFreshdeskPublicImagePath(articleId, imageToken)}`;
}
export function buildFreshdeskScreenshotUrls(articleId, syncedImages, blocks, options = {}) {
    if (!isFreshdeskPublicImageSigningConfigured() || blocks.length === 0) {
        return [];
    }
    const imagesByOrder = new Map(syncedImages.map((image) => [image.order, image]));
    const screenshotUrls = [];
    for (const block of [...blocks].sort((left, right) => left.order - right.order)) {
        const syncedImage = imagesByOrder.get(block.order);
        if (!syncedImage) {
            continue;
        }
        const imageKey = resolveFreshdeskImageKey(syncedImage);
        if (!imageKey) {
            continue;
        }
        const token = createFreshdeskPublicImageToken(String(articleId), imageKey, {
            now: options.now,
        });
        if (!token) {
            continue;
        }
        const url = buildFreshdeskPublicImageUrl(articleId, token, options.baseUrl);
        if (!url) {
            continue;
        }
        screenshotUrls.push({
            caption: buildScreenshotCaption(syncedImage.altText),
            mimeType: block.mimeType,
            url,
        });
    }
    return screenshotUrls;
}
