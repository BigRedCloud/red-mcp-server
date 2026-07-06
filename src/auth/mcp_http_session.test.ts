import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadModules() {
  const connectionStore = await import("./connection_store.js");
  const shared = await import("../shared.js");
  const mcpHttpSession = await import("./mcp_http_session.js");
  return { ...connectionStore, ...shared, ...mcpHttpSession };
}

test("confirm connection then list companies in the same detected session", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    runWithHttpToolSession,
    prepareHttpToolSessionScope,
    getCompanyApiContexts,
    listConnectedCompanyNames,
  } = await loadModules();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const sessionId = uniqueId("session-a");
  const clientKey = uniqueId("client-a");
  const keyStore = new Map();

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
    },
    {
      companyName: "Company B",
      apiKey: "test-api-key-b",
      expiresAt: Date.now() + 60_000,
    },
    {
      companyName: "Company C",
      apiKey: "test-api-key-c",
      expiresAt: Date.now() + 60_000,
    },
    {
      companyName: "Company D",
      apiKey: "test-api-key-d",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  await claimConnectionCodeForSession(code, sessionId, { clientKey });

  const scope = await prepareHttpToolSessionScope(sessionId, keyStore, clientKey);
  await runWithHttpToolSession(scope, async () => {
    const names = listConnectedCompanyNames();
    assert.deepEqual(names.sort(), [
      "Company A",
      "Company B",
      "Company C",
      "Company D",
    ]);
    assert.equal(getCompanyApiContexts().size, 4);
  });
});

test("different session cannot see companies confirmed in another session", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    runWithHttpToolSession,
    prepareHttpToolSessionScope,
    listConnectedCompanyNames,
  } = await loadModules();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const sessionA = uniqueId("session-a");
  const sessionB = uniqueId("session-b");
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
      apiKey: "test-api-key-a",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  await claimConnectionCodeForSession(code, sessionA, { clientKey });

  const scopeB = await prepareHttpToolSessionScope(
    sessionB,
    new Map(),
    uniqueId("other-client")
  );

  await runWithHttpToolSession(scopeB, async () => {
    assert.deepEqual(listConnectedCompanyNames(), []);
  });
});

test("missing session scope in HTTP mode does not fall back to a global credential store", async () => {
  const { getCompanyApiContexts } = await loadModules();

  const contexts = getCompanyApiContexts();
  contexts.set("should-not-leak", {
    companyName: "SHOULD-NOT-LEAK",
    apiKey: "secret-key",
    expiresAt: Date.now() + 60_000,
  });

  const freshLookup = getCompanyApiContexts();
  assert.equal(freshLookup.has("should-not-leak"), false);
  assert.equal(freshLookup.size, 0);
});

test("same API keys in different sessions remain isolated without a shared client claim", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    runWithHttpToolSession,
    prepareHttpToolSessionScope,
    listConnectedCompanyNames,
  } = await loadModules();

  const store = getConnectionStore();

  async function connectCompany(sessionId: string, companyName: string) {
    const code = uniqueId("code");
    const connectionId = uniqueId("connection");

    await store.createPendingConnection({
      code,
      connectionId,
      expiresAt: Date.now() + 60_000,
    });
    await store.completePendingConnection(code);
    await store.saveConnectedCompanies(connectionId, [
      {
        companyName,
        apiKey: "shared-test-api-key",
        expiresAt: Date.now() + 60_000,
      },
    ]);

    await claimConnectionCodeForSession(code, sessionId, {
      clientKey: uniqueId(`client-${sessionId}`),
    });
  }

  const sessionA = uniqueId("session-a");
  const sessionB = uniqueId("session-b");

  await connectCompany(sessionA, "Company A");
  await connectCompany(sessionB, "Company B");

  const scopeA = await prepareHttpToolSessionScope(sessionA, new Map());
  await runWithHttpToolSession(scopeA, async () => {
    assert.deepEqual(listConnectedCompanyNames(), ["Company A"]);
  });

  const scopeB = await prepareHttpToolSessionScope(sessionB, new Map());
  await runWithHttpToolSession(scopeB, async () => {
    assert.deepEqual(listConnectedCompanyNames(), ["Company B"]);
  });
});

test("rotated MCP session id inherits connection via stable client key", async () => {
  const {
    getConnectionStore,
    claimConnectionCodeForSession,
    runHttpToolSessionFromExtra,
    listConnectedCompanyNames,
    buildHttpClientKeyFromHeaders,
  } = await loadModules();

  const store = getConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");
  const firstSessionId = uniqueId("session-1");
  const secondSessionId = uniqueId("session-2");
  const headers = {
    authorization: "Bearer stable-user-token",
    "x-forwarded-for": "203.0.113.10",
  };
  const clientKey = buildHttpClientKeyFromHeaders(headers, "203.0.113.10");
  const keyStore = new Map();

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + 60_000,
  });
  await store.completePendingConnection(code);
  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: "Company C",
      apiKey: "test-api-key-c",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  await claimConnectionCodeForSession(code, firstSessionId, { clientKey });

  await runHttpToolSessionFromExtra(
    firstSessionId,
    keyStore,
    {
      requestInfo: {
        headers,
      },
    },
    async () => {
      assert.deepEqual(listConnectedCompanyNames(), ["Company C"]);
    }
  );

  await runHttpToolSessionFromExtra(
    secondSessionId,
    new Map(),
    {
      requestInfo: {
        headers,
      },
    },
    async () => {
      assert.deepEqual(listConnectedCompanyNames(), ["Company C"]);
    }
  );

  assert.equal(
    await store.getConnectionIdForSession(secondSessionId),
    connectionId
  );
});

test("buildHttpClientKeyFromHeaders fingerprints authorization without exposing it", async () => {
  const { buildHttpClientKeyFromHeaders } = await import("./mcp_http_session.js");

  const first = buildHttpClientKeyFromHeaders(
    {
      authorization: "Bearer secret-token-value",
      "x-forwarded-for": "203.0.113.10",
    },
    "203.0.113.10"
  );
  const second = buildHttpClientKeyFromHeaders(
    {
      authorization: "Bearer secret-token-value",
      "x-forwarded-for": "203.0.113.10",
    },
    "203.0.113.10"
  );
  const different = buildHttpClientKeyFromHeaders(
    {
      authorization: "Bearer different-token",
      "x-forwarded-for": "203.0.113.10",
    },
    "203.0.113.10"
  );

  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.equal(first.includes("secret-token-value"), false);
});

test("resolveMcpSessionIdFromHeaders supports mcp-session-id and x-mcp-session-id", async () => {
  const { resolveMcpSessionIdFromHeaders } = await import("./mcp_http_session.js");

  assert.equal(
    resolveMcpSessionIdFromHeaders({ "mcp-session-id": "session-123" }),
    "session-123"
  );
  assert.equal(
    resolveMcpSessionIdFromHeaders({ "x-mcp-session-id": "session-456" }),
    "session-456"
  );
});

test("session diagnostic omits secrets and truncates identifiers", async () => {
  const { buildMcpSessionDiagnostic } = await import("./mcp_http_session.js");

  const diagnostic = buildMcpSessionDiagnostic({
    transportSessionId: "abcdefgh-ijklmnop",
    extra: {
      requestInfo: {
        headers: {
          authorization: "Bearer super-secret",
          "mcp-session-id": "session-abcdef",
        },
      },
    },
    resolution: {
      connectionId: "connection-12345678",
      sessionBindingFound: true,
      clientClaimInherited: false,
    },
    credentialCount: 2,
    companiesLoaded: ["Company A", "Company B"],
  });

  assert.equal(diagnostic.transportSessionId, "abcdefgh");
  assert.equal(diagnostic.connectionIdPrefix, "connecti");
  assert.equal(diagnostic.clientIdentityHeaderNamesPresent.includes("authorization"), true);
  assert.equal(JSON.stringify(diagnostic).includes("super-secret"), false);
});
