import type { FreshdeskScreenshotUrl } from "./freshdesk-public-image-url.js";
import { buildFreshdeskScreenshotCaption } from "./screenshot-caption.js";
import type { FreshdeskArticleContentBlock } from "./types.js";

export type HelpInstructionTextBlock = {
  type: "text";
  text: string;
};

export type HelpInstructionScreenshotBlock = {
  type: "screenshot";
  caption: string;
  url: string;
  mimeType: string;
};

export type HelpInstructionBlock =
  | HelpInstructionTextBlock
  | HelpInstructionScreenshotBlock;

/**
 * Customer-safe ordered instruction blocks. Strips internal fields
 * (sourceUrl, imageIndex, blob metadata, relevance scores).
 */
export function buildFreshdeskInstructionBlocks(
  contentBlocks: FreshdeskArticleContentBlock[] | undefined,
  screenshotUrls: FreshdeskScreenshotUrl[],
  options: {
    /** Map imageIndex → screenshot URL entry (by synced image order). */
    screenshotsByImageIndex?: Map<number, FreshdeskScreenshotUrl>;
  } = {},
): HelpInstructionBlock[] {
  if (!contentBlocks || contentBlocks.length === 0) {
    return [];
  }

  const screenshotsByIndex =
    options.screenshotsByImageIndex ??
    new Map(
      screenshotUrls.map((screenshot, index) => [index, screenshot] as const),
    );

  const usedScreenshotIndexes = new Set<number>();
  const blocks: HelpInstructionBlock[] = [];

  for (const block of contentBlocks) {
    if (block.type === "text") {
      const text = block.text.trim();
      if (!text) {
        continue;
      }
      blocks.push({ type: "text", text });
      continue;
    }

    const screenshot = screenshotsByIndex.get(block.imageIndex);
    if (!screenshot) {
      continue;
    }

    usedScreenshotIndexes.add(block.imageIndex);

    const caption = buildFreshdeskScreenshotCaption({
      altText: block.altText,
      nearbyHeading: block.nearbyHeading,
      precedingText: block.precedingText,
      followingText: block.followingText,
    });

    blocks.push({
      type: "screenshot",
      caption,
      url: screenshot.url,
      mimeType: screenshot.mimeType,
    });
  }

  // Append any screenshots that were not placed via content blocks (defensive).
  for (const [imageIndex, screenshot] of screenshotsByIndex) {
    if (usedScreenshotIndexes.has(imageIndex)) {
      continue;
    }
    blocks.push({
      type: "screenshot",
      caption: screenshot.caption,
      url: screenshot.url,
      mimeType: screenshot.mimeType,
    });
  }

  return blocks;
}

/**
 * Enrich legacy screenshotUrls captions using content-block context when available.
 */
export function enrichScreenshotUrlCaptions(
  screenshotUrls: FreshdeskScreenshotUrl[],
  contentBlocks: FreshdeskArticleContentBlock[] | undefined,
): FreshdeskScreenshotUrl[] {
  if (!contentBlocks || contentBlocks.length === 0) {
    return screenshotUrls.map((screenshot) => ({
      ...screenshot,
      caption: buildFreshdeskScreenshotCaption({
        altText: screenshot.caption,
      }),
    }));
  }

  const imageContexts = new Map<
    number,
    {
      altText?: string;
      nearbyHeading?: string;
      precedingText?: string;
      followingText?: string;
    }
  >();

  for (const block of contentBlocks) {
    if (block.type !== "image") {
      continue;
    }
    if (!imageContexts.has(block.imageIndex)) {
      imageContexts.set(block.imageIndex, {
        altText: block.altText,
        nearbyHeading: block.nearbyHeading,
        precedingText: block.precedingText,
        followingText: block.followingText,
      });
    }
  }

  return screenshotUrls.map((screenshot, index) => {
    const context = imageContexts.get(index);
    return {
      ...screenshot,
      caption: buildFreshdeskScreenshotCaption({
        altText: context?.altText ?? screenshot.caption,
        nearbyHeading: context?.nearbyHeading,
        precedingText: context?.precedingText,
        followingText: context?.followingText,
      }),
    };
  });
}
