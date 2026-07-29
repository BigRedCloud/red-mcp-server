import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeYouTubeCatalogWithOverrides,
  upsertYouTubeVideoOverride,
} from "./youtube-catalog-merge.js";
import {
  parseYouTubeEffectiveCatalog,
  parseYouTubeOverridesDocument,
  parseYouTubeRawCatalog,
} from "./youtube-catalog-store.js";
import { runYouTubeCatalogSync, updateYouTubeVideoVisibility } from "./youtube-sync-service.js";
import type { YouTubeRawCatalogVideo } from "./youtube-types.js";

function rawVideo(
  overrides: Partial<YouTubeRawCatalogVideo> & Pick<YouTubeRawCatalogVideo, "videoId" | "category">,
): YouTubeRawCatalogVideo {
  return {
    title: "Title",
    description: "Description",
    url: `https://www.youtube.com/watch?v=${overrides.videoId}`,
    publishedAt: "2024-01-01T00:00:00Z",
    channelId: "channel-1",
    playlistIds: ["UU_UPLOADS"],
    lastSyncedAt: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

test("parseYouTubeRawCatalog rejects invalid payloads", () => {
  assert.equal(parseYouTubeRawCatalog(null), null);
  assert.equal(parseYouTubeRawCatalog({ generatedAt: "x", items: [{ videoId: "a" }] }), null);
});

test("parseYouTubeEffectiveCatalog accepts valid catalogue", () => {
  const parsed = parseYouTubeEffectiveCatalog({
    generatedAt: "2024-01-01T00:00:00Z",
    channelId: "channel-1",
    webinarPlaylistId: "PL",
    itemCount: 1,
    visibleCount: 1,
    excludedCount: 0,
    items: [
      {
        ...rawVideo({ videoId: "v1", category: "youtube_video" }),
        excluded: false,
      },
    ],
  });

  assert.ok(parsed);
  assert.equal(parsed?.items[0]?.videoId, "v1");
});

test("failed YouTube requests do not delete the previous working catalogue", async () => {
  let savedRaw: unknown = {
    generatedAt: "2024-01-01T00:00:00Z",
    channelId: "channel-1",
    webinarPlaylistId: "PL",
    itemCount: 1,
    items: [rawVideo({ videoId: "keep-me", category: "youtube_video" })],
  };
  let savedEffective: unknown = {
    generatedAt: "2024-01-01T00:00:00Z",
    channelId: "channel-1",
    webinarPlaylistId: "PL",
    itemCount: 1,
    visibleCount: 1,
    excludedCount: 0,
    items: [
      {
        ...rawVideo({ videoId: "keep-me", category: "youtube_video" }),
        excluded: false,
      },
    ],
  };
  const blobs = new Map<string, { body: string; etag: string }>();

  const container = {
    getBlockBlobClient(path: string) {
      return {
        async exists() {
          return blobs.has(path) || path.includes("effective") || path.includes("youtube-videos");
        },
        async getProperties() {
          return { etag: blobs.get(path)?.etag ?? '"etag-1"' };
        },
        async download() {
          const stored = blobs.get(path);
          const body =
            stored?.body ??
            (path.includes("effective")
              ? JSON.stringify(savedEffective)
              : path.includes("youtube-videos")
                ? JSON.stringify(savedRaw)
                : path.includes("overrides")
                  ? JSON.stringify({ updatedAt: "2024-01-01T00:00:00Z", overrides: {} })
                  : JSON.stringify({
                      lastAttemptAt: null,
                      lastSuccessAt: "2024-01-01T00:00:00Z",
                      lastErrorSummary: null,
                      lastSource: "manual",
                      lastCounts: null,
                    }));
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(body, "utf8");
            })(),
          };
        },
        async uploadData(buffer: Buffer) {
          const text = buffer.toString("utf8");
          blobs.set(path, { body: text, etag: `"etag-${blobs.size + 2}"` });
          if (path.includes("youtube-videos") && !path.includes("effective")) {
            savedRaw = JSON.parse(text);
          }
          if (path.includes("effective")) {
            savedEffective = JSON.parse(text);
          }
        },
      };
    },
  } as never;

  const result = await runYouTubeCatalogSync("manual", {
    container,
    youtubeConfig: {
      apiKey: "key",
      channelId: "channel-1",
      uploadsPlaylistId: "UU",
      webinarPlaylistId: "PL",
      fetchImpl: async () => {
        throw new Error("YouTube API unavailable");
      },
    },
    writeSyncedResources: false,
    invalidateCache: false,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.preservedPreviousCatalog, true);
  }

  const effective = parseYouTubeEffectiveCatalog(savedEffective);
  assert.equal(effective?.items[0]?.videoId, "keep-me");
});

test("failed catalogue writes refuse empty YouTube catalogues", async () => {
  const { saveYouTubeRawCatalog } = await import("./youtube-catalog-store.js");

  await assert.rejects(
    () =>
      saveYouTubeRawCatalog({} as never, {
        generatedAt: "2024-01-01T00:00:00Z",
        channelId: "channel-1",
        webinarPlaylistId: "PL",
        itemCount: 0,
        items: [],
      }),
    /empty/i,
  );
});

test("concurrent override changes do not silently overwrite each other", () => {
  const first = upsertYouTubeVideoOverride({}, "vid-1", {
    excluded: true,
    reason: "first",
    updatedAt: "2024-01-01T00:00:00Z",
  });
  const second = upsertYouTubeVideoOverride(first, "vid-2", {
    excluded: true,
    reason: "second",
    updatedAt: "2024-01-02T00:00:00Z",
  });

  assert.equal(second["vid-1"]?.reason, "first");
  assert.equal(second["vid-2"]?.reason, "second");

  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [
      rawVideo({ videoId: "vid-1", category: "youtube_video" }),
      rawVideo({ videoId: "vid-2", category: "recorded_webinar" }),
    ],
    overrides: second,
    channelId: "channel-1",
    webinarPlaylistId: "PL",
  });

  assert.equal(merged.excludedCount, 2);
});

test("updateYouTubeVideoVisibility requires a known videoId", async () => {
  const blobs = new Map<string, { body: string; etag: string }>();
  blobs.set("brc-edu/youtube/youtube-videos.json", {
    etag: '"1"',
    body: JSON.stringify({
      generatedAt: "2024-01-01T00:00:00Z",
      channelId: "channel-1",
      webinarPlaylistId: "PL",
      itemCount: 1,
      items: [rawVideo({ videoId: "known", category: "youtube_video" })],
    }),
  });
  blobs.set("brc-edu/youtube/video-overrides.json", {
    etag: '"1"',
    body: JSON.stringify({ updatedAt: "2024-01-01T00:00:00Z", overrides: {} }),
  });

  const container = {
    getBlockBlobClient(path: string) {
      return {
        async exists() {
          return blobs.has(path);
        },
        async getProperties() {
          return { etag: blobs.get(path)?.etag ?? "" };
        },
        async download() {
          const stored = blobs.get(path);
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(stored?.body ?? "{}", "utf8");
            })(),
          };
        },
        async uploadData() {
          return undefined;
        },
      };
    },
  } as never;

  const result = await updateYouTubeVideoVisibility({
    videoId: "missing",
    excluded: true,
    container,
    writeSyncedResources: false,
    invalidateCache: false,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
  }
});

test("manual YouTube sync succeeds without generating a workbook", async () => {
  const blobs = new Map<string, { body: string; etag: string }>();
  const container = {
    getBlockBlobClient(path: string) {
      return {
        async exists() {
          return blobs.has(path);
        },
        async getProperties() {
          return { etag: blobs.get(path)?.etag ?? '"e"' };
        },
        async download() {
          const stored = blobs.get(path);
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(
                stored?.body ??
                  JSON.stringify({
                    updatedAt: "2024-01-01T00:00:00Z",
                    overrides: {},
                  }),
                "utf8",
              );
            })(),
          };
        },
        async uploadData(buffer: Buffer) {
          blobs.set(path, { body: buffer.toString("utf8"), etag: `"${blobs.size + 1}"` });
        },
      };
    },
  } as never;

  const result = await runYouTubeCatalogSync("manual", {
    container,
    youtubeConfig: {
      apiKey: "key",
      channelId: "channel-1",
      uploadsPlaylistId: "UU",
      webinarPlaylistId: "PL",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/playlistItems")) {
          const playlistId = url.searchParams.get("playlistId");
          const videoId = playlistId === "PL" ? "vid-webinar" : "vid-other";
          return new Response(
            JSON.stringify({
              items: [
                {
                  contentDetails: { videoId },
                  snippet: { publishedAt: "2024-01-01T00:00:00Z" },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.pathname.endsWith("/videos")) {
          const ids = (url.searchParams.get("id") ?? "").split(",");
          return new Response(
            JSON.stringify({
              items: ids.map((id) => ({
                id,
                snippet: {
                  title: id === "vid-webinar" ? "Webinar" : "Tip",
                  description: "Desc",
                  channelId: "channel-1",
                  publishedAt: "2024-01-01T00:00:00Z",
                },
              })),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("{}", { status: 404 });
      },
    },
    writeSyncedResources: false,
    invalidateCache: false,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.counts.total, 2);
    assert.equal(result.counts.recordedWebinar, 1);
    assert.equal(result.counts.youtubeVideo, 1);
  }

  // No workbook blob paths should be written by sync.
  assert.equal(
    [...blobs.keys()].some((key) => key.includes("webinar_video_routing_index")),
    false,
  );

  const overrides = parseYouTubeOverridesDocument(
    JSON.parse(blobs.get("brc-edu/youtube/video-overrides.json")?.body ?? "null"),
  );
  assert.deepEqual(overrides?.overrides ?? {}, {});
});
