import assert from "node:assert/strict";
import test from "node:test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";
import { CONNECTION_REF_INVALID_MESSAGE } from "./connection_ref.js";
import { assessVibeConnectionHealth, buildMcpSessionDiagnostic, } from "./mcp_http_session.js";
function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function loadModules() {
    const connectionStore = await import("./connection_store.js");
    const connectionRef = await import("./connection_ref.js");
    const mcpHttpSession = await import("./mcp_http_session.js");
    const shared = await import("../shared.js");
    return { ...connectionStore, ...connectionRef, ...mcpHttpSession, ...shared };
}
test("assessVibeConnectionHealth reports healthy staging Vibe call pattern", () => {
    const health = assessVibeConnectionHealth({
        connectionRefPresent: true,
        connectionRefResolved: true,
        connectionIdPresent: true,
        connectionRefInvalid: false,
        credentialCount: 4,
    });
    assert.equal(health.healthy, true);
    assert.equal(health.shouldReconnect, false);
    assert.equal(health.checks.connectionRefPresent, true);
    assert.equal(health.checks.connectionRefResolved, true);
    assert.equal(health.checks.connectionIdPresent, true);
    assert.equal(health.checks.hasCredentials, true);
});
test("assessVibeConnectionHealth is false when connectionRef is invalid", () => {
    const health = assessVibeConnectionHealth({
        connectionRefPresent: true,
        connectionRefResolved: false,
        connectionIdPresent: false,
        connectionRefInvalid: true,
        credentialCount: 0,
    });
    assert.equal(health.healthy, false);
    assert.equal(health.shouldReconnect, false);
});
test("buildMcpSessionDiagnostic includes vibeConnectionHealthy without secrets", () => {
    const fullRef = "redconn_" + "a".repeat(48);
    const diagnostic = buildMcpSessionDiagnostic({
        transportSessionId: "session-abcdefgh",
        resolution: {
            connectionId: "connection-12345678",
            sessionBindingFound: false,
            clientClaimInherited: false,
            connectionRefResolved: true,
            connectionRefInvalid: false,
        },
        connectionRef: fullRef,
        credentialCount: 4,
        companiesLoaded: ["Company A"],
        toolName: "brc_list_customers",
    });
    assert.equal(diagnostic.vibeConnectionHealthy, true);
    assert.equal(diagnostic.connectionRefPresent, true);
    assert.equal(diagnostic.connectionRefResolved, true);
    assert.equal(diagnostic.connectionIdPresent, true);
    assert.equal(diagnostic.credentialCount, 4);
    assert.equal(diagnostic.toolName, "brc_list_customers");
    const serialised = JSON.stringify(diagnostic);
    assert.equal(serialised.includes(fullRef), false);
    assert.equal(serialised.includes("test-api-key"), false);
    assert.ok(diagnostic.connectionRefPrefix);
    assert.ok((diagnostic.connectionRefPrefix?.length ?? 0) <= 16);
});
test("invalid expired connectionRef returns clear reconnect message", async () => {
    const { getConnectionStore, issueConnectionRef, runWithHttpToolSession, prepareHttpToolSessionScope, getCredentialForCompanyAsync, runWithActiveConnectionRef, } = await loadModules();
    const connectionId = uniqueId("connection");
    const store = getConnectionStore();
    await store.saveConnectedCompanies(connectionId, [
        {
            companyName: "Company A",
            apiKey: "test-api-key-a",
            expiresAt: Date.now() + 60_000,
        },
    ]);
    const { connectionRef } = await issueConnectionRef(connectionId);
    await store.createConnectionRef({
        ref: connectionRef,
        connectionId,
        expiresAt: Date.now() - 1,
    });
    const scope = await prepareHttpToolSessionScope(uniqueId("session"), new Map(), undefined, connectionRef);
    assert.equal(scope.resolution.connectionRefInvalid, true);
    await assert.rejects(() => runWithActiveConnectionRef(connectionRef, () => runWithHttpToolSession(scope, () => getCredentialForCompanyAsync("Company A"))), (error) => {
        assert.match(error.message, /connection reference is missing, invalid, or has expired/i);
        assert.match(error.message, /brc_confirm_company_connection/i);
        return true;
    });
    assert.match(CONNECTION_REF_INVALID_MESSAGE, /connection reference is missing, invalid, or has expired/i);
});
test("valid connectionRef across rotated MCP sessions never falls back to global credentials", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, prepareHttpToolSessionScope, runWithHttpToolSession, runWithActiveConnectionRef, listConnectedCompanyNames, getCompanyApiContexts, } = await loadModules();
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
    await store.saveConnectedCompanies(connectionId, [
        {
            companyName: "Company A",
            apiKey: "test-api-key-a",
            expiresAt: Date.now() + 60_000,
        },
    ]);
    const claim = await claimConnectionCodeForSession(code, confirmSession);
    const foreignScope = await prepareHttpToolSessionScope(uniqueId("foreign-session"), new Map(), undefined, undefined);
    await runWithHttpToolSession(foreignScope, async () => {
        assert.deepEqual(listConnectedCompanyNames(), []);
    });
    const rotatedScope = await prepareHttpToolSessionScope(rotatedSession, new Map(), undefined, claim.connectionRef);
    await runWithActiveConnectionRef(claim.connectionRef, () => runWithHttpToolSession(rotatedScope, async () => {
        assert.deepEqual(listConnectedCompanyNames(), ["Company A"]);
        assert.equal(getCompanyApiContexts().size, 1);
    }));
    assert.deepEqual(listConnectedCompanyNames(), []);
});
test("tool-level diagnostics log for session-bound tools without connectionRef", async () => {
    process.env.RED_CONNECT_SESSION_DEBUG = "true";
    const { getConnectionStore, claimConnectionCodeForSession, runHttpToolSessionFromExtra, } = await loadModules();
    const store = getConnectionStore();
    const code = uniqueId("code");
    const connectionId = uniqueId("connection");
    const sessionId = uniqueId("session-a");
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
    ]);
    await claimConnectionCodeForSession(code, sessionId);
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => {
        logs.push(args.map(String).join(" "));
    };
    try {
        await runHttpToolSessionFromExtra(sessionId, keyStore, undefined, async () => "ok", {
            companyName: "Company A",
            toolName: "brc_list_customers",
        });
    }
    finally {
        console.info = originalInfo;
        delete process.env.RED_CONNECT_SESSION_DEBUG;
    }
    const diagnosticLine = logs.find((line) => line.includes("Red MCP session:"));
    assert.ok(diagnosticLine, "expected diagnostic for session-bound tool without connectionRef");
    const payload = JSON.parse(diagnosticLine.replace(/^Red MCP session:\s*/, ""));
    assert.equal(payload.toolName, "brc_list_customers");
    assert.equal(payload.connectionRefPresent, false);
    assert.equal(payload.connectionIdPresent, true);
    assert.equal(payload.credentialCount, 1);
    assert.equal(JSON.stringify(payload).includes("test-api-key-a"), false);
});
