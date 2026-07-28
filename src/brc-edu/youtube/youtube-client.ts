import {
  DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID,
  buildYouTubeWatchUrl,
  type YouTubeRawCatalogVideo,
  type YouTubeVideoCategory,
} from "./youtube-types.js";

export type YouTubeClientFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type YouTubeClientConfig = {
  apiKey: string;
  channelId: string;
  uploadsPlaylistId?: string | null;
  webinarPlaylistId?: string | null;
  fetchImpl?: YouTubeClientFetch;
};

export type YouTubePlaylistItemRef = {
  videoId: string;
  playlistId: string;
  publishedAt?: string;
};

export type YouTubeVideoSnippet = {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  publishedAt: string;
  updatedAt?: string;
  thumbnailUrl?: string;
};

type YouTubeApiErrorBody = {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function toSafeYouTubeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/key=/i.test(message) || /AIza/i.test(message)) {
    return "YouTube API request failed.";
  }
  return message;
}

export function getYouTubeClientConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): YouTubeClientConfig | null {
  const apiKey = env.BRC_YOUTUBE_API_KEY?.trim() ?? "";
  const channelId = env.BRC_YOUTUBE_CHANNEL_ID?.trim() ?? "";

  if (!apiKey || !channelId) {
    return null;
  }

  return {
    apiKey,
    channelId,
    uploadsPlaylistId: env.BRC_YOUTUBE_UPLOADS_PLAYLIST_ID?.trim() || null,
    webinarPlaylistId:
      env.BRC_YOUTUBE_WEBINAR_PLAYLIST_ID?.trim() ||
      DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID,
  };
}

export function classifyYouTubeVideoCategory(
  videoId: string,
  webinarVideoIds: ReadonlySet<string>,
): YouTubeVideoCategory {
  return webinarVideoIds.has(videoId) ? "recorded_webinar" : "youtube_video";
}

export function pickBestThumbnailUrl(
  thumbnails: Record<string, { url?: string } | undefined> | undefined,
): string | undefined {
  if (!thumbnails || typeof thumbnails !== "object") {
    return undefined;
  }

  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const url = asTrimmedString(thumbnails[key]?.url);
    if (url) {
      return url;
    }
  }

  return undefined;
}

async function youtubeGetJson(
  url: string,
  fetchImpl: YouTubeClientFetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(toSafeYouTubeErrorMessage(error));
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const apiError = body as YouTubeApiErrorBody | null;
    const apiMessage = asTrimmedString(apiError?.error?.message);
    throw new Error(
      apiMessage
        ? `YouTube API request failed (${response.status}): ${apiMessage}`
        : `YouTube API request failed (${response.status}).`,
    );
  }

  return body;
}

function buildApiUrl(
  path: string,
  params: Record<string, string | undefined>,
  apiKey: string,
): string {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set("key", apiKey);
  return url.toString();
}

export async function resolveChannelUploadsPlaylistId(
  config: YouTubeClientConfig,
): Promise<string> {
  if (config.uploadsPlaylistId) {
    return config.uploadsPlaylistId;
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const url = buildApiUrl(
    "channels",
    {
      part: "contentDetails",
      id: config.channelId,
      maxResults: "1",
    },
    config.apiKey,
  );

  const body = (await youtubeGetJson(url, fetchImpl)) as {
    items?: Array<{
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  };

  const uploads =
    body.items?.[0]?.contentDetails?.relatedPlaylists?.uploads?.trim() ?? "";
  if (!uploads) {
    throw new Error("Could not resolve the Big Red Cloud uploads playlist.");
  }

  return uploads;
}

export async function listAllPlaylistVideoIds(
  config: YouTubeClientConfig,
  playlistId: string,
): Promise<YouTubePlaylistItemRef[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const items: YouTubePlaylistItemRef[] = [];
  let pageToken: string | undefined;

  do {
    const url = buildApiUrl(
      "playlistItems",
      {
        part: "contentDetails,snippet",
        playlistId,
        maxResults: "50",
        pageToken,
      },
      config.apiKey,
    );

    const body = (await youtubeGetJson(url, fetchImpl)) as {
      nextPageToken?: string;
      items?: Array<{
        contentDetails?: { videoId?: string; videoPublishedAt?: string };
        snippet?: { publishedAt?: string; resourceId?: { videoId?: string } };
      }>;
    };

    for (const item of body.items ?? []) {
      const videoId =
        asTrimmedString(item.contentDetails?.videoId) ||
        asTrimmedString(item.snippet?.resourceId?.videoId);
      if (!videoId) {
        continue;
      }

      items.push({
        videoId,
        playlistId,
        publishedAt:
          asTrimmedString(item.contentDetails?.videoPublishedAt) ||
          asTrimmedString(item.snippet?.publishedAt) ||
          undefined,
      });
    }

    pageToken = asTrimmedString(body.nextPageToken) || undefined;
  } while (pageToken);

  return items;
}

export async function fetchVideoSnippetsByIds(
  config: YouTubeClientConfig,
  videoIds: string[],
): Promise<Map<string, YouTubeVideoSnippet>> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const uniqueIds = [...new Set(videoIds.map((id) => id.trim()).filter(Boolean))];
  const results = new Map<string, YouTubeVideoSnippet>();

  for (let index = 0; index < uniqueIds.length; index += 50) {
    const batch = uniqueIds.slice(index, index + 50);
    const url = buildApiUrl(
      "videos",
      {
        part: "snippet",
        id: batch.join(","),
        maxResults: "50",
      },
      config.apiKey,
    );

    const body = (await youtubeGetJson(url, fetchImpl)) as {
      items?: Array<{
        id?: string;
        snippet?: {
          title?: string;
          description?: string;
          channelId?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string } | undefined>;
        };
      }>;
    };

    for (const item of body.items ?? []) {
      const videoId = asTrimmedString(item.id);
      const snippet = item.snippet;
      if (!videoId || !snippet) {
        continue;
      }

      const title = asTrimmedString(snippet.title);
      const channelId = asTrimmedString(snippet.channelId) || config.channelId;
      const publishedAt = asTrimmedString(snippet.publishedAt);
      if (!title || !publishedAt) {
        continue;
      }

      results.set(videoId, {
        videoId,
        title,
        description: asTrimmedString(snippet.description),
        channelId,
        publishedAt,
        thumbnailUrl: pickBestThumbnailUrl(snippet.thumbnails),
      });
    }
  }

  return results;
}

export function buildRawCatalogVideos(params: {
  channelId: string;
  webinarPlaylistId: string;
  uploadItems: YouTubePlaylistItemRef[];
  webinarItems: YouTubePlaylistItemRef[];
  snippets: Map<string, YouTubeVideoSnippet>;
  lastSyncedAt: string;
}): YouTubeRawCatalogVideo[] {
  const webinarVideoIds = new Set(params.webinarItems.map((item) => item.videoId));
  const playlistIdsByVideo = new Map<string, Set<string>>();

  for (const item of [...params.uploadItems, ...params.webinarItems]) {
    const existing = playlistIdsByVideo.get(item.videoId) ?? new Set<string>();
    existing.add(item.playlistId);
    playlistIdsByVideo.set(item.videoId, existing);
  }

  const videos: YouTubeRawCatalogVideo[] = [];

  for (const [videoId, playlistIds] of playlistIdsByVideo) {
    const snippet = params.snippets.get(videoId);
    if (!snippet) {
      continue;
    }

    // Only include videos that belong to the configured channel uploads set,
    // or appear on the webinar playlist (defensive for shared playlist oddities).
    const onUploads = params.uploadItems.some((item) => item.videoId === videoId);
    const onWebinar = webinarVideoIds.has(videoId);
    if (!onUploads && !onWebinar) {
      continue;
    }

    if (
      snippet.channelId &&
      params.channelId &&
      snippet.channelId !== params.channelId &&
      !onWebinar
    ) {
      continue;
    }

    const category = classifyYouTubeVideoCategory(videoId, webinarVideoIds);
    videos.push({
      videoId,
      title: snippet.title,
      description: snippet.description,
      url: buildYouTubeWatchUrl(videoId),
      thumbnailUrl: snippet.thumbnailUrl,
      publishedAt: snippet.publishedAt,
      updatedAt: snippet.updatedAt,
      channelId: snippet.channelId || params.channelId,
      category,
      playlistIds: [...playlistIds].sort(),
      lastSyncedAt: params.lastSyncedAt,
    });
  }

  videos.sort((left, right) => {
    const byDate = right.publishedAt.localeCompare(left.publishedAt);
    if (byDate !== 0) {
      return byDate;
    }
    return left.videoId.localeCompare(right.videoId);
  });

  return videos;
}

export async function fetchChannelAndWebinarCatalog(
  config: YouTubeClientConfig,
  options: { lastSyncedAt?: string } = {},
): Promise<{
  uploadsPlaylistId: string;
  webinarPlaylistId: string;
  videos: YouTubeRawCatalogVideo[];
}> {
  const webinarPlaylistId =
    config.webinarPlaylistId?.trim() || DEFAULT_BRC_YOUTUBE_WEBINAR_PLAYLIST_ID;
  const uploadsPlaylistId = await resolveChannelUploadsPlaylistId(config);
  const [uploadItems, webinarItems] = await Promise.all([
    listAllPlaylistVideoIds(config, uploadsPlaylistId),
    listAllPlaylistVideoIds(config, webinarPlaylistId),
  ]);

  const allIds = [
    ...new Set([
      ...uploadItems.map((item) => item.videoId),
      ...webinarItems.map((item) => item.videoId),
    ]),
  ];

  const snippets = await fetchVideoSnippetsByIds(config, allIds);
  const lastSyncedAt = options.lastSyncedAt ?? new Date().toISOString();

  return {
    uploadsPlaylistId,
    webinarPlaylistId,
    videos: buildRawCatalogVideos({
      channelId: config.channelId,
      webinarPlaylistId,
      uploadItems,
      webinarItems,
      snippets,
      lastSyncedAt,
    }),
  };
}
