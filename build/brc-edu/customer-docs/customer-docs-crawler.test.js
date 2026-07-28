import assert from "node:assert/strict";
import test from "node:test";
import { extractCustomerDocsLinks, isCustomerDocsArticleUrl, parseCustomerDocsArticlePage, } from "./customer-docs-crawler.js";
const DOCS_HOME_HTML = `
<html><body>
<nav><a href="/docs/">Docs</a></nav>
<a href="/docs/sales/">Sales</a>
<a href="/docs/sales/invoices/">Invoices</a>
<a href="https://bigredcloud.com/contact/">Contact</a>
<footer>Cookie banner accept all</footer>
</body></html>`;
const ARTICLE_HTML = `
<html><body>
<nav>Menu</nav>
<h1>Completing a Bank Reconciliation</h1>
<div class="breadcrumb"><a href="/docs/">Docs</a><a href="/docs/cash-book/">Cash Book</a></div>
<main>
  <p>Follow these steps to complete a bank reconciliation in Big Red Cloud.</p>
  <h2>Match transactions</h2>
  <p>Review unmatched items and confirm the closing balance.</p>
</main>
<footer>Privacy policy</footer>
</body></html>`;
test("extractCustomerDocsLinks discovers docs category and article links", () => {
    const links = extractCustomerDocsLinks(DOCS_HOME_HTML, "https://bigredcloud.com/docs/");
    assert.ok(links.some((link) => link.includes("/docs/sales/")));
    assert.ok(links.some((link) => link.includes("/docs/sales/invoices/")));
    assert.equal(links.some((link) => link.includes("/contact/")), false);
});
test("isCustomerDocsArticleUrl identifies article pages", () => {
    assert.equal(isCustomerDocsArticleUrl("https://bigredcloud.com/docs/sales/invoices/"), true);
    assert.equal(isCustomerDocsArticleUrl("https://bigredcloud.com/docs/sales/"), false);
});
test("parseCustomerDocsArticlePage preserves canonical URL and removes navigation text", () => {
    const article = parseCustomerDocsArticlePage(ARTICLE_HTML, "https://bigredcloud.com/docs/cash-book/bank-reconciliation/", "2026-07-15T10:00:00.000Z");
    assert.ok(article);
    assert.equal(article?.title, "Completing a Bank Reconciliation");
    assert.equal(article?.url, "https://bigredcloud.com/docs/cash-book/bank-reconciliation/");
    assert.match(article?.bodyText ?? "", /bank reconciliation/i);
    assert.equal(article?.bodyText.includes("Cookie banner"), false);
    assert.equal(article?.bodyText.includes("Privacy policy"), false);
    assert.equal(article?.source, "customer_docs");
});
test("crawlCustomerDocumentation uses mocked fetch without live network", async () => {
    const { crawlCustomerDocumentation } = await import("./customer-docs-crawler.js");
    const responses = new Map([
        ["https://bigredcloud.com/docs/", DOCS_HOME_HTML],
        ["https://bigredcloud.com/docs/sales/", DOCS_HOME_HTML],
        [
            "https://bigredcloud.com/docs/sales/invoices/",
            ARTICLE_HTML.replace("Completing a Bank Reconciliation", "Creating Sales Invoices"),
        ],
    ]);
    const fetchImpl = async (input) => {
        const raw = String(input);
        const normalized = raw.replace(/\/+$/, "") + "/";
        const text = responses.get(normalized) ??
            responses.get(raw) ??
            (normalized.includes("/docs/") && normalized.split("/").filter(Boolean).length >= 3
                ? ARTICLE_HTML
                : DOCS_HOME_HTML);
        return new Response(text, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    };
    const result = await crawlCustomerDocumentation({
        fetchImpl,
        maxPages: 10,
    });
    assert.ok(result.articles.length >= 1);
    assert.ok(result.discoveredUrls.length >= 2);
});
