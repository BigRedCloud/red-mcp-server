import { loadCustomerDocsForHelpSearch } from "../customer-docs/customer-docs-index-store.js";
import { createConfiguredFreshdeskIndexContainer, loadFreshdeskArticlesIndex, } from "../freshdesk/freshdesk-index-store.js";
import { createConfiguredFreshdeskImageContainer, } from "../freshdesk/image-sync.js";
import { loadUpcomingWebinarsForHelpSearch } from "../upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import { parseHelpResourceId, } from "./help-resource-types.js";
import { toSafeVersionedIndexStorageError } from "./versioned-index-store.js";
import { FRESHDESK_LINK_RESPONSE_GUIDANCE, getSyncedFreshdeskArticlePublicUrl, } from "../freshdesk/freshdesk-article-url.js";
import { fromFreshdeskResource, fromRecordedWebinarResource, SUPPORT_FOOTER_GUIDANCE, } from "./unified-help-search.js";
export const HELP_RESOURCE_DETAILS_MAX_IMAGES = 5;
export const HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES = 512 * 1024;
export const HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES = 2 * 1024 * 1024;
async function readBlobBytes(container, blobName) {
    try {
        const blobClient = container.getBlockBlobClient(blobName);
        const exists = await blobClient.exists();
        if (!exists) {
            return null;
        }
        const response = await blobClient.download(0);
        const chunks = [];
        for await (const chunk of response.readableStreamBody ?? []) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }
    catch {
        return null;
    }
}
export async function loadFreshdeskImageBlocks(article, container, options = {}) {
    if (!container || article.syncedImages.length === 0) {
        return [];
    }
    const maxImages = options.maxImages ?? HELP_RESOURCE_DETAILS_MAX_IMAGES;
    const maxImageBytes = options.maxImageBytes ?? HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES;
    const blocks = [];
    let totalBytes = 0;
    for (const image of article.syncedImages.slice(0, maxImages)) {
        const buffer = await readBlobBytes(container, image.blobName);
        if (!buffer || buffer.byteLength === 0) {
            continue;
        }
        if (buffer.byteLength > maxImageBytes) {
            continue;
        }
        if (totalBytes + buffer.byteLength > maxTotalBytes) {
            break;
        }
        totalBytes += buffer.byteLength;
        blocks.push({
            mimeType: image.contentType,
            data: buffer.toString("base64"),
        });
    }
    return blocks;
}
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
function buildDetailsGuidance() {
    return {
        supportFooter: SUPPORT_FOOTER_GUIDANCE,
        freshdeskLinks: FRESHDESK_LINK_RESPONSE_GUIDANCE,
        doNotExpose: [
            "resource IDs in customer-facing text",
            "Azure blob names",
            "storage URLs",
            "Freshdesk source image URLs",
            "sync metadata",
            "invented Freshdesk article URLs",
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
    try {
        if (parsed.source === "freshdesk") {
            const article = await findFreshdeskArticleById(parsed.id, freshdeskIndexContainer);
            if (!article) {
                return { ok: false, error: "Help resource was not found." };
            }
            const normalized = fromFreshdeskResource(article);
            const images = await loadFreshdeskImageBlocks(article, imageContainer);
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
                    imageCount: images.length,
                    responseGuidance: buildDetailsGuidance(),
                },
                images,
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
                    responseGuidance: buildDetailsGuidance(),
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
                    responseGuidance: buildDetailsGuidance(),
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
                    responseGuidance: buildDetailsGuidance(),
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
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
            ...images.map((image) => ({
                type: "image",
                data: image.data,
                mimeType: image.mimeType,
            })),
        ],
    };
}
