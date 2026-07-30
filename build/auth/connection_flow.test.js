import assert from "node:assert/strict";
import test from "node:test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
import { seedClaimableConnection } from "./connection_test_helpers.js";
function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function loadConnectionStoreModule() {
    return await import("./connection_store.js");
}
test("completed connection code can be claimed and bound to a session", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const connectToken = uniqueId("connect");
    const confirmationCode = uniqueId("confirm");
    const connectionId = uniqueId("connection");
    const sessionId = uniqueId("session");
    const clientKey = uniqueId("client");
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [
            {
                companyName: "Company A",
                apiKey: "test-api-key-company-a",
            },
        ],
    });
    const result = await claimConnectionCodeForSession(` ${confirmationCode} `, ` ${sessionId} `, { clientKey });
    assert.equal(result.connectionId, connectionId);
    assert.deepEqual(result.companyNames, ["Company A"]);
    assert.match(result.connectionRef, /^redconn_[0-9a-f]{48}$/);
    assert.equal(await store.getConnectionIdForSession(sessionId), connectionId);
    assert.equal(await store.getRecentClientClaim(clientKey, 60_000), connectionId);
});
test("claiming a confirmation code a second time fails safely", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const connectToken = uniqueId("connect");
    const confirmationCode = uniqueId("confirm");
    const connectionId = uniqueId("connection");
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [
            {
                companyName: "Company A",
                apiKey: "test-api-key-company-a",
            },
        ],
    });
    await claimConnectionCodeForSession(confirmationCode, uniqueId("session-1"));
    await assert.rejects(() => claimConnectionCodeForSession(confirmationCode, uniqueId("session-2")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "not_found");
        assert.match(error.message, /missing|incorrect|already been used/i);
        return true;
    });
});
test("connectToken cannot be claimed as a confirmation code", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const connectToken = uniqueId("connect");
    const confirmationCode = uniqueId("confirm");
    const connectionId = uniqueId("connection");
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [
            {
                companyName: "Company A",
                apiKey: "test-api-key-a",
            },
        ],
    });
    await assert.rejects(() => claimConnectionCodeForSession(connectToken, uniqueId("session")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "not_found");
        assert.match(error.message, /secure connection link token|confirmation code/i);
        return true;
    });
    // Confirmation code still works afterward.
    const result = await claimConnectionCodeForSession(confirmationCode, uniqueId("session-ok"));
    assert.equal(result.connectionId, connectionId);
});
test("claiming an unknown connection code fails safely", async () => {
    const { claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    await assert.rejects(() => claimConnectionCodeForSession(uniqueId("missing-code"), uniqueId("session")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "not_found");
        assert.match(error.message, /missing|invalid|used/i);
        return true;
    });
});
test("claiming before confirmation code is issued fails safely", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const connectToken = uniqueId("incomplete-code");
    await store.createPendingConnection({
        connectToken,
        connectionId: uniqueId("connection"),
        expiresAt: Date.now() + 60_000,
    });
    await store.completePendingConnection(connectToken);
    await assert.rejects(() => claimConnectionCodeForSession(connectToken, uniqueId("session")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "not_found");
        return true;
    });
});
test("claiming an incomplete connection code fails safely", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const connectToken = uniqueId("incomplete-code");
    await store.createPendingConnection({
        connectToken,
        connectionId: uniqueId("connection"),
        expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(() => claimConnectionCodeForSession(connectToken, uniqueId("session")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "not_found");
        return true;
    });
});
test("claiming an expired connection code fails safely", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const code = uniqueId("expired-code");
    await store.createPendingConnection({
        connectToken: code,
        connectionId: uniqueId("connection"),
        expiresAt: Date.now() - 1,
    });
    await assert.rejects(() => claimConnectionCodeForSession(code, uniqueId("session")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "not_found");
        return true;
    });
});
test("claiming a completed connection with no companies fails safely", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ClaimConnectionError, } = await loadConnectionStoreModule();
    const store = getConnectionStore();
    const connectToken = uniqueId("empty-company-connect");
    const confirmationCode = uniqueId("empty-company-confirm");
    await store.createPendingConnection({
        connectToken,
        connectionId: uniqueId("connection"),
        expiresAt: Date.now() + 60_000,
    });
    await store.completePendingConnection(connectToken);
    await store.issueConfirmationCode(connectToken, confirmationCode);
    await assert.rejects(() => claimConnectionCodeForSession(confirmationCode, uniqueId("session")), (error) => {
        assert.ok(error instanceof ClaimConnectionError);
        assert.equal(error.reason, "no_companies");
        assert.match(error.message, /No companies/i);
        return true;
    });
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
            credentialValidatedAt: Date.now(),
        },
    ]);
    await store.saveConnectedCompanies(connectionB, [
        {
            companyName: "Company B",
            apiKey: "api-key-b",
            expiresAt: Date.now() + 60_000,
            credentialValidatedAt: Date.now(),
        },
    ]);
    assert.equal(await store.getCredentialForCompany(connectionA, "Company B"), null);
    assert.equal(await store.getCredentialForCompany(connectionB, "Company A"), null);
    assert.equal((await store.getCredentialForCompany(connectionA, "Company A"))?.companyName, "Company A");
    assert.equal((await store.getCredentialForCompany(connectionB, "Company B"))?.companyName, "Company B");
});
