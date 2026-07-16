import { loadCustomerDocsForHelpSearch } from "../customer-docs/customer-docs-index-store.js";
import { createConfiguredFreshdeskIndexContainer, loadFreshdeskArticlesIndex, } from "../freshdesk/freshdesk-index-store.js";
import { getSyncedFreshdeskArticlePublicUrl, FRESHDESK_LINK_RESPONSE_GUIDANCE, } from "../freshdesk/freshdesk-article-url.js";
import { buildFreshdeskScreenshotUrls, } from "../freshdesk/freshdesk-public-image-url.js";
import { buildFreshdeskInstructionBlocks, enrichScreenshotUrlCaptions, } from "../freshdesk/instruction-blocks.js";
import { buildFreshdeskImageLoadDiagnostics, getNormalizedFreshdeskSyncedImages, FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD, freshdeskArticleImageAvailable, loadFreshdeskImageBlocks, logFreshdeskImageLoadDiagnostics, } from "../freshdesk/freshdesk-image-load.js";
import { createConfiguredFreshdeskImageContainer, isFreshdeskImageContainerConfigured, } from "../freshdesk/image-sync.js";
import { loadUpcomingWebinarsForHelpSearch } from "../upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import { parseHelpResourceId, } from "./help-resource-types.js";
import { toSafeVersionedIndexStorageError } from "./versioned-index-store.js";
import { fromFreshdeskResource, fromRecordedWebinarResource, SUPPORT_FOOTER_GUIDANCE, } from "./unified-help-search.js";
export const HELP_RESOURCE_DETAILS_MAX_IMAGES = 5;
export const HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES = 512 * 1024;
export const HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES = 2 * 1024 * 1024;
export const FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE = [
    "When instructionBlocks are returned, follow them in order.",
    "Place each screenshot link immediately after the step or paragraph it illustrates.",
    "Use the exact supplied caption as the clickable Markdown link text, for example [Customers list — click Add](EXACT_SCREENSHOT_URL).",
    "Do not group all screenshots into one Relevant screenshots section when instructionBlocks are available.",
    "Never label screenshot links Show Image.",
    "Do not invent captions — use only the caption supplied on each screenshot block.",
    "Do not say screenshots are displayed inline unless the chat client actually rendered them.",
    "Keep the official Freshdesk article link in the Helpful resources section.",
    "Use screenshot links only when they support the nearby instruction.",
].join(" ");
export const FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE = [
    "When instructionBlocks are not available, use screenshotUrls with their descriptive captions.",
    "Place each screenshot after the most relevant paragraph where possible.",
    "Use the exact supplied caption as the clickable link text.",
    "Never label screenshot links Show Image.",
    "Do not invent captions.",
    "Do not claim screenshots are shown inline unless the client actually rendered them.",
    "MCP image content blocks are a fallback only.",
    "Do not claim screenshots were supplied when imageCount is 0.",
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
function buildDetailsGuidance(hasInstructionBlocks) {
    return {
        supportFooter: SUPPORT_FOOTER_GUIDANCE,
        freshdeskLinks: FRESHDESK_LINK_RESPONSE_GUIDANCE,
        images: hasInstructionBlocks
            ? FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE
            : FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE,
        ...(hasInstructionBlocks
            ? { instructionBlocks: FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE }
            : {}),
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
        ],
    };
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
    try {
        if (parsed.source === "freshdesk") {
            const article = await findFreshdeskArticleById(parsed.id, freshdeskIndexContainer);
            if (!article) {
                return { ok: false, error: "Help resource was not found." };
            }
            const normalized = fromFreshdeskResource(article);
            const imageResult = await loadFreshdeskImageBlocks(article, imageContainer, {
                includeImages,
                maxImages,
                maxImageBytes: HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES,
                maxTotalBytes: HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES,
            });
            logFreshdeskImageLoadDiagnostics(buildFreshdeskImageLoadDiagnostics(article, imageResult, isFreshdeskImageContainerConfigured()));
            const rawScreenshotUrls = buildFreshdeskScreenshotUrls(article.freshdeskArticleId, getNormalizedFreshdeskSyncedImages(article), imageResult.blocks);
            const screenshotUrls = enrichScreenshotUrlCaptions(rawScreenshotUrls, article.contentBlocks);
            const instructionBlocks = buildFreshdeskInstructionBlocks(article.contentBlocks, screenshotUrls);
            const hasInstructionBlocks = instructionBlocks.length > 0;
            return {
                ok: true,
                payload: {
                    resourceId: normalized.resourceId,
                    source: normalized.source,
                    title: normalized.title,
                    summary: normalized.summary,
                    instructions: normalized.bodyText,
                    publicUrl: getSyncedFreshdeskArticlePublicUrl(article),
                    category: normalized.category,
                    topics: normalized.topics,
                    imageAvailable: freshdeskArticleImageAvailable(article),
                    imageCount: imageResult.imageCount,
                    requestedImageCount: imageResult.requestedImageCount,
                    skippedImageCount: imageResult.skippedImageCount,
                    imageWarning: imageResult.storageWarning,
                    ...(hasInstructionBlocks ? { instructionBlocks } : {}),
                    ...(screenshotUrls.length > 0 ? { screenshotUrls } : {}),
                    responseGuidance: buildDetailsGuidance(hasInstructionBlocks),
                },
                images: imageResult.blocks,
            };
        }
        if (parsed.source === "customer_docs") {
            const resource = await findCustomerDocById(resourceId);
            if (!resource) {
                return { ok: false, error: "Help resource was not found." };
            }
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
                    responseGuidance: buildDetailsGuidance(false),
                },
                images: [],
            };
        }
        if (parsed.source === "recorded_webinar") {
            const resource = await findRecordedWebinarById(resourceId);
            if (!resource) {
                return { ok: false, error: "Help resource was not found." };
            }
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
                    responseGuidance: buildDetailsGuidance(false),
                },
                images: [],
            };
        }
        if (parsed.source === "upcoming_webinar") {
            const resource = await findUpcomingWebinarById(resourceId);
            if (!resource) {
                return { ok: false, error: "Help resource was not found." };
            }
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
                    responseGuidance: buildDetailsGuidance(false),
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
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
            ...sortedImages.flatMap((image) => [
                ...(image.caption
                    ? [{ type: "text", text: image.caption }]
                    : []),
                {
                    type: "image",
                    data: image.data,
                    mimeType: image.mimeType,
                },
            ]),
        ],
    };
}
