function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
export function mergeYouTubeCatalogWithOverrides(params) {
    const generatedAt = params.generatedAt ?? new Date().toISOString();
    const items = params.rawVideos.map((video) => {
        const override = params.overrides[video.videoId];
        return applyOverrideToRawVideo(video, override);
    });
    const visibleCount = items.filter((item) => !item.excluded).length;
    const excludedCount = items.length - visibleCount;
    return {
        generatedAt,
        channelId: params.channelId,
        webinarPlaylistId: params.webinarPlaylistId,
        itemCount: items.length,
        visibleCount,
        excludedCount,
        items,
    };
}
export function applyOverrideToRawVideo(video, override) {
    if (!override || !override.excluded) {
        return {
            ...video,
            excluded: false,
        };
    }
    return {
        ...video,
        excluded: true,
        excludedAt: asTrimmedString(override.excludedAt) || undefined,
        excludedBy: asTrimmedString(override.excludedBy) || undefined,
        exclusionReason: asTrimmedString(override.reason) || undefined,
    };
}
export function upsertYouTubeVideoOverride(current, videoId, next) {
    const updatedAt = next.updatedAt ?? new Date().toISOString();
    const copy = { ...current };
    if (!next.excluded) {
        // Keep an explicit restore record so sync never "forgets" staff intent,
        // while still treating excluded=false as visible.
        copy[videoId] = {
            excluded: false,
            reason: asTrimmedString(next.reason) || undefined,
            excludedBy: asTrimmedString(next.excludedBy) || undefined,
            updatedAt,
        };
        return copy;
    }
    copy[videoId] = {
        excluded: true,
        excludedAt: updatedAt,
        excludedBy: asTrimmedString(next.excludedBy) || undefined,
        reason: asTrimmedString(next.reason) || undefined,
        updatedAt,
    };
    return copy;
}
export function buildRawCatalogDocument(params) {
    const generatedAt = params.generatedAt ?? new Date().toISOString();
    return {
        generatedAt,
        channelId: params.channelId,
        webinarPlaylistId: params.webinarPlaylistId,
        itemCount: params.videos.length,
        items: params.videos,
    };
}
export function summarizeEffectiveCatalog(catalog) {
    let recordedWebinar = 0;
    let youtubeVideo = 0;
    for (const item of catalog.items) {
        if (item.category === "recorded_webinar") {
            recordedWebinar += 1;
        }
        else {
            youtubeVideo += 1;
        }
    }
    return {
        total: catalog.itemCount,
        visible: catalog.visibleCount,
        excluded: catalog.excludedCount,
        recordedWebinar,
        youtubeVideo,
    };
}
