import assert from "node:assert/strict";
import test from "node:test";

import {
  BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS,
  BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS,
  findAdminPageElementIdsBeforeScript,
  getAdminPageScriptReferencedElementIds,
  renderBrcEduUploadPage,
} from "./brc_edu_upload_page.js";

const TEST_SECRET = "test-admin-secret-value";

test("renderBrcEduUploadPage includes every required admin element id before the init script", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET);
  const renderedIds = findAdminPageElementIdsBeforeScript(html);

  for (const id of BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS) {
    assert.equal(
      renderedIds.has(id),
      true,
      `Expected id="${id}" in markup before admin init script`,
    );
  }
});

test("renderBrcEduUploadPage includes optional admin element ids before the init script", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET);
  const renderedIds = findAdminPageElementIdsBeforeScript(html);

  for (const id of BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS) {
    assert.equal(renderedIds.has(id), true, `Expected optional id="${id}" in markup`);
  }
});

test("admin init script is emitted after toolbar markup so elements exist at init time", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET);
  const scriptMarker = html.indexOf("function requireElement(id)");
  const refreshBtn = html.indexOf('id="refresh-btn"');

  assert.ok(scriptMarker >= 0, "Admin init script marker should be present");
  assert.ok(refreshBtn >= 0, "Refresh button should be present");
  assert.ok(
    refreshBtn < scriptMarker,
    "Refresh button markup must appear before the admin init script",
  );
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

test("getAdminPageScriptReferencedElementIds covers every required and optional id", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET);
  const renderedIds = findAdminPageElementIdsBeforeScript(html);
  const referencedIds = getAdminPageScriptReferencedElementIds();

  assert.deepEqual(
    new Set(referencedIds),
    new Set([
      ...BRC_EDU_UPLOAD_ADMIN_REQUIRED_ELEMENT_IDS,
      ...BRC_EDU_UPLOAD_ADMIN_OPTIONAL_ELEMENT_IDS,
    ]),
  );

  for (const id of referencedIds) {
    assert.equal(renderedIds.has(id), true, `Referenced id="${id}" should exist in markup`);
  }
});

test("renderBrcEduUploadPage does not embed the admin secret in error message templates", () => {
  const secret = "super-secret-admin-token-12345";
  const html = renderBrcEduUploadPage(secret);

  assert.equal(html.includes(`Admin page element missing: ${secret}`), false);
  assert.equal(html.includes(`Could not load workbook.${secret}`), false);
});

test("renderBrcEduUploadPage session mode keeps the admin page without secret query parameters", () => {
  const html = renderBrcEduUploadPage({ mode: "session" });

  assert.match(html, /BRC Edu webinar resources/);
  assert.match(html, /id="refresh-btn"/);
  assert.match(html, /id="save-btn"/);
  assert.equal(html.includes("secret="), false);
});
