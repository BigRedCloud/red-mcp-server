import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFreshdeskArticle } from "./article-normalizer.js";
function createArticle(overrides = {}) {
    return {
        id: 42,
        type: 1,
        status: 2,
        category_id: 10,
        folder_id: 20,
        title: "  Getting started  ",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-07-01T12:00:00Z",
        description: '<p>See <img src="https://cdn.freshdesk.com/guide.png" alt="Guide screenshot" /></p>',
        description_text: "  Line one.\u00a0Line\u00a0two.   Extra   spaces  ",
        ...overrides,
    };
}
test("normalizeFreshdeskArticle creates the expected normalized ID", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({ id: 99 }), "Help");
    assert.equal(normalized.id, "freshdesk-99");
});
test("normalizeFreshdeskArticle trims title and body text", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({
        title: "  Trimmed title  ",
        description_text: "  Trimmed body  ",
    }), "Help");
    assert.equal(normalized.title, "Trimmed title");
    assert.equal(normalized.bodyText, "Trimmed body");
});
test("normalizeFreshdeskArticle normalizes repeated whitespace and non-breaking spaces", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({
        description_text: "Word\u00a0one\u00a0\u00a0  and   two",
    }), "Help");
    assert.equal(normalized.bodyText, "Word one and two");
});
test("normalizeFreshdeskArticle sets enabled=true for status 2", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({ status: 2 }), "Help");
    assert.equal(normalized.enabled, true);
});
test("normalizeFreshdeskArticle sets enabled=false for non-published statuses", () => {
    for (const status of [1, 3, 4, 0]) {
        const normalized = normalizeFreshdeskArticle(createArticle({ status }), "Help");
        assert.equal(normalized.enabled, false, `status ${status} should be disabled`);
    }
});
test("normalizeFreshdeskArticle includes extracted image references", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({
        description: '<img src="https://cdn.freshdesk.com/a.png" alt="First" />' +
            '<img src="https://cdn.freshdesk.com/a.png" alt="Duplicate" />' +
            '<img src="http://cdn.freshdesk.com/insecure.png" alt="Ignored" />',
    }), "Help");
    assert.equal(normalized.images.length, 1);
    assert.equal(normalized.images[0]?.sourceUrl, "https://cdn.freshdesk.com/a.png");
    assert.equal(normalized.images[0]?.altText, "Duplicate");
});
test("normalizeFreshdeskArticle preserves category, folder, article ID, folder name and updatedAt", () => {
    const article = createArticle({
        id: 77,
        category_id: 5,
        folder_id: 15,
        updated_at: "2026-07-14T09:30:00Z",
    });
    const normalized = normalizeFreshdeskArticle(article, "  Billing FAQ  ");
    assert.equal(normalized.source, "freshdesk");
    assert.equal(normalized.freshdeskArticleId, 77);
    assert.equal(normalized.categoryId, 5);
    assert.equal(normalized.folderId, 15);
    assert.equal(normalized.folderName, "  Billing FAQ  ");
    assert.equal(normalized.updatedAt, "2026-07-14T09:30:00Z");
});
test("normalizeFreshdeskArticle preserves API url field as publicUrl", () => {
    const canonicalUrl = "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368991-how-do-i-do-the-bank-reconciliation-bank-rec-";
    const normalized = normalizeFreshdeskArticle(createArticle({
        id: 157000368991,
        url: canonicalUrl,
        slug: "how-do-i-do-the-bank-reconciliation-bank-rec-",
    }), "Cash Book");
    assert.equal(normalized.publicUrl, canonicalUrl);
    assert.equal(normalized.slug, "how-do-i-do-the-bank-reconciliation-bank-rec-");
});
test("normalizeFreshdeskArticle builds publicUrl from API slug when url is absent", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({
        id: 1001,
        slug: "complete-a-bank-reconciliation",
    }), "Cash Book");
    assert.equal(normalized.publicUrl, "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation");
});
test("normalizeFreshdeskArticle builds publicUrl from title when API fields are absent", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({
        id: 1001,
        title: "Complete a bank reconciliation",
    }), "Cash Book");
    assert.equal(normalized.publicUrl, "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation");
    assert.equal(normalized.slug, "complete-a-bank-reconciliation");
});
test("normalizeFreshdeskArticle builds bank reconciliation regression URL from title", () => {
    const normalized = normalizeFreshdeskArticle(createArticle({
        id: 157000368991,
        title: "How do I do the Bank Reconciliation (Bank Rec)?",
    }), "Cash Book");
    assert.equal(normalized.publicUrl, "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368991-how-do-i-do-the-bank-reconciliation-bank-rec-");
});
