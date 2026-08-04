import { FRESHDESK_SCREENSHOT_LINK_LABEL } from "./freshdesk-public-image-url.js";
import { buildFreshdeskScreenshotCaption } from "./screenshot-caption.js";
import { actionsOverlapScore, blockMatchesSelectedWorkflows, classifyFreshdeskWorkflows, extractNearbyActions, resolveMutuallyExclusiveConflicts, selectWorkflowsFromQuestion, textTokenOverlap, } from "./workflow-context.js";
/** Minimum score required to attach a screenshot to an instruction step. */
export const SCREENSHOT_MATCH_MIN_SCORE = 4;
function sectionHeadingOf(block) {
    if (block.type === "text") {
        return block.sectionHeading ?? block.heading;
    }
    return block.sectionHeading ?? block.nearbyHeading;
}
function workflowsOf(block) {
    if (block.workflow) {
        return [block.workflow];
    }
    if (block.type === "text") {
        return classifyFreshdeskWorkflows(block.text, sectionHeadingOf(block));
    }
    return classifyFreshdeskWorkflows(block.altText, sectionHeadingOf(block), block.precedingText, block.followingText);
}
function nearbyActionsOf(block) {
    if (block.nearbyActions && block.nearbyActions.length > 0) {
        return block.nearbyActions;
    }
    if (block.type === "text") {
        return extractNearbyActions(block.text, sectionHeadingOf(block));
    }
    // Do not use followingText for action matching — it often belongs to the next step.
    return extractNearbyActions(block.altText, sectionHeadingOf(block), block.precedingText);
}
function isInstructionalText(text) {
    const cleaned = text.trim();
    if (cleaned.length < 8) {
        return false;
    }
    // Headings alone are usually section labels, not steps — keep short headings out
    // unless they look actionable.
    if (cleaned.length < 40 &&
        !/\b(click|go to|open|enter|fill|select|save|add|change)\b/i.test(cleaned)) {
        return /^(step\s*\d+)/i.test(cleaned);
    }
    return true;
}
function scoreScreenshotForStep(step, image, nearbyArticleTexts = []) {
    const stepActions = nearbyActionsOf(step);
    const imageActions = nearbyActionsOf(image);
    const stepWorkflows = workflowsOf(step);
    const imageWorkflows = workflowsOf(image);
    let score = actionsOverlapScore(stepActions, imageActions);
    const sharedWorkflow = stepWorkflows.some((tag) => tag !== "generic" && imageWorkflows.includes(tag));
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
    if ((stepWorkflows.includes("add_customer") &&
        imageWorkflows.includes("existing_customer") &&
        !imageWorkflows.includes("add_customer")) ||
        (stepWorkflows.includes("existing_customer") &&
            imageWorkflows.includes("add_customer") &&
            !imageWorkflows.includes("existing_customer"))) {
        score -= 6;
    }
    if ((stepWorkflows.includes("manual_allocations") &&
        imageWorkflows.includes("non_manual_allocations") &&
        !imageWorkflows.includes("manual_allocations")) ||
        (stepWorkflows.includes("non_manual_allocations") &&
            imageWorkflows.includes("manual_allocations") &&
            !imageWorkflows.includes("non_manual_allocations"))) {
        score -= 6;
    }
    return score;
}
function nearbyTextsForImage(contentBlocks, image) {
    const imagePosition = contentBlocks.findIndex((block) => block.type === "image" && block.imageIndex === image.imageIndex);
    if (imagePosition < 0) {
        return [];
    }
    const texts = [];
    for (let index = Math.max(0, imagePosition - 4); index <= Math.min(contentBlocks.length - 1, imagePosition + 2); index += 1) {
        const block = contentBlocks[index];
        if (block?.type === "text" && block.text.trim()) {
            texts.push(block.text);
        }
    }
    return texts;
}
function captionForImage(image) {
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
function isValidScreenshotUrl(url) {
    if (!url?.trim()) {
        return false;
    }
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
function contentBlocksHaveImageReferences(contentBlocks) {
    return (contentBlocks ?? []).some((block) => block.type === "image");
}
function splitBodyTextIntoInstructionBlocks(bodyText) {
    const cleaned = (bodyText ?? "").replace(/\r\n/g, "\n").trim();
    if (!cleaned) {
        return [];
    }
    const paragraphs = cleaned
        .split(/\n{2,}/)
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const parts = paragraphs.length > 1
        ? paragraphs
        : cleaned
            .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
            .map((part) => part.trim())
            .filter((part) => part.length >= 8);
    return parts.map((text) => {
        const actions = extractNearbyActions(text);
        const workflows = classifyFreshdeskWorkflows(text);
        return {
            type: "text",
            text,
            ...(workflows[0] ? { workflow: workflows[0] } : {}),
            ...(actions.length > 0 ? { nearbyActions: actions } : {}),
        };
    });
}
/**
 * Prefer the instructional step that best matches alt/caption context.
 * Falls back to synced image index only when no semantic signal exists.
 */
function pickNearbyInstructionText(instructionalTexts, preferredIndex, context) {
    if (instructionalTexts.length === 0) {
        return undefined;
    }
    const fallback = instructionalTexts[Math.min(preferredIndex, Math.max(0, instructionalTexts.length - 1))];
    const contextText = context?.trim();
    if (!contextText) {
        return fallback;
    }
    let best;
    for (const text of instructionalTexts) {
        const score = textTokenOverlap(contextText, text) +
            actionsOverlapScore(extractNearbyActions(contextText), extractNearbyActions(text));
        if (!best || score > best.score) {
            best = { text, score };
        }
    }
    return best && best.score > 0 ? best.text : fallback;
}
/**
 * When Freshdesk contentBlocks lack image refs but syncedImages exist, synthesize
 * image blocks from synced image order + nearby instructional text so the
 * existing semantic matcher can place screenshots beside steps.
 */
export function synthesizeFreshdeskImageBlocksForMatching(options) {
    const { syncedImageCount, articleImages = [], syncedImages = [], textBlocks } = options;
    if (syncedImageCount <= 0) {
        return [];
    }
    const instructionalTexts = textBlocks
        .map((block) => block.text.trim())
        .filter((text) => isInstructionalText(text));
    const usedPreceding = new Set();
    const imageBlocks = [];
    for (let index = 0; index < syncedImageCount; index += 1) {
        const synced = syncedImages[index];
        const articleImage = articleImages[index];
        const altText = synced?.altText?.trim() ||
            articleImage?.altText?.trim() ||
            undefined;
        let precedingText = pickNearbyInstructionText(instructionalTexts, index, altText);
        // Prefer unused steps when several images compete for the same text.
        if (precedingText &&
            usedPreceding.has(precedingText) &&
            instructionalTexts.length > 1) {
            const unused = instructionalTexts.find((text) => !usedPreceding.has(text));
            if (unused) {
                const unusedScore = textTokenOverlap(altText ?? "", unused) +
                    actionsOverlapScore(extractNearbyActions(altText), extractNearbyActions(unused));
                if (unusedScore > 0) {
                    precedingText = unused;
                }
            }
        }
        if (precedingText) {
            usedPreceding.add(precedingText);
        }
        const precedingIndex = precedingText
            ? instructionalTexts.indexOf(precedingText)
            : index;
        const followingText = instructionalTexts[Math.min(precedingIndex >= 0 ? precedingIndex + 1 : index + 1, Math.max(0, instructionalTexts.length - 1))] ?? textBlocks[Math.min(index + 1, Math.max(0, textBlocks.length - 1))]?.text;
        const sectionHeading = textBlocks.find((block) => block.sectionHeading || block.heading)?.sectionHeading ??
            textBlocks.find((block) => block.heading)?.heading;
        const actions = extractNearbyActions(altText, sectionHeading, precedingText);
        const workflows = classifyFreshdeskWorkflows(altText, sectionHeading, precedingText, followingText);
        imageBlocks.push({
            type: "image",
            imageIndex: typeof synced?.order === "number" && Number.isFinite(synced.order)
                ? synced.order
                : index,
            sourceUrl: synced?.sourceUrl ?? articleImage?.sourceUrl,
            altText,
            precedingText,
            followingText: followingText && followingText !== precedingText
                ? followingText
                : undefined,
            sectionHeading,
            nearbyHeading: sectionHeading,
            ...(workflows[0] ? { workflow: workflows[0] } : {}),
            ...(actions.length > 0 ? { nearbyActions: actions } : {}),
        });
    }
    return imageBlocks;
}
/**
 * Resolve content blocks for screenshot matching:
 * A. explicit image contentBlocks — preserve as-is
 * B. text-only / missing contentBlocks + syncedImages — synthesize image blocks
 * C. caller falls back to raw article order when matching yields no screenshots
 */
export function resolveFreshdeskContentBlocksForMatching(options) {
    const { contentBlocks, bodyText, syncedImages = [], articleImages = [], } = options;
    if (contentBlocksHaveImageReferences(contentBlocks)) {
        return contentBlocks ?? [];
    }
    const textBlocks = (contentBlocks ?? []).filter((block) => block.type === "text" && Boolean(block.text.trim()));
    const resolvedTextBlocks = textBlocks.length > 0
        ? textBlocks
        : splitBodyTextIntoInstructionBlocks(bodyText);
    if (syncedImages.length === 0) {
        return resolvedTextBlocks;
    }
    const imageBlocks = synthesizeFreshdeskImageBlocksForMatching({
        syncedImageCount: syncedImages.length,
        articleImages,
        syncedImages,
        textBlocks: resolvedTextBlocks,
    });
    return [...resolvedTextBlocks, ...imageBlocks];
}
/**
 * Customer-safe ordered instruction blocks. Strips internal fields
 * (sourceUrl, imageIndex, workflow, nearbyActions, blob metadata).
 *
 * Screenshots are matched to instruction steps by meaning (actions, workflow,
 * nearby text). Image order is only a tie-breaker. Weak matches are omitted.
 * Unused workflow branches are excluded when a question is supplied.
 */
export function buildFreshdeskInstructionBlocks(contentBlocks, screenshotUrls, options = {}) {
    if (!contentBlocks || contentBlocks.length === 0) {
        return [];
    }
    const screenshotsByIndex = options.screenshotsByImageIndex ??
        new Map(screenshotUrls.map((screenshot, index) => {
            const imageIndex = typeof screenshot.imageIndex === "number"
                ? screenshot.imageIndex
                : index;
            return [imageIndex, screenshot];
        }));
    const selected = resolveMutuallyExclusiveConflicts(selectWorkflowsFromQuestion(options.question));
    const filteredBlocks = contentBlocks.filter((block) => blockMatchesSelectedWorkflows(workflowsOf(block), selected));
    const imageCandidates = filteredBlocks.filter((block) => block.type === "image");
    const usedImageIndexes = new Set();
    const blocks = [];
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
        let best;
        for (const image of imageCandidates) {
            if (usedImageIndexes.has(image.imageIndex)) {
                continue;
            }
            const screenshot = screenshotsByIndex.get(image.imageIndex);
            if (!screenshot || !isValidScreenshotUrl(screenshot.url)) {
                continue;
            }
            let score = scoreScreenshotForStep(block, image, nearbyTextsForImage(filteredBlocks, image));
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
            linkLabel: FRESHDESK_SCREENSHOT_LINK_LABEL,
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
                linkLabel: screenshot.linkLabel ?? FRESHDESK_SCREENSHOT_LINK_LABEL,
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
export function enrichScreenshotUrlCaptions(screenshotUrls, contentBlocks, options = {}) {
    if (!contentBlocks || contentBlocks.length === 0) {
        return screenshotUrls
            .filter((screenshot) => isValidScreenshotUrl(screenshot.url))
            .map((screenshot) => ({
            ...screenshot,
            linkLabel: screenshot.linkLabel ?? FRESHDESK_SCREENSHOT_LINK_LABEL,
            caption: buildFreshdeskScreenshotCaption({
                altText: screenshot.caption,
            }),
        }));
    }
    const selected = options.filterByWorkflow && options.question
        ? resolveMutuallyExclusiveConflicts(selectWorkflowsFromQuestion(options.question))
        : null;
    const imageContexts = new Map();
    for (const block of contentBlocks) {
        if (block.type !== "image") {
            continue;
        }
        if (!imageContexts.has(block.imageIndex)) {
            imageContexts.set(block.imageIndex, block);
        }
    }
    return screenshotUrls.map((screenshot, index) => {
        const imageIndex = typeof screenshot.imageIndex === "number" ? screenshot.imageIndex : index;
        const context = imageContexts.get(imageIndex);
        return {
            url: screenshot.url,
            mimeType: screenshot.mimeType,
            imageIndex,
            linkLabel: screenshot.linkLabel ?? FRESHDESK_SCREENSHOT_LINK_LABEL,
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
        const context = imageContexts.get(typeof screenshot.imageIndex === "number" ? screenshot.imageIndex : -1);
        if (!context) {
            return true;
        }
        return blockMatchesSelectedWorkflows(workflowsOf(context), selected);
    });
}
