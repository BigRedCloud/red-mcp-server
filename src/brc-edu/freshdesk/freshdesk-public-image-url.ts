import { getCustomerFacingScreenshotBaseUrl } from "../../config/red_public_base_url.js";
import {
  normalizeFreshdeskImageMimeType,
  isSupportedFreshdeskImageMimeType,
} from "./freshdesk-image-metadata.js";
import {
  createFreshdeskPublicImageToken,
  isFreshdeskPublicImageSigningConfigured,
  resolveFreshdeskImageKey,
} from "./freshdesk-public-image-token.js";
import type { FreshdeskSyncedImage } from "./freshdesk-image-metadata.js";
import {
  buildFreshdeskScreenshotCaption,
  FRESHDESK_SCREENSHOT_CAPTION_FALLBACK,
} from "./screenshot-caption.js";

export const FRESHDESK_PUBLIC_IMAGE_ROUTE_PREFIX =
  "/public/brc-edu/freshdesk-images";

export type FreshdeskScreenshotUrl = {
  caption: string;
  mimeType: string;
  url: string;
  /**
   * Internal synced-image order / content-block imageIndex.
   * Never expose in customer-facing JSON.
   */
  imageIndex?: number;
};

function buildScreenshotCaption(altText?: string): string {
  return buildFreshdeskScreenshotCaption({ altText }) || FRESHDESK_SCREENSHOT_CAPTION_FALLBACK;
}

export function buildFreshdeskPublicImagePath(
  articleId: string | number,
  imageToken: string,
): string {
  return `${FRESHDESK_PUBLIC_IMAGE_ROUTE_PREFIX}/${encodeURIComponent(
    String(articleId),
  )}/${encodeURIComponent(imageToken)}`;
}

export function buildFreshdeskPublicImageUrl(
  articleId: string | number,
  imageToken: string,
  baseUrl?: string | null,
): string | null {
  const resolvedBaseUrl = baseUrl ?? getCustomerFacingScreenshotBaseUrl();
  if (!resolvedBaseUrl) {
    return null;
  }

  return `${resolvedBaseUrl.replace(/\/$/, "")}${buildFreshdeskPublicImagePath(
    articleId,
    imageToken,
  )}`;
}

export function buildFreshdeskScreenshotUrls(
  articleId: string | number,
  syncedImages: FreshdeskSyncedImage[],
  options: {
    baseUrl?: string | null;
    now?: number;
  } = {},
): FreshdeskScreenshotUrl[] {
  if (!isFreshdeskPublicImageSigningConfigured()) {
    return [];
  }

  const screenshotUrls: FreshdeskScreenshotUrl[] = [];

  for (const syncedImage of [...syncedImages].sort(
    (left, right) => left.order - right.order,
  )) {
    const mimeType = normalizeFreshdeskImageMimeType(syncedImage.mimeType);

    if (!mimeType || !isSupportedFreshdeskImageMimeType(mimeType)) {
      continue;
    }

    const imageKey = resolveFreshdeskImageKey(syncedImage);
    if (!imageKey) {
      continue;
    }

    const token = createFreshdeskPublicImageToken(
      String(articleId),
      imageKey,
      {
        now: options.now,
      },
    );

    if (!token) {
      continue;
    }

    const url = buildFreshdeskPublicImageUrl(
      articleId,
      token,
      options.baseUrl,
    );

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
export function toCustomerFacingScreenshotUrl(
  screenshot: FreshdeskScreenshotUrl,
): FreshdeskScreenshotUrl {
  return {
    caption: screenshot.caption,
    mimeType: screenshot.mimeType,
    url: screenshot.url,
  };
}
