import { FRESHDESK_SCREENSHOT_LINK_LABEL } from "./freshdesk-public-image-url.js";
export const DEFAULT_HELP_IMAGE_PRESENTATION = "links";
export const SCREENSHOT_MARKDOWN_COPY_INSTRUCTION = "Include the following exact Markdown links in the customer-facing answer, placed after the related steps. Keep the short View image link text and exact signed URL — do not replace them with the descriptive caption.";
export function isValidHttpsScreenshotUrl(url) {
    const cleanedUrl = url.trim();
    if (!cleanedUrl) {
        return false;
    }
    try {
        const parsed = new URL(cleanedUrl);
        return parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
export function buildScreenshotLinkLabel(indexWithinStep = 0, countWithinStep = 1) {
    return countWithinStep > 1
        ? `View image ${indexWithinStep + 1}`
        : FRESHDESK_SCREENSHOT_LINK_LABEL;
}
/**
 * Customer-facing Markdown link. Uses a short neutral label; never the
 * descriptive caption (which is retained separately for matching/viewer).
 */
export function buildScreenshotLinkMarkdown(screenshot, indexWithinStep = 0, countWithinStep = 1) {
    const cleanedUrl = screenshot.url.trim();
    if (!isValidHttpsScreenshotUrl(cleanedUrl)) {
        return null;
    }
    const label = countWithinStep > 1
        ? buildScreenshotLinkLabel(indexWithinStep, countWithinStep)
        : screenshot.linkLabel?.trim() || buildScreenshotLinkLabel();
    return `[${label}](${cleanedUrl})`;
}
/**
 * @deprecated Prefer buildScreenshotLinkMarkdown. Kept for callers that still
 * pass a caption; the caption is ignored as link text and replaced with View image.
 */
export function toScreenshotMarkdownLink(_caption, url) {
    return buildScreenshotLinkMarkdown({ url });
}
export function buildScreenshotLinksMarkdown(screenshots) {
    const links = [];
    for (const screenshot of screenshots) {
        const link = buildScreenshotLinkMarkdown(screenshot);
        if (link) {
            links.push(link);
        }
    }
    return links;
}
export function buildCustomerFacingScreenshotMarkdown(screenshots) {
    const links = buildScreenshotLinksMarkdown(screenshots);
    if (links.length === 0) {
        return undefined;
    }
    return links.join("\n\n");
}
function collectFollowingScreenshots(instructionBlocks, startIndex) {
    const screenshots = [];
    for (let index = startIndex; index < instructionBlocks.length; index += 1) {
        const block = instructionBlocks[index];
        if (block?.type !== "screenshot") {
            break;
        }
        screenshots.push(block);
    }
    return screenshots;
}
/**
 * Deterministic customer-facing Markdown from ordered instructionBlocks.
 * Numbers instructional text steps; places short View image links after each
 * matched step. Descriptive captions are never emitted as link text or plain text.
 */
export function buildCustomerFacingInstructionMarkdown(instructionBlocks) {
    if (!instructionBlocks || instructionBlocks.length === 0) {
        return undefined;
    }
    const parts = [];
    let stepNumber = 0;
    let index = 0;
    while (index < instructionBlocks.length) {
        const block = instructionBlocks[index];
        if (!block) {
            index += 1;
            continue;
        }
        if (block.type === "text") {
            const text = block.text.trim();
            if (!text) {
                index += 1;
                continue;
            }
            const followingScreenshots = collectFollowingScreenshots(instructionBlocks, index + 1).filter((screenshot) => isValidHttpsScreenshotUrl(screenshot.url));
            // Skip short section headings unless they have an attached screenshot.
            if (followingScreenshots.length === 0 &&
                text.length < 40 &&
                !/\b(click|go to|open|enter|fill|select|save|add|change)\b/i.test(text)) {
                index += 1;
                continue;
            }
            stepNumber += 1;
            parts.push(`${stepNumber}. ${text}`);
            const count = followingScreenshots.length;
            for (let shotIndex = 0; shotIndex < count; shotIndex += 1) {
                const screenshot = followingScreenshots[shotIndex];
                if (!screenshot) {
                    continue;
                }
                const link = buildScreenshotLinkMarkdown(screenshot, shotIndex, count);
                if (link) {
                    parts.push(`   ${link}`);
                }
            }
            index += 1 + followingScreenshots.length;
            continue;
        }
        // Orphan screenshot without a preceding text step — still emit View image.
        const link = buildScreenshotLinkMarkdown(block);
        if (link) {
            parts.push(link);
        }
        index += 1;
    }
    if (parts.length === 0) {
        return undefined;
    }
    return parts.join("\n\n");
}
export function buildScreenshotMarkdownTextBlock(options) {
    const instruction = options.instructionMarkdown?.trim();
    const screenshots = options.screenshotMarkdown?.trim();
    if (!instruction && !screenshots) {
        return undefined;
    }
    const sections = [SCREENSHOT_MARKDOWN_COPY_INSTRUCTION, ""];
    if (instruction) {
        sections.push(instruction);
    }
    else if (screenshots) {
        sections.push("Relevant screenshots:", "", screenshots);
    }
    return sections.join("\n").trim();
}
export function resolveHelpImagePresentation(value) {
    if (value === "inline" || value === "both" || value === "links") {
        return value;
    }
    return DEFAULT_HELP_IMAGE_PRESENTATION;
}
