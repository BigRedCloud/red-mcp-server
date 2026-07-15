import assert from "node:assert/strict";
import test from "node:test";
import { BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS, BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS, findAdminPageElementIdsBeforeScript, getAdminPageScriptReferencedElementIds, renderBrcEduUploadPage, } from "./brc_edu_upload_page.js";
const TEST_SECRET = "test-admin-secret-value";
test("renderBrcEduUploadPage includes every required admin element id before the init script", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    const renderedIds = findAdminPageElementIdsBeforeScript(html);
    for (const id of BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS) {
        assert.equal(renderedIds.has(id), true, `Expected id="${id}" in markup before admin init script`);
    }
});
test("renderBrcEduUploadPage includes optional admin element ids before the init script", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    const renderedIds = findAdminPageElementIdsBeforeScript(html);
    for (const id of BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS) {
        assert.equal(renderedIds.has(id), true, `Expected optional id="${id}" in markup`);
    }
});
test("admin page contains Refresh, Download current Excel, and Upload Excel", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.match(html, /Refresh from Azure/);
    assert.match(html, /Download current Excel/);
    assert.match(html, /Upload Excel/);
    assert.match(html, /id="refresh-btn"/);
    assert.match(html, /id="download-btn"/);
    assert.match(html, /id="upload-excel-btn"/);
});
test("admin page does not contain in-browser editing controls", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.equal(html.includes("Add resource"), false);
    assert.equal(html.includes("Save &amp; Publish"), false);
    assert.equal(html.includes("Save & Publish"), false);
    assert.equal(html.includes("Cancel changes"), false);
    assert.equal(html.includes('id="add-btn"'), false);
    assert.equal(html.includes('id="save-btn"'), false);
    assert.equal(html.includes('id="cancel-btn"'), false);
    assert.equal(html.includes("Delete"), false);
});
test("admin page instructions describe download-edit-upload workflow", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.match(html, /Click Refresh from Azure to view the latest workbook/i);
    assert.match(html, /Click Download current Excel/i);
    assert.match(html, /Open the downloaded file in Excel/i);
    assert.match(html, /Keep the existing column headers unchanged/i);
    assert.match(html, /Red updates after the uploaded file is processed/i);
});
test("workbook preview script renders read-only text and clickable URLs", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.match(html, /cell\.textContent/);
    assert.match(html, /document\.createElement\("a"\)/);
    assert.match(html, /target = "_blank"/);
    assert.match(html, /rel = "noopener noreferrer"/);
    assert.equal(html.includes('data-field="videoTitle"'), false);
    assert.equal(html.includes("<input"), true);
    assert.equal(html.includes('type="file"'), true);
    assert.equal(html.match(/<input/g)?.length, 1);
});
test("admin page script does not issue PUT requests", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.equal(/method:\s*["']PUT["']/i.test(html), false);
    assert.equal(/method:\s*"PUT"/.test(html), false);
});
test("admin init script is emitted after toolbar markup so elements exist at init time", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    const scriptMarker = html.indexOf("function requireElement(id)");
    const refreshBtn = html.indexOf('id="refresh-btn"');
    assert.ok(scriptMarker >= 0, "Admin init script marker should be present");
    assert.ok(refreshBtn >= 0, "Refresh button should be present");
    assert.ok(refreshBtn < scriptMarker, "Refresh button markup must appear before the admin init script");
});
test("admin init script is not placed in head before body content", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    const headClose = html.indexOf("</head>");
    const scriptMarker = html.indexOf("function initAdminPage()");
    assert.ok(headClose >= 0, "Page should include a head section");
    assert.ok(scriptMarker > headClose, "Admin init script must run from body markup, not head");
});
test("admin init script uses requireElement and DOMContentLoaded guards", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.match(html, /function requireElement\(id\)/);
    assert.match(html, /Admin page element missing:/);
    assert.match(html, /DOMContentLoaded", initAdminPage\)/);
    assert.match(html, /els\.refreshBtn\.addEventListener\("click"/);
    assert.match(html, /els\.uploadExcelBtn\.addEventListener\("click"/);
});
test("upload Excel button tolerates missing optional file input", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    assert.match(html, /fileInput instanceof HTMLInputElement/);
    assert.match(html, /document\.getElementById\(fileInputId\)/);
});
test("getAdminPageScriptReferencedElementIds covers every required and optional id", () => {
    const html = renderBrcEduUploadPage(TEST_SECRET);
    const renderedIds = findAdminPageElementIdsBeforeScript(html);
    const referencedIds = getAdminPageScriptReferencedElementIds();
    assert.deepEqual(new Set(referencedIds), new Set([
        ...BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS,
        ...BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS,
    ]));
    for (const id of referencedIds) {
        assert.equal(renderedIds.has(id), true, `Referenced id="${id}" should exist in markup`);
    }
});
test("renderBrcEduUploadPage does not embed the admin secret in visible page text", () => {
    const secret = "super-secret-admin-token-12345";
    const html = renderBrcEduUploadPage(secret);
    assert.equal(html.includes(`>super-secret-admin-token-12345<`), false);
    assert.equal(html.includes(`Admin page element missing: ${secret}`), false);
    assert.equal(html.includes(`Could not load workbook.${secret}`), false);
});
