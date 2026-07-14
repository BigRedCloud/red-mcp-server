import assert from "node:assert/strict";
import test from "node:test";
import { buildFindHelpResourcesResponse, mergeHelpSearchResults, parseEnrichedEduCsv, } from "../../edu/brc_edu_resources.js";
import { createFreshdeskBodyExcerpt, findFreshdeskHelpArticles, loadFreshdeskArticlesForHelpSearch, resetFreshdeskHelpIndexCacheForTests, scoreFreshdeskHelpArticle, toFreshdeskHelpResourceResult, tokenizeHelpSearchQuestion, } from "./freshdesk-help-search.js";
const CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=secret;AccountKey=super-secret-key;EndpointSuffix=core.windows.net";
const WEBINAR_CSV = [
    "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview",
    "Bank Feeds and Open Banking,https://example.com/bank-feeds,bank_feeds,bank feeds open banking,Bank feeds help,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
    "Sales Invoices Cash Book,https://example.com/sales,sales_cash_bank_rec,sales invoices invoice,Sales invoice and cash book help,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
].join("\n");
function webinarResources() {
    return parseEnrichedEduCsv(WEBINAR_CSV);
}
function createFreshdeskArticle(overrides = {}) {
    return {
        id: "freshdesk-1001",
        source: "freshdesk",
        freshdeskArticleId: 1001,
        categoryId: 157000561739,
        folderId: 200,
        folderName: "Sales Book and Customers",
        title: "Create a sales invoice",
        bodyText: "Follow these steps to create a sales invoice in Big Red Cloud accounting software.",
        images: [
            {
                sourceUrl: "https://cdn.freshdesk.com/private-guide.png",
                altText: "Guide screenshot",
            },
        ],
        syncedImages: [
            {
                sourceUrl: "https://cdn.freshdesk.com/private-guide.png",
                blobName: "freshdesk/1001/sha256.png",
                sha256: "sha256",
                contentType: "image/png",
            },
        ],
        updatedAt: "2026-07-01T00:00:00Z",
        enabled: true,
        ...overrides,
    };
}
function freshdeskArticles(overrides = [createFreshdeskArticle()]) {
    return overrides.map((entry, index) => createFreshdeskArticle({
        id: `freshdesk-${1000 + index}`,
        freshdeskArticleId: 1000 + index,
        ...entry,
    }));
}
test("findFreshdeskHelpArticles matches by title", () => {
    const matches = findFreshdeskHelpArticles("Create a sales invoice", [
        createFreshdeskArticle(),
        createFreshdeskArticle({
            id: "freshdesk-2000",
            freshdeskArticleId: 2000,
            title: "Bank feeds overview",
            folderName: "Bank Feeds",
            bodyText: "Bank feeds body",
        }),
    ]);
    assert.ok(matches.some((match) => match.title === "Create a sales invoice"));
    assert.equal(matches[0]?.title, "Create a sales invoice", "exact title match should rank first");
});
test("findFreshdeskHelpArticles matches by body text", () => {
    const matches = findFreshdeskHelpArticles("accounting software", [
        createFreshdeskArticle({
            title: "Unrelated title",
            bodyText: "Details about accounting software setup.",
        }),
    ]);
    assert.equal(matches.length, 1);
    assert.match(matches[0]?.bodyText ?? "", /accounting software/i);
});
test("findFreshdeskHelpArticles matches by folder name", () => {
    const matches = findFreshdeskHelpArticles("customers", [
        createFreshdeskArticle({
            title: "Overview",
            folderName: "Sales Book and Customers",
            bodyText: "General overview text.",
        }),
    ]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.folderName, "Sales Book and Customers");
});
test("findFreshdeskHelpArticles excludes disabled articles", () => {
    const matches = findFreshdeskHelpArticles("sales invoice", [
        createFreshdeskArticle({ enabled: false }),
    ]);
    assert.deepEqual(matches, []);
});
test("scoreFreshdeskHelpArticle ranks exact title above body matches", () => {
    const exactArticle = createFreshdeskArticle({
        id: "freshdesk-exact",
        freshdeskArticleId: 1,
        title: "Bank feeds",
        bodyText: "General help text.",
    });
    const bodyArticle = createFreshdeskArticle({
        id: "freshdesk-body",
        freshdeskArticleId: 2,
        title: "Getting started",
        bodyText: "Learn how bank feeds work in Big Red Cloud.",
    });
    const tokens = tokenizeHelpSearchQuestion("bank feeds");
    const exactScore = scoreFreshdeskHelpArticle(exactArticle, "bank feeds", tokens);
    const bodyScore = scoreFreshdeskHelpArticle(bodyArticle, "bank feeds", tokens);
    assert.ok(exactScore > bodyScore);
});
test("mergeHelpSearchResults combines webinar and Freshdesk results by relevance", () => {
    const results = mergeHelpSearchResults("bank feeds", webinarResources(), freshdeskArticles([
        {
            title: "Bank feeds setup guide",
            bodyText: "Configure bank feeds in Big Red Cloud.",
            folderName: "Bank Feeds",
        },
    ]));
    assert.ok(results.length >= 2);
    assert.equal(results.some((result) => result.source === "freshdesk"), true);
    assert.equal(results.some((result) => result.source === "Big Red Cloud"), true);
    assert.ok(results[0]?.title.toLowerCase().includes("bank feeds"));
});
test("mergeHelpSearchResults caps combined results at 5", () => {
    const webinars = Array.from({ length: 4 }, (_, index) => ({
        title: `Webinar bank feeds ${index + 1}`,
        url: `https://example.com/webinar-${index + 1}`,
        helpRoutingCategory: "bank_feeds",
        keywords: "bank feeds",
        description: "bank feeds webinar",
        isActive: true,
        contentType: "video",
        source: "Big Red Cloud",
        lastReviewed: "2026-07-08",
        generatedFrom: "webinar_video_routing_index.csv",
        needsReview: false,
    }));
    const articles = Array.from({ length: 4 }, (_, index) => createFreshdeskArticle({
        id: `freshdesk-${index + 10}`,
        freshdeskArticleId: index + 10,
        title: `Freshdesk bank feeds ${index + 1}`,
        bodyText: "bank feeds support article",
    }));
    const results = mergeHelpSearchResults("bank feeds", webinars, articles, {
        maxResults: 5,
    });
    assert.equal(results.length, 5);
});
test("mergeHelpSearchResults removes duplicate titles", () => {
    const results = mergeHelpSearchResults("sales invoice", webinarResources(), freshdeskArticles([
        {
            title: "Sales Invoices Cash Book",
            bodyText: "Duplicate title across sources.",
        },
    ]));
    const titles = results.map((result) => result.title.toLowerCase());
    assert.equal(titles.filter((title) => title === "sales invoices cash book").length, 1);
});
test("buildFindHelpResourcesResponse falls back to webinar results when Freshdesk index is unavailable", async () => {
    resetFreshdeskHelpIndexCacheForTests();
    const loaded = await loadFreshdeskArticlesForHelpSearch({
        now: 1_700_000_000_000,
        container: null,
    });
    assert.equal(loaded, null);
    const response = buildFindHelpResourcesResponse("open banking", webinarResources(), {
        freshdeskArticles: loaded ?? undefined,
    });
    assert.ok(response.resources.length >= 1);
    assert.equal(response.resources.every((resource) => resource.source === "Big Red Cloud"), true);
    assert.equal(response.supportFallbackUrl, null);
});
test("loadFreshdeskArticlesForHelpSearch falls back safely when index load fails", async () => {
    resetFreshdeskHelpIndexCacheForTests();
    const mockContainer = {};
    const loaded = await loadFreshdeskArticlesForHelpSearch({
        now: 1_700_000_000_000,
        container: mockContainer,
        loadIndex: async () => {
            throw new Error(`Freshdesk articles index storage operation failed: ${CONNECTION_STRING}`);
        },
    });
    assert.equal(loaded, null);
    const cached = await loadFreshdeskArticlesForHelpSearch({
        now: 1_700_000_000_001,
        container: mockContainer,
        loadIndex: async () => {
            throw new Error("Should not be called while cache is warm.");
        },
    });
    assert.equal(cached, null);
});
test("loadFreshdeskArticlesForHelpSearch falls back safely when index JSON is malformed", async () => {
    resetFreshdeskHelpIndexCacheForTests();
    const loaded = await loadFreshdeskArticlesForHelpSearch({
        now: 2_000_000_000_000,
        container: {},
        loadIndex: async () => {
            throw new Error("Freshdesk articles index JSON is malformed.");
        },
    });
    assert.equal(loaded, null);
});
test("toFreshdeskHelpResourceResult does not return the full article body", () => {
    const longBody = "Word ".repeat(80).trim();
    const result = toFreshdeskHelpResourceResult(createFreshdeskArticle({ bodyText: longBody }));
    assert.ok(result.description.length <= 200);
    assert.notEqual(result.description, longBody);
});
test("toFreshdeskHelpResourceResult does not return source image URLs", () => {
    const result = toFreshdeskHelpResourceResult(createFreshdeskArticle());
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("cdn.freshdesk.com"), false);
    assert.equal(serialized.includes("blob.core.windows.net"), false);
    assert.equal(serialized.includes("freshdesk/1001"), false);
    assert.equal(result.url, null);
});
test("Freshdesk help results use support content type and freshdesk source", () => {
    const result = toFreshdeskHelpResourceResult(createFreshdeskArticle());
    assert.equal(result.contentType, "support");
    assert.equal(result.source, "freshdesk");
    assert.equal(result.helpRoutingCategory, "Sales Book and Customers");
});
test("createFreshdeskBodyExcerpt normalizes whitespace", () => {
    assert.equal(createFreshdeskBodyExcerpt("  Line one.   Line   two.  "), "Line one. Line two.");
});
test("loadFreshdeskArticlesForHelpSearch loads articles from a valid index", async () => {
    resetFreshdeskHelpIndexCacheForTests();
    const articles = freshdeskArticles();
    const index = {
        generatedAt: "2026-07-14T12:00:00.000Z",
        articleCount: articles.length,
        failureCount: 0,
        articles,
        failures: [],
    };
    const loaded = await loadFreshdeskArticlesForHelpSearch({
        now: 3_000_000_000_000,
        container: {},
        loadIndex: async () => index,
    });
    assert.deepEqual(loaded, articles);
});
test("buildFindHelpResourcesResponse with Freshdesk results keeps support fallback when nothing matches", () => {
    const response = buildFindHelpResourcesResponse("completely unrelated topic", webinarResources(), {
        freshdeskArticles: freshdeskArticles([
            {
                title: "Unrelated Freshdesk article",
                bodyText: "Nothing matching here.",
            },
        ]),
    });
    assert.equal(response.matchCount, 0);
    assert.equal(response.supportFallbackUrl, "https://bigredcloud.com/support/");
});
