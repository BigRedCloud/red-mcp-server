import { isGenericFreshdeskAltText, isRejectedFreshdeskCaption, } from "./screenshot-caption.js";
export const DEFAULT_HELP_IMAGE_PRESENTATION = "links";
export const SCREENSHOT_MARKDOWN_COPY_INSTRUCTION = "Include the following exact Markdown links in the customer-facing answer, placed after the related steps. Do not replace the link text or URL.";
export function toScreenshotMarkdownLink(caption, url) {
    const cleanedCaption = caption.trim();
    const cleanedUrl = url.trim();
    if (!cleanedCaption || !cleanedUrl) {
        return null;
    }
    if (isRejectedFreshdeskCaption(cleanedCaption) || isGenericFreshdeskAltText(cleanedCaption)) {
        return null;
    }
    try {
        const parsed = new URL(cleanedUrl);
        if (parsed.protocol !== "https:") {
            return null;
        }
    }
    catch {
        return null;
    }
    return `[${cleanedCaption}](${cleanedUrl})`;
}
export function buildScreenshotLinksMarkdown(screenshots) {
    const links = [];
    for (const screenshot of screenshots) {
        const link = toScreenshotMarkdownLink(screenshot.caption, screenshot.url);
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
/**
 * Deterministic customer-facing Markdown from ordered instructionBlocks.
 * Numbers only instructional text steps that are followed by a screenshot or
 * stand alone as procedure steps.
 */
export function buildCustomerFacingInstructionMarkdown(instructionBlocks) {
    if (!instructionBlocks || instructionBlocks.length === 0) {
        return undefined;
    }
    const parts = [];
    let stepNumber = 0;
    for (let index = 0; index < instructionBlocks.length; index += 1) {
        const block = instructionBlocks[index];
        if (!block) {
            continue;
        }
        if (block.type === "text") {
            const text = block.text.trim();
            if (!text) {
                continue;
            }
            const next = instructionBlocks[index + 1];
            const hasScreenshot = next?.type === "screenshot" &&
                Boolean(toScreenshotMarkdownLink(next.caption, next.url));
            // Skip short section headings unless they have an attached screenshot.
            if (!hasScreenshot &&
                text.length < 40 &&
                !/\b(click|go to|open|enter|fill|select|save|add|change)\b/i.test(text)) {
                continue;
            }
            stepNumber += 1;
            parts.push(`${stepNumber}. ${text}`);
            if (hasScreenshot && next?.type === "screenshot") {
                const link = toScreenshotMarkdownLink(next.caption, next.url);
                if (link) {
                    parts.push(`   ${link}`);
                }
            }
            continue;
        }
        // Orphan screenshot without a preceding text step in this pass — still emit.
        if (index === 0 ||
            instructionBlocks[index - 1]?.type !== "text") {
            const link = toScreenshotMarkdownLink(block.caption, block.url);
            if (link) {
                parts.push(link);
            }
        }
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
