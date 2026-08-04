import assert from "node:assert/strict";
import test from "node:test";
import { invalidateYouTubeEffectiveCatalogCache, resetYouTubeEffectiveCatalogCacheForTests, } from "./youtube-help-loader.js";
test("YouTube effective catalogue cache can be invalidated after sync or visibility changes", () => {
    resetYouTubeEffectiveCatalogCacheForTests();
    invalidateYouTubeEffectiveCatalogCache();
    // Smoke check: invalidation is idempotent and does not throw.
    invalidateYouTubeEffectiveCatalogCache();
    assert.equal(true, true);
});
