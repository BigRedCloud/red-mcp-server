import assert from "node:assert/strict";
import test from "node:test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";
process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET =
    process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET ||
        "test-route-token-signing-secret-claim-inherit";
import { seedClaimableConnection } from "../auth/connection_test_helpers.js";
function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function loadModules() {
    const connectionStore = await import("../auth/connection_store.js");
    const mcpHttp = await import("../auth/mcp_http_session.js");
    const routeRequest = await import("../routing/route-request.js");
    const routeToken = await import("../routing/route-token.js");
    const connectionRefMod = await import("../auth/connection_ref.js");
    return {
        ...connectionStore,
        ...mcpHttp,
        ...routeRequest,
        ...routeToken,
        ...connectionRefMod,
    };
}
/**
 * Matches staging logs:
 * 1) confirm connection
 * 2) Claude starts a new MCP session
 * 3) brc_route_request with message only (no connectionRef in args / often no headers in extra)
 * 4) same verified client claim is inherited
 * 5) active connection resolved → connectionBinding on token
 * 6) another MCP session calls create with connectionRef → validation succeeds
 * 7) unrelated client identity cannot inherit
 * 8) forged/different connectionRef fails
 */
test("route_request inherits client claim without connectionRef then create validates across sessions", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, issueConnectionRef, runHttpToolSessionFromExtra, clearSessionClientKeysForTests, resetRouteTokenStateForTests, routeRequest, validateRouteTokenForTool, wrapRouteTokenHandler, ROUTE_TOKEN_SIGNING_SECRET_ENV, resolveHttpClientKeyFromHeaders, } = await loadModules();
    clearSessionClientKeysForTests();
    resetRouteTokenStateForTests({
        signingSecret: process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV],
    });
    const store = getConnectionStore();
    const connectToken = uniqueId("connect");
    const confirmationCode = uniqueId("confirm");
    const connectionId = uniqueId("connection");
    const confirmSession = uniqueId("session-confirm");
    const routeSession = uniqueId("session-route");
    const createSession = uniqueId("session-create");
    const confirmHeaders = {
        authorization: "Bearer stable-claude-user-token",
        "x-forwarded-for": "198.51.100.42",
    };
    // Same Authorization, different IP — previously broke claim inheritance.
    const routeHeaders = {
        authorization: "Bearer stable-claude-user-token",
        "x-forwarded-for": "203.0.113.88",
    };
    const unrelatedHeaders = {
        authorization: "Bearer other-user-token",
        "x-forwarded-for": "198.51.100.99",
    };
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [{ companyName: "Demo Co", apiKey: "test-api-key-demo" }],
    });
    const confirmResolution = resolveHttpClientKeyFromHeaders(confirmHeaders, "198.51.100.42");
    const routeResolution = resolveHttpClientKeyFromHeaders(routeHeaders, "203.0.113.88");
    assert.equal(confirmResolution.clientKey, routeResolution.clientKey);
    assert.equal(confirmResolution.inheritEligible, true);
    // 1. Confirm connection (records verified durable client claim).
    await claimConnectionCodeForSession(confirmationCode, confirmSession, {
        clientKey: confirmResolution.clientKey,
    });
    const { connectionRef } = await issueConnectionRef(connectionId);
    // Simulate Azure multi-instance / process-local Map miss: clear in-memory
    // session client keys. Durable store claim must still be found by key hash.
    clearSessionClientKeysForTests();
    // 2–5. New Claude MCP session; route_request with message only.
    // Tool extra has sessionId but NO requestInfo.headers. Client key comes from
    // the session registry populated as if HTTP entry resolved stable identity.
    const { registerSessionClientKey } = await loadModules();
    registerSessionClientKey(routeSession, routeResolution);
    const issuedLogs = [];
    const originalInfo = console.info;
    console.info = (...args) => {
        issuedLogs.push(String(args[0] ?? ""));
        originalInfo.apply(console, args);
    };
    let routeToken = "";
    try {
        await runHttpToolSessionFromExtra(routeSession, new Map(), 
        // No headers — matches Claude tool extra that omits requestInfo.
        { sessionId: routeSession }, async () => {
            const routed = await routeRequest("add a customer");
            assert.equal(routed.mode, "action");
            assert.ok(routed.routeToken);
            routeToken = routed.routeToken;
        }, { toolName: "brc_route_request" });
    }
    finally {
        console.info = originalInfo;
    }
    const issuedLine = issuedLogs.find((line) => line.includes('"event":"route_token_issued"'));
    assert.ok(issuedLine, "expected route_token_issued telemetry");
    const issued = JSON.parse(issuedLine);
    assert.equal(issued.workflow, "create_customer");
    assert.equal(issued.connectionIdPresent, true);
    assert.equal(issued.connectionBindingAdded, true);
    assert.equal(issued.connectionRefResolved, false);
    assert.ok(issued.clientClaimInherited || issued.sessionBindingFound, "expected claim inheritance or resulting session binding");
    assert.equal("connectionId" in issued, false);
    assert.equal("connectionRef" in issued, false);
    assert.equal("sessionId" in issued, false);
    assert.equal("clientKey" in issued, false);
    assert.equal("routeToken" in issued, false);
    // Token must carry connectionBinding (not merely session id).
    const previewValidation = await validateRouteTokenForTool(routeToken, {
        toolName: "brc_create_customer",
        sessionId: routeSession,
        connectionId,
    });
    assert.equal(previewValidation.ok, true);
    if (previewValidation.ok) {
        assert.ok(previewValidation.payload.connectionBinding);
    }
    // Issuing session can be gone; create in session C still validates via binding.
    clearSessionClientKeysForTests();
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    await runHttpToolSessionFromExtra(createSession, new Map(), { sessionId: createSession, requestInfo: { headers: routeHeaders } }, async () => {
        const result = await wrapped({
            routeToken,
            connectionRef,
            companyName: "Demo Co",
            payload: { code: "ACME", name: "Acme Ltd" },
        });
        assert.deepEqual(result, { ok: true });
    }, { connectionRef, toolName: "brc_create_customer", companyName: "Demo Co" });
    assert.equal(handlerCalled, true);
    // Unrelated client identity cannot inherit the connection on a fresh session.
    const strangerSession = uniqueId("session-stranger");
    const strangerScope = await (await loadModules()).prepareHttpToolSessionScope(strangerSession, new Map(), resolveHttpClientKeyFromHeaders(unrelatedHeaders, "198.51.100.99"));
    assert.equal(strangerScope.connectionId, "");
    assert.equal(strangerScope.resolution.clientClaimInherited, false);
    // Forged / different connection target fails route validation.
    const otherConnection = uniqueId("connection-other");
    const forged = await validateRouteTokenForTool(routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-forged"),
        connectionId: otherConnection,
    });
    assert.equal(forged.ok, false);
    if (!forged.ok) {
        assert.equal(forged.reason, "wrong_session");
    }
});
test("route_request recovers via connectionRef when client claim is unavailable", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, issueConnectionRef, runHttpToolSessionFromExtra, clearSessionClientKeysForTests, resetRouteTokenStateForTests, routeRequest, validateRouteTokenForTool, ROUTE_TOKEN_SIGNING_SECRET_ENV, } = await loadModules();
    clearSessionClientKeysForTests();
    resetRouteTokenStateForTests({
        signingSecret: process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV],
    });
    const store = getConnectionStore();
    const connectToken = uniqueId("connect");
    const confirmationCode = uniqueId("confirm");
    const connectionId = uniqueId("connection");
    const confirmSession = uniqueId("session-confirm");
    const routeSession = uniqueId("session-route");
    await seedClaimableConnection(store, {
        connectToken,
        confirmationCode,
        connectionId,
        companies: [{ companyName: "Ref Co", apiKey: "test-api-key-ref" }],
    });
    // Confirm without durable claim (Claude IP-only / no stable identity).
    await claimConnectionCodeForSession(confirmationCode, confirmSession);
    const { connectionRef } = await issueConnectionRef(connectionId);
    clearSessionClientKeysForTests();
    const issuedLogs = [];
    const originalInfo = console.info;
    console.info = (...args) => {
        issuedLogs.push(String(args[0] ?? ""));
        originalInfo.apply(console, args);
    };
    let routeToken = "";
    try {
        await runHttpToolSessionFromExtra(routeSession, new Map(), { sessionId: routeSession }, async () => {
            const routed = await routeRequest("add a customer");
            assert.equal(routed.mode, "action");
            assert.ok(routed.routeToken);
            routeToken = routed.routeToken;
        }, {
            toolName: "brc_route_request",
            connectionRef,
        });
    }
    finally {
        console.info = originalInfo;
    }
    const issuedLine = issuedLogs.find((line) => line.includes('"event":"route_token_issued"'));
    assert.ok(issuedLine, "expected route_token_issued telemetry");
    const issued = JSON.parse(issuedLine);
    assert.equal(issued.connectionIdPresent, true);
    assert.equal(issued.connectionRefResolved, true);
    assert.equal(issued.connectionBindingAdded, true);
    const createSession = uniqueId("session-create");
    const validated = await validateRouteTokenForTool(routeToken, {
        toolName: "brc_create_customer",
        sessionId: createSession,
        connectionId,
    });
    assert.equal(validated.ok, true);
    const forgedRefSession = uniqueId("session-forged-ref");
    const forgedScope = await (await loadModules()).prepareHttpToolSessionScope(forgedRefSession, new Map(), undefined, "redconn_forged_not_real");
    assert.equal(forgedScope.connectionId, "");
    assert.equal(forgedScope.resolution.connectionRefInvalid, true);
});
test("route_request without any verified client key stays session-bound", async () => {
    const { clearSessionClientKeysForTests, resetRouteTokenStateForTests, runHttpToolSessionFromExtra, routeRequest, validateRouteToken, ROUTE_TOKEN_SIGNING_SECRET_ENV, } = await loadModules();
    clearSessionClientKeysForTests();
    resetRouteTokenStateForTests({
        signingSecret: process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV],
    });
    const sessionId = uniqueId("session-no-claim");
    let routeToken = "";
    await runHttpToolSessionFromExtra(sessionId, new Map(), { sessionId }, async () => {
        const routed = await routeRequest("add a customer");
        assert.ok(routed.routeToken);
        routeToken = routed.routeToken;
    }, { toolName: "brc_route_request" });
    const sameSession = validateRouteToken(routeToken, {
        toolName: "brc_create_customer",
        sessionId,
    });
    assert.equal(sameSession.ok, true);
    const rotated = validateRouteToken(routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-rotated"),
        connectionId: uniqueId("connection-unrelated"),
    });
    assert.equal(rotated.ok, false);
    if (!rotated.ok) {
        assert.equal(rotated.reason, "wrong_session");
    }
});
