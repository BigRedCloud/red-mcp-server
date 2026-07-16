import type { FreshdeskScreenshotUrl } from "./freshdesk-public-image-url.js";
import { buildFreshdeskScreenshotCaption } from "./screenshot-caption.js";
import type { FreshdeskArticleContentBlock } from "./types.js";
import {
  actionsOverlapScore,
  blockMatchesSelectedWorkflows,
  classifyFreshdeskWorkflows,
  extractNearbyActions,
  resolveMutuallyExclusiveConflicts,
  selectWorkflowsFromQuestion,
  textTokenOverlap,
  type FreshdeskWorkflowTag,
  type SelectedWorkflows,
} from "./workflow-context.js";

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

/** Minimum score required to attach a screenshot to an instruction step. */
export const SCREENSHOT_MATCH_MIN_SCORE = 4;

type ImageBlock = Extract<FreshdeskArticleContentBlock, { type: "image" }>;
type TextBlock = Extract<FreshdeskArticleContentBlock, { type: "text" }>;

function sectionHeadingOf(
  block: FreshdeskArticleContentBlock,
): string | undefined {
  if (block.type === "text") {
    return block.sectionHeading ?? block.heading;
  }
  return block.sectionHeading ?? block.nearbyHeading;
}

function workflowsOf(block: FreshdeskArticleContentBlock): FreshdeskWorkflowTag[] {
  if (block.workflow) {
    return [block.workflow as FreshdeskWorkflowTag];
  }

  if (block.type === "text") {
    return classifyFreshdeskWorkflows(block.text, sectionHeadingOf(block));
  }

  return classifyFreshdeskWorkflows(
    block.altText,
    sectionHeadingOf(block),
    block.precedingText,
    block.followingText,
  );
}

function nearbyActionsOf(block: FreshdeskArticleContentBlock): string[] {
  if (block.nearbyActions && block.nearbyActions.length > 0) {
    return block.nearbyActions;
  }

  if (block.type === "text") {
    return extractNearbyActions(block.text, sectionHeadingOf(block));
  }

  // Do not use followingText for action matching — it often belongs to the next step.
  return extractNearbyActions(
    block.altText,
    sectionHeadingOf(block),
    block.precedingText,
  );
}

function isInstructionalText(text: string): boolean {
  const cleaned = text.trim();
  if (cleaned.length < 8) {
    return false;
  }

  // Headings alone are usually section labels, not steps — keep short headings out
  // unless they look actionable.
  if (
    cleaned.length < 40 &&
    !/\b(click|go to|open|enter|fill|select|save|add|change)\b/i.test(cleaned)
  ) {
    return /^(step\s*\d+)/i.test(cleaned);
  }

  return true;
}

function scoreScreenshotForStep(
  step: TextBlock,
  image: ImageBlock,
  nearbyArticleTexts: string[] = [],
): number {
  const stepActions = nearbyActionsOf(step);
  const imageActions = nearbyActionsOf(image);
  const stepWorkflows = workflowsOf(step);
  const imageWorkflows = workflowsOf(image);

  let score = actionsOverlapScore(stepActions, imageActions);

  const sharedWorkflow = stepWorkflows.some(
    (tag) => tag !== "generic" && imageWorkflows.includes(tag),
  );
  if (sharedWorkflow) {
    score += 2;
  }

  const stepHeading = sectionHeadingOf(step)?.toLowerCase() ?? "";
  const imageHeading = sectionHeadingOf(image)?.toLowerCase() ?? "";
  if (stepHeading && imageHeading && stepHeading === imageHeading) {
    score += 1;
  }

  const stepText = step.text;
  score += textTokenOverlap(stepText, image.precedingText ?? "");
  score += textTokenOverlap(stepText, image.followingText ?? "");
  score += textTokenOverlap(stepText, image.altText ?? "");

  for (const nearby of nearbyArticleTexts) {
    if (nearby === stepText) {
      continue;
    }
    // Only lightly boost shared tokens from nearby article text so weak
    // matches cannot clear the threshold on generic overlap alone.
    score += Math.min(2, textTokenOverlap(stepText, nearby));
  }

  // Strong exact-action boosts for common UI verbs present in the step.
  const stepLower = stepText.toLowerCase();
  const imageCorpus = [
    image.precedingText,
    image.followingText,
    image.altText,
    ...imageActions,
    ...nearbyArticleTexts.filter((text) => text !== stepText),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const action of stepActions) {
    const actionLower = action.toLowerCase();
    if (actionLower.length < 2) {
      continue;
    }
    if (stepLower.includes(actionLower) && imageCorpus.includes(actionLower)) {
      score += 3;
    }
  }

  // Penalize clear workflow conflicts (Add image vs Change step).
  if (
    (stepWorkflows.includes("add_customer") &&
      imageWorkflows.includes("existing_customer") &&
      !imageWorkflows.includes("add_customer")) ||
    (stepWorkflows.includes("existing_customer") &&
      imageWorkflows.includes("add_customer") &&
      !imageWorkflows.includes("existing_customer"))
  ) {
    score -= 6;
  }

  if (
    (stepWorkflows.includes("manual_allocations") &&
      imageWorkflows.includes("non_manual_allocations") &&
      !imageWorkflows.includes("manual_allocations")) ||
    (stepWorkflows.includes("non_manual_allocations") &&
      imageWorkflows.includes("manual_allocations") &&
      !imageWorkflows.includes("non_manual_allocations"))
  ) {
    score -= 6;
  }

  return score;
}

function nearbyTextsForImage(
  contentBlocks: FreshdeskArticleContentBlock[],
  image: ImageBlock,
): string[] {
  const imagePosition = contentBlocks.findIndex(
    (block) =>
      block.type === "image" && block.imageIndex === image.imageIndex,
  );
  if (imagePosition < 0) {
    return [];
  }

  const texts: string[] = [];
  for (
    let index = Math.max(0, imagePosition - 4);
    index <= Math.min(contentBlocks.length - 1, imagePosition + 2);
    index += 1
  ) {
    const block = contentBlocks[index];
    if (block?.type === "text" && block.text.trim()) {
      texts.push(block.text);
    }
  }
  return texts;
}

function captionForImage(image: ImageBlock): string {
  return buildFreshdeskScreenshotCaption({
    altText: image.altText,
    nearbyHeading: image.nearbyHeading,
    sectionHeading: image.sectionHeading ?? image.nearbyHeading,
    precedingText: image.precedingText,
    followingText: image.followingText,
    workflow: image.workflow,
    nearbyActions: nearbyActionsOf(image),
  });
}

function isValidScreenshotUrl(url: string | undefined): boolean {
  if (!url?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Customer-safe ordered instruction blocks. Strips internal fields
 * (sourceUrl, imageIndex, workflow, nearbyActions, blob metadata).
 *
 * Screenshots are matched to instruction steps by meaning (actions, workflow,
 * nearby text). Image order is only a tie-breaker. Weak matches are omitted.
 * Unused workflow branches are excluded when a question is supplied.
 */
export function buildFreshdeskInstructionBlocks(
  contentBlocks: FreshdeskArticleContentBlock[] | undefined,
  screenshotUrls: FreshdeskScreenshotUrl[],
  options: {
    /** Map imageIndex → screenshot URL entry (by synced image order). */
    screenshotsByImageIndex?: Map<number, FreshdeskScreenshotUrl>;
    /** Customer question used to select workflow branches. */
    question?: string | null;
    /**
     * When true (default), do not append unmatched screenshots at the end.
     * Legacy DOM-order callers may set false.
     */
    omitUnmatchedScreenshots?: boolean;
  } = {},
): HelpInstructionBlock[] {
  if (!contentBlocks || contentBlocks.length === 0) {
    return [];
  }

  const screenshotsByIndex =
    options.screenshotsByImageIndex ??
    new Map(
      screenshotUrls.map((screenshot, index) => {
        const imageIndex =
          typeof screenshot.imageIndex === "number"
            ? screenshot.imageIndex
            : index;
        return [imageIndex, screenshot] as const;
      }),
    );

  const selected = resolveMutuallyExclusiveConflicts(
    selectWorkflowsFromQuestion(options.question),
  );

  const filteredBlocks = contentBlocks.filter((block) =>
    blockMatchesSelectedWorkflows(workflowsOf(block), selected),
  );

  const imageCandidates = filteredBlocks.filter(
    (block): block is ImageBlock => block.type === "image",
  );

  const usedImageIndexes = new Set<number>();
  const blocks: HelpInstructionBlock[] = [];

  for (const block of filteredBlocks) {
    if (block.type !== "text") {
      continue;
    }

    const text = block.text.trim();
    if (!text) {
      continue;
    }

    blocks.push({ type: "text", text });

    if (!isInstructionalText(text)) {
      continue;
    }

    let best:
      | { image: ImageBlock; score: number; imageIndex: number }
      | undefined;

    for (const image of imageCandidates) {
      if (usedImageIndexes.has(image.imageIndex)) {
        continue;
      }

      const screenshot = screenshotsByIndex.get(image.imageIndex);
      if (!screenshot || !isValidScreenshotUrl(screenshot.url)) {
        continue;
      }

      let score = scoreScreenshotForStep(
        block,
        image,
        nearbyTextsForImage(filteredBlocks, image),
      );

      // Image order is a final tie-breaker only (prefer earlier images slightly).
      score += Math.max(0, 1 - image.imageIndex * 0.01);

      if (!best || score > best.score) {
        best = { image, score, imageIndex: image.imageIndex };
      }
    }

    if (!best || best.score < SCREENSHOT_MATCH_MIN_SCORE) {
      continue;
    }

    const screenshot = screenshotsByIndex.get(best.imageIndex);
    if (!screenshot || !isValidScreenshotUrl(screenshot.url)) {
      continue;
    }

    usedImageIndexes.add(best.imageIndex);
    blocks.push({
      type: "screenshot",
      caption: captionForImage(best.image),
      url: screenshot.url,
      mimeType: screenshot.mimeType,
    });
  }

  const omitUnmatched = options.omitUnmatchedScreenshots !== false;
  if (!omitUnmatched) {
    for (const [imageIndex, screenshot] of screenshotsByIndex) {
      if (usedImageIndexes.has(imageIndex) || !isValidScreenshotUrl(screenshot.url)) {
        continue;
      }
      blocks.push({
        type: "screenshot",
        caption: screenshot.caption,
        url: screenshot.url,
        mimeType: screenshot.mimeType,
      });
    }
  }

  return blocks;
}

/**
 * Enrich legacy screenshotUrls captions using content-block context when available.
 * Does not expose sourceUrl, workflow, or nearbyActions on the returned objects.
 */
export function enrichScreenshotUrlCaptions(
  screenshotUrls: FreshdeskScreenshotUrl[],
  contentBlocks: FreshdeskArticleContentBlock[] | undefined,
  options: {
    question?: string | null;
    /** When set with a question, omit screenshots from unused workflow branches. */
    filterByWorkflow?: boolean;
  } = {},
): FreshdeskScreenshotUrl[] {
  if (!contentBlocks || contentBlocks.length === 0) {
    return screenshotUrls
      .filter((screenshot) => isValidScreenshotUrl(screenshot.url))
      .map((screenshot) => ({
        ...screenshot,
        caption: buildFreshdeskScreenshotCaption({
          altText: screenshot.caption,
        }),
      }));
  }

  const selected: SelectedWorkflows | null =
    options.filterByWorkflow && options.question
      ? resolveMutuallyExclusiveConflicts(
          selectWorkflowsFromQuestion(options.question),
        )
      : null;

  const imageContexts = new Map<number, ImageBlock>();

  for (const block of contentBlocks) {
    if (block.type !== "image") {
      continue;
    }
    if (!imageContexts.has(block.imageIndex)) {
      imageContexts.set(block.imageIndex, block);
    }
  }

  return screenshotUrls.map((screenshot, index) => {
    const imageIndex =
      typeof screenshot.imageIndex === "number" ? screenshot.imageIndex : index;
    const context = imageContexts.get(imageIndex);
    return {
      url: screenshot.url,
      mimeType: screenshot.mimeType,
      imageIndex,
      caption: buildFreshdeskScreenshotCaption({
        altText: context?.altText ?? screenshot.caption,
        nearbyHeading: context?.nearbyHeading,
        sectionHeading: context?.sectionHeading ?? context?.nearbyHeading,
        precedingText: context?.precedingText,
        followingText: context?.followingText,
        workflow: context?.workflow,
        nearbyActions: context ? nearbyActionsOf(context) : undefined,
      }),
    };
  }).filter((screenshot) => {
    if (!isValidScreenshotUrl(screenshot.url)) {
      return false;
    }
    if (!selected) {
      return true;
    }
    const context = imageContexts.get(
      typeof screenshot.imageIndex === "number" ? screenshot.imageIndex : -1,
    );
    if (!context) {
      return true;
    }
    return blockMatchesSelectedWorkflows(workflowsOf(context), selected);
  });
}
