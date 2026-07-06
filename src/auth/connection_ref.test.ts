import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadModules() {
  const connectionStore = await import("./connection_store.js");
  const connectionRef = await import("./connection_ref.js");
  const mcpHttpSession = await import("./mcp_http_session.js");
  const shared = await import("../shared.js");
  return { ...connectionStore, ...connectionRef, ...mcpHttpSession, ...shared };
}

async function seedConnection(connectionId: string, companies: string[]) {
  const { getConnectionStore } = await loadModules();
  const store = getConnectionStore();
  await store.saveConnectedCompanies(
    connectionId,
    companies.map((companyName) => ({
      companyName,
      apiKey: `test-api-key-${companyName}`,
      expiresAt: Date.now() + 60_000,
    }))
  );
}

test("confirm issues connectionRef and rotated Vibe session can reload companies with it", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    runWithHttpToolSession,
    prepareHttpToolSessionScope,
    listConnectedCompanyNames,
    isConnectionRefFormat,
  } = await loadModules();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const confirmSession = uniqueId("vibe-session-confirm");
  const rotatedSession = uniqueId("vibe-session-next");

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + 60_000,
  });
  await store.completePendingConnection(code);
  await seedConnection(connectionId, ["Company A", "Company B", "Company C", "Company D"]);

  const result = await claimConnectionCodeForSession(code, confirmSession);
  assert.equal(isConnectionRefFormat(result.connectionRef), true);
  assert.deepEqual(result.companyNames.sort(), [
    "Company A",
    "Company B",
    "Company C",
    "Company D",
  ]);

  const scope = await prepareHttpToolSessionScope(
    rotatedSession,
    new Map(),
    undefined,
    result.connectionRef
  );

  assert.equal(scope.resolution.connectionRefResolved, true);
  assert.equal(scope.resolution.connectionId, connectionId);

  await runWithHttpToolSession(scope, async () => {
    assert.deepEqual(listConnectedCompanyNames().sort(), [
      "Company A",
      "Company B",
      "Company C",
      "Company D",
    ]);
  });
});

test("rotated session without connectionRef or stable client identity stays unbound", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    prepareHttpToolSessionScope,
    listConnectedCompanyNames,
    runWithHttpToolSession,
  } = await loadModules();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const confirmSession = uniqueId("session-confirm");
  const rotatedSession = uniqueId("session-rotated");

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + 60_000,
  });
  await store.completePendingConnection(code);
  await seedConnection(connectionId, ["Company C"]);

  await claimConnectionCodeForSession(code, confirmSession);

  const scope = await prepareHttpToolSessionScope(rotatedSession, new Map());
  assert.equal(scope.resolution.connectionId, null);

  await runWithHttpToolSession(scope, async () => {
    assert.deepEqual(listConnectedCompanyNames(), []);
  });
});

test("different connectionRef cannot access another connection", async () => {
  const {
    getConnectionStore,
    issueConnectionRef,
    prepareHttpToolSessionScope,
    listConnectedCompanyNames,
    runWithHttpToolSession,
  } = await loadModules();

  const connectionA = uniqueId("connection-a");
  const connectionB = uniqueId("connection-b");
  await seedConnection(connectionA, ["Company A"]);
  await seedConnection(connectionB, ["Company B"]);

  const refA = await issueConnectionRef(connectionA);
  const refB = await issueConnectionRef(connectionB);

  const scopeWrong = await prepareHttpToolSessionScope(
    uniqueId("session"),
    new Map(),
    undefined,
    refB.connectionRef
  );

  await runWithHttpToolSession(scopeWrong, async () => {
    const names = listConnectedCompanyNames();
    assert.equal(names.includes("Company A"), false);
    assert.deepEqual(names, ["Company B"]);
  });

  const scopeRight = await prepareHttpToolSessionScope(
    uniqueId("session-2"),
    new Map(),
    undefined,
    refA.connectionRef
  );

  await runWithHttpToolSession(scopeRight, async () => {
    assert.deepEqual(listConnectedCompanyNames(), ["Company A"]);
  });
});

test("expired connectionRef fails safely", async () => {
  const {
    getConnectionStore,
    issueConnectionRef,
    prepareHttpToolSessionScope,
  } = await loadModules();

  const connectionId = uniqueId("connection");
  await seedConnection(connectionId, ["Company A"]);

  const { connectionRef } = await issueConnectionRef(connectionId);
  const store = getConnectionStore();

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

  assert.equal(scope.resolution.connectionRefInvalid, true);
  assert.equal(scope.resolution.connectionId, null);
});

test("audit log remains scoped to resolved connection across rotated MCP sessions", async () => {
  const {
    auditEntryMatchesScope,
    recordRedAuditEntry,
    getRedAuditLog,
    runWithHttpToolSession,
    prepareHttpToolSessionScope,
    claimConnectionCodeForSession,
    getConnectionStore,
    __resetRedAuditLogForTests,
  } = await loadModules();

  __resetRedAuditLogForTests();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const sessionA = uniqueId("session-a");
  const sessionB = uniqueId("session-b");

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + 60_000,
  });
  await store.completePendingConnection(code);
  await seedConnection(connectionId, ["Company C"]);

  const claim = await claimConnectionCodeForSession(code, sessionA);

  const scopeA = await prepareHttpToolSessionScope(
    sessionA,
    new Map(),
    undefined,
    claim.connectionRef
  );
  await runWithHttpToolSession(scopeA, async () => {
    recordRedAuditEntry({
      companyName: "Company C",
      method: "POST",
      path: "/customers",
      requestBody: { name: "Test" },
    });
  });

  const scopeB = await prepareHttpToolSessionScope(
    sessionB,
    new Map(),
    undefined,
    claim.connectionRef
  );

  await runWithHttpToolSession(scopeB, async () => {
    const entries = getRedAuditLog({
      connectedCompanyNames: ["Company C"],
    });
    assert.equal(entries.length, 1);
    assert.match(entries[0]?.summary ?? "", /Company C/i);
  });

  const foreignScope = {
    mcpSessionId: uniqueId("foreign-session"),
    connectionId: uniqueId("foreign-connection"),
  };
  const entries = getRedAuditLog({
    scope: foreignScope,
    connectedCompanyNames: ["Company C"],
  });
  assert.deepEqual(entries, []);
});
