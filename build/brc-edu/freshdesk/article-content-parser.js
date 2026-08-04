import * as cheerio from "cheerio";
import { classifyFreshdeskWorkflows, extractNearbyActions, primaryWorkflow, } from "./workflow-context.js";
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_BLOCK_TAGS = new Set([
    "p",
    "li",
    "td",
    "th",
    "blockquote",
    "figcaption",
    "dt",
    "dd",
]);
const DECORATIVE_ALT_PATTERN = /^(logo|avatar|icon|spacer|separator|bullet|decoration|decorative|banner)$/i;
const DECORATIVE_CLASS_PATTERN = /\b(logo|avatar|icon|spacer|separator|decorative|decoration|emoji)\b/i;
const DECORATIVE_SRC_PATTERN = /(spacer|pixel|1x1|blank\.|transparent\.|logo[_-]|avatar[_-]|icon[_-])/i;
function normalizeWhitespace(value) {
    return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
function stripHtmlToText(value) {
    return normalizeWhitespace(value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'"));
}
function isMeaningfulInstructionText(text) {
    const cleaned = normalizeWhitespace(text);
    if (cleaned.length < 3) {
        return false;
    }
    if (/^[\d.\-)•]+$/.test(cleaned)) {
        return false;
    }
    return true;
}
function parseHttpsImageUrl(sourceUrl) {
    const trimmed = sourceUrl?.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "https:") {
            return null;
        }
        return trimmed;
    }
    catch {
        return null;
    }
}
function readNumericAttr(element, name) {
    const raw = element.attr(name)?.trim();
    if (!raw) {
        return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
}
export function isDecorativeFreshdeskImage(element) {
    const alt = element.attr("alt")?.trim() ?? "";
    const className = element.attr("class") ?? "";
    const src = element.attr("src") ?? "";
    const role = element.attr("role")?.trim().toLowerCase() ?? "";
    const ariaHidden = element.attr("aria-hidden")?.trim().toLowerCase();
    if (role === "presentation" || ariaHidden === "true") {
        return true;
    }
    if (alt && DECORATIVE_ALT_PATTERN.test(alt)) {
        return true;
    }
    if (DECORATIVE_CLASS_PATTERN.test(className)) {
        return true;
    }
    if (DECORATIVE_SRC_PATTERN.test(src)) {
        return true;
    }
    const width = readNumericAttr(element, "width");
    const height = readNumericAttr(element, "height");
    if ((width !== null && width > 0 && width <= 32) ||
        (height !== null && height > 0 && height <= 32)) {
        return true;
    }
    return false;
}
function nearestPrecedingText(texts, fromIndex) {
    for (let index = fromIndex - 1; index >= 0; index -= 1) {
        const candidate = texts[index];
        if (candidate && isMeaningfulInstructionText(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
function nearestPrecedingHeading(headings, textIndex) {
    let match;
    for (const heading of headings) {
        if (heading.index <= textIndex) {
            match = heading.text;
        }
        else {
            break;
        }
    }
    return match;
}
function collectOrderedNodes($) {
    const nodes = [];
    const visit = ($elements) => {
        $elements.each((_index, element) => {
            const $el = $(element);
            const rawName = element.tagName ??
                element.name ??
                "";
            const tagName = String(rawName).toLowerCase();
            if (tagName === "script" || tagName === "style" || tagName === "noscript") {
                return;
            }
            if (tagName === "img") {
                const sourceUrl = parseHttpsImageUrl($el.attr("src"));
                if (!sourceUrl || isDecorativeFreshdeskImage($el)) {
                    return;
                }
                nodes.push({
                    kind: "image",
                    sourceUrl,
                    altText: $el.attr("alt")?.trim() || null,
                });
                return;
            }
            if (HEADING_TAGS.has(tagName)) {
                const text = normalizeWhitespace($el.text());
                if (isMeaningfulInstructionText(text)) {
                    nodes.push({ kind: "heading", text });
                }
                return;
            }
            if (TEXT_BLOCK_TAGS.has(tagName)) {
                const clone = $el.clone();
                clone.find("img, script, style").remove();
                const text = normalizeWhitespace(clone.text());
                if (isMeaningfulInstructionText(text)) {
                    nodes.push({ kind: "text", text });
                }
                $el.find("img[src]").each((_imgIndex, img) => {
                    const $img = $(img);
                    const sourceUrl = parseHttpsImageUrl($img.attr("src"));
                    if (!sourceUrl || isDecorativeFreshdeskImage($img)) {
                        return;
                    }
                    nodes.push({
                        kind: "image",
                        sourceUrl,
                        altText: $img.attr("alt")?.trim() || null,
                    });
                });
                return;
            }
            visit($el.children());
        });
    };
    visit($.root().children());
    return nodes;
}
/**
 * Parse Freshdesk article HTML in DOM order, preserving interleaved text and
 * screenshot references. Decorative images are skipped. Image sourceUrl values
 * are retained for sync matching only and must not be exposed publicly.
 */
export function parseFreshdeskArticleContent(html) {
    const $ = cheerio.load(html || "");
    const ordered = collectOrderedNodes($);
    const contentBlocks = [];
    const images = [];
    const seenImageUrls = new Map();
    const textSequence = [];
    const headingMarkers = [];
    let currentHeading;
    const bodyParts = [];
    for (const node of ordered) {
        if (node.kind === "heading") {
            currentHeading = node.text;
            textSequence.push(node.text);
            headingMarkers.push({
                index: textSequence.length - 1,
                text: node.text,
            });
            bodyParts.push(node.text);
            const headingActions = extractNearbyActions(node.text);
            const headingWorkflows = classifyFreshdeskWorkflows(node.text);
            contentBlocks.push({
                type: "text",
                text: node.text,
                heading: node.text,
                sectionHeading: node.text,
                workflow: primaryWorkflow(headingWorkflows, headingActions),
                ...(headingActions.length > 0 ? { nearbyActions: headingActions } : {}),
            });
            continue;
        }
        if (node.kind === "text") {
            textSequence.push(node.text);
            bodyParts.push(node.text);
            const nearbyActions = extractNearbyActions(node.text, currentHeading);
            const workflows = classifyFreshdeskWorkflows(node.text, currentHeading);
            contentBlocks.push({
                type: "text",
                text: node.text,
                ...(currentHeading
                    ? { heading: currentHeading, sectionHeading: currentHeading }
                    : {}),
                workflow: primaryWorkflow(workflows, nearbyActions),
                ...(nearbyActions.length > 0 ? { nearbyActions } : {}),
            });
            continue;
        }
        const imageTextIndex = textSequence.length;
        const precedingText = nearestPrecedingText(textSequence, imageTextIndex);
        const nearbyHeading = currentHeading ??
            nearestPrecedingHeading(headingMarkers, imageTextIndex - 1);
        let imageIndex = seenImageUrls.get(node.sourceUrl);
        if (imageIndex === undefined) {
            imageIndex = images.length;
            seenImageUrls.set(node.sourceUrl, imageIndex);
            images.push({
                sourceUrl: node.sourceUrl,
                altText: node.altText,
            });
        }
        else if (node.altText) {
            images[imageIndex] = {
                sourceUrl: node.sourceUrl,
                altText: node.altText,
            };
        }
        const nearbyActions = extractNearbyActions(node.altText, nearbyHeading, precedingText);
        const workflows = classifyFreshdeskWorkflows(node.altText, nearbyHeading, precedingText);
        contentBlocks.push({
            type: "image",
            imageIndex,
            sourceUrl: node.sourceUrl,
            altText: node.altText ?? undefined,
            nearbyHeading,
            sectionHeading: nearbyHeading,
            precedingText,
            workflow: primaryWorkflow(workflows, nearbyActions),
            ...(nearbyActions.length > 0 ? { nearbyActions } : {}),
        });
    }
    const textOnly = contentBlocks
        .map((block, index) => block.type === "text" ? { index, text: block.text } : null)
        .filter((entry) => entry !== null);
    for (let blockIndex = 0; blockIndex < contentBlocks.length; blockIndex += 1) {
        const block = contentBlocks[blockIndex];
        if (!block || block.type !== "image" || block.followingText) {
            continue;
        }
        const nextText = textOnly.find((entry) => entry.index > blockIndex);
        if (nextText) {
            // Keep followingText for captions, but do not mix it into nearbyActions /
            // workflow — that would blur separate workflow branches.
            contentBlocks[blockIndex] = {
                ...block,
                followingText: nextText.text,
            };
        }
    }
    return {
        contentBlocks,
        images,
        bodyTextFromHtml: bodyParts.join(" ").replace(/\s+/g, " ").trim(),
    };
}
export function stripHtmlEntitiesForCaption(value) {
    return stripHtmlToText(value);
}
