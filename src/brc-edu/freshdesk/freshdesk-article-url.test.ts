import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFreshdeskPublicArticleUrl,
  extractSlugFromLegacyBigredcloudSupportUrl,
  FRESHDESK_LINK_RESPONSE_GUIDANCE,
  FRESHDESK_PUBLIC_ARTICLES_BASE_URL,
  getSyncedFreshdeskArticlePublicUrl,
  isFreshdeskPublicArticleUrl,
  isLegacyBigredcloudSupportArticleUrl,
  readFreshdeskArticleUrlFields,
  repairStoredFreshdeskArticlePublicUrl,
  resolveFreshdeskArticlePublicUrl,
  slugifyFreshdeskArticleTitle,
} from "./freshdesk-article-url.js";

const BANK_RECON_CANONICAL_URL =
  "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368991-how-do-i-do-the-bank-reconciliation-bank-rec-";

const BANK_RECON_LEGACY_URL =
  "https://bigredcloud.com/support/how-do-i-do-the-bank-reconciliation-bank-rec/";

export const BANK_RECON_FRESHDESK_ARTICLE = {
  freshdeskArticleId: 157000368991,
  slug: "how-do-i-do-the-bank-reconciliation-bank-rec-",
  title: "How do I do the Bank Reconciliation (Bank Rec)?",
  canonicalUrl: BANK_RECON_CANONICAL_URL,
  legacyUrl: BANK_RECON_LEGACY_URL,
};

test("slugifyFreshdeskArticleTitle matches bank reconciliation regression slug", () => {
  assert.equal(
    slugifyFreshdeskArticleTitle(
      "How do I do the Bank Reconciliation (Bank Rec)?",
    ),
    "how-do-i-do-the-bank-reconciliation-bank-rec-",
  );
});

test("slugifyFreshdeskArticleTitle matches add-a-customer regression slug", () => {
  assert.equal(
    slugifyFreshdeskArticleTitle("How do I add a Customer?"),
    "how-do-i-add-a-customer-",
  );
});

test("API-provided canonical Freshdesk URL is preserved", () => {
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    title: BANK_RECON_FRESHDESK_ARTICLE.title,
    apiUrl: BANK_RECON_CANONICAL_URL,
  });

  assert.equal(url, BANK_RECON_CANONICAL_URL);
});

test("bank reconciliation regression returns canonical Freshdesk URL from title", () => {
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    title: BANK_RECON_FRESHDESK_ARTICLE.title,
  });

  assert.equal(url, BANK_RECON_CANONICAL_URL);
  assert.notEqual(url, BANK_RECON_LEGACY_URL);
  assert.equal(isLegacyBigredcloudSupportArticleUrl(url ?? ""), false);
});

test("add-a-customer regression returns canonical URL pattern from title", () => {
  const articleId = 157000123456;
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: articleId,
    title: "How do I add a Customer?",
  });

  assert.equal(
    url,
    `${FRESHDESK_PUBLIC_ARTICLES_BASE_URL}${articleId}-how-do-i-add-a-customer-`,
  );
});

test("canonical URL is built from article ID and API slug field", () => {
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: 1001,
    title: "Ignored when slug is present",
    apiSlug: "complete-a-bank-reconciliation",
  });

  assert.equal(
    url,
    `${FRESHDESK_PUBLIC_ARTICLES_BASE_URL}1001-complete-a-bank-reconciliation`,
  );
});

test("API path under /support/solutions/articles/ is accepted", () => {
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: 1001,
    title: "Fallback title",
    apiPath:
      "/support/solutions/articles/1001-complete-a-bank-reconciliation",
  });

  assert.equal(
    url,
    "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation",
  );
});

test("readFreshdeskArticleUrlFields reads url, path, and slug from API payload", () => {
  const fields = readFreshdeskArticleUrlFields({
    id: 1001,
    title: "Sample",
    url: BANK_RECON_CANONICAL_URL,
    path: "/support/solutions/articles/1001-sample-slug",
    slug: "sample-slug",
  });

  assert.equal(fields.apiUrl, BANK_RECON_CANONICAL_URL);
  assert.equal(fields.apiPath, "/support/solutions/articles/1001-sample-slug");
  assert.equal(fields.apiSlug, "sample-slug");
});

test("missing API URL and slug falls back to slugifying the title", () => {
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    title: BANK_RECON_FRESHDESK_ARTICLE.title,
  });

  assert.equal(url, BANK_RECON_CANONICAL_URL);
});

test("article ID and title always produce a publicUrl", () => {
  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: 42,
    title: "Create a sales invoice",
  });

  assert.equal(
    url,
    "https://bigredcloud.freshdesk.com/support/solutions/articles/42-create-a-sales-invoice",
  );
});

test("wrong bigredcloud.com/support URL is replaced using title fallback", () => {
  assert.equal(isFreshdeskPublicArticleUrl(BANK_RECON_LEGACY_URL), false);
  assert.equal(isLegacyBigredcloudSupportArticleUrl(BANK_RECON_LEGACY_URL), true);

  const url = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    title: BANK_RECON_FRESHDESK_ARTICLE.title,
    storedPublicUrl: BANK_RECON_LEGACY_URL,
  });

  assert.equal(url, BANK_RECON_CANONICAL_URL);
});

test("legacy wrong URL is repaired using article ID and slug", () => {
  const repaired = repairStoredFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    title: BANK_RECON_FRESHDESK_ARTICLE.title,
    publicUrl: BANK_RECON_LEGACY_URL,
    slug: BANK_RECON_FRESHDESK_ARTICLE.slug,
  });

  assert.equal(repaired.publicUrl, BANK_RECON_CANONICAL_URL);
});

test("legacy publicUrl null is repaired during index repair using title", () => {
  const repaired = repairStoredFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    title: BANK_RECON_FRESHDESK_ARTICLE.title,
    publicUrl: null,
  });

  assert.equal(repaired.publicUrl, BANK_RECON_CANONICAL_URL);
  assert.equal(repaired.slug, BANK_RECON_FRESHDESK_ARTICLE.slug);
});

test("legacy wrong URL is repaired using slug extracted from legacy path when title is absent", () => {
  const legacySlug = extractSlugFromLegacyBigredcloudSupportUrl(
    BANK_RECON_LEGACY_URL,
  );
  assert.equal(legacySlug, "how-do-i-do-the-bank-reconciliation-bank-rec");

  const repaired = repairStoredFreshdeskArticlePublicUrl({
    freshdeskArticleId: BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
    publicUrl: BANK_RECON_LEGACY_URL,
  });

  assert.equal(
    repaired.publicUrl,
    buildFreshdeskPublicArticleUrl(
      BANK_RECON_FRESHDESK_ARTICLE.freshdeskArticleId,
      "how-do-i-do-the-bank-reconciliation-bank-rec",
    ),
  );
});

test("getSyncedFreshdeskArticlePublicUrl resolves legacy articles without stored publicUrl", () => {
  const url = getSyncedFreshdeskArticlePublicUrl({
    freshdeskArticleId: 1001,
    title: "Complete a bank reconciliation",
    publicUrl: null,
    slug: null,
  });

  assert.equal(
    url,
    "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation",
  );
});

test("invalid host is rejected", () => {
  assert.equal(
    isFreshdeskPublicArticleUrl(
      "https://evil.example.com/support/solutions/articles/1001-slug",
    ),
    false,
  );
});

test("HTTP URL is rejected", () => {
  assert.equal(
    isFreshdeskPublicArticleUrl(
      "http://bigredcloud.freshdesk.com/support/solutions/articles/1001-slug",
    ),
    false,
  );
});

test("malformed URL is rejected", () => {
  assert.equal(isFreshdeskPublicArticleUrl("not-a-url"), false);
  assert.equal(
    isFreshdeskPublicArticleUrl("javascript:alert(1)"),
    false,
  );
});

test("response guidance tells the model to use exact Freshdesk publicUrl", () => {
  assert.match(FRESHDESK_LINK_RESPONSE_GUIDANCE, /exact publicUrl/i);
  assert.match(FRESHDESK_LINK_RESPONSE_GUIDANCE, /bigredcloud\.freshdesk\.com/i);
  assert.match(FRESHDESK_LINK_RESPONSE_GUIDANCE, /never rewrite/i);
});
