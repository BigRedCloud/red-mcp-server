export const YOUTUBE_VIDEO_CATEGORIES = [
    "recorded_webinar",
    "youtube_video",
];
export const DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID = "PL2rEGgtssfJ9w74MU2yi88FIUB345pp2D";
export const DEFAULT_BRC_YOUTUBE_CATALOG_BLOB = "brc-edu/youtube/youtube-videos.json";
export const DEFAULT_BRC_YOUTUBE_OVERRIDES_BLOB = "brc-edu/youtube/video-overrides.json";
export const DEFAULT_BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB = "brc-edu/youtube/effective-video-catalog.json";
export const DEFAULT_BRC_YOUTUBE_SYNC_STATUS_BLOB = "brc-edu/youtube/sync-status.json";
export const DEFAULT_BRC_YOUTUBE_SYNC_SCHEDULE = "0 0 * * * *";
export function buildYouTubeWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}
export function isYouTubeVideoCategory(value) {
    return (typeof value === "string" &&
        YOUTUBE_VIDEO_CATEGORIES.includes(value));
}
export function extractYouTubeVideoIdFromUrl(url) {
    try {
        const parsed = new URL(url.trim());
        const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
        if (host === "youtu.be") {
            const id = parsed.pathname.replace(/^\//, "").split("/")[0]?.trim();
            return id || null;
        }
        if (host === "youtube.com" || host.endsWith(".youtube.com")) {
            const fromQuery = parsed.searchParams.get("v")?.trim();
            if (fromQuery) {
                return fromQuery;
            }
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts[0] &&
                ["embed", "shorts", "live", "v"].includes(parts[0].toLowerCase()) &&
                parts[1]) {
                return parts[1];
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
