import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_OVERVIEW_REQUIRED_ELEMENT_IDS,
  findAdminPageElementIdsBeforeScript,
  getAdminPageScriptReferencedElementIds,
  parseBrcEduAdminView,
  renderBrcEduUploadPage,
} from "./brc_edu_upload_page.js";
import { YOUTUBE_ADMIN_REQUIRED_ELEMENT_IDS } from "../brc-edu/youtube/youtube-admin-page.js";
import { FRESHDESK_ADMIN_REQUIRED_ELEMENT_IDS } from "../brc-edu/freshdesk/freshdesk-admin-page.js";

const TEST_SECRET = "test-admin-secret-value";

test("parseBrcEduAdminView defaults to overview", () => {
  assert.equal(parseBrcEduAdminView(undefined), "overview");
  assert.equal(parseBrcEduAdminView("youtube"), "youtube");
  assert.equal(parseBrcEduAdminView("freshdesk"), "freshdesk");
});

test("renderBrcEduUploadPage defaults to content overview homepage", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET);

  assert.match(html, /Red content administration/);
  assert.match(html, /Content overview/);
  assert.match(html, /YouTube videos/);
  assert.match(html, /Freshdesk articles/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /id="overview-refresh-btn"/);
  assert.match(html, /Visible content by topic/);
  assert.equal(html.includes("Upload Excel"), false);
  assert.equal(html.includes("workbook"), false);
});

test("overview nav item is active on the default view", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "overview");
  assert.match(html, /admin-nav-link nav-active[^>]*>Content overview</);
});

test("YouTube view renders split sections and nav active state", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "youtube");

  assert.match(html, /YouTube video management/);
  assert.match(html, /id="youtube-videos-section"/);
  assert.match(html, /id="youtube-webinars-section"/);
  assert.match(html, /Recorded webinars/);
  assert.match(html, /admin-nav-link nav-active[^>]*>YouTube videos</);
  assert.equal(html.includes("id=\"overview-topics\""), false);
});

test("Freshdesk view mounts Freshdesk admin controls", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "freshdesk");

  assert.match(html, /Freshdesk article management/);
  assert.match(html, /Sync Freshdesk now/);
  assert.match(html, /id="freshdesk-sync-btn"/);
  assert.match(html, /admin-nav-link nav-active[^>]*>Freshdesk articles</);
});

test("overview view includes every required overview element id", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "overview");
  const renderedIds = findAdminPageElementIdsBeforeScript(html);
  const referencedIds = getAdminPageScriptReferencedElementIds("overview");

  assert.deepEqual(
    new Set(referencedIds),
    new Set([...CONTENT_OVERVIEW_REQUIRED_ELEMENT_IDS]),
  );

  for (const id of CONTENT_OVERVIEW_REQUIRED_ELEMENT_IDS) {
    assert.equal(renderedIds.has(id), true, `Expected id="${id}"`);
  }
});

test("YouTube view includes every required YouTube admin element id", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "youtube");
  const renderedIds = findAdminPageElementIdsBeforeScript(html);

  for (const id of YOUTUBE_ADMIN_REQUIRED_ELEMENT_IDS) {
    assert.equal(renderedIds.has(id), true, `Expected id="${id}"`);
  }
});

test("Freshdesk view includes every required Freshdesk admin element id", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "freshdesk");
  const renderedIds = findAdminPageElementIdsBeforeScript(html);

  for (const id of FRESHDESK_ADMIN_REQUIRED_ELEMENT_IDS) {
    assert.equal(renderedIds.has(id), true, `Expected id="${id}"`);
  }
});

test("renderBrcEduUploadPage does not embed the admin secret in error message templates", () => {
  const secret = "super-secret-admin-token-12345";
  const html = renderBrcEduUploadPage(secret, "youtube");

  assert.equal(html.includes(`Admin page element missing: ${secret}`), false);
  assert.equal(html.includes(`YouTube admin element missing: ${secret}`), false);
});

test("renderBrcEduUploadPage session mode keeps the admin page without secret query parameters", () => {
  const html = renderBrcEduUploadPage({ mode: "session" }, "overview");

  assert.match(html, /Red content administration/);
  assert.match(html, /id="overview-refresh-btn"/);
  assert.equal(html.includes("secret="), false);
});

test("Freshdesk admin HTML escapes user-controlled values in script helpers", () => {
  const html = renderBrcEduUploadPage(TEST_SECRET, "freshdesk");
  assert.match(html, /function escapeHtml\(value\)/);
  assert.match(html, /rel="noopener noreferrer"/);
});
