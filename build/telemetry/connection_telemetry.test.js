import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
function uniqueId(prefix) {
    return `${prefix}-${randomUUID()}`;
}
test("new confirmed connection creates a new connection session ID", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ensureConnectionStoreInitialized, } = await import("../auth/connection_store.js");
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
    assert.match(result.connectionSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const telemetry = await store.getConnectionTelemetry(connectionId);
    assert.equal(telemetry?.connectionSessionId, result.connectionSessionId);
});
test("same client reconnecting retains client ID but gets a new session ID", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ensureConnectionStoreInitialized, } = await import("../auth/connection_store.js");
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
    const clientId = randomUUID();
    const html = renderConnectPage("abc123", { telemetryClientId: clientId });
    assert.match(html, /red_telemetry_client_id/);
    assert.match(html, /telemetryClientId/);
    assert.match(html, /localStorage/);
    assert.match(html, /SameSite=Lax/);
    assert.match(html, new RegExp(`name="telemetryClientId" value="${clientId.toLowerCase()}"`));
    assert.match(html, new RegExp(`SERVER_ID = "${clientId.toLowerCase()}"`));
});
test("memory save then session-only update preserves both telemetry ids", async () => {
    const { getConnectionStore, ensureConnectionStoreInitialized } = await import("../auth/connection_store.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn-both");
    const clientId = randomUUID();
    const sessionId = randomUUID();
    await store.saveConnectionTelemetry(connectionId, {
        telemetryClientId: clientId,
    });
    await store.saveConnectionTelemetry(connectionId, {
        connectionSessionId: sessionId,
    });
    const loaded = await store.getConnectionTelemetry(connectionId);
    assert.equal(loaded?.telemetryClientId, clientId.toLowerCase());
    assert.equal(loaded?.connectionSessionId, sessionId.toLowerCase());
});
test("getConnectionTelemetry returns both ids after dual save", async () => {
    const { getConnectionStore, ensureConnectionStoreInitialized } = await import("../auth/connection_store.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn-load-both");
    const clientId = randomUUID();
    const sessionId = randomUUID();
    await store.saveConnectionTelemetry(connectionId, {
        telemetryClientId: clientId,
        connectionSessionId: sessionId,
    });
    const loaded = await store.getConnectionTelemetry(connectionId);
    assert.equal(loaded?.telemetryClientId, clientId.toLowerCase());
    assert.equal(loaded?.connectionSessionId, sessionId.toLowerCase());
});
test("cosmos telemetry merge document builder never drops client id on session patch", async () => {
    // Unit-level stand-in for Cosmos upsert replace semantics: a partial document
    // must not be written when merging a session-only update onto an existing record.
    const { mergeConnectionTelemetryRecord } = await import("../auth/connection_telemetry_merge.js");
    const connectionId = uniqueId("cosmos-sim");
    const clientId = randomUUID();
    const sessionId = randomUUID();
    const existing = mergeConnectionTelemetryRecord(connectionId, null, {
        telemetryClientId: clientId,
    });
    // Bug path: upsert({ connectionSessionId }) without merge → client id lost.
    const buggyReplace = {
        connectionId,
        connectionSessionId: sessionId,
    };
    assert.equal("telemetryClientId" in buggyReplace, false);
    const fixed = mergeConnectionTelemetryRecord(connectionId, existing, {
        connectionSessionId: sessionId,
    });
    assert.equal(fixed.telemetryClientId, clientId.toLowerCase());
    assert.equal(fixed.connectionSessionId, sessionId.toLowerCase());
});
const cosmosConnectionString = process.env.RED_CONNECT_COSMOS_CONNECTION_STRING?.trim() || "";
test("cosmos save/load preserves both telemetry ids across session update", { skip: !cosmosConnectionString }, async () => {
    const previousStore = process.env.RED_CONNECT_CONNECTION_STORE;
    process.env.RED_CONNECT_CONNECTION_STORE = "cosmos";
    try {
        const { CosmosConnectionStore } = await import("../auth/cosmos_connection_store.js");
        const database = process.env.RED_CONNECT_COSMOS_DATABASE?.trim() || "red-connect";
        const container = process.env.RED_CONNECT_COSMOS_CONTAINER?.trim() || "connections";
        const store = new CosmosConnectionStore(cosmosConnectionString, database, container);
        await store.initialize();
        const connectionId = uniqueId("cosmos-tel");
        const clientId = randomUUID();
        const sessionId = randomUUID();
        await store.saveConnectionTelemetry(connectionId, {
            telemetryClientId: clientId,
        });
        await store.saveConnectionTelemetry(connectionId, {
            connectionSessionId: sessionId,
        });
        const loaded = await store.getConnectionTelemetry(connectionId);
        assert.equal(loaded?.telemetryClientId, clientId.toLowerCase());
        assert.equal(loaded?.connectionSessionId, sessionId.toLowerCase());
    }
    finally {
        if (previousStore === undefined) {
            delete process.env.RED_CONNECT_CONNECTION_STORE;
        }
        else {
            process.env.RED_CONNECT_CONNECTION_STORE = previousStore;
        }
    }
});
