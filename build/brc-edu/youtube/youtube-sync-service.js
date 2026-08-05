import { writeSyncedEduResources } from "../../edu/brc_edu_synced_store.js";
import { invalidateEduResourcesCache } from "../../edu/brc_edu_resources.js";
import { buildRawCatalogDocument, mergeYouTubeCatalogWithOverrides, summarizeEffectiveCatalog, upsertYouTubeVideoOverride, } from "./youtube-catalog-merge.js";
import { createConfiguredYouTubeBlobContainer, emptyYouTubeSyncStatus, loadYouTubeEffectiveCatalog, loadYouTubeOverrides, loadYouTubeRawCatalog, loadYouTubeSyncStatus, saveYouTubeEffectiveCatalog, saveYouTubeOverrides, saveYouTubeRawCatalog, saveYouTubeSyncStatus, toSafeYouTubeStorageError, } from "./youtube-catalog-store.js";
import { fetchChannelAndWebinarCatalog, getYouTubeClientConfigFromEnv, } from "./youtube-client.js";
import { invalidateYouTubeEffectiveCatalogCache } from "./youtube-help-loader.js";
import { catalogVideosToEnrichedResources } from "./youtube-resource-mapper.js";
import { DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID, } from "./youtube-types.js";
export { catalogVideoToSupportRow, catalogVideosToEnrichedResources, } from "./youtube-resource-mapper.js";
async function publishSyncedResources(params) {
    const visibleEnriched = catalogVideosToEnrichedResources(params.catalog.items, {
        reviewDate: params.now,
        includeExcluded: false,
    });
    if (params.writeSyncedResources) {
        writeSyncedEduResources(visibleEnriched);
    }
    if (params.invalidateCache) {
        invalidateEduResourcesCache();
        invalidateYouTubeEffectiveCatalogCache();
    }
}
export async function runYouTubeCatalogSync(source, deps = {}) {
    const now = deps.now ?? new Date();
    const nowIso = now.toISOString();
    const container = deps.container === undefined
        ? createConfiguredYouTubeBlobContainer()
        : deps.container;
    const youtubeConfig = deps.youtubeConfig === undefined
        ? getYouTubeClientConfigFromEnv()
        : deps.youtubeConfig;
    const writeSyncedResources = deps.writeSyncedResources !== false;
    const invalidateCache = deps.invalidateCache !== false;
    let status = container
        ? await loadYouTubeSyncStatus(container)
        : emptyYouTubeSyncStatus();
    status = {
        ...status,
        lastAttemptAt: nowIso,
        lastSource: source,
    };
    if (!container) {
        const failure = {
            ok: false,
            error: "BRC Edu upload storage is not configured.",
            preservedPreviousCatalog: true,
            status: {
                ...status,
                lastErrorSummary: "BRC Edu upload storage is not configured.",
            },
        };
        return failure;
    }
    if (!youtubeConfig) {
        const error = "YouTube sync is not configured. Set BRC_YOUTUBE_API_KEY and BRC_YOUTUBE_CHANNEL_ID.";
        status = { ...status, lastErrorSummary: error };
        await saveYouTubeSyncStatus(container, status);
        return {
            ok: false,
            error,
            preservedPreviousCatalog: true,
            status,
        };
    }
    const previousCatalog = await loadYouTubeEffectiveCatalog(container);
    try {
        const fetched = await fetchChannelAndWebinarCatalog(youtubeConfig, {
            lastSyncedAt: nowIso,
        });
        if (fetched.videos.length === 0) {
            const error = "YouTube returned no videos. The previous catalogue was preserved.";
            status = { ...status, lastErrorSummary: error };
            await saveYouTubeSyncStatus(container, status);
            return {
                ok: false,
                error,
                preservedPreviousCatalog: Boolean(previousCatalog),
                status,
            };
        }
        const overridesLoad = await loadYouTubeOverrides(container);
        const rawCatalog = buildRawCatalogDocument({
            videos: fetched.videos,
            channelId: youtubeConfig.channelId,
            webinarPlaylistId: fetched.webinarPlaylistId || DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID,
            generatedAt: nowIso,
        });
        await saveYouTubeRawCatalog(container, rawCatalog);
        const effective = mergeYouTubeCatalogWithOverrides({
            rawVideos: fetched.videos,
            overrides: overridesLoad.document.overrides,
            channelId: youtubeConfig.channelId,
            webinarPlaylistId: rawCatalog.webinarPlaylistId,
            generatedAt: nowIso,
        });
        await saveYouTubeEffectiveCatalog(container, effective);
        await publishSyncedResources({
            catalog: effective,
            writeSyncedResources,
            invalidateCache,
            now,
        });
        const counts = summarizeEffectiveCatalog(effective);
        status = {
            lastAttemptAt: nowIso,
            lastSuccessAt: nowIso,
            lastErrorSummary: null,
            lastSource: source,
            lastCounts: counts,
        };
        await saveYouTubeSyncStatus(container, status);
        return {
            ok: true,
            catalog: effective,
            status,
            counts,
        };
    }
    catch (error) {
        const message = toSafeYouTubeStorageError(error);
        status = {
            ...status,
            lastErrorSummary: message,
        };
        try {
            await saveYouTubeSyncStatus(container, status);
        }
        catch {
            // Keep returning the sync failure even if status persistence fails.
        }
        return {
            ok: false,
            error: message,
            preservedPreviousCatalog: Boolean(previousCatalog),
            status,
        };
    }
}
export async function rebuildEffectiveCatalogFromStores(params) {
    const now = params.now ?? new Date();
    const raw = await loadYouTubeRawCatalog(params.container);
    if (!raw || raw.items.length === 0) {
        throw new Error("No YouTube raw catalogue is available to rebuild.");
    }
    const overridesLoad = await loadYouTubeOverrides(params.container);
    const effective = mergeYouTubeCatalogWithOverrides({
        rawVideos: raw.items,
        overrides: overridesLoad.document.overrides,
        channelId: raw.channelId,
        webinarPlaylistId: raw.webinarPlaylistId,
        generatedAt: now.toISOString(),
    });
    await saveYouTubeEffectiveCatalog(params.container, effective);
    await publishSyncedResources({
        catalog: effective,
        writeSyncedResources: params.writeSyncedResources !== false,
        invalidateCache: params.invalidateCache !== false,
        now,
    });
    return effective;
}
export async function updateYouTubeVideoVisibility(params) {
    const container = params.container === undefined
        ? createConfiguredYouTubeBlobContainer()
        : params.container;
    if (!container) {
        return {
            ok: false,
            status: 503,
            error: "BRC Edu upload storage is not configured.",
        };
    }
    const videoId = params.videoId.trim();
    if (!videoId) {
        return { ok: false, status: 400, error: "videoId is required." };
    }
    const maxRetries = params.maxRetries ?? 3;
    const now = params.now ?? new Date();
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const overridesLoad = await loadYouTubeOverrides(container);
        const raw = await loadYouTubeRawCatalog(container);
        if (!raw) {
            return {
                ok: false,
                status: 404,
                error: "No YouTube catalogue is available. Run a sync first.",
            };
        }
        const rawVideo = raw.items.find((item) => item.videoId === videoId);
        if (!rawVideo) {
            return {
                ok: false,
                status: 404,
                error: "Video was not found in the YouTube catalogue.",
            };
        }
        const nextOverrides = upsertYouTubeVideoOverride(overridesLoad.document.overrides, videoId, {
            excluded: params.excluded,
            reason: params.reason,
            excludedBy: params.excludedBy,
            updatedAt: now.toISOString(),
        });
        try {
            const saved = await saveYouTubeOverrides({
                container,
                document: {
                    updatedAt: now.toISOString(),
                    overrides: nextOverrides,
                },
                ifMatch: overridesLoad.etag || undefined,
            });
            const catalog = await rebuildEffectiveCatalogFromStores({
                container,
                writeSyncedResources: params.writeSyncedResources,
                invalidateCache: params.invalidateCache,
                now,
            });
            const video = catalog.items.find((item) => item.videoId === videoId);
            if (!video) {
                return {
                    ok: false,
                    status: 404,
                    error: "Video was not found after updating visibility.",
                };
            }
            return {
                ok: true,
                video,
                catalog,
                overridesEtag: saved.etag,
            };
        }
        catch (error) {
            const statusCode = error.statusCode;
            if (statusCode === 409 && attempt < maxRetries - 1) {
                continue;
            }
            if (statusCode === 409) {
                return {
                    ok: false,
                    status: 409,
                    error: "Another administrator updated video visibility at the same time. Please retry.",
                };
            }
            return {
                ok: false,
                status: 503,
                error: toSafeYouTubeStorageError(error),
            };
        }
    }
    return {
        ok: false,
        status: 409,
        error: "Another administrator updated video visibility at the same time. Please retry.",
    };
}
export async function loadYouTubeVideosForAdmin(container = createConfiguredYouTubeBlobContainer()) {
    if (!container) {
        return {
            ok: false,
            status: 503,
            error: "BRC Edu upload storage is not configured.",
        };
    }
    try {
        const [catalog, status] = await Promise.all([
            loadYouTubeEffectiveCatalog(container),
            loadYouTubeSyncStatus(container),
        ]);
        const items = catalog?.items ?? [];
        const counts = catalog
            ? summarizeEffectiveCatalog(catalog)
            : {
                total: 0,
                visible: 0,
                excluded: 0,
                recordedWebinar: 0,
                youtubeVideo: 0,
            };
        return {
            ok: true,
            payload: {
                videos: items,
                status,
                counts,
            },
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 503,
            error: toSafeYouTubeStorageError(error),
        };
    }
}
