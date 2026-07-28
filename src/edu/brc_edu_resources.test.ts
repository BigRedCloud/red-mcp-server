import assert from "node:assert/strict";
import test from "node:test";

import {
  BRC_SUPPORT_FALLBACK_URL,
  buildFindHelpResourcesResponse,
  findHelpResources,
  parseEnrichedEduCsv,
  toHelpResourceResult,
} from "./brc_edu_resources.js";

const SAMPLE_CSV = [
  "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview",
  "Bank Feeds and Open Banking,https://example.com/bank-feeds,bank_feeds,bank feeds open banking,Bank feeds help,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
  "Sales Invoices Cash Book,https://example.com/sales,sales_cash_bank_rec,sales invoices invoice,Sales invoice and cash book help,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
  "Retired webinar,https://example.com/retired,general_help,retired webinar,Old resource,false,webinar,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,true",
].join("\n");

function sampleResources() {
  return parseEnrichedEduCsv(SAMPLE_CSV);
}

test("findHelpResources matches by title", () => {
  const matches = findHelpResources("Sales Invoices Cash Book", {
    resources: sampleResources(),
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.title, "Sales Invoices Cash Book");
});

test("findHelpResources matches by category filter", () => {
  const matches = findHelpResources("invoice", {
    resources: sampleResources(),
    category: "sales_cash_bank_rec",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.helpRoutingCategory, "sales_cash_bank_rec");
});

test("findHelpResources matches by keyword and description", () => {
  const keywordMatches = findHelpResources("open banking", {
    resources: sampleResources(),
  });
  const descriptionMatches = findHelpResources("cash book", {
    resources: sampleResources(),
  });

  assert.equal(keywordMatches[0]?.helpRoutingCategory, "bank_feeds");
  assert.equal(descriptionMatches[0]?.helpRoutingCategory, "sales_cash_bank_rec");
});

test("findHelpResources ignores inactive rows", () => {
  const matches = findHelpResources("retired webinar", {
    resources: sampleResources(),
  });

  assert.equal(matches.length, 0);
});

test("buildFindHelpResourcesResponse returns support fallback when nothing matches", () => {
  const response = buildFindHelpResourcesResponse("completely unrelated topic", sampleResources());

  assert.equal(response.matchCount, 0);
  assert.equal(response.resources.length, 0);
  assert.equal(response.supportFallbackUrl, BRC_SUPPORT_FALLBACK_URL);
});

test("buildFindHelpResourcesResponse returns only required result fields", () => {
  const response = buildFindHelpResourcesResponse("bank feeds", sampleResources());
  const result = response.resources[0];

  assert.ok(result);
  assert.deepEqual(Object.keys(result).sort(), [
    "contentType",
    "description",
    "helpRoutingCategory",
    "source",
    "title",
    "url",
  ]);
  assert.equal(result.source, "Big Red Cloud");
  assert.equal(response.supportFallbackUrl, null);
  assert.equal(toHelpResourceResult(sampleResources()[0]!).url, "https://example.com/bank-feeds");
});

test("buildFindHelpResourcesResponse returns at most 5 resources", () => {
  const resources = Array.from({ length: 8 }, (_, index) => ({
    title: `Help video ${index + 1}`,
    url: `https://example.com/video-${index + 1}`,
    helpRoutingCategory: "setup",
    keywords: "setup help video",
    description: "Setup help video description",
    isActive: true,
    contentType: "video" as const,
    source: "Big Red Cloud",
    lastReviewed: "2026-07-08",
    generatedFrom: "webinar_video_routing_index.csv",
    needsReview: false,
  }));

  const response = buildFindHelpResourcesResponse("setup help video", resources);
  assert.equal(response.resources.length, 5);
});
