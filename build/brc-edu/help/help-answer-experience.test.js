import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerFacingSourcesMarkdown, buildHelpAnswerSources, buildSourcesMarkdownTextBlock, } from "./help-answer-sources.js";
import { COMPANY_SPECIFIC_SUPPORT_MARKDOWN, CUSTOMER_FACING_SUPPORT_MARKDOWN, SUPPORT_CONTACT_URL, resolveSupportFallback, } from "./help-support-fallback.js";
import { buildUnifiedFindHelpResourcesResponse, unifiedFindHelpResourcesMcpContent, } from "./unified-help-search.js";
const FRESHDESK_PUBLIC_URL = "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-how-do-i-add-a-customer";
function customerDoc() {
    return {
        resourceId: "customer_docs:getting-started",
        source: "customer_docs",
        title: "Getting Started with Big Red Cloud",
        summary: "Get started",
        bodyText: "Getting started guide for Big Red Cloud.",
        url: "https://docs.example.com/getting-started",
        category: "Getting Started",
        topics: ["getting started"],
        imageBlobNames: [],
        enabled: true,
        lastSyncedAt: "2026-07-01T00:00:00.000Z",
    };
}
function freshdeskArticle() {
    return {
        id: "freshdesk-1001",
        source: "freshdesk",
        freshdeskArticleId: 1001,
        categoryId: 1,
        folderId: 2,
        folderName: "Customers",
        title: "How do I add a Customer?",
        bodyText: "Click Customers, then click Add.",
        images: [],
        syncedImages: [
            {
                sourceUrl: "https://cdn.freshdesk.com/a.png",
                blobName: "freshdesk/1001/a.png",
                sha256: "00000000000000000000000000000000000000000000000000000000000000ab",
                contentType: "image/png",
                altText: "Add customer",
                order: 0,
            },
        ],
        updatedAt: "2026-07-01T00:00:00.000Z",
        enabled: true,
        slug: "how-do-i-add-a-customer",
        publicUrl: FRESHDESK_PUBLIC_URL,
    };
}
test("used help resources appear under Sources", () => {
    const response = buildUnifiedFindHelpResourcesResponse("add a customer", {
        customerDocs: [customerDoc()],
        freshdeskArticles: [freshdeskArticle()],
    });
    assert.ok(response.sources.length >= 1);
    assert.ok(response.customerFacingSourcesMarkdown?.startsWith("Sources"));
    assert.match(response.customerFacingSourcesMarkdown ?? "", /How do I add a Customer\?|Getting Started with Big Red Cloud/);
});
test("Sources preserve exact public URLs", () => {
    const response = buildUnifiedFindHelpResourcesResponse("add a customer", {
        freshdeskArticles: [freshdeskArticle()],
    });
    const freshdeskSource = response.sources.find((source) => source.sourceType === "support_article");
    assert.equal(freshdeskSource?.url, FRESHDESK_PUBLIC_URL);
    assert.match(response.customerFacingSourcesMarkdown ?? "", new RegExp(FRESHDESK_PUBLIC_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(response.customerFacingSourcesMarkdown?.includes("bigredcloud.com/support/how"), false);
});
test("Sources are deduplicated", () => {
    const sources = buildHelpAnswerSources([
        {
            title: "How do I add a Customer?",
            source: "freshdesk",
            publicUrl: FRESHDESK_PUBLIC_URL,
        },
        {
            title: "How do I add a Customer? (duplicate)",
            source: "freshdesk",
            publicUrl: FRESHDESK_PUBLIC_URL,
        },
        {
            title: "Getting Started with Big Red Cloud",
            source: "customer_docs",
            publicUrl: "https://docs.example.com/getting-started",
        },
    ]);
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.url, FRESHDESK_PUBLIC_URL);
});
test("internal resource IDs and Azure metadata are not exposed in Sources", () => {
    const markdown = buildCustomerFacingSourcesMarkdown([
        {
            title: "How do I add a Customer?",
            url: FRESHDESK_PUBLIC_URL,
            sourceType: "support_article",
        },
    ]);
    assert.equal(markdown?.includes("freshdesk:1001"), false);
    assert.equal(markdown?.includes("blob.core.windows.net"), false);
    assert.equal(markdown?.includes("freshdesk/1001/a.png"), false);
    assert.equal(markdown?.includes("AccountKey="), false);
});
test("screenshot links remain beside steps, not under Sources", () => {
    const screenshotUrl = "https://red.example.com/public/brc-edu/freshdesk-images/1001/token";
    const sourcesMarkdown = buildCustomerFacingSourcesMarkdown([
        {
            title: "How do I add a Customer?",
            url: FRESHDESK_PUBLIC_URL,
            sourceType: "support_article",
        },
    ]);
    assert.equal(sourcesMarkdown?.includes(screenshotUrl), false);
    assert.equal(sourcesMarkdown?.includes("Adding a customer: Click Add"), false);
    const sourcesBlock = buildSourcesMarkdownTextBlock(sourcesMarkdown);
    assert.match(sourcesBlock ?? "", /Do not move screenshot links into Sources/i);
});
test("support link appears when no strong answer is found", () => {
    const response = buildUnifiedFindHelpResourcesResponse("completely unrelated zzqx topic", {
        customerDocs: [customerDoc()],
        freshdeskArticles: [freshdeskArticle()],
    });
    assert.equal(response.matchCount, 0);
    assert.equal(response.supportFallbackRecommended, true);
    assert.equal(response.supportFallbackReason, "no_strong_match");
    assert.equal(response.supportUrl, SUPPORT_CONTACT_URL);
    assert.equal(response.customerFacingSupportMarkdown, CUSTOMER_FACING_SUPPORT_MARKDOWN);
});
test("support link appears for unresolved company-specific settings", () => {
    const fallback = resolveSupportFallback({
        matchCount: 2,
        strongestScore: 500,
        hasRelevantSourceOrScreenshot: true,
        companySpecific: true,
    });
    assert.equal(fallback.supportFallbackRecommended, true);
    assert.equal(fallback.supportFallbackReason, "company_specific_settings");
    assert.equal(fallback.supportUrl, SUPPORT_CONTACT_URL);
    assert.equal(fallback.customerFacingSupportMarkdown, COMPANY_SPECIFIC_SUPPORT_MARKDOWN);
});
test("support link is omitted from complete confident answers", () => {
    const response = buildUnifiedFindHelpResourcesResponse("add a customer", {
        freshdeskArticles: [freshdeskArticle()],
    });
    assert.ok(response.matchCount > 0);
    assert.equal(response.supportFallbackRecommended, false);
    assert.equal(response.supportFallbackReason, null);
    assert.equal(response.customerFacingSupportMarkdown, undefined);
    assert.equal(response.supportFallbackUrl, null);
});
test("find-help MCP content includes ready-to-use Sources Markdown", () => {
    const payload = buildUnifiedFindHelpResourcesResponse("add a customer", {
        freshdeskArticles: [freshdeskArticle()],
    });
    const mcp = unifiedFindHelpResourcesMcpContent(payload);
    assert.equal(mcp.content[0]?.type, "text");
    assert.ok(mcp.content.some((block) => block.text.includes("Sources")));
    assert.ok(mcp.content.some((block) => block.text.includes(FRESHDESK_PUBLIC_URL)));
    assert.equal(mcp.content.some((block) => block.text.includes("freshdesk/1001")), false);
});
