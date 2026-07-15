import { getBrcEduUploadContainer, getBrcEduUploadStorageConnectionString, } from "../../edu/brc_edu_upload_store.js";
import { buildVersionedHelpIndex, createHelpIndexContainer, loadVersionedHelpIndex, saveVersionedHelpIndex, } from "../help/versioned-index-store.js";
import { crawlCustomerDocumentation, } from "./customer-docs-crawler.js";
export const CUSTOMER_DOCS_INDEX_LATEST_BLOB = "brc-edu/customer-docs/latest/articles.json";
export const CUSTOMER_DOCS_INDEX_ARCHIVE_PREFIX = "brc-edu/customer-docs/archive/articles";
export function parseCustomerDocsIndex(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const record = value;
    if (typeof record.generatedAt !== "string" || !Array.isArray(record.items)) {
        return null;
    }
    for (const item of record.items) {
        if (typeof item !== "object" || item === null) {
            return null;
        }
        const article = item;
        if (typeof article.resourceId !== "string" ||
            article.source !== "customer_docs" ||
            typeof article.title !== "string" ||
            typeof article.url !== "string") {
            return null;
        }
    }
    return {
        generatedAt: record.generatedAt,
        itemCount: typeof record.itemCount === "number" ? record.itemCount : record.items.length,
        items: record.items,
    };
}
export function createConfiguredCustomerDocsIndexContainer() {
    const connectionString = getBrcEduUploadStorageConnectionString();
    const containerName = getBrcEduUploadContainer();
    if (!connectionString || !containerName) {
        return null;
    }
    return createHelpIndexContainer(connectionString, containerName);
}
export async function loadCustomerDocsIndex(container) {
    return loadVersionedHelpIndex(container, CUSTOMER_DOCS_INDEX_LATEST_BLOB, parseCustomerDocsIndex);
}
export async function saveCustomerDocsIndex(container, articles, options = {}) {
    const index = buildVersionedHelpIndex(articles, options.generatedAt);
    return saveVersionedHelpIndex(container, {
        latestBlobPath: CUSTOMER_DOCS_INDEX_LATEST_BLOB,
        archiveBlobPathPrefix: CUSTOMER_DOCS_INDEX_ARCHIVE_PREFIX,
    }, index, { previousIndex: options.previousIndex, generatedAt: options.generatedAt });
}
export async function syncCustomerDocumentationIndex(container, options = {}) {
    const previousIndex = await loadCustomerDocsIndex(container);
    try {
        const crawl = await crawlCustomerDocumentation(options);
        const index = await saveCustomerDocsIndex(container, crawl.articles, {
            previousIndex,
        });
        return {
            ok: true,
            index,
            crawl,
        };
    }
    catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            preservedPreviousIndex: previousIndex != null,
        };
    }
}
let customerDocsIndexCache = null;
export function resetCustomerDocsIndexCacheForTests() {
    customerDocsIndexCache = null;
}
function getCustomerDocsCacheTtlMs() {
    const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
    const minutes = rawMinutes ? Number(rawMinutes) : 5;
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 5 * 60 * 1000;
    }
    return minutes * 60 * 1000;
}
export async function loadCustomerDocsForHelpSearch(options = {}) {
    const now = options.now ?? Date.now();
    const ttlMs = getCustomerDocsCacheTtlMs();
    if (customerDocsIndexCache && customerDocsIndexCache.expiresAt > now) {
        return "unavailable" in customerDocsIndexCache
            ? null
            : customerDocsIndexCache.articles;
    }
    try {
        const container = options.container === undefined
            ? createConfiguredCustomerDocsIndexContainer()
            : options.container;
        if (!container) {
            customerDocsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
            return null;
        }
        const index = await loadCustomerDocsIndex(container);
        if (!index) {
            customerDocsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
            return null;
        }
        customerDocsIndexCache = {
            articles: index.items.filter((item) => item.enabled),
            expiresAt: now + ttlMs,
        };
        return customerDocsIndexCache.articles;
    }
    catch {
        customerDocsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
        return null;
    }
}
