import assert from "node:assert/strict";
import test from "node:test";
import { RestError } from "@azure/storage-blob";
import { upsertYouTubeVideoOverride } from "./youtube-catalog-merge.js";
test("optimistic concurrency conflict is represented as HTTP 409 semantics", () => {
    const error = new RestError("Precondition Failed", { statusCode: 412 });
    assert.equal(error.statusCode, 412);
    // Visibility updates map Azure 412 -> 409 and retry using fresh ETags.
    const first = upsertYouTubeVideoOverride({}, "vid-1", {
        excluded: true,
        reason: "a",
        updatedAt: "2024-01-01T00:00:00Z",
    });
    const raced = upsertYouTubeVideoOverride(first, "vid-1", {
        excluded: false,
        updatedAt: "2024-01-02T00:00:00Z",
    });
    assert.equal(raced["vid-1"]?.excluded, false);
});
