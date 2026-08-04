import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";

function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function loadModules() {
  const connectionStore = await import("./connection_store.js");
  const connectionRef = await import("./connection_ref.js");
  const mcpHttpSession = await import("./mcp_http_session.js");
  const shared = await import("../shared.js");
  const persistence = await import("./connection_persistence.js");
  const merge = await import("./connection_telemetry_merge.js");
  const context = await import("../telemetry/context.js");
  return {
    ...connectionStore,
    ...connectionRef,
    ...mcpHttpSession,
    ...shared,
    ...persistence,
    ...merge,
    ...context,
  };
}

async function seedCompletedConnection(args: {
  connectionId: string;
  code: string;
  companies: Array<{ name: string; apiKey: string }>;
}): Promise<{ confirmationCode: string }> {
  const { getConnectionStore } = await loadModules();
  const { seedClaimableConnection } = await import("./connection_test_helpers.js");
  const store = getConnectionStore();
  const confirmationCode = uniqueId("confirm");
  await seedClaimableConnection(store, {
    connectToken: args.code,
    confirmationCode,
    connectionId: args.connectionId,
    companies: args.companies.map((company) => ({
      companyName: company.name,
      apiKey: company.apiKey,
      expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    })),
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  return { confirmationCode };
}

test("confirm returns a ref that works on the next read call", async () => {
  const {
    claimConnectionCodeForSession,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    runWithActiveConnectionRef,
    listConnectedCompanyNames,
    getCredentialForCompanyAsync,
  } = await loadModules();

  const connectionId = uniqueId("conn");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-c-confirm-next" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-session")
  );

  const nextSession = uniqueId("read-session");
  const scope = await prepareHttpToolSessionScope(
    nextSession,
    new Map(),
    undefined,
    claimed.connectionRef
  );
  assert.equal(scope.resolution.connectionRefResolved, true);
  assert.equal(scope.resolution.connectionRefInvalid, false);

  await runWithActiveConnectionRef(claimed.connectionRef, () =>
    runWithHttpToolSession(scope, async () => {
      assert.deepEqual(listConnectedCompanyNames(), ["Company C"]);
      const credential = await getCredentialForCompanyAsync("Company C");
      assert.equal(credential.kind, "apiKey");
      assert.equal(credential.companyName, "Company C");
    })
  );
});

test("missing-ref failure followed by valid-ref retry succeeds", async () => {
  const {
    claimConnectionCodeForSession,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    runWithActiveConnectionRef,
    getCredentialForCompany,
    getCredentialForCompanyAsync,
    CONNECTION_REF_NOT_PASSED_MESSAGE,
    wrapHttpSessionAwareToolHandler,
    getConnectionStore,
  } = await loadModules();

  const connectionId = uniqueId("conn-retry");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-c-retry" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-retry")
  );

  const rotated = uniqueId("rotated-session");

  await assert.rejects(
    async () => {
      const scope = await prepareHttpToolSessionScope(rotated, new Map());
      await runWithHttpToolSession(scope, async () => {
        getCredentialForCompany("Company C");
      });
    },
    (error: Error) => {
      assert.match(error.message, /activeConnectionRef/i);
      assert.equal(error.message.includes(CONNECTION_REF_NOT_PASSED_MESSAGE), true);
      return true;
    }
  );

  // Connection must still be intact after the missing-ref failure.
  const stillThere = await getConnectionStore().listConnectedCompanies(connectionId);
  assert.equal(stillThere.length, 1);

  const retryScope = await prepareHttpToolSessionScope(
    uniqueId("retry-session"),
    new Map(),
    undefined,
    claimed.connectionRef
  );

  await runWithActiveConnectionRef(claimed.connectionRef, () =>
    runWithHttpToolSession(retryScope, async () => {
      const credential = await getCredentialForCompanyAsync("Company C");
      assert.equal(credential.kind, "apiKey");
      if (credential.kind === "apiKey") {
        assert.equal(credential.apiKey, "key-c-retry");
      }
    })
  );

  // Handler-level path (as Claude/Vibe tool wrappers use).
  const handler = wrapHttpSessionAwareToolHandler(
    async (args: { companyName: string; connectionRef?: string }) => {
      const credential = await getCredentialForCompanyAsync(args.companyName);
      return { companyName: credential.companyName };
    },
    { toolName: "brc_list_sales_invoices" }
  );

  const result = await handler(
    { companyName: "Company C", connectionRef: claimed.connectionRef },
    { sessionId: uniqueId("handler-session") }
  );
  assert.equal(result.companyName, "Company C");
});

test("missing-ref failure does not delete the connection", async () => {
  const {
    claimConnectionCodeForSession,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    getCredentialForCompany,
    getConnectionStore,
  } = await loadModules();

  const connectionId = uniqueId("conn-preserve");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-preserve" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-preserve")
  );

  const scope = await prepareHttpToolSessionScope(uniqueId("missing-ref"), new Map());
  await assert.rejects(() =>
    runWithHttpToolSession(scope, async () => {
      getCredentialForCompany("Company C");
    })
  );

  const companies = await getConnectionStore().listConnectedCompanies(connectionId);
  assert.equal(companies.length, 1);
  const refStillValid = await getConnectionStore().getConnectionIdForRef(
    claimed.connectionRef
  );
  assert.equal(refStillValid, connectionId);
});

test("ref remains valid after MCP session rotation", async () => {
  const {
    claimConnectionCodeForSession,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    runWithActiveConnectionRef,
    listConnectedCompanyNames,
  } = await loadModules();

  const connectionId = uniqueId("conn-rotate");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-rotate" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-rotate")
  );

  for (let i = 0; i < 3; i++) {
    const scope = await prepareHttpToolSessionScope(
      uniqueId(`rot-${i}`),
      new Map(),
      undefined,
      claimed.connectionRef
    );
    await runWithActiveConnectionRef(claimed.connectionRef, () =>
      runWithHttpToolSession(scope, async () => {
        assert.deepEqual(listConnectedCompanyNames(), ["Company C"]);
      })
    );
  }
});

test("ref remains valid after telemetry update", async () => {
  const {
    claimConnectionCodeForSession,
    getConnectionStore,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    runWithActiveConnectionRef,
    listConnectedCompanyNames,
  } = await loadModules();
  const { generateTelemetryUuid } = await import("../telemetry/identity.js");

  const connectionId = uniqueId("conn-tel");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-tel" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-tel")
  );

  // Session-only telemetry patch (as confirm does after connect).
  await getConnectionStore().saveConnectionTelemetry(connectionId, {
    connectionSessionId: generateTelemetryUuid(),
  });
  await getConnectionStore().saveConnectionTelemetry(connectionId, {
    telemetryClientId: generateTelemetryUuid(),
  });

  const companies = await getConnectionStore().listConnectedCompanies(connectionId);
  assert.equal(companies.length, 1);
  assert.equal(
    await getConnectionStore().getConnectionIdForRef(claimed.connectionRef),
    connectionId
  );

  const scope = await prepareHttpToolSessionScope(
    uniqueId("after-tel"),
    new Map(),
    undefined,
    claimed.connectionRef
  );
  await runWithActiveConnectionRef(claimed.connectionRef, () =>
    runWithHttpToolSession(scope, async () => {
      assert.deepEqual(listConnectedCompanyNames(), ["Company C"]);
    })
  );
});

test("Cosmos merge preserves credentials, companies, expiry and ref mapping", async () => {
  const { mergeConnectionTelemetryRecord } = await loadModules();
  const connectionId = uniqueId("conn-merge");
  const clientId = randomUUID();
  const sessionId = randomUUID();

  const first = mergeConnectionTelemetryRecord(connectionId, null, {
    telemetryClientId: clientId,
  });
  const second = mergeConnectionTelemetryRecord(connectionId, first, {
    connectionSessionId: sessionId,
  });

  assert.equal(second.telemetryClientId, clientId.toLowerCase());
  assert.equal(second.connectionSessionId, sessionId.toLowerCase());
  assert.equal(second.connectionId, connectionId);
});

test("TTL is not immediately expired for a fresh connectionRef", async () => {
  const { issueConnectionRef, getConnectionStore } = await loadModules();
  const { getApiKeyExpirationMs } = await import("../config/server_config.js");

  const connectionId = uniqueId("conn-ttl");
  const before = Date.now();
  const { connectionRef, expiresAt } = await issueConnectionRef(connectionId);
  const after = Date.now();
  const ttlMs = getApiKeyExpirationMs();

  assert.ok(expiresAt >= before + ttlMs - 1000);
  assert.ok(expiresAt <= after + ttlMs + 1000);
  assert.ok(ttlMs >= 60 * 60 * 1000, "expected at least a one-hour TTL");

  const resolved = await getConnectionStore().getConnectionIdForRef(connectionRef);
  assert.equal(resolved, connectionId);
});

test("list company contexts reloads through connectionRef", async () => {
  const {
    claimConnectionCodeForSession,
    wrapHttpSessionAwareToolHandler,
    listConnectedCompanyNames,
  } = await loadModules();

  const connectionId = uniqueId("conn-contexts");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-contexts" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-contexts")
  );

  const handler = wrapHttpSessionAwareToolHandler(
    async () => ({
      count: listConnectedCompanyNames().length,
      companies: listConnectedCompanyNames(),
    }),
    { toolName: "brc_list_company_contexts" }
  );

  const result = await handler(
    { connectionRef: claimed.connectionRef },
    { sessionId: uniqueId("contexts-session") }
  );
  assert.equal(result.count, 1);
  assert.deepEqual(result.companies, ["Company C"]);
});

test("list sales invoices reloads through connectionRef", async () => {
  const {
    claimConnectionCodeForSession,
    wrapHttpSessionAwareToolHandler,
    getCredentialForCompanyAsync,
  } = await loadModules();

  const connectionId = uniqueId("conn-invoices");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "key-invoices" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-invoices")
  );

  const handler = wrapHttpSessionAwareToolHandler(
    async (args: { companyName: string; connectionRef?: string }) => {
      const credential = await getCredentialForCompanyAsync(args.companyName);
      return { ok: true, companyName: credential.companyName };
    },
    { toolName: "brc_list_sales_invoices" }
  );

  const result = await handler(
    { companyName: "Company C", connectionRef: claimed.connectionRef },
    { sessionId: uniqueId("invoice-session") }
  );
  assert.equal(result.ok, true);
  assert.equal(result.companyName, "Company C");
});

test("separate connections cannot inherit Company B", async () => {
  const {
    claimConnectionCodeForSession,
    prepareHttpToolSessionScope,
    runWithHttpToolSession,
    runWithActiveConnectionRef,
    listConnectedCompanyNames,
  } = await loadModules();

  const connectionA = uniqueId("conn-a");
  const connectionB = uniqueId("conn-b");
  const codeA = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const codeB = uniqueId("code").replace(/-/g, "").slice(0, 32);

  const seededA = await seedCompletedConnection({
    connectionId: connectionA,
    code: codeA,
    companies: [{ name: "Company A", apiKey: "key-a-isol" }],
  });
  const seededB = await seedCompletedConnection({
    connectionId: connectionB,
    code: codeB,
    companies: [{ name: "Company B", apiKey: "key-b-isol" }],
  });

  const claimA = await claimConnectionCodeForSession(seededA.confirmationCode, uniqueId("sess-a"));
  const claimB = await claimConnectionCodeForSession(seededB.confirmationCode, uniqueId("sess-b"));

  const scopeA = await prepareHttpToolSessionScope(
    uniqueId("use-a"),
    new Map(),
    undefined,
    claimA.connectionRef
  );
  await runWithActiveConnectionRef(claimA.connectionRef, () =>
    runWithHttpToolSession(scopeA, async () => {
      assert.deepEqual(listConnectedCompanyNames(), ["Company A"]);
      assert.equal(listConnectedCompanyNames().includes("Company B"), false);
    })
  );

  const scopeB = await prepareHttpToolSessionScope(
    uniqueId("use-b"),
    new Map(),
    undefined,
    claimB.connectionRef
  );
  await runWithActiveConnectionRef(claimB.connectionRef, () =>
    runWithHttpToolSession(scopeB, async () => {
      assert.deepEqual(listConnectedCompanyNames(), ["Company B"]);
      assert.equal(listConnectedCompanyNames().includes("Company A"), false);
    })
  );
});

test("true 401 removes only the affected company", async () => {
  const { brcFetch, setApiKeyForCompany, listConnectedCompanyNames, runWithSessionKeyStore } =
    await loadModules();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const auth = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization ?? ""
    );
    if (auth.includes(Buffer.from("bad-key:", "utf8").toString("base64"))) {
      return new Response("Unauthorized", { status: 401 });
    }
    return new Response(JSON.stringify({ Items: [], Count: 0 }), { status: 200 });
  };

  try {
    await runWithSessionKeyStore(new Map(), async () => {
      setApiKeyForCompany({
        companyName: "Company Bad",
        apiKey: "bad-key",
        expiresAt: Date.now() + 60_000,
      });
      setApiKeyForCompany({
        companyName: "Company Good",
        apiKey: "good-key",
        expiresAt: Date.now() + 60_000,
      });

      const failed = (await brcFetch(
        "Company Bad",
        "/v1/salesInvoices?page=1&pageSize=1"
      )) as Record<string, unknown>;
      assert.equal(failed.errorType, "company_credential_invalid");
      assert.equal(listConnectedCompanyNames().includes("Company Bad"), false);
      assert.equal(listConnectedCompanyNames().includes("Company Good"), true);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("403, 404, 422, 500, timeout and malformed response preserve the connection", async () => {
  const { brcFetch, setApiKeyForCompany, listConnectedCompanyNames, runWithSessionKeyStore } =
    await loadModules();

  const cases: Array<{ status: number; body: string; label: string }> = [
    { status: 403, body: "rate limited by upstream", label: "403" },
    { status: 404, body: "resource missing", label: "404" },
    { status: 422, body: "validation failed", label: "422" },
    { status: 500, body: "internal failure", label: "500" },
    { status: 503, body: "temporarily unavailable", label: "503" },
    { status: 400, body: "{not-json", label: "malformed" },
  ];

  for (const testCase of cases) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(testCase.body, { status: testCase.status });

    try {
      await runWithSessionKeyStore(new Map(), async () => {
        setApiKeyForCompany({
          companyName: "Company Keep",
          apiKey: `keep-key-${testCase.label}`,
          expiresAt: Date.now() + 60_000,
        });

        await assert.rejects(() =>
          brcFetch("Company Keep", "/v1/salesInvoices?page=1&pageSize=1")
        );

        assert.equal(
          listConnectedCompanyNames().includes("Company Keep"),
          true,
          `status ${testCase.label} must preserve the connection`
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("diagnostics contain no secrets", async () => {
  const {
    claimConnectionCodeForSession,
    prepareMcpTelemetryContext,
  } = await loadModules();

  const connectionId = uniqueId("conn-diag");
  const code = uniqueId("code").replace(/-/g, "").slice(0, 32);
  const { confirmationCode } = await seedCompletedConnection({
    connectionId,
    code,
    companies: [{ name: "Company C", apiKey: "super-secret-api-key-value" }],
  });

  const claimed = await claimConnectionCodeForSession(
    confirmationCode,
    uniqueId("confirm-diag")
  );

  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    await prepareMcpTelemetryContext({
      sessionId: uniqueId("diag-session"),
      keyStore: new Map(),
      connectionRef: claimed.connectionRef,
    });
  } finally {
    console.info = originalInfo;
  }

  const blob = logs.join("\n");
  assert.match(blob, /Red connectionRef resolution:/);
  assert.equal(blob.includes("super-secret-api-key-value"), false);
  assert.equal(blob.includes(claimed.connectionRef), false);
  assert.equal(/Authorization/i.test(blob), false);
  assert.equal(/apiKey["']?\s*:/i.test(blob), false);
});
