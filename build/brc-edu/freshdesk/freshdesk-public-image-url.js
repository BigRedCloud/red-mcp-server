import { getCustomerFacingScreenshotBaseUrl } from "../../config/red_public_base_url.js";
import { normalizeFreshdeskImageMimeType, isSupportedFreshdeskImageMimeType, } from "./freshdesk-image-metadata.js";
import { createFreshdeskPublicImageToken, isFreshdeskPublicImageSigningConfigured, resolveFreshdeskImageKey, } from "./freshdesk-public-image-token.js";
import { buildFreshdeskScreenshotCaption, FRESHDESK_SCREENSHOT_CAPTION_FALLBACK, } from "./screenshot-caption.js";
export const FRESHDESK_PUBLIC_IMAGE_ROUTE_PREFIX = "/public/brc-edu/freshdesk-images";
function buildScreenshotCaption(altText) {
    return buildFreshdeskScreenshotCaption({ altText }) || FRESHDESK_SCREENSHOT_CAPTION_FALLBACK;
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
export function buildFreshdeskScreenshotUrls(articleId, syncedImages, options = {}) {
    if (!isFreshdeskPublicImageSigningConfigured()) {
        return [];
    }
    const screenshotUrls = [];
    for (const syncedImage of [...syncedImages].sort((left, right) => left.order - right.order)) {
        const mimeType = normalizeFreshdeskImageMimeType(syncedImage.mimeType);
        if (!mimeType || !isSupportedFreshdeskImageMimeType(mimeType)) {
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
            mimeType,
            url,
            imageIndex: syncedImage.order,
        });
    }
    return screenshotUrls;
}
/** Strip internal fields before returning screenshot URLs to customers. */
export function toCustomerFacingScreenshotUrl(screenshot) {
    return {
        caption: screenshot.caption,
        mimeType: screenshot.mimeType,
        url: screenshot.url,
    };
}
