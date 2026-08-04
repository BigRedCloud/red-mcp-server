import { createConfiguredYouTubeBlobContainer, loadYouTubeEffectiveCatalog, } from "./youtube-catalog-store.js";
import { catalogVideosToEnrichedResources } from "./youtube-resource-mapper.js";
let effectiveCatalogCache = null;
function getCacheTtlMs() {
    const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
    const minutes = rawMinutes ? Number(rawMinutes) : 5;
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 5 * 60 * 1000;
    }
    return minutes * 60 * 1000;
}
export function resetYouTubeEffectiveCatalogCacheForTests() {
    effectiveCatalogCache = null;
}
export function invalidateYouTubeEffectiveCatalogCache() {
    effectiveCatalogCache = null;
}
/**
 * Loads visible (non-excluded) YouTube catalogue videos for Red customer help search.
 * Prefers effective-video-catalog.json in Azure Blob; returns null when unavailable
 * so callers can fall back to the legacy synced JSON / local CSV path.
 */
export async function loadVisibleYouTubeResourcesForHelpSearch(container = createConfiguredYouTubeBlobContainer(), options) {
    const now = options?.now ?? Date.now();
    if (effectiveCatalogCache && effectiveCatalogCache.expiresAt > now) {
        return effectiveCatalogCache.resources;
    }
    if (!container) {
        return null;
    }
    try {
        const catalog = await loadYouTubeEffectiveCatalog(container);
        if (!catalog || catalog.items.length === 0) {
            return null;
        }
        const resources = catalogVideosToEnrichedResources(catalog.items, {
            includeExcluded: false,
        });
        effectiveCatalogCache = {
            resources,
            adminVideos: catalog.items,
            expiresAt: now + getCacheTtlMs(),
        };
        return resources;
    }
    catch {
        return null;
    }
}
