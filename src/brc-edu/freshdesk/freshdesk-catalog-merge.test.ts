import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeFreshdeskCatalogWithOverrides,
  toFreshdeskAdminArticle,
  upsertFreshdeskArticleOverride,
  visibleFreshdeskArticlesFromEffective,
} from "./freshdesk-catalog-merge.js";
import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";

function article(
  id: number,
  title: string,
  folderName = "Sales Invoices",
): SyncedFreshdeskArticle {
  return {
    id: `freshdesk-${id}`,
    source: "freshdesk",
    freshdeskArticleId: id,
    categoryId: 1,
    folderId: 10,
    folderName,
    title,
    bodyText: `${title} body`,
    images: [],
    updatedAt: "2026-06-01T00:00:00Z",
    enabled: true,
    slug: `slug-${id}`,
    publicUrl: `https://bigredcloud.freshdesk.com/support/solutions/articles/${id}`,
    syncedImages: [],
  };
}

test("mergeFreshdeskCatalogWithOverrides applies exclusions by articleId", () => {
  const overrides = upsertFreshdeskArticleOverride(
    {},
    "2",
    { excluded: true, reason: "Staff only", excludedBy: "staff@example.com" },
  );

  const catalog = mergeFreshdeskCatalogWithOverrides({
    articles: [article(1, "Visible"), article(2, "Hidden")],
    overrides,
    generatedAt: "2026-07-01T00:00:00Z",
  });

  assert.equal(catalog.itemCount, 2);
  assert.equal(catalog.visibleCount, 1);
  assert.equal(catalog.excludedCount, 1);

  const hidden = catalog.items.find((item) => item.articleId === "2");
  assert.equal(hidden?.excluded, true);
  assert.equal(hidden?.exclusionReason, "Staff only");

  const visible = visibleFreshdeskArticlesFromEffective(catalog);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.freshdeskArticleId, 1);
  assert.equal(
    visible.some((item) => item.freshdeskArticleId === 2),
    false,
  );
});

test("excluded articles remain in the merged catalogue for admins", () => {
  const overrides = upsertFreshdeskArticleOverride({}, "1", {
    excluded: true,
    reason: "Draft",
  });

  const catalog = mergeFreshdeskCatalogWithOverrides({
    articles: [article(1, "Draft")],
    overrides,
  });

  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0]?.excluded, true);

  const admin = toFreshdeskAdminArticle(catalog.items[0]!);
  assert.equal(admin.articleId, "1");
  assert.equal(admin.excluded, true);
  assert.equal(admin.exclusionReason, "Draft");
  assert.ok(admin.topic);
});

test("restoring an article keeps an explicit excluded:false override", () => {
  let overrides = upsertFreshdeskArticleOverride({}, "9", {
    excluded: true,
    reason: "temp",
  });
  overrides = upsertFreshdeskArticleOverride(overrides, "9", {
    excluded: false,
  });

  assert.equal(overrides["9"]?.excluded, false);

  const catalog = mergeFreshdeskCatalogWithOverrides({
    articles: [article(9, "Restored")],
    overrides,
  });

  assert.equal(catalog.items[0]?.excluded, false);
  assert.equal(catalog.visibleCount, 1);
});

test("exclusions survive a fresh raw catalogue merge", () => {
  const overrides = upsertFreshdeskArticleOverride({}, "5", {
    excluded: true,
    reason: "Keep hidden",
  });

  const afterSync = mergeFreshdeskCatalogWithOverrides({
    articles: [
      article(5, "Still synced"),
      article(6, "New article", "Bank Feeds"),
    ],
    overrides,
    generatedAt: "2026-07-10T00:00:00Z",
  });

  assert.equal(
    afterSync.items.find((item) => item.articleId === "5")?.excluded,
    true,
  );
  assert.equal(
    afterSync.items.find((item) => item.articleId === "6")?.excluded,
    false,
  );
  assert.equal(afterSync.excludedCount, 1);
  assert.equal(afterSync.visibleCount, 1);
});
