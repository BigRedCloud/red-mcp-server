import { getBrcEduUploadContainer, getBrcEduUploadStorageConnectionString, } from "../../edu/brc_edu_upload_store.js";
import { BIGREDCLOUD_WEBINAR_SERIES_RULE, safeWebFetchText, } from "../help/safe-web-fetch.js";
import { buildVersionedHelpIndex, createHelpIndexContainer, loadVersionedHelpIndex, saveVersionedHelpIndex, } from "../help/versioned-index-store.js";
import { parseUpcomingWebinarsFromHtml, UPCOMING_WEBINAR_PAGE_URL, } from "./upcoming-webinar-parser.js";
export const UPCOMING_WEBINARS_INDEX_LATEST_BLOB = "brc-edu/upcoming-webinars/latest/webinars.json";
export const UPCOMING_WEBINARS_INDEX_ARCHIVE_PREFIX = "brc-edu/upcoming-webinars/archive/webinars";
export function parseUpcomingWebinarsIndex(value) {
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
        const webinar = item;
        if (typeof webinar.resourceId !== "string" ||
            webinar.source !== "upcoming_webinar" ||
            typeof webinar.title !== "string") {
            return null;
        }
    }
    return {
        generatedAt: record.generatedAt,
        itemCount: typeof record.itemCount === "number" ? record.itemCount : record.items.length,
        items: record.items,
    };
}
export function createConfiguredUpcomingWebinarsIndexContainer() {
    const connectionString = getBrcEduUploadStorageConnectionString();
    const containerName = getBrcEduUploadContainer();
    if (!connectionString || !containerName) {
        return null;
    }
    return createHelpIndexContainer(connectionString, containerName);
}
export async function loadUpcomingWebinarsIndex(container) {
    return loadVersionedHelpIndex(container, UPCOMING_WEBINARS_INDEX_LATEST_BLOB, parseUpcomingWebinarsIndex);
}
export async function saveUpcomingWebinarsIndex(container, webinars, options = {}) {
    const index = buildVersionedHelpIndex(webinars, options.generatedAt);
    return saveVersionedHelpIndex(container, {
        latestBlobPath: UPCOMING_WEBINARS_INDEX_LATEST_BLOB,
        archiveBlobPathPrefix: UPCOMING_WEBINARS_INDEX_ARCHIVE_PREFIX,
    }, index, { previousIndex: options.previousIndex, generatedAt: options.generatedAt });
}
export async function syncUpcomingWebinarsIndex(container, options = {}) {
    const previousIndex = await loadUpcomingWebinarsIndex(container);
    try {
        const page = await safeWebFetchText(UPCOMING_WEBINAR_PAGE_URL, [BIGREDCLOUD_WEBINAR_SERIES_RULE], options);
        const webinars = parseUpcomingWebinarsFromHtml(page.text, page.url);
        const index = await saveUpcomingWebinarsIndex(container, webinars, {
            previousIndex,
        });
        return {
            ok: true,
            index,
            webinars,
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
let upcomingWebinarsIndexCache = null;
export function resetUpcomingWebinarsIndexCacheForTests() {
    upcomingWebinarsIndexCache = null;
}
function getUpcomingWebinarsCacheTtlMs() {
    const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
    const minutes = rawMinutes ? Number(rawMinutes) : 5;
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 5 * 60 * 1000;
    }
    return minutes * 60 * 1000;
}
export async function loadUpcomingWebinarsForHelpSearch(options = {}) {
    const now = options.now ?? Date.now();
    const ttlMs = getUpcomingWebinarsCacheTtlMs();
    if (upcomingWebinarsIndexCache && upcomingWebinarsIndexCache.expiresAt > now) {
        return "unavailable" in upcomingWebinarsIndexCache
            ? null
            : upcomingWebinarsIndexCache.webinars;
    }
    try {
        const container = options.container === undefined
            ? createConfiguredUpcomingWebinarsIndexContainer()
            : options.container;
        if (!container) {
            upcomingWebinarsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
            return null;
        }
        const index = await loadUpcomingWebinarsIndex(container);
        if (!index) {
            upcomingWebinarsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
            return null;
        }
        upcomingWebinarsIndexCache = {
            webinars: index.items.filter((item) => item.enabled),
            expiresAt: now + ttlMs,
        };
        return upcomingWebinarsIndexCache.webinars;
    }
    catch {
        upcomingWebinarsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
        return null;
    }
}
