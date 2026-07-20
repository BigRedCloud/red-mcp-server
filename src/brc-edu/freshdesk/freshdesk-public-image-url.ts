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
  isGenericFreshdeskAltText,
  isRejectedFreshdeskCaption,
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

/** Customer-facing caption when alt text / article context is missing. */
export function buildOrderedArticleImageCaption(imageNumber: number): string {
  return `Article image ${imageNumber}`;
}

function buildScreenshotCaption(
  altText: string | undefined,
  imageNumber: number,
): string {
  const built = buildFreshdeskScreenshotCaption({ altText });
  if (
    !built ||
    isRejectedFreshdeskCaption(built) ||
    isGenericFreshdeskAltText(built)
  ) {
    return buildOrderedArticleImageCaption(imageNumber);
  }
  return built;
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
  const orderedImages = [...syncedImages].sort(
    (left, right) => left.order - right.order,
  );

  for (let index = 0; index < orderedImages.length; index += 1) {
    const syncedImage = orderedImages[index];
    if (!syncedImage) {
      continue;
    }

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
      caption: buildScreenshotCaption(syncedImage.altText, index + 1),
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
