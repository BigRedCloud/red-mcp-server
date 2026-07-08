import assert from "node:assert/strict";
import test from "node:test";

import {
  ENRICHED_EDU_CSV_COLUMNS,
  SUPPORT_EDU_SOURCE_FILE,
  enrichSupportEduRows,
  formatEnrichedEduCsv,
  inferHelpRoutingCategory,
  normaliseSupportEduRows,
  parseSupportEduCsv,
} from "./brc_edu_enrichment.js";

const REVIEW_DATE = new Date("2026-07-08T12:00:00.000Z");

function enrich(rows: ReturnType<typeof normaliseSupportEduRows>) {
  return enrichSupportEduRows(rows, { reviewDate: REVIEW_DATE });
}

test("blank rows are ignored during normalisation", () => {
  const rows = normaliseSupportEduRows([
    { title: "", url: "", notes: "" },
    { title: "Valid title", url: "https://example.com/video" },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "Valid title");
});

test("active defaults to true when omitted", () => {
  const rows = normaliseSupportEduRows([{ title: "Setup guide", url: "https://example.com/setup" }]);
  assert.equal(rows[0]?.active, true);

  const enriched = enrich(rows)[0];
  assert.equal(enriched?.isActive, true);
});

test("inactive rows remain marked inactive in enriched output", () => {
  const rows = normaliseSupportEduRows([
    { title: "Old webinar", url: "https://example.com/old", active: false },
    { title: "Retired", url: "https://example.com/retired", active: "no" },
  ]);

  const enriched = enrich(rows);
  assert.equal(enriched.length, 2);
  assert.equal(enriched[0]?.isActive, false);
  assert.equal(enriched[1]?.isActive, false);
});

test("preferredCategory overrides keyword inference", () => {
  const inference = inferHelpRoutingCategory(
    "Bank feeds overview",
    "supplier payments",
    "sales",
  );
  assert.equal(inference.category, "sales");
  assert.equal(inference.confidence, "high");

  const rows = normaliseSupportEduRows([
    {
      title: "Bank feeds overview",
      url: "https://example.com/bank-feeds",
      preferredCategory: "sales",
    },
  ]);
  const enriched = enrich(rows)[0];
  assert.equal(enriched?.helpRoutingCategory, "sales");
  assert.equal(enriched?.needsReview, false);
});

test("purchase importer category is inferred", () => {
  const inference = inferHelpRoutingCategory("Purchase importer walkthrough");
  assert.equal(inference.category, "purchase_importer");
  assert.notEqual(inference.confidence, "low");
});

test("bank feeds category is inferred", () => {
  const inference = inferHelpRoutingCategory("Connecting bank feeds", "Open banking setup");
  assert.equal(inference.category, "bank_feeds");
});

test("year end category is inferred", () => {
  const inference = inferHelpRoutingCategory("Year-end close books checklist");
  assert.equal(inference.category, "year_end");
});

test("unknown title becomes general_help and needsReview=true", () => {
  const inference = inferHelpRoutingCategory("Miscellaneous overview");
  assert.equal(inference.category, "general_help");
  assert.equal(inference.confidence, "low");

  const rows = normaliseSupportEduRows([
    { title: "Miscellaneous overview", url: "https://example.com/misc" },
  ]);
  const enriched = enrich(rows)[0];
  assert.equal(enriched?.helpRoutingCategory, "general_help");
  assert.equal(enriched?.needsReview, true);
});

test("generated rows contain required enriched fields", () => {
  const rows = normaliseSupportEduRows([
    {
      title: "Sales invoice webinar",
      url: "https://example.com/sales-webinar",
      notes: "Covers quotes and invoices",
    },
  ]);
  const enriched = enrich(rows)[0];

  assert.ok(enriched);
  assert.equal(enriched.title, "Sales invoice webinar");
  assert.equal(enriched.url, "https://example.com/sales-webinar");
  assert.equal(enriched.helpRoutingCategory, "sales");
  assert.match(enriched.keywords, /sales/);
  assert.match(enriched.description, /Sales invoice webinar/);
  assert.equal(enriched.isActive, true);
  assert.equal(enriched.contentType, "webinar");
  assert.equal(enriched.source, "Big Red Cloud");
  assert.equal(enriched.lastReviewed, "2026-07-08");
  assert.equal(enriched.generatedFrom, SUPPORT_EDU_SOURCE_FILE);
  assert.equal(enriched.needsReview, false);
});

test("support category sets contentType to support", () => {
  const rows = normaliseSupportEduRows([
    { title: "Contact support", url: "https://example.com/support" },
  ]);
  const enriched = enrich(rows)[0];
  assert.equal(enriched?.helpRoutingCategory, "support");
  assert.equal(enriched?.contentType, "support");
});

test("CSV round-trip produces generated columns only", () => {
  const supportCsv = [
    "title,url,notes,preferredCategory,active",
    "Purchase importer walkthrough,https://example.com/importer,,,true",
    "Bank feeds setup,https://example.com/bank-feeds,Open banking,,",
    "Retired video,https://example.com/retired,,,false",
    ",,,,",
  ].join("\n");

  const rawRows = parseSupportEduCsv(supportCsv);
  const supportRows = normaliseSupportEduRows(rawRows);
  const enrichedRows = enrich(supportRows);
  const outputCsv = formatEnrichedEduCsv(enrichedRows);
  const outputLines = outputCsv.trim().split("\n");

  assert.equal(rawRows.length, 4);
  assert.equal(supportRows.length, 3);
  assert.equal(enrichedRows.length, 3);
  assert.equal(outputLines[0], ENRICHED_EDU_CSV_COLUMNS.join(","));
  assert.match(outputCsv, /purchase_importer/);
  assert.match(outputCsv, /bank_feeds/);
  assert.match(outputCsv, /false/);
  assert.equal(enrichedRows.filter((row) => row.isActive === false).length, 1);
});
