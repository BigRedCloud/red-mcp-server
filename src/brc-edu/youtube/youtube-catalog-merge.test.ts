import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOverrideToRawVideo,
  mergeYouTubeCatalogWithOverrides,
  upsertYouTubeVideoOverride,
} from "./youtube-catalog-merge.js";
import type { YouTubeRawCatalogVideo } from "./youtube-types.js";

function rawVideo(
  overrides: Partial<YouTubeRawCatalogVideo> & Pick<YouTubeRawCatalogVideo, "videoId" | "category">,
): YouTubeRawCatalogVideo {
  return {
    title: "Original title",
    description: "Original description",
    url: `https://www.youtube.com/watch?v=${overrides.videoId}`,
    publishedAt: "2024-01-01T00:00:00Z",
    channelId: "channel-1",
    playlistIds: ["UU_UPLOADS"],
    lastSyncedAt: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

test("excluded video remains excluded after a full sync merge", () => {
  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [rawVideo({ videoId: "vid-1", category: "youtube_video" })],
    overrides: {
      "vid-1": {
        excluded: true,
        excludedAt: "2024-01-03T00:00:00Z",
        excludedBy: "staff@example.com",
        reason: "Internal only",
        updatedAt: "2024-01-03T00:00:00Z",
      },
    },
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  assert.equal(merged.items[0]?.excluded, true);
  assert.equal(merged.items[0]?.exclusionReason, "Internal only");
  assert.equal(merged.excludedCount, 1);
  assert.equal(merged.visibleCount, 0);
});

test("restored video becomes visible after the next sync merge", () => {
  const overrides = upsertYouTubeVideoOverride(
    {
      "vid-1": {
        excluded: true,
        updatedAt: "2024-01-03T00:00:00Z",
      },
    },
    "vid-1",
    { excluded: false, updatedAt: "2024-01-04T00:00:00Z" },
  );

  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [rawVideo({ videoId: "vid-1", category: "recorded_webinar" })],
    overrides,
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  assert.equal(merged.items[0]?.excluded, false);
  assert.equal(merged.visibleCount, 1);
});

test("title and description updates do not clear exclusion", () => {
  const previous = applyOverrideToRawVideo(
    rawVideo({ videoId: "vid-1", category: "youtube_video" }),
    {
      excluded: true,
      excludedAt: "2024-01-03T00:00:00Z",
      excludedBy: "staff@example.com",
      reason: "Staff only",
      updatedAt: "2024-01-03T00:00:00Z",
    },
  );

  assert.equal(previous.excluded, true);

  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [
      rawVideo({
        videoId: "vid-1",
        category: "youtube_video",
        title: "Updated title",
        description: "Updated description",
      }),
    ],
    overrides: {
      "vid-1": {
        excluded: true,
        excludedAt: "2024-01-03T00:00:00Z",
        excludedBy: "staff@example.com",
        reason: "Staff only",
        updatedAt: "2024-01-03T00:00:00Z",
      },
    },
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  assert.equal(merged.items[0]?.title, "Updated title");
  assert.equal(merged.items[0]?.description, "Updated description");
  assert.equal(merged.items[0]?.excluded, true);
  assert.equal(merged.items[0]?.exclusionReason, "Staff only");
});

test("moving into webinar playlist changes category but preserves exclusion", () => {
  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [
      rawVideo({
        videoId: "vid-1",
        category: "recorded_webinar",
        playlistIds: ["UU_UPLOADS", "PL_WEBINAR"],
      }),
    ],
    overrides: {
      "vid-1": {
        excluded: true,
        reason: "Keep excluded",
        updatedAt: "2024-01-03T00:00:00Z",
      },
    },
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  assert.equal(merged.items[0]?.category, "recorded_webinar");
  assert.equal(merged.items[0]?.excluded, true);
});

test("moving out of webinar playlist changes category but preserves exclusion", () => {
  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [
      rawVideo({
        videoId: "vid-1",
        category: "youtube_video",
        playlistIds: ["UU_UPLOADS"],
      }),
    ],
    overrides: {
      "vid-1": {
        excluded: true,
        reason: "Keep excluded",
        updatedAt: "2024-01-03T00:00:00Z",
      },
    },
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  assert.equal(merged.items[0]?.category, "youtube_video");
  assert.equal(merged.items[0]?.excluded, true);
});

test("regression: metadata updates after exclusion keep excluded true", () => {
  const videoId = "existing-video";
  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [
      rawVideo({
        videoId,
        category: "recorded_webinar",
        title: "Changed title later",
        description: "Changed description later",
      }),
    ],
    overrides: {
      [videoId]: {
        excluded: true,
        excludedAt: "2024-05-01T00:00:00Z",
        excludedBy: "admin@bigredcloud.com",
        reason: "Internal staff-only recording",
        updatedAt: "2024-05-01T00:00:00Z",
      },
    },
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  const item = merged.items[0]!;
  assert.equal(item.videoId, videoId);
  assert.equal(item.title, "Changed title later");
  assert.equal(item.description, "Changed description later");
  assert.equal(item.excluded, true);
});
