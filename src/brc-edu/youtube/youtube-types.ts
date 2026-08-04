export const YOUTUBE_VIDEO_CATEGORIES = [
  "recorded_webinar",
  "youtube_video",
] as const;

export type YouTubeVideoCategory = (typeof YOUTUBE_VIDEO_CATEGORIES)[number];

export const DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID =
  "PL2rEGgtssfJ9w74MU2yi88FIUB345pp2D";

export const DEFAULT_BRC_YOUTUBE_CATALOG_BLOB =
  "brc-edu/youtube/youtube-videos.json";

export const DEFAULT_BRC_YOUTUBE_OVERRIDES_BLOB =
  "brc-edu/youtube/video-overrides.json";

export const DEFAULT_BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB =
  "brc-edu/youtube/effective-video-catalog.json";

export const DEFAULT_BRC_YOUTUBE_SYNC_STATUS_BLOB =
  "brc-edu/youtube/sync-status.json";

export const DEFAULT_BRC_YOUTUBE_SYNC_SCHEDULE = "0 0 * * * *";

export interface YouTubeCatalogVideo {
  videoId: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl?: string;
  publishedAt: string;
  updatedAt?: string;
  channelId: string;
  category: YouTubeVideoCategory;
  playlistIds: string[];
  excluded: boolean;
  excludedAt?: string;
  excludedBy?: string;
  exclusionReason?: string;
  lastSyncedAt: string;
}

export interface YouTubeVideoOverride {
  excluded: boolean;
  excludedAt?: string;
  excludedBy?: string;
  reason?: string;
  updatedAt: string;
}

export type YouTubeVideoOverridesMap = Record<string, YouTubeVideoOverride>;

export type YouTubeRawCatalog = {
  generatedAt: string;
  channelId: string;
  webinarPlaylistId: string;
  itemCount: number;
  items: YouTubeRawCatalogVideo[];
};

/** Raw YouTube metadata before staff overrides are applied. */
export type YouTubeRawCatalogVideo = Omit<
  YouTubeCatalogVideo,
  | "excluded"
  | "excludedAt"
  | "excludedBy"
  | "exclusionReason"
>;

export type YouTubeEffectiveCatalog = {
  generatedAt: string;
  channelId: string;
  webinarPlaylistId: string;
  itemCount: number;
  visibleCount: number;
  excludedCount: number;
  items: YouTubeCatalogVideo[];
};

export type YouTubeOverridesDocument = {
  updatedAt: string;
  overrides: YouTubeVideoOverridesMap;
};

export type YouTubeSyncStatus = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorSummary: string | null;
  lastSource: "timer" | "webhook" | "manual" | "unknown" | null;
  lastCounts: {
    total: number;
    visible: number;
    excluded: number;
    recordedWebinar: number;
    youtubeVideo: number;
  } | null;
};

export type YouTubeSyncSource = NonNullable<YouTubeSyncStatus["lastSource"]>;

export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function isYouTubeVideoCategory(
  value: unknown,
): value is YouTubeVideoCategory {
  return (
    typeof value === "string" &&
    (YOUTUBE_VIDEO_CATEGORIES as readonly string[]).includes(value)
  );
}

export function extractYouTubeVideoIdFromUrl(url: string): string | null {
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
      if (
        parts[0] &&
        ["embed", "shorts", "live", "v"].includes(parts[0].toLowerCase()) &&
        parts[1]
      ) {
        return parts[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}
