import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";

function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

test("new confirmed connection creates a new connection session ID", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    ensureConnectionStoreInitialized,
  } = await import("../auth/connection_store.js");
  await ensureConnectionStoreInitialized();
  const store = getConnectionStore();

  const connectionId = uniqueId("conn");
  const sessionId = uniqueId("session");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  await store.completePendingConnection(code);
  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: "Company A",
      apiKey: "test-key-aaaaaaaa",
      expiresAt: Date.now() + 60_000,
      credentialValidatedAt: Date.now(),
    },
  ]);

  const result = await claimConnectionCodeForSession(code, sessionId);
  assert.equal(typeof result.connectionSessionId, "string");
  assert.match(
    result.connectionSessionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );

  const telemetry = await store.getConnectionTelemetry(connectionId);
  assert.equal(telemetry?.connectionSessionId, result.connectionSessionId);
});

test("same client reconnecting retains client ID but gets a new session ID", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    ensureConnectionStoreInitialized,
  } = await import("../auth/connection_store.js");
  await ensureConnectionStoreInitialized();
  const store = getConnectionStore();

  const telemetryClientId = randomUUID();
  const connectionId = uniqueId("conn");
  const code1 = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const code2 = uniqueId("code").replace(/-/g, "").slice(0, 32);

  await store.saveConnectionTelemetry(connectionId, { telemetryClientId });

  await store.createPendingConnection({
    code: code1,
    connectionId,
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  await store.completePendingConnection(code1);
  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: "Company A",
      apiKey: "test-key-bbbbbbbb",
      expiresAt: Date.now() + 60_000,
      credentialValidatedAt: Date.now(),
    },
  ]);

  const first = await claimConnectionCodeForSession(code1, uniqueId("session"));

  await store.createPendingConnection({
    code: code2,
    connectionId,
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  await store.completePendingConnection(code2);

  const second = await claimConnectionCodeForSession(code2, uniqueId("session"));

  const telemetry = await store.getConnectionTelemetry(connectionId);
  assert.equal(telemetry?.telemetryClientId, telemetryClientId);
  assert.notEqual(first.connectionSessionId, second.connectionSessionId);
  assert.equal(telemetry?.connectionSessionId, second.connectionSessionId);
});

test("connection page HTML includes anonymous client id script and form field", async () => {
  const { renderConnectPage } = await import("../auth/connection_page.js");
  const html = renderConnectPage("abc123");
  assert.match(html, /red_telemetry_client_id/);
  assert.match(html, /telemetryClientId/);
  assert.match(html, /localStorage/);
  assert.match(html, /SameSite=Lax/);
});
