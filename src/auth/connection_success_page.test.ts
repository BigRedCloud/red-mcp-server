import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";

import {
  applyConnectionSuccessPageHeaders,
  escapeHtml,
  renderSuccessPage,
} from "./connection_page.js";
import {
  buildConnectionSuccessPath,
  CONNECTION_SUCCESS_PAGE_TTL_MS,
  createConnectionSuccessPage,
  getConnectionSuccessPage,
  successUrlContainsConfirmationCode,
} from "./connection_success_session.js";
import {
  claimConnectionCodeForSession,
  ClaimConnectionError,
  getConnectionStore,
} from "./connection_store.js";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test("success path never includes the confirmation code", async () => {
  const confirmationCode = uniqueId("confirm-code");
  const { successId, path } = await createConnectionSuccessPage({
    confirmationCode,
    connectedNames: ["Acme Ltd"],
  });

  assert.equal(path.includes(confirmationCode), false);
  assert.notEqual(successId, confirmationCode);
  assert.equal(
    successUrlContainsConfirmationCode(
      `https://red.example.com${path}`,
      confirmationCode
    ),
    false
  );
  assert.equal(path, buildConnectionSuccessPath(successId));
  assert.match(path, /^\/connect\/success\/[0-9a-f]+$/);
  assert.equal(/\?/.test(path), false);
});

test("success page HTML body shows the confirmation code plainly", () => {
  const code = "plain-code-xyz";
  const html = renderSuccessPage(["Demo Co"], code);

  assert.match(html, /id="confirmation-code"/);
  assert.match(html, new RegExp(`>${escapeHtml(code)}<`));
  assert.match(html, /Return to this chat and copy\/paste this confirmation code/);
  assert.match(html, new RegExp(`Confirm connection code ${escapeHtml(code)}`));
});

test("copy-code button copies only the confirmation code", () => {
  const code = "copy-only-code-1";
  const html = renderSuccessPage(["Demo Co"], code);

  assert.match(html, /id="copy-confirmation-code"/);
  assert.match(html, />\s*Copy confirmation code\s*</);
  assert.match(
    html,
    new RegExp(`var confirmationCode = ${JSON.stringify(code)};`)
  );
  assert.match(
    html,
    /copyText\(confirmationCode, "Confirmation code copied\."\)/
  );
});

test("copy-message button uses Confirm connection code <CODE>", () => {
  const code = "chat-msg-code-2";
  const html = renderSuccessPage(["Demo Co"], code);
  const expectedMessage = `Confirm connection code ${code}`;

  assert.match(html, /id="copy-chat-message"/);
  assert.match(html, />\s*Copy message for chat\s*</);
  assert.match(
    html,
    new RegExp(`var chatMessage = ${JSON.stringify(expectedMessage)};`)
  );
  assert.match(html, /copyText\(chatMessage, "Chat message copied\."\)/);
});

test("confirmation code is HTML-escaped in the success page body", () => {
  const code = `<img src=x onerror=alert(1)>&"'`;
  const html = renderSuccessPage(["Demo Co"], code);

  // Visible HTML text must be escaped (not a live tag).
  assert.match(html, /id="confirmation-code">[^<]*&lt;img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;/);
  assert.match(html, /&#039;/);
  assert.equal(/id="confirmation-code"><img/.test(html), false);

  // Clipboard payload is JSON-encoded for the script context.
  assert.match(html, /var confirmationCode = "/);
  assert.equal(html.includes("localStorage.setItem"), false);
  assert.equal(/localStorage\.(setItem|getItem)\([^)]*confirmation/i.test(html), false);
});

test("success page does not render API keys, connectionRef, or connection ids", () => {
  const code = "safe-visible-code";
  const html = renderSuccessPage(["Company A"], code, [
    {
      companyName: "Bad Co",
      connected: false,
      reason: "invalid_or_expired_api_key",
      message: "Could not validate credentials for Bad Co.",
    },
  ]);

  assert.equal(html.includes("secret-api-key"), false);
  assert.equal(html.includes("apiKey"), false);
  assert.equal(html.includes("connectionRef"), false);
  assert.equal(html.includes("redconn_"), false);
  assert.equal(html.includes("connectionId"), false);
  assert.equal(/cosmos/i.test(html), false);
  assert.match(html, /Company A/);
  assert.match(html, /safe-visible-code/);
});

test("success page headers include no-store and no-referrer", () => {
  const headers = new Map<string, string>();
  applyConnectionSuccessPageHeaders({
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
  });

  assert.equal(headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  assert.equal(headers.get("pragma"), "no-cache");
  assert.equal(headers.get("referrer-policy"), "no-referrer");

  const html = renderSuccessPage(["Demo Co"], "header-code");
  assert.match(html, /<meta name="referrer" content="no-referrer"/);
});

test("opaque success session returns confirmation code server-side until expiry", async () => {
  const confirmationCode = uniqueId("sess-code");
  const { successId } = await createConnectionSuccessPage({
    confirmationCode,
    connectedNames: ["Alpha"],
    failedCompanies: [],
  });

  const page = await getConnectionSuccessPage(successId);
  assert.ok(page);
  assert.equal(page.confirmationCode, confirmationCode);
  assert.deepEqual(page.connectedNames, ["Alpha"]);
  assert.ok(page.expiresAt > Date.now());
  assert.ok(page.expiresAt - page.createdAt <= CONNECTION_SUCCESS_PAGE_TTL_MS + 1_000);
});

test("expired success session is not returned", async () => {
  const store = getConnectionStore();
  const successId = uniqueId("expired-success");
  const confirmationCode = uniqueId("expired-confirm");

  await store.saveConnectionSuccessPage({
    successId,
    confirmationCode,
    connectedNames: ["Gone"],
    failedCompanies: [],
    createdAt: Date.now() - 60_000,
    expiresAt: Date.now() - 1,
  });

  assert.equal(await getConnectionSuccessPage(successId), null);
});

test("confirmation code remains claimable once then fails on second claim", async () => {
  const store = getConnectionStore();
  const code = uniqueId("claim-once");
  const connectionId = uniqueId("connection");

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + 60_000,
  });
  await store.completePendingConnection(code);
  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: "Company A",
      apiKey: "test-api-key-a",
      expiresAt: Date.now() + 60_000,
      credentialValidatedAt: Date.now(),
    },
  ]);

  const first = await claimConnectionCodeForSession(code, uniqueId("session-1"));
  assert.equal(first.connectionId, connectionId);

  await assert.rejects(
    () => claimConnectionCodeForSession(code, uniqueId("session-2")),
    (error) => {
      assert.ok(error instanceof ClaimConnectionError);
      assert.equal(error.reason, "not_found");
      return true;
    }
  );
});

test("expired pending confirmation codes still fail before claim", async () => {
  const store = getConnectionStore();
  const code = uniqueId("expired-pending");

  await store.createPendingConnection({
    code,
    connectionId: uniqueId("connection"),
    expiresAt: Date.now() - 1,
  });

  await assert.rejects(
    () => claimConnectionCodeForSession(code, uniqueId("session")),
    (error) => {
      assert.ok(error instanceof ClaimConnectionError);
      assert.equal(error.reason, "not_found");
      return true;
    }
  );
});

test("completing a pending connection link a second time fails safely", async () => {
  const store = getConnectionStore();
  const code = uniqueId("complete-once");

  await store.createPendingConnection({
    code,
    connectionId: uniqueId("connection"),
    expiresAt: Date.now() + 60_000,
  });

  const first = await store.completePendingConnection(code);
  assert.ok(first);
  assert.equal(first.used, true);

  const second = await store.completePendingConnection(code);
  assert.equal(second, null);
});
