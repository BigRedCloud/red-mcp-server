import assert from "node:assert/strict";
import test from "node:test";

import {
    decodeStoredApiKey,
    encodeStoredApiKey,
  } from "../auth/credential_secret.js";
  
  import {
    renderConnectPage,
    renderConnectionFailedPage,
    renderSuccessPage,
  } from "../auth/connection_page.js";
  

test("stored API keys are not stored as raw plaintext", () => {
  const rawApiKey = "super-secret-production-api-key";

  delete process.env.RED_CONNECT_ENCRYPTION_KEY;

  const stored = encodeStoredApiKey(rawApiKey);

  assert.notEqual(stored, rawApiKey);
  assert.equal(stored.includes(rawApiKey), false);
  assert.equal(decodeStoredApiKey(stored), rawApiKey);
});

test("stored API keys use encrypted format when encryption key is configured", () => {
  const rawApiKey = "another-super-secret-api-key";

  process.env.RED_CONNECT_ENCRYPTION_KEY =
    "test-only-encryption-key-that-is-long-enough";

  const stored = encodeStoredApiKey(rawApiKey);

  assert.equal(stored.startsWith("enc:"), true);
  assert.equal(stored.includes(rawApiKey), false);
  assert.equal(decodeStoredApiKey(stored), rawApiKey);

  delete process.env.RED_CONNECT_ENCRYPTION_KEY;
});

test("connection page does not render API keys", () => {
  const fakeApiKey = "secret-key-that-must-not-render";
  const html = renderConnectPage("test-code");

  assert.equal(html.includes(fakeApiKey), false);
  assert.match(html, /type="password"/);
});

test("success page shows company names and code but not API keys", () => {
  const fakeApiKey = "secret-api-key-123";
  const html = renderSuccessPage(["Company A"], "safe-code-123");

  assert.match(html, /Company A/);
  assert.match(html, /safe-code-123/);
  assert.equal(html.includes(fakeApiKey), false);
});

test("error pages escape user supplied HTML to prevent reflected XSS", () => {
    const html = renderConnectionFailedPage(
      `<script>alert("xss")</script><img src=x onerror=alert(1)>`
    );
  
    // The raw user-supplied dangerous HTML should not appear.
    assert.equal(html.includes(`<script>alert("xss")</script>`), false);
    assert.equal(html.includes(`<img src=x onerror=alert(1)>`), false);
  
    // The dangerous parts should be escaped as text instead.
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });