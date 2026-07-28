import { loadCustomerDocsForHelpSearch } from "../customer-docs/customer-docs-index-store.js";
import { createConfiguredFreshdeskIndexContainer, loadFreshdeskArticlesIndex, } from "../freshdesk/freshdesk-index-store.js";
import { getSyncedFreshdeskArticlePublicUrl, FRESHDESK_LINK_RESPONSE_GUIDANCE, } from "../freshdesk/freshdesk-article-url.js";
import { buildFreshdeskScreenshotUrls, buildOrderedArticleImageCaption, FRESHDESK_SCREENSHOT_LINK_LABEL, toCustomerFacingScreenshotUrl, } from "../freshdesk/freshdesk-public-image-url.js";
import { buildFreshdeskInstructionBlocks, enrichScreenshotUrlCaptions, resolveFreshdeskContentBlocksForMatching, } from "../freshdesk/instruction-blocks.js";
import { buildCustomerFacingInstructionMarkdown, buildCustomerFacingScreenshotMarkdown, buildScreenshotLinksMarkdown, buildScreenshotMarkdownTextBlock, resolveHelpImagePresentation, } from "../freshdesk/screenshot-markdown.js";
import { isRejectedFreshdeskCaption } from "../freshdesk/screenshot-caption.js";
import { buildFreshdeskImageLoadDiagnostics, FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD, freshdeskArticleImageAvailable, loadFreshdeskImageBlocks, logFreshdeskImageLoadDiagnostics, } from "../freshdesk/freshdesk-image-load.js";
import { createConfiguredFreshdeskImageContainer, isFreshdeskImageContainerConfigured, } from "../freshdesk/image-sync.js";
import { loadUpcomingWebinarsForHelpSearch } from "../upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import { parseHelpResourceId, } from "./help-resource-types.js";
import { toSafeVersionedIndexStorageError } from "./versioned-index-store.js";
import { fromFreshdeskResource, fromRecordedWebinarResource, SUPPORT_FOOTER_GUIDANCE, } from "./unified-help-search.js";
import { buildCustomerFacingSourcesMarkdown, buildHelpAnswerSources, buildSourcesMarkdownTextBlock, } from "./help-answer-sources.js";
import { SUPPORT_FALLBACK_RESPONSE_GUIDANCE, buildSupportMarkdownTextBlock, resolveSupportFallback, } from "./help-support-fallback.js";
import { buildRedActionMarkdownTextBlock, resolveHelpRedActionCapability, } from "./help-red-action-capability.js";
import { buildHelpAnswerSectionsMarkdown, AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE, HELP_ANSWER_LAYOUT_GUIDANCE, TUTORIAL_NO_DATA_CHANGE_GUIDANCE, } from "./help-answer-layout.js";
import { normalizeFreshdeskSyncedImages } from "../freshdesk/freshdesk-image-metadata.js";
export const HELP_RESOURCE_DETAILS_MAX_IMAGES = 5;
export const HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES = 512 * 1024;
export const HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES = 2 * 1024 * 1024;
export const FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE = [
    "Copy the exact Markdown links from customerFacingScreenshotMarkdown or customerFacingInstructionMarkdown into the final customer-facing answer.",
    "Place each link after the related step.",
    "Use the short link text View image (or View image N when one step has multiple images).",
    "Do not paste the descriptive screenshot caption as a second instruction sentence.",
    "Do not merely describe the screenshots.",
    "Do not say Here are the screenshots without including the links.",
    "Do not replace links with Screenshot 1, Tool result, Show Image, or invent different URLs.",
    "Do not depend on tool-result image previews being visible to the user.",
    "The final answer must contain the exact signed Markdown links.",
    "If no links are returned, clearly say that no matching screenshot was found.",
    "Never omit valid returned screenshot links after telling the user screenshots are available.",
].join(" ");
export const FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE = [
    "When customerFacingInstructionMarkdown is returned, prefer copying that Markdown into the answer, preserving every screenshot link exactly.",
    "When instructionBlocks are returned, follow them in order.",
    "Place each screenshot link immediately after the step it illustrates.",
    "Use the short link text View image (or View image N for multiple images on the same step), for example [View image](EXACT_SIGNED_IMAGE_URL).",
    "Keep descriptive captions on instructionBlocks / screenshotUrls for accessibility and the image viewer — do not repeat them as plain instruction text.",
    "Do not group screenshots into a separate Relevant screenshots section when step-and-link Markdown is available.",
    "Omit screenshots from unused workflow branches.",
    "Omit unclear screenshots rather than guessing.",
    "Do not repeat a screenshot.",
    "Do not invent captions or URLs.",
    "Do not say screenshots are displayed inline unless the chat client actually rendered them.",
    "Keep the official Freshdesk article link in the Sources section.",
    "Use the exact supplied signed public URL — do not rewrite, shorten, or replace it.",
    FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE,
].join(" ");
export const FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE = [
    "When instructionBlocks are not available, use customerFacingScreenshotMarkdown or screenshotUrls.",
    "Place each [View image](URL) link after the most relevant paragraph where possible.",
    "Use the short View image link text — do not use the descriptive caption as link text or as a second instruction sentence.",
    "Never label screenshot links Show Image.",
    "Do not invent captions or URLs.",
    "Omit unclear screenshots rather than guessing.",
    "Do not claim screenshots are shown inline unless the client actually rendered them.",
    "MCP image content blocks are a fallback only.",
    "Do not claim screenshots were supplied when imageCount is 0 or when no Markdown links are returned.",
    FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE,
].join(" ");
async function findFreshdeskArticleById(freshdeskArticleId, container) {
    if (!container) {
        return null;
    }
    try {
        const index = await loadFreshdeskArticlesIndex(container);
        return (index?.articles.find((article) => String(article.freshdeskArticleId) === freshdeskArticleId) ?? null);
    }
    catch {
        return null;
    }
}
async function findCustomerDocById(resourceId) {
    const articles = await loadCustomerDocsForHelpSearch();
    return articles?.find((article) => article.resourceId === resourceId) ?? null;
}
async function findUpcomingWebinarById(resourceId) {
    const webinars = await loadUpcomingWebinarsForHelpSearch();
    return webinars?.find((webinar) => webinar.resourceId === resourceId) ?? null;
}
async function findRecordedWebinarById(resourceId) {
    const resources = await loadEnrichedEduResources();
    const syncedAt = new Date().toISOString();
    for (const resource of resources) {
        const normalized = fromRecordedWebinarResource(resource, syncedAt);
        if (normalized.resourceId === resourceId) {
            return normalized;
        }
    }
    return null;
}
function buildDetailsGuidance(hasInstructionBlocks, hasScreenshotLinks) {
    return {
        supportFooter: SUPPORT_FOOTER_GUIDANCE,
        supportFooterWhen: SUPPORT_FALLBACK_RESPONSE_GUIDANCE,
        freshdeskLinks: FRESHDESK_LINK_RESPONSE_GUIDANCE,
        images: hasInstructionBlocks
            ? FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE
            : FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE,
        ...(hasInstructionBlocks
            ? { instructionBlocks: FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE }
            : {}),
        ...(hasScreenshotLinks
            ? { screenshotMarkdown: FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE }
            : {}),
        sources: [
            "Copy customerFacingSourcesMarkdown into the final answer under Sources.",
            "Group Freshdesk / documentation links under Articles and recorded webinars under Videos — omit an empty Videos heading.",
            "Use the exact publicUrl or registrationUrl returned by this tool — never invent or rewrite URLs.",
            "Keep screenshot links beside their steps — do not move them into Sources.",
            "After Sources, include customerFacingRedActionMarkdown when redActionAvailable is true.",
            "Always end with customerFacingSupportMarkdown (Still need help?) after Sources and any Red-action section.",
            TUTORIAL_NO_DATA_CHANGE_GUIDANCE,
        ].join(" "),
        layout: HELP_ANSWER_LAYOUT_GUIDANCE,
        autoScreenshots: AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE,
        doNotExpose: [
            "resource IDs in customer-facing text",
            "Azure blob names",
            "storage URLs",
            "Freshdesk source image URLs",
            "sync metadata",
            "invented Freshdesk article URLs",
            "internal image metadata",
            "image hashes",
            "relevance scores",
            "internal content-block order keys",
            "workflow tags",
            "nearbyActions",
            "sourceUrl",
        ],
    };
}
function buildDetailSourceFields(resource) {
    const sources = buildHelpAnswerSources([
        {
            title: resource.title,
            source: resource.source,
            publicUrl: resource.publicUrl,
            registrationUrl: resource.registrationUrl,
        },
    ]);
    const customerFacingSourcesMarkdown = buildCustomerFacingSourcesMarkdown(sources);
    const supportFallback = resolveSupportFallback({
        matchCount: sources.length > 0 ? 1 : 0,
        strongestScore: sources.length > 0 ? 1000 : 0,
        hasRelevantSourceOrScreenshot: sources.length > 0 || (resource.imageCount ?? 0) > 0,
    });
    const redAction = resolveHelpRedActionCapability(resource.question);
    const usedResourceIds = resource.resourceId ? [resource.resourceId] : [];
    const customerFacingAnswerSectionsMarkdown = buildHelpAnswerSectionsMarkdown({
        sourcesMarkdown: customerFacingSourcesMarkdown,
        redActionMarkdown: redAction.customerFacingRedActionMarkdown,
        supportMarkdown: supportFallback.customerFacingSupportMarkdown,
    });
    return {
        usedResourceIds,
        sources,
        ...(customerFacingSourcesMarkdown
            ? { customerFacingSourcesMarkdown }
            : {}),
        ...(customerFacingAnswerSectionsMarkdown
            ? { customerFacingAnswerSectionsMarkdown }
            : {}),
        supportFallbackRecommended: supportFallback.supportFallbackRecommended,
        supportFallbackReason: supportFallback.supportFallbackReason,
        supportUrl: supportFallback.supportUrl,
        contactUrl: supportFallback.contactUrl,
        customerFacingSupportMarkdown: supportFallback.customerFacingSupportMarkdown,
        redActionAvailable: redAction.redActionAvailable,
        redActionName: redAction.redActionName,
        ...(redAction.customerFacingRedActionMarkdown
            ? {
                customerFacingRedActionMarkdown: redAction.customerFacingRedActionMarkdown,
            }
            : {}),
    };
}
function sanitizeScreenshotUrls(screenshots) {
    const sanitized = [];
    for (let index = 0; index < screenshots.length; index += 1) {
        const screenshot = screenshots[index];
        if (!screenshot) {
            continue;
        }
        const facing = toCustomerFacingScreenshotUrl(screenshot);
        if (!facing.url) {
            continue;
        }
        // Keep synced images even when altText/order/context is missing — use a
        // stable non-rejected caption instead of dropping the screenshot.
        const caption = !facing.caption || isRejectedFreshdeskCaption(facing.caption)
            ? buildOrderedArticleImageCaption(index + 1)
            : facing.caption;
        sanitized.push({
            ...facing,
            caption,
            linkLabel: facing.linkLabel || FRESHDESK_SCREENSHOT_LINK_LABEL,
        });
    }
    return sanitized;
}
function sanitizeInstructionBlocks(blocks) {
    const sanitized = [];
    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!block) {
            continue;
        }
        if (block.type === "text") {
            if (block.text.trim()) {
                sanitized.push(block);
            }
            continue;
        }
        if (!block.url) {
            continue;
        }
        const caption = !block.caption || isRejectedFreshdeskCaption(block.caption)
            ? buildOrderedArticleImageCaption(index + 1)
            : block.caption;
        sanitized.push({
            ...block,
            caption,
            linkLabel: block.linkLabel || FRESHDESK_SCREENSHOT_LINK_LABEL,
        });
    }
    return sanitized;
}
export async function getHelpResourceDetails(resourceId, options = {}) {
    const parsed = parseHelpResourceId(resourceId);
    if (!parsed) {
        return { ok: false, error: "Help resource ID is invalid." };
    }
    const freshdeskIndexContainer = options.freshdeskIndexContainer === undefined
        ? createConfiguredFreshdeskIndexContainer()
        : options.freshdeskIndexContainer;
    const imageContainer = options.freshdeskImageContainer === undefined
        ? createConfiguredFreshdeskImageContainer()
        : options.freshdeskImageContainer;
    const includeImages = options.includeImages ?? true;
    const maxImages = Math.min(options.maxImages ?? HELP_RESOURCE_DETAILS_MAX_IMAGES, FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD);
    const question = options.question?.trim() || null;
    const imagePresentation = resolveHelpImagePresentation(options.imagePresentation);
    try {
        if (parsed.source === "freshdesk") {
            const article = await findFreshdeskArticleById(parsed.id, freshdeskIndexContainer);
            if (!article) {
                return { ok: false, error: "Help resource was not found." };
            }
            const normalized = fromFreshdeskResource(article);
            // Load up to the hard max so workflow matching can pick later screenshots
            // even when maxImages (MCP inline limit) is lower.
            const imageLoadLimit = article.contentBlocks?.length
                ? FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD
                : maxImages;
            const shouldLoadBinaryImages = includeImages &&
                (imagePresentation === "inline" || imagePresentation === "both");
            const imageResult = await loadFreshdeskImageBlocks(article, imageContainer, {
                includeImages: shouldLoadBinaryImages,
                maxImages: imageLoadLimit,
                maxImageBytes: HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES,
                maxTotalBytes: HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES,
            });
            logFreshdeskImageLoadDiagnostics(buildFreshdeskImageLoadDiagnostics(article, imageResult, isFreshdeskImageContainerConfigured()));
            const syncedImages = normalizeFreshdeskSyncedImages(article.syncedImages, article.images);
            console.info("Freshdesk normalized screenshot diagnostic:", JSON.stringify({
                freshdeskArticleId: article.freshdeskArticleId,
                rawSyncedImageCount: Array.isArray(article.syncedImages)
                    ? article.syncedImages.length
                    : 0,
                normalizedSyncedImageCount: syncedImages.length,
                normalizedImages: syncedImages.map((image) => ({
                    order: image.order,
                    mimeType: image.mimeType,
                    hasBlobName: Boolean(image.blobName),
                    hasSha256: Boolean(image.sha256),
                })),
            }));
            const rawScreenshotUrls = buildFreshdeskScreenshotUrls(article.freshdeskArticleId, syncedImages);
            const matchingContentBlocks = resolveFreshdeskContentBlocksForMatching({
                contentBlocks: article.contentBlocks,
                bodyText: article.bodyText,
                syncedImages,
                articleImages: article.images,
            });
            const enrichedScreenshotUrls = enrichScreenshotUrlCaptions(rawScreenshotUrls, matchingContentBlocks);
            const rawInstructionBlocks = buildFreshdeskInstructionBlocks(matchingContentBlocks, enrichedScreenshotUrls, { question });
            const instructionBlocks = sanitizeInstructionBlocks(rawInstructionBlocks);
            const instructionScreenshots = instructionBlocks.filter((block) => block.type === "screenshot");
            // A) explicit image contentBlocks, B) semantic matches from synthesized
            // image context, C) raw article order only when matching yields nothing.
            const useMatchedStepPlacement = instructionScreenshots.length > 0;
            const hasInstructionBlocks = useMatchedStepPlacement &&
                instructionBlocks.some((block) => block.type === "text");
            const screenshotUrls = sanitizeScreenshotUrls(useMatchedStepPlacement
                ? instructionScreenshots.map((block) => ({
                    caption: block.caption,
                    linkLabel: block.linkLabel,
                    url: block.url,
                    mimeType: block.mimeType,
                }))
                : enrichedScreenshotUrls);
            const screenshotLinksMarkdown = buildScreenshotLinksMarkdown(screenshotUrls);
            const customerFacingScreenshotMarkdown = buildCustomerFacingScreenshotMarkdown(screenshotUrls);
            const customerFacingInstructionMarkdown = buildCustomerFacingInstructionMarkdown(useMatchedStepPlacement && hasInstructionBlocks
                ? instructionBlocks
                : undefined);
            const hasScreenshotLinks = screenshotLinksMarkdown.length > 0;
            // imageCount must match selected customer-facing screenshots, not raw loads.
            const selectedImageCount = screenshotUrls.length;
            // Binary MCP image blocks only when presentation asks for them.
            const includeBinaryImages = includeImages &&
                (imagePresentation === "inline" || imagePresentation === "both");
            const selectedImageOrders = new Set(screenshotUrls
                .map((screenshot) => screenshot.imageIndex)
                .filter((value) => typeof value === "number"));
            const inlineImages = includeBinaryImages
                ? imageResult.blocks
                    .filter((block) => selectedImageOrders.size === 0 ||
                    selectedImageOrders.has(block.order))
                    .sort((left, right) => left.order - right.order)
                    .slice(0, maxImages)
                : [];
            const publicUrl = getSyncedFreshdeskArticlePublicUrl(article);
            const sourceFields = buildDetailSourceFields({
                resourceId: normalized.resourceId,
                title: normalized.title,
                source: normalized.source,
                publicUrl,
                imageCount: selectedImageCount,
                question,
            });
            return {
                ok: true,
                payload: {
                    resourceId: normalized.resourceId,
                    source: normalized.source,
                    title: normalized.title,
                    summary: normalized.summary,
                    instructions: normalized.bodyText,
                    publicUrl,
                    category: normalized.category,
                    topics: normalized.topics,
                    imageAvailable: hasScreenshotLinks
                        ? true
                        : freshdeskArticleImageAvailable(article) && selectedImageCount > 0,
                    imageCount: selectedImageCount,
                    requestedImageCount: imageResult.requestedImageCount,
                    skippedImageCount: imageResult.skippedImageCount,
                    imageWarning: imageResult.storageWarning,
                    imagePresentation,
                    ...(useMatchedStepPlacement && hasInstructionBlocks
                        ? { instructionBlocks }
                        : {}),
                    ...(screenshotUrls.length > 0 ? { screenshotUrls } : {}),
                    ...(screenshotLinksMarkdown.length > 0
                        ? { screenshotLinksMarkdown }
                        : {}),
                    ...(customerFacingScreenshotMarkdown
                        ? { customerFacingScreenshotMarkdown }
                        : {}),
                    ...(customerFacingInstructionMarkdown
                        ? { customerFacingInstructionMarkdown }
                        : {}),
                    ...sourceFields,
                    responseGuidance: buildDetailsGuidance(Boolean(customerFacingInstructionMarkdown), hasScreenshotLinks),
                },
                images: inlineImages,
            };
        }
        if (parsed.source === "customer_docs") {
            const resource = await findCustomerDocById(resourceId);
            if (!resource) {
                return { ok: false, error: "Help resource was not found." };
            }
            const sourceFields = buildDetailSourceFields({
                resourceId: resource.resourceId,
                title: resource.title,
                source: resource.source,
                publicUrl: resource.url,
                imageCount: 0,
                question,
            });
            return {
                ok: true,
                payload: {
                    resourceId: resource.resourceId,
                    source: resource.source,
                    title: resource.title,
                    summary: resource.summary,
                    instructions: resource.bodyText,
                    publicUrl: resource.url,
                    category: resource.category,
                    topics: resource.topics,
                    imageCount: 0,
                    imagePresentation,
                    ...sourceFields,
                    responseGuidance: buildDetailsGuidance(false, false),
                },
                images: [],
            };
        }
        if (parsed.source === "recorded_webinar" || parsed.source === "youtube_video") {
            const resource = await findRecordedWebinarById(resourceId);
            if (!resource) {
                return { ok: false, error: "Help resource was not found." };
            }
            const sourceFields = buildDetailSourceFields({
                resourceId: resource.resourceId,
                title: resource.title,
                source: resource.source,
                publicUrl: resource.url,
                imageCount: 0,
                question,
            });
            return {
                ok: true,
                payload: {
                    resourceId: resource.resourceId,
                    source: resource.source,
                    title: resource.title,
                    summary: resource.summary,
                    instructions: resource.bodyText,
                    publicUrl: resource.url,
                    category: resource.category,
                    topics: resource.topics,
                    imageCount: 0,
                    imagePresentation,
                    ...sourceFields,
                    responseGuidance: buildDetailsGuidance(false, false),
                },
                images: [],
            };
        }
        if (parsed.source === "upcoming_webinar") {
            const resource = await findUpcomingWebinarById(resourceId);
            if (!resource) {
                return { ok: false, error: "Help resource was not found." };
            }
            const sourceFields = buildDetailSourceFields({
                resourceId: resource.resourceId,
                title: resource.title,
                source: resource.source,
                publicUrl: resource.url,
                registrationUrl: resource.registrationUrl,
                imageCount: 0,
                question,
            });
            return {
                ok: true,
                payload: {
                    resourceId: resource.resourceId,
                    source: resource.source,
                    title: resource.title,
                    summary: resource.summary,
                    instructions: resource.bodyText,
                    publicUrl: resource.url,
                    registrationUrl: resource.registrationUrl,
                    category: resource.category,
                    topics: resource.topics,
                    eventDay: resource.eventDay,
                    imageCount: 0,
                    imagePresentation,
                    ...sourceFields,
                    responseGuidance: buildDetailsGuidance(false, false),
                },
                images: [],
            };
        }
        return { ok: false, error: "Help resource was not found." };
    }
    catch (error) {
        return {
            ok: false,
            error: toSafeVersionedIndexStorageError(error),
        };
    }
}
export function helpResourceDetailResponse(payload, images) {
    const sortedImages = [...images].sort((left, right) => left.order - right.order);
    const markdownText = buildScreenshotMarkdownTextBlock({
        instructionMarkdown: payload.customerFacingInstructionMarkdown,
        screenshotMarkdown: payload.customerFacingScreenshotMarkdown,
    });
    const sourcesText = buildSourcesMarkdownTextBlock(payload.customerFacingSourcesMarkdown);
    const redActionText = payload.redActionAvailable
        ? buildRedActionMarkdownTextBlock(payload.customerFacingRedActionMarkdown)
        : undefined;
    const supportText = buildSupportMarkdownTextBlock(payload.customerFacingSupportMarkdown);
    const content = [
        {
            type: "text",
            text: JSON.stringify(payload, null, 2),
        },
    ];
    // Put ready-to-use Markdown before any binary image blocks so links are the
    // primary customer-facing signal. Order: steps/screenshots → Sources → Red → support.
    if (markdownText) {
        content.push({
            type: "text",
            text: markdownText,
        });
    }
    if (sourcesText) {
        content.push({
            type: "text",
            text: sourcesText,
        });
    }
    if (redActionText) {
        content.push({
            type: "text",
            text: redActionText,
        });
    }
    if (supportText) {
        content.push({
            type: "text",
            text: supportText,
        });
    }
    if (payload.customerFacingAnswerSectionsMarkdown) {
        content.push({
            type: "text",
            text: [
                "Copy the following sections after the tutorial steps and screenshots, preserving this exact order (Sources with Articles/Videos, then optional Do this through Red, then Still need help? support last):",
                "",
                payload.customerFacingAnswerSectionsMarkdown,
            ].join("\n"),
        });
    }
    for (const image of sortedImages) {
        if (image.caption) {
            content.push({ type: "text", text: image.caption });
        }
        content.push({
            type: "image",
            data: image.data,
            mimeType: image.mimeType,
        });
    }
    return { content };
}
