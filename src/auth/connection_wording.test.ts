import assert from "node:assert/strict";
import test from "node:test";

import { renderExpiredLinkPage, renderSuccessPage } from "./connection_page.js";
import {
  DO_NOT_PASTE_API_KEY_IN_CHAT,
  DO_NOT_REUSE_OLD_CONNECTION_LINK,
  FRESH_CONNECTION_ASSISTANT_GUIDANCE,
  FRESH_CONNECTION_LINK_CLAIM_GUIDANCE,
  START_COMPANY_CONNECTION_TOOL_DESCRIPTION,
  formatStartConnectionResponse,
} from "./connection_wording.js";

function assertFreshConnectionWording(text: string): void {
  assert.match(text, /fresh/i);
  assert.match(text, /secure Red connection link/i);
  assert.match(text, /do not reuse an old/i);
  assert.match(text, /paste an API key into chat/i);
}

test("fresh connection assistant guidance requires a new link and forbids reuse and pasted keys", () => {
  assertFreshConnectionWording(FRESH_CONNECTION_ASSISTANT_GUIDANCE);
  assert.match(FRESH_CONNECTION_ASSISTANT_GUIDANCE, /confirmation code/i);
});

test("start company connection tool description covers connect, reconnect, retry, expired, and stale links", () => {
  const description = START_COMPANY_CONNECTION_TOOL_DESCRIPTION;
  assert.match(description, /first-time connect/i);
  assert.match(description, /reconnect/i);
  assert.match(description, /try again after a failed connection/i);
  assert.match(description, /expired session credentials/i);
  assert.match(description, /stale secure connection link/i);
  assert.match(description, /generates a fresh one-time secure Red connection link/i);
  assert.match(description, /never reuse a previous connection link/i);
  assert.match(description, /paste an API key into chat/i);
});

test("start connection response tells the user not to reuse an older link", () => {
  const text = formatStartConnectionResponse("https://example.test/connect?code=abc");
  assert.match(text, /fresh secure Red connection page/i);
  assert.match(text, /Do not open or reuse an older connection link/i);
  assert.match(text, /start a new company connection to generate a fresh link/i);
  assert.equal(text.includes("https://example.test/connect?code=abc"), true);
});

test("claim guidance requires a fresh secure Red connection link", () => {
  assert.match(FRESH_CONNECTION_LINK_CLAIM_GUIDANCE, /fresh company connection/i);
  assert.match(FRESH_CONNECTION_LINK_CLAIM_GUIDANCE, /new secure Red connection link/i);
  assert.match(FRESH_CONNECTION_LINK_CLAIM_GUIDANCE, /do not reuse an old link/i);
});

test("expired connection link page tells the user to start a fresh link and not reuse an old one", () => {
  const html = renderExpiredLinkPage();
  assert.match(html, /Connection link not available/i);
  assert.match(html, /start a fresh company connection/i);
  assert.match(html, /generate a new secure Red connection link/i);
  assert.match(html, /invalid, expired, or has already been used/i);
  assert.match(html, /Do not reuse an old connection link/i);
});

test("success page tells the user to return to this chat and copy/paste the code", () => {
  const html = renderSuccessPage(["YOUR-COMPANY"], "abc123");
  assert.match(html, /Return to this chat and copy\/paste this confirmation code/);
  assert.equal(/return to your AI assistant/i.test(html), false);
  assert.equal(/paste this confirmation command/.test(html), false);
});

test("success page still includes the confirmation code without exposing keys", () => {
  const html = renderSuccessPage(["YOUR-COMPANY"], "abc123");
  assert.match(html, /Confirm connection code abc123/);
});

test("shared do-not-reuse and do-not-paste constants are explicit", () => {
  assert.match(DO_NOT_REUSE_OLD_CONNECTION_LINK, /Do not reuse an old/i);
  assert.match(DO_NOT_PASTE_API_KEY_IN_CHAT, /paste an API key into chat/i);
});
