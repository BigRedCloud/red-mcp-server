import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawCatalogVideos,
  classifyYouTubeVideoCategory,
  fetchVideoSnippetsByIds,
  listAllPlaylistVideoIds,
  type YouTubeClientConfig,
} from "./youtube-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("webinar playlist video is classified as recorded_webinar", () => {
  const webinarIds = new Set(["abc123"]);
  assert.equal(classifyYouTubeVideoCategory("abc123", webinarIds), "recorded_webinar");
});

test("channel upload outside webinar playlist is classified as youtube_video", () => {
  const webinarIds = new Set(["webinar1"]);
  assert.equal(classifyYouTubeVideoCategory("other99", webinarIds), "youtube_video");
});

test("buildRawCatalogVideos assigns categories from playlist membership", () => {
  const videos = buildRawCatalogVideos({
    channelId: "channel-1",
    webinarPlaylistId: "PL_WEBINAR",
    uploadItems: [
      { videoId: "vid-webinar", playlistId: "UU_UPLOADS" },
      { videoId: "vid-other", playlistId: "UU_UPLOADS" },
    ],
    webinarItems: [{ videoId: "vid-webinar", playlistId: "PL_WEBINAR" }],
    snippets: new Map([
      [
        "vid-webinar",
        {
          videoId: "vid-webinar",
          title: "Webinar recording",
          description: "A webinar",
          channelId: "channel-1",
          publishedAt: "2024-01-01T00:00:00Z",
        },
      ],
      [
        "vid-other",
        {
          videoId: "vid-other",
          title: "Product tip",
          description: "A tip",
          channelId: "channel-1",
          publishedAt: "2024-02-01T00:00:00Z",
        },
      ],
    ]),
    lastSyncedAt: "2024-03-01T00:00:00Z",
  });

  assert.equal(videos.find((v) => v.videoId === "vid-webinar")?.category, "recorded_webinar");
  assert.equal(videos.find((v) => v.videoId === "vid-other")?.category, "youtube_video");
});

test("YouTube playlist pagination retrieves all pages", async () => {
  const calls: string[] = [];
  const config: YouTubeClientConfig = {
    apiKey: "test-key",
    channelId: "channel-1",
    fetchImpl: async (input) => {
      calls.push(String(input));
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("key"), "test-key");
      const pageToken = url.searchParams.get("pageToken");

      if (!pageToken) {
        return jsonResponse({
          nextPageToken: "page-2",
          items: [
            {
              contentDetails: { videoId: "v1" },
              snippet: { publishedAt: "2024-01-01T00:00:00Z" },
            },
          ],
        });
      }

      assert.equal(pageToken, "page-2");
      return jsonResponse({
        items: [
          {
            contentDetails: { videoId: "v2" },
            snippet: { publishedAt: "2024-01-02T00:00:00Z" },
          },
        ],
      });
    },
  };

  const items = await listAllPlaylistVideoIds(config, "PL123");
  assert.deepEqual(
    items.map((item) => item.videoId),
    ["v1", "v2"],
  );
  assert.equal(calls.length, 2);
});

test("fetchVideoSnippetsByIds batches requests", async () => {
  const ids = Array.from({ length: 51 }, (_, index) => `id-${index}`);
  let callCount = 0;

  const config: YouTubeClientConfig = {
    apiKey: "test-key",
    channelId: "channel-1",
    fetchImpl: async (input) => {
      callCount += 1;
      const url = new URL(String(input));
      const batch = (url.searchParams.get("id") ?? "").split(",");
      return jsonResponse({
        items: batch.map((videoId) => ({
          id: videoId,
          snippet: {
            title: `Title ${videoId}`,
            description: "Desc",
            channelId: "channel-1",
            publishedAt: "2024-01-01T00:00:00Z",
            thumbnails: { high: { url: `https://img.example/${videoId}.jpg` } },
          },
        })),
      });
    },
  };

  const snippets = await fetchVideoSnippetsByIds(config, ids);
  assert.equal(snippets.size, 51);
  assert.equal(callCount, 2);
});
