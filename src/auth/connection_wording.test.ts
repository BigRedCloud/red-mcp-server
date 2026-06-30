import assert from "node:assert/strict";
import test from "node:test";

import { renderSuccessPage } from "./connection_page.js";

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
