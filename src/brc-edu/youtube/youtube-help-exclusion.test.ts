import assert from "node:assert/strict";
import test from "node:test";

import { catalogVideosToEnrichedResources } from "./youtube-resource-mapper.js";
import type { YouTubeCatalogVideo, YouTubeEffectiveCatalog } from "./youtube-types.js";
import { searchUnifiedHelpResources } from "../help/unified-help-search.js";
import { mergeYouTubeCatalogWithOverrides } from "./youtube-catalog-merge.js";

function video(
  partial: Partial<YouTubeCatalogVideo> &
    Pick<YouTubeCatalogVideo, "videoId" | "category" | "excluded">,
): YouTubeCatalogVideo {
  return {
    title: "Sample video",
    description: "About sales invoices",
    url: `https://www.youtube.com/watch?v=${partial.videoId}`,
    publishedAt: "2024-01-01T00:00:00Z",
    channelId: "channel-1",
    playlistIds: ["UU_UPLOADS"],
    lastSyncedAt: "2024-01-02T00:00:00Z",
    ...partial,
  };
}

test("excluded videos are omitted from Red customer help search resources", () => {
  const resources = catalogVideosToEnrichedResources([
    video({
      videoId: "visible",
      category: "recorded_webinar",
      excluded: false,
      title: "Visible webinar",
    }),
    video({
      videoId: "hidden",
      category: "youtube_video",
      excluded: true,
      title: "Hidden staff video",
    }),
  ]);

  assert.equal(resources.length, 1);
  assert.equal(resources[0]?.videoId, "visible");
  assert.equal(resources[0]?.isActive, true);

  const results = searchUnifiedHelpResources(
    "webinar recording",
    { recordedWebinars: resources },
    { maxResults: 10 },
  );

  assert.ok(results.every((result) => !result.title.includes("Hidden")));
  assert.ok(results.some((result) => result.title.includes("Visible")));
});

test("excluded videos remain visible on the admin page model", () => {
  const catalog: YouTubeEffectiveCatalog = {
    generatedAt: "2024-01-02T00:00:00Z",
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
    itemCount: 2,
    visibleCount: 1,
    excludedCount: 1,
    items: [
      video({ videoId: "visible", category: "recorded_webinar", excluded: false }),
      video({
        videoId: "hidden",
        category: "youtube_video",
        excluded: true,
        exclusionReason: "Internal",
      }),
    ],
  };

  assert.equal(catalog.items.length, 2);
  assert.equal(catalog.items.filter((item) => item.excluded).length, 1);
});

test("excluded videos do not appear as visible in the effective catalogue merge", () => {
  const merged = mergeYouTubeCatalogWithOverrides({
    rawVideos: [
      {
        videoId: "hidden",
        title: "Hidden",
        description: "Internal",
        url: "https://www.youtube.com/watch?v=hidden",
        publishedAt: "2024-01-01T00:00:00Z",
        channelId: "channel-1",
        category: "youtube_video",
        playlistIds: ["UU_UPLOADS"],
        lastSyncedAt: "2024-01-02T00:00:00Z",
      },
    ],
    overrides: {
      hidden: {
        excluded: true,
        reason: "Internal",
        updatedAt: "2024-01-03T00:00:00Z",
      },
    },
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
  });

  assert.equal(merged.visibleCount, 0);
  assert.equal(merged.excludedCount, 1);
  assert.equal(merged.items[0]?.excluded, true);

  const customerFacing = catalogVideosToEnrichedResources(merged.items);
  assert.equal(customerFacing.length, 0);
});
