import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeYouTubeServiceSyncSecret,
  handleYouTubeWebhookRequest,
} from "./youtube-admin-http.js";

test("manual/service sync secret authorization rejects missing configuration", () => {
  const previous = process.env.BRC_EDU_SYNC_SECRET;
  delete process.env.BRC_EDU_SYNC_SECRET;

  const result = authorizeYouTubeServiceSyncSecret("anything");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
  }

  if (previous === undefined) {
    delete process.env.BRC_EDU_SYNC_SECRET;
  } else {
    process.env.BRC_EDU_SYNC_SECRET = previous;
  }
});

test("manual/service sync secret authorization rejects bad secrets", () => {
  const previous = process.env.BRC_EDU_SYNC_SECRET;
  process.env.BRC_EDU_SYNC_SECRET = "expected-secret";

  const rejected = authorizeYouTubeServiceSyncSecret("wrong");
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.status, 401);
  }

  const accepted = authorizeYouTubeServiceSyncSecret("expected-secret");
  assert.equal(accepted.ok, true);

  if (previous === undefined) {
    delete process.env.BRC_EDU_SYNC_SECRET;
  } else {
    process.env.BRC_EDU_SYNC_SECRET = previous;
  }
});

test("YouTube webhook hub challenge echoes the challenge token", () => {
  const result = handleYouTubeWebhookRequest({
    method: "GET",
    query: {
      "hub.mode": "subscribe",
      "hub.challenge": "challenge-token-123",
      "hub.topic": "https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCtest",
    },
    body: "",
    headers: {},
  } as never);

  assert.equal(result.status, 200);
  assert.equal(result.body, "challenge-token-123");
  assert.equal(result.shouldSync, false);
});

test("YouTube webhook POST with Atom payload requests sync", () => {
  const previous = process.env.BRC_YOUTUBE_CHANNEL_ID;
  process.env.BRC_YOUTUBE_CHANNEL_ID = "UCtest";

  const result = handleYouTubeWebhookRequest({
    method: "POST",
    query: {},
    body: `<feed><entry><yt:videoId>abc123</yt:videoId><yt:channelId>UCtest</yt:channelId></entry></feed>`,
    headers: {},
  } as never);

  assert.equal(result.status, 204);
  assert.equal(result.shouldSync, true);

  if (previous === undefined) {
    delete process.env.BRC_YOUTUBE_CHANNEL_ID;
  } else {
    process.env.BRC_YOUTUBE_CHANNEL_ID = previous;
  }
});
