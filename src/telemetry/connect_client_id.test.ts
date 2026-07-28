import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";

import {
  buildConnectTelemetryFlowDiagnostics,
  hashConnectionCodeForDiagnostics,
  resolveAndPersistConnectTelemetryClientId,
  resolveCanonicalTelemetryClientId,
  resolveTelemetryClientIdFromRequest,
} from "./context.js";
import {
  buildTelemetryClientIdPageScript,
  generateTelemetryUuid,
  isValidTelemetryUuid,
  TELEMETRY_CLIENT_ID_COOKIE,
  TELEMETRY_CLIENT_ID_FORM_FIELD,
} from "./identity.js";
import { detectClientPlatform } from "./platform.js";

function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

test("Mistral embedded browser: duplicate cookie-less GET keeps one client ID", async () => {
  const {
    getConnectionStore,
    ensureConnectionStoreInitialized,
  } = await import("../auth/connection_store.js");
  await ensureConnectionStoreInitialized();
  const store = getConnectionStore();
  const connectionId = uniqueId("conn-mistral");

  const first = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {
      "user-agent": "Mozilla/5.0",
      // no cookie — typical embedded webview
    },
  });
  assert.equal(first.fallbackGenerated, true);
  assert.equal(first.source, "fallback");
  assert.equal(isValidTelemetryUuid(first.clientId), true);

  const second = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });
  assert.equal(second.clientId, first.clientId);
  assert.equal(second.fallbackGenerated, false);
  assert.equal(second.source, "serverSeed");
  assert.equal(second.fromServerSeed, true);

  const stored = await store.getConnectionTelemetry(connectionId);
  assert.equal(stored?.telemetryClientId, first.clientId);
});

test("cookie unavailable but hidden field present uses submitted ID", () => {
  const bodyId = generateTelemetryUuid();
  const seed = generateTelemetryUuid();
  const result = resolveCanonicalTelemetryClientId({
    headers: {},
    body: { [TELEMETRY_CLIENT_ID_FORM_FIELD]: bodyId },
    serverSeed: seed,
  });
  assert.equal(result.clientId, bodyId.toLowerCase());
  assert.equal(result.source, "body");
  assert.equal(result.fallbackGenerated, false);
  assert.equal(result.postClientIdValid, true);
});

test("localStorage unavailable but server-seeded field present reuses seed", () => {
  const seed = generateTelemetryUuid();
  const result = resolveCanonicalTelemetryClientId({
    headers: {},
    body: {},
    serverSeed: seed,
  });
  assert.equal(result.clientId, seed.toLowerCase());
  assert.equal(result.source, "serverSeed");
  assert.equal(result.fallbackGenerated, false);
});

test("GET and POST retain one client ID for the same connection", async () => {
  const { ensureConnectionStoreInitialized } = await import(
    "../auth/connection_store.js"
  );
  await ensureConnectionStoreInitialized();
  const connectionId = uniqueId("conn-get-post");

  const getResolution = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {},
  });

  const postResolution = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {},
    body: {
      // empty hidden field — cookie also missing (Mistral POST)
      [TELEMETRY_CLIENT_ID_FORM_FIELD]: "",
    },
  });

  assert.equal(postResolution.clientId, getResolution.clientId);
  assert.equal(postResolution.fallbackGenerated, false);
  assert.equal(postResolution.source, "serverSeed");
});

test("duplicate GET requests do not create multiple IDs when cookie is returned", async () => {
  const { ensureConnectionStoreInitialized } = await import(
    "../auth/connection_store.js"
  );
  await ensureConnectionStoreInitialized();
  const connectionId = uniqueId("conn-cookie-get");

  const first = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {},
  });

  const second = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {
      cookie: `${TELEMETRY_CLIENT_ID_COOKIE}=${first.clientId}`,
    },
  });

  assert.equal(second.clientId, first.clientId);
  assert.equal(second.source, "cookie");
  assert.equal(second.fallbackGenerated, false);
});

test("fallback UUID is generated only once per connection", async () => {
  const { ensureConnectionStoreInitialized, getConnectionStore } = await import(
    "../auth/connection_store.js"
  );
  await ensureConnectionStoreInitialized();
  const connectionId = uniqueId("conn-once");

  const a = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {},
  });
  const b = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {},
  });
  const c = await resolveAndPersistConnectTelemetryClientId({
    connectionId,
    headers: {},
    body: {},
  });

  assert.equal(a.fallbackGenerated, true);
  assert.equal(b.fallbackGenerated, false);
  assert.equal(c.fallbackGenerated, false);
  assert.equal(b.clientId, a.clientId);
  assert.equal(c.clientId, a.clientId);

  const stored = await getConnectionStore().getConnectionTelemetry(connectionId);
  assert.equal(stored?.telemetryClientId, a.clientId);
});

test("ChatGPT and Claude cookie behaviour remains unchanged", () => {
  const chatgptId = generateTelemetryUuid();
  const claudeId = generateTelemetryUuid();

  const chatgpt = resolveTelemetryClientIdFromRequest({
    headers: {
      cookie: `${TELEMETRY_CLIENT_ID_COOKIE}=${chatgptId}`,
      "user-agent": "ChatGPT-User/1.0",
    },
    body: {},
  });
  assert.equal(chatgpt.clientId, chatgptId.toLowerCase());
  assert.equal(chatgpt.fromCookie, true);
  assert.equal(chatgpt.fallbackGenerated, false);
  assert.equal(
    detectClientPlatform({ "user-agent": "ChatGPT-User/1.0" }),
    "chatgpt"
  );

  const claude = resolveTelemetryClientIdFromRequest({
    headers: {
      cookie: `${TELEMETRY_CLIENT_ID_COOKIE}=${claudeId}`,
      "user-agent": "claude-desktop",
    },
    body: {},
  });
  assert.equal(claude.clientId, claudeId.toLowerCase());
  assert.equal(claude.fromCookie, true);
  assert.equal(
    detectClientPlatform({ "user-agent": "claude-desktop" }),
    "claude"
  );
});

test("page script does not mint a browser-side UUID when server seed is present", () => {
  const seed = generateTelemetryUuid();
  const script = buildTelemetryClientIdPageScript(seed);
  assert.match(script, new RegExp(`SERVER_ID = "${seed.toLowerCase()}"`));
  assert.equal(/crypto\.randomUUID\s*\(/.test(script), false);
  assert.equal(/function createId\s*\(/.test(script), false);
});

test("connect flow diagnostics never include UUID values", () => {
  const id = generateTelemetryUuid();
  const code = "abcdef0123456789abcdef0123456789";
  const diagnostics = buildConnectTelemetryFlowDiagnostics({
    resolution: resolveCanonicalTelemetryClientId({
      headers: { cookie: `${TELEMETRY_CLIENT_ID_COOKIE}=${id}` },
      serverSeed: id,
    }),
    code,
    headers: { host: "red-staging.example.com", "user-agent": "vibe" },
    localStorageIdPresent: true,
  });

  const blob = JSON.stringify(diagnostics);
  assert.equal(blob.includes(id), false);
  assert.equal(blob.includes(code), false);
  assert.equal(diagnostics.cookieIdPresent, true);
  assert.equal(diagnostics.localStorageIdPresent, true);
  assert.equal(diagnostics.fallbackGenerated, false);
  assert.equal(diagnostics.idsMatched, true);
  assert.equal(diagnostics.requestHost, "red-staging.example.com");
  assert.equal(diagnostics.platform, "mistral");
  assert.equal(diagnostics.connectionCodeHash, hashConnectionCodeForDiagnostics(code));
  assert.equal(diagnostics.connectionCodeHash.length, 12);
});

test("server seed wins over a second fallback when body and cookie are absent", () => {
  const seed = generateTelemetryUuid();
  const first = resolveCanonicalTelemetryClientId({ serverSeed: seed });
  const second = resolveCanonicalTelemetryClientId({ serverSeed: seed });
  assert.equal(first.clientId, second.clientId);
  assert.equal(first.source, "serverSeed");
  assert.equal(second.fallbackGenerated, false);
});
