import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";
import { applyRedTelemetryToActiveSpan, buildRedTelemetryDiagnostics, countCompaniesForConnection, extractConnectionRefFromMcpBody, loadConnectionTelemetryContext, prepareMcpTelemetryContext, } from "./context.js";
import { buildTelemetryCustomDimensions, ENDUSER_PSEUDO_ID_ATTRIBUTE, generateTelemetryUuid, getRedTelemetryContext, runWithRedTelemetryContext, } from "./identity.js";
import { RedTelemetrySpanProcessor } from "./enrichment.js";
function uniqueId(prefix) {
    return `${prefix}-${randomUUID()}`;
}
test("telemetry saved after successful connection is loadable by connection id", async () => {
    const { getConnectionStore, ensureConnectionStoreInitialized } = await import("../auth/connection_store.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn");
    const clientId = generateTelemetryUuid();
    await store.saveConnectionTelemetry(connectionId, {
        telemetryClientId: clientId,
    });
    const loaded = await loadConnectionTelemetryContext(connectionId);
    assert.equal(loaded.recordFound, true);
    assert.equal(loaded.telemetryClientId, clientId);
});
test("client ID and connection session ID survive confirmation and rehydration", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ensureConnectionStoreInitialized, } = await import("../auth/connection_store.js");
    const { seedClaimableConnection } = await import("../auth/connection_test_helpers.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn");
    const clientId = generateTelemetryUuid();
    const connectToken = uniqueId("connect").replace(/-/g, "").slice(0, 32);
    const confirmationCode = uniqueId("confirm").replace(/-/g, "").slice(0, 32);
    const sessionId = uniqueId("session");
    await store.saveConnectionTelemetry(connectionId, {
        telemetryClientId: clientId,
    });
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [
            {
                companyName: "Company A",
                apiKey: "test-key-telemetry-a",
            },
            {
                companyName: "Company B",
                apiKey: "test-key-telemetry-b",
            },
            {
                companyName: "Company C",
                apiKey: "test-key-telemetry-c",
            },
        ],
        expiresAt: Number.MAX_SAFE_INTEGER,
    });
    const claim = await claimConnectionCodeForSession(confirmationCode, sessionId);
    const afterConfirm = await loadConnectionTelemetryContext(connectionId);
    assert.equal(afterConfirm.recordFound, true);
    assert.equal(afterConfirm.telemetryClientId, clientId);
    assert.equal(afterConfirm.connectionSessionId, claim.connectionSessionId);
    const prepared = await prepareMcpTelemetryContext({
        sessionId,
        keyStore: new Map(),
        headers: { "user-agent": "claude-desktop" },
    });
    assert.equal(prepared.diagnostics.connectionContextFound, true);
    assert.equal(prepared.diagnostics.telemetryRecordFound, true);
    assert.equal(prepared.diagnostics.clientIdPresent, true);
    assert.equal(prepared.diagnostics.connectionSessionIdPresent, true);
    assert.equal(prepared.context.telemetryClientId, clientId);
    assert.equal(prepared.context.connectionSessionId, claim.connectionSessionId);
    assert.equal(prepared.diagnostics.companyCount, 3);
    assert.equal(prepared.context.connectedCompanyCount, 3);
    assert.equal(prepared.diagnostics.platform, "claude");
});
test("connected company count reflects stored companies not empty keyStore", async () => {
    const { getConnectionStore, ensureConnectionStoreInitialized } = await import("../auth/connection_store.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn-count");
    await store.saveConnectedCompanies(connectionId, [
        {
            companyName: "One",
            apiKey: "k1",
            expiresAt: Date.now() + 60_000,
            credentialValidatedAt: Date.now(),
        },
        {
            companyName: "Two",
            apiKey: "k2",
            expiresAt: Date.now() + 60_000,
            credentialValidatedAt: Date.now(),
        },
    ]);
    const count = await countCompaniesForConnection(connectionId, 0);
    assert.equal(count, 2);
});
test("telemetry loaded during a later MCP request via connectionRef body", async () => {
    const { getConnectionStore, ensureConnectionStoreInitialized, claimConnectionCodeForSession, } = await import("../auth/connection_store.js");
    const { seedClaimableConnection } = await import("../auth/connection_test_helpers.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn-ref");
    const clientId = generateTelemetryUuid();
    const connectToken = uniqueId("connect").replace(/-/g, "").slice(0, 32);
    const confirmationCode = uniqueId("confirm").replace(/-/g, "").slice(0, 32);
    await store.saveConnectionTelemetry(connectionId, {
        telemetryClientId: clientId,
    });
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [
            {
                companyName: "Ref Co",
                apiKey: "test-key-ref",
            },
        ],
        expiresAt: Number.MAX_SAFE_INTEGER,
    });
    const claim = await claimConnectionCodeForSession(confirmationCode, uniqueId("session-a"));
    const rotatedSession = uniqueId("session-b");
    const extracted = extractConnectionRefFromMcpBody({
        method: "tools/call",
        params: {
            name: "brc_list_customers",
            arguments: {
                companyName: "Ref Co",
                connectionRef: claim.connectionRef,
            },
        },
    });
    assert.equal(extracted, claim.connectionRef);
    const prepared = await prepareMcpTelemetryContext({
        sessionId: rotatedSession,
        keyStore: new Map(),
        connectionRef: extracted,
        toolName: "brc_list_customers",
        headers: { "user-agent": "claude-desktop" },
    });
    assert.equal(prepared.context.telemetryClientId, clientId);
    assert.equal(prepared.context.connectionSessionId, claim.connectionSessionId);
    assert.equal(prepared.context.connectedCompanyCount, 1);
    assert.equal(prepared.context.toolName, "brc_list_customers");
});
test("user_Id enrichment occurs when client ID exists; auth user id stays empty", () => {
    const processor = new RedTelemetrySpanProcessor();
    const attrs = {
        "enduser.id": "should-be-removed",
        user_AuthenticatedId: "should-be-removed",
    };
    const clientId = generateTelemetryUuid();
    runWithRedTelemetryContext({
        telemetryClientId: clientId,
        connectionSessionId: generateTelemetryUuid(),
        connectedCompanyCount: 3,
        clientPlatform: "claude",
        environment: "development",
        toolName: "brc_list_customers",
    }, () => {
        processor.onEnd({ attributes: attrs });
    });
    assert.equal(attrs[ENDUSER_PSEUDO_ID_ATTRIBUTE], clientId);
    assert.equal(attrs["red.telemetry_client_id"], clientId);
    assert.equal(attrs["red.tool_name"], "brc_list_customers");
    assert.equal(attrs["red.connected_company_count"], "3");
    assert.equal("enduser.id" in attrs, false);
    assert.equal("user_AuthenticatedId" in attrs, false);
});
test("client id path diagnostics never include UUID values", async () => {
    const { logTelemetryClientIdPathDiagnostics } = await import("./context.js");
    const clientId = generateTelemetryUuid();
    const diagnostics = {
        cookieClientIdPresent: true,
        localStorageClientIdSubmitted: true,
        postClientIdPresent: true,
        postClientIdValid: true,
        saveTelemetryClientIdPresent: true,
        persistedTelemetryClientIdPresent: true,
        loadedTelemetryClientIdPresent: true,
    };
    const blob = JSON.stringify(diagnostics);
    assert.equal(blob.includes(clientId), false);
    assert.doesNotThrow(() => logTelemetryClientIdPathDiagnostics(diagnostics));
});
test("tool name appears on tool spans via prepared context", () => {
    const dims = buildTelemetryCustomDimensions({
        toolName: "brc_company_readiness_check",
        clientPlatform: "claude",
        environment: "development",
    });
    assert.equal(dims["red.tool_name"], "brc_company_readiness_check");
    assert.equal("red.telemetry_client_id" in dims, false);
});
test("missing telemetry context does not break requests", async () => {
    assert.doesNotThrow(() => applyRedTelemetryToActiveSpan({}));
    const loaded = await loadConnectionTelemetryContext(undefined);
    assert.equal(loaded.recordFound, false);
    const prepared = await prepareMcpTelemetryContext({
        sessionId: uniqueId("orphan-session"),
        keyStore: new Map(),
        headers: {},
    });
    assert.equal(prepared.diagnostics.connectionContextFound, false);
    assert.equal(prepared.diagnostics.telemetryRecordFound, false);
    assert.equal(prepared.diagnostics.clientIdPresent, false);
    assert.deepEqual(getRedTelemetryContext(), {});
});
test("safe diagnostics never include identifier values", () => {
    const clientId = generateTelemetryUuid();
    const sessionId = generateTelemetryUuid();
    const diagnostics = buildRedTelemetryDiagnostics({
        telemetryClientId: clientId,
        connectionSessionId: sessionId,
        connectedCompanyCount: 2,
        clientPlatform: "claude",
    }, {
        telemetryRecordFound: true,
        connectionContextFound: true,
        sourceStoreName: "cosmos:red-connect/connections",
    });
    const blob = JSON.stringify(diagnostics);
    assert.equal(blob.includes(clientId), false);
    assert.equal(blob.includes(sessionId), false);
    assert.equal(diagnostics.clientIdPresent, true);
    assert.equal(diagnostics.connectionSessionIdPresent, true);
    assert.equal(diagnostics.companyCount, 2);
    assert.equal(diagnostics.sourceStoreName, "cosmos:red-connect/connections");
});
test("MCP load diagnostics expose store name without UUID values", async () => {
    const { getConnectionStore, ensureConnectionStoreInitialized, getConnectionStoreTargetName, } = await import("../auth/connection_store.js");
    const { logMcpTelemetryLoadDiagnostics, prepareMcpTelemetryContext } = await import("./context.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn-store-diag");
    const clientId = generateTelemetryUuid();
    const sessionId = generateTelemetryUuid();
    await store.saveConnectionTelemetry(connectionId, {
        telemetryClientId: clientId,
        connectionSessionId: sessionId,
    });
    await store.bindSessionToConnection("session-diag", connectionId);
    const prepared = await prepareMcpTelemetryContext({
        sessionId: "session-diag",
        keyStore: new Map(),
        headers: { "user-agent": "claude-desktop" },
    });
    assert.equal(prepared.diagnostics.sourceStoreName, getConnectionStoreTargetName());
    assert.equal(prepared.diagnostics.clientIdPresent, true);
    assert.doesNotThrow(() => logMcpTelemetryLoadDiagnostics({
        telemetryRecordFound: true,
        telemetryClientIdPresent: true,
        connectionSessionIdPresent: true,
        sourceStoreName: getConnectionStoreTargetName(),
    }));
    assert.equal(JSON.stringify(prepared.diagnostics).includes(clientId), false);
});
test("no sensitive values are exported in dimensions", () => {
    const dims = buildTelemetryCustomDimensions({
        telemetryClientId: generateTelemetryUuid(),
        connectionSessionId: generateTelemetryUuid(),
        toolName: "brc_list_customers",
        clientPlatform: "claude",
        environment: "development",
        connectedCompanyCount: 3,
    });
    const blob = JSON.stringify(dims);
    assert.equal(/connectionRef/i.test(blob), false);
    assert.equal(/redconn_/i.test(blob), false);
    assert.equal(/apiKey/i.test(blob), false);
    assert.equal(/password/i.test(blob), false);
    assert.equal(/@/.test(blob), false);
});
