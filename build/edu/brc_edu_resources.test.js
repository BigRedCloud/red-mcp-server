import assert from "node:assert/strict";
import test from "node:test";
import { findHelpResources, parseEnrichedEduCsv } from "./brc_edu_resources.js";
const SAMPLE_CSV = [
    "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview",
    "Bank Feeds and Open Banking,https://example.com/bank-feeds,bank_feeds,bank feeds open banking,Bank feeds help,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
    "Sales Invoices,https://example.com/sales,sales,sales invoices invoice,Sales invoice help,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
    "Retired webinar,https://example.com/retired,general_help,retired,Old resource,false,webinar,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,true",
].join("\n");
test("parseEnrichedEduCsv reads generated CSV columns", () => {
    const resources = parseEnrichedEduCsv(SAMPLE_CSV);
    assert.equal(resources.length, 3);
    assert.equal(resources[0]?.helpRoutingCategory, "bank_feeds");
    assert.equal(resources[2]?.isActive, false);
    assert.equal(resources[2]?.needsReview, true);
});
test("findHelpResources ranks bank feeds matches ahead of unrelated resources", () => {
    const resources = parseEnrichedEduCsv(SAMPLE_CSV);
    const matches = findHelpResources("bank feeds", { resources, maxResults: 2 });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.helpRoutingCategory, "bank_feeds");
});
test("findHelpResources excludes inactive resources by default", () => {
    const resources = parseEnrichedEduCsv(SAMPLE_CSV);
    const matches = findHelpResources("retired", { resources });
    assert.equal(matches.length, 0);
});
