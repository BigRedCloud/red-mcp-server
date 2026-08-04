import assert from "node:assert/strict";
import test from "node:test";
import { RED_BRC_YOUTUBE_SYNC_ENDPOINT_ENV, RED_BRC_YOUTUBE_SYNC_SCHEDULE_ENV, } from "./constants.js";
test("YouTube Function env constant names are stable", () => {
    assert.equal(RED_BRC_YOUTUBE_SYNC_ENDPOINT_ENV, "RED_BRC_YOUTUBE_SYNC_ENDPOINT");
    assert.equal(RED_BRC_YOUTUBE_SYNC_SCHEDULE_ENV, "BRC_YOUTUBE_SYNC_SCHEDULE");
});
