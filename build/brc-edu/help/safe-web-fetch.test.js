import assert from "node:assert/strict";
import test from "node:test";
import { BIGREDCLOUD_DOCS_RULE, normalizeApprovedWebUrl, validateApprovedWebUrl, } from "./safe-web-fetch.js";
test("validateApprovedWebUrl accepts bigredcloud docs paths", () => {
    const url = validateApprovedWebUrl("https://bigredcloud.com/docs/sales/invoices/", [BIGREDCLOUD_DOCS_RULE]);
    assert.equal(url.hostname, "bigredcloud.com");
    assert.equal(url.pathname.startsWith("/docs"), true);
});
test("validateApprovedWebUrl rejects non-docs paths", () => {
    assert.throws(() => validateApprovedWebUrl("https://bigredcloud.com/webinar-series/", [
        BIGREDCLOUD_DOCS_RULE,
    ]), /outside the approved crawl scope/i);
});
test("validateApprovedWebUrl rejects javascript URLs", () => {
    assert.throws(() => validateApprovedWebUrl("javascript:alert(1)", [BIGREDCLOUD_DOCS_RULE]), /Only HTTPS URLs are allowed|malformed/i);
});
test("validateApprovedWebUrl rejects localhost", () => {
    assert.throws(() => validateApprovedWebUrl("https://localhost/docs/test", [
        BIGREDCLOUD_DOCS_RULE,
    ]), /not allowed/i);
});
test("normalizeApprovedWebUrl resolves relative docs links", () => {
    const resolved = normalizeApprovedWebUrl("/docs/sales/invoices/", [BIGREDCLOUD_DOCS_RULE], "https://bigredcloud.com/docs/");
    assert.equal(resolved, "https://bigredcloud.com/docs/sales/invoices/");
});
