import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadConnectionStoreModule() {
  return await import("./connection_store.js");
}

test("completed connection code can be claimed and bound to a session", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
  } = await loadConnectionStoreModule();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const sessionId = uniqueId("session");
  const clientKey = uniqueId("client");

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + 60_000,
  });

  await store.completePendingConnection(code);

  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: "Company A",
      apiKey: "test-api-key-company-a",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  const result = await claimConnectionCodeForSession(` ${code} `, ` ${sessionId} `, {
    clientKey,
  });

  assert.equal(result.connectionId, connectionId);
  assert.deepEqual(result.companyNames, ["Company A"]);

  assert.equal(await store.getConnectionIdForSession(sessionId), connectionId);
  assert.equal(await store.getRecentClientClaim(clientKey, 60_000), connectionId);
});

test("claiming an unknown connection code fails safely", async () => {
  const {
    claimConnectionCodeForSession,
    ClaimConnectionError,
  } = await loadConnectionStoreModule();

  await assert.rejects(
    () => claimConnectionCodeForSession(uniqueId("missing-code"), uniqueId("session")),
    (error) => {
      assert.ok(error instanceof ClaimConnectionError);
      assert.equal(error.reason, "not_found");
      assert.match(error.message, /missing|invalid|used/i);
      return true;
    }
  );
});

test("claiming an incomplete connection code fails safely", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    ClaimConnectionError,
  } = await loadConnectionStoreModule();

  const store = getConnectionStore();
  const code = uniqueId("incomplete-code");

  await store.createPendingConnection({
    code,
    connectionId: uniqueId("connection"),
    expiresAt: Date.now() + 60_000,
  });

  await assert.rejects(
    () => claimConnectionCodeForSession(code, uniqueId("session")),
    (error) => {
      assert.ok(error instanceof ClaimConnectionError);
      assert.equal(error.reason, "not_completed");
      assert.match(error.message, /not been completed/i);
      return true;
    }
  );
});

test("claiming an expired connection code fails safely", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    ClaimConnectionError,
  } = await loadConnectionStoreModule();

  const store = getConnectionStore();
  const code = uniqueId("expired-code");

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

test("claiming a completed connection with no companies fails safely", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    ClaimConnectionError,
  } = await loadConnectionStoreModule();

  const store = getConnectionStore();
  const code = uniqueId("empty-company-code");

  await store.createPendingConnection({
    code,
    connectionId: uniqueId("connection"),
    expiresAt: Date.now() + 60_000,
  });

  await store.completePendingConnection(code);

  await assert.rejects(
    () => claimConnectionCodeForSession(code, uniqueId("session")),
    (error) => {
      assert.ok(error instanceof ClaimConnectionError);
      assert.equal(error.reason, "no_companies");
      assert.match(error.message, /No companies/i);
      return true;
    }
  );
});

test("connection credentials are isolated by connection ID", async () => {
  const { getConnectionStore } = await loadConnectionStoreModule();

  const store = getConnectionStore();

  const connectionA = uniqueId("connection-a");
  const connectionB = uniqueId("connection-b");

  await store.saveConnectedCompanies(connectionA, [
    {
      companyName: "Company A",
      apiKey: "api-key-a",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  await store.saveConnectedCompanies(connectionB, [
    {
      companyName: "Company B",
      apiKey: "api-key-b",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  assert.equal(
    await store.getCredentialForCompany(connectionA, "Company B"),
    null
  );

  assert.equal(
    await store.getCredentialForCompany(connectionB, "Company A"),
    null
  );

  assert.equal(
    (await store.getCredentialForCompany(connectionA, "Company A"))?.companyName,
    "Company A"
  );

  assert.equal(
    (await store.getCredentialForCompany(connectionB, "Company B"))?.companyName,
    "Company B"
  );
});