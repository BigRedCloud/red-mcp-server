import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";

import {
  CONNECTION_REF_INVALID_MESSAGE,
  CONNECTION_REF_NOT_PASSED_MESSAGE,
} from "./connection_ref.js";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const SAMPLE_REF = `redconn_${"b".repeat(48)}`;

async function loadModules() {
  const connectionStore = await import("./connection_store.js");
  const connectionRef = await import("./connection_ref.js");
  const mcpHttpSession = await import("./mcp_http_session.js");
  const shared = await import("../shared.js");
  return { ...connectionStore, ...connectionRef, ...mcpHttpSession, ...shared };
}

test("missing connectionRef error says Vibe did not pass connectionRef", async () => {
  const {
    runWithHttpRequestSessionId,
    getCredentialForCompany,
  } = await loadModules();

  const sessionId = uniqueId("vibe-session");

  assert.throws(
    () => {
      runWithHttpRequestSessionId(sessionId, () =>
        getCredentialForCompany("Company A")
      );
    },
    (error: Error) => {
      assert.match(error.message, /Vibe did not pass connectionRef/i);
      assert.match(error.message, /activeConnectionRef/i);
      assert.equal(error.message.includes(CONNECTION_REF_NOT_PASSED_MESSAGE), true);
      assert.equal(error.message.includes("start a fresh company connection"), false);
      return true;
    }
  );
});

test("expired connectionRef still gives clear reconnect instruction", async () => {
  const {
    getConnectionStore,
    issueConnectionRef,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    runWithActiveConnectionRef,
    getCredentialForCompanyAsync,
  } = await loadModules();

  const connectionId = uniqueId("connection");
  const store = getConnectionStore();
  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: "Company A",
      apiKey: "test-api-key-a",
      expiresAt: Date.now() + 60_000,
      credentialValidatedAt: Date.now(),
    },
  ]);

  const { connectionRef } = await issueConnectionRef(connectionId);
  await store.createConnectionRef({
    ref: connectionRef,
    connectionId,
    expiresAt: Date.now() - 1,
  });

  const scope = await prepareHttpToolSessionScope(
    uniqueId("session"),
    new Map(),
    undefined,
    connectionRef
  );

  await assert.rejects(
    () =>
      runWithActiveConnectionRef(connectionRef, () =>
        runWithHttpToolSession(scope, () =>
          getCredentialForCompanyAsync("Company A")
        )
      ),
    (error: Error) => {
      assert.match(error.message, /invalid or has expired/i);
      assert.match(error.message, /brc_confirm_company_connection/i);
      assert.equal(error.message.includes(CONNECTION_REF_INVALID_MESSAGE), true);
      assert.equal(error.message.includes("Vibe did not pass connectionRef"), false);
      return true;
    }
  );
});

test("jsonResponse echoes activeConnectionRef without adding credential fields", async () => {
  const { jsonResponse, runWithActiveConnectionRef } = await loadModules();

  const payload = runWithActiveConnectionRef(SAMPLE_REF, () =>
    jsonResponse({
      Items: [{ id: 1 }],
      Count: 1,
      companyName: "Company A",
    })
  );

  const text = payload.content[0]?.text ?? "";
  const body = JSON.parse(text);

  assert.equal(body.activeConnectionRef, SAMPLE_REF);
  assert.equal(body.connectionRefUsed, true);
  assert.equal(body.shouldReconnect, false);
  assert.equal(body.connectionRefReminder?.length > 0, true);
  assert.equal("apiKey" in body, false);
  assert.equal("token" in body, false);
});

test("enrichToolResponseData does not invent activeConnectionRef without a ref", async () => {
  const { enrichToolResponseData } = await loadModules();

  const body = enrichToolResponseData({
    Items: [{ id: 1 }],
    Count: 1,
    companyName: "Company A",
  }) as Record<string, unknown>;

  assert.equal(body.activeConnectionRef, undefined);
  assert.equal(body.connectionRefReminder, undefined);
  assert.equal(body.connectionStatus, "active");
});
