import assert from "node:assert/strict";
import test from "node:test";
import { ensureConnectionStoreInitialized, getConnectionStore, getCurrentConnectionId, runWithMcpSessionContext, } from "../auth/connection_store.js";
import { wrapWriteToolHandler } from "../guards/write_confirmation.js";
import { routeRequest } from "./route-request.js";
import { encodeRouteTokenForTests, getRouteTokenSigningSecretSource, hashConnectionIdForBinding, hashRouteMessage, hashSessionIdForDiagnostics, issueActionRouteToken, markRouteTokenConsumed, requiresRouteToken, resetRouteTokenStateForTests, ROUTE_REQUIRED_ERROR, ROUTE_REQUIRED_MESSAGE, ROUTE_TOKEN_SIGNING_SECRET_ENV, ROUTE_TOKEN_TTL_MS, validateRouteToken, validateRouteTokenForTool, wrapRouteTokenHandler, } from "./route-token.js";
process.env.RED_CONNECT_CONNECTION_STORE ??= "memory";
const SECRET = "test-route-token-signing-secret";
const SECRET_B = "other-route-token-signing-secret";
function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function setup() {
    resetRouteTokenStateForTests({ signingSecret: SECRET });
}
const sampleArticle = {
    id: "freshdesk-1001",
    source: "freshdesk",
    freshdeskArticleId: 1001,
    categoryId: 1,
    folderId: 2,
    folderName: "Customers",
    title: "How do I add a Customer",
    bodyText: "Steps to add a customer in Big Red Cloud.",
    images: [],
    syncedImages: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: "how-do-i-add-a-customer",
    publicUrl: "https://bigredcloud.freshdesk.com/support/solutions/articles/1001",
};
test("add a customer returns action/create_customer and a valid token", async () => {
    setup();
    const result = await routeRequest("add a customer");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow, "create_customer");
    assert.deepEqual(result.allowedTools, ["brc_create_customer"]);
    assert.ok(result.routeToken);
    assert.equal(typeof result.routeToken, "string");
    const validation = validateRouteToken(result.routeToken, {
        toolName: "brc_create_customer",
    });
    assert.equal(validation.ok, true);
});
test("how do I add a customer returns help and no transactional token", async () => {
    setup();
    const result = await routeRequest("how do I add a customer", {
        helpSources: { freshdeskArticles: [sampleArticle] },
    });
    assert.equal(result.mode, "help");
    assert.equal(result.blockTransactionalTools, true);
    assert.equal(result.routeToken, undefined);
    assert.ok(result.help);
});
test("red-help add a customer returns help and no transactional token", async () => {
    setup();
    const result = await routeRequest("red-help add a customer", {
        helpSources: { freshdeskArticles: [] },
    });
    assert.equal(result.mode, "help");
    assert.equal(result.routeToken, undefined);
    assert.equal(result.blockTransactionalTools, true);
});
test("create_customer without a token is rejected", async () => {
    setup();
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    const result = (await wrapped({}));
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.error, ROUTE_REQUIRED_ERROR);
    assert.equal(body.message, ROUTE_REQUIRED_MESSAGE);
    assert.equal(handlerCalled, false);
});
test("create_customer with a help-mode attempt (no action token) is rejected", async () => {
    setup();
    const help = await routeRequest("how do I add a customer", {
        helpSources: { freshdeskArticles: [] },
    });
    assert.equal(help.routeToken, undefined);
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    const result = (await wrapped({
        routeToken: help.routeToken,
    }));
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.error, ROUTE_REQUIRED_ERROR);
    assert.equal(handlerCalled, false);
});
test("route and transactional calls succeed in the same session", async () => {
    setup();
    const sessionId = "same-session-route-and-create";
    const routed = await runWithMcpSessionContext({ sessionId, connectionId: "" }, () => routeRequest("add a customer", { sessionId }));
    assert.ok(routed.routeToken);
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { preview: true };
    });
    const result = await runWithMcpSessionContext({ sessionId, connectionId: "" }, () => wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme", code: "ACME" },
    }));
    assert.equal(handlerCalled, true);
    assert.deepEqual(result, { preview: true });
});
test("route and transactional calls succeed after HTTP session rehydration", async () => {
    setup();
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("connection");
    const sessionA = uniqueId("session-before-rehydrate");
    const sessionB = uniqueId("session-after-rehydrate");
    await store.bindSessionToConnection(sessionA, connectionId);
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: sessionA,
        connectionId,
    });
    assert.ok(issued.payload.connectionBinding);
    // Rehydration binds the rotated MCP session to the same connection.
    await store.bindSessionToConnection(sessionB, connectionId);
    const validation = await runWithMcpSessionContext({ sessionId: sessionB, connectionId }, () => validateRouteTokenForTool(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: sessionB,
    }));
    assert.equal(validation.ok, true);
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    const result = await runWithMcpSessionContext({ sessionId: sessionB, connectionId }, () => wrapped({
        routeToken: issued.routeToken,
    }));
    assert.equal(handlerCalled, true);
    assert.deepEqual(result, { ok: true });
});
test("route token issued while connected contains stable connection binding", async () => {
    setup();
    const connectionId = uniqueId("connection");
    const sessionId = uniqueId("session-connected");
    const routed = await runWithMcpSessionContext({ sessionId, connectionId }, () => routeRequest("add a customer", {
        sessionId,
        connectionId,
    }));
    assert.ok(routed.routeToken);
    const validation = validateRouteToken(routed.routeToken, {
        toolName: "brc_create_customer",
        sessionId,
        connectionId,
    });
    assert.equal(validation.ok, true);
    if (!validation.ok) {
        return;
    }
    assert.ok(validation.payload.connectionBinding);
    assert.equal(validation.payload.connectionBinding, hashConnectionIdForBinding(connectionId));
    assert.equal(validation.payload.connectionBinding.includes(connectionId), false);
});
test("different Claude sessions with same connection succeed via connection binding", async () => {
    setup();
    const connectionId = uniqueId("connection");
    const sessionA = uniqueId("claude-session-a");
    const sessionB = uniqueId("claude-session-b");
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: sessionA,
        connectionId,
    });
    assert.ok(issued.payload.connectionBinding);
    const validation = await runWithMcpSessionContext({ sessionId: sessionB, connectionId }, () => validateRouteTokenForTool(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: sessionB,
    }));
    assert.equal(validation.ok, true);
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    const result = await runWithMcpSessionContext({ sessionId: sessionB, connectionId }, () => wrapped({ routeToken: issued.routeToken }));
    assert.equal(handlerCalled, true);
    assert.deepEqual(result, { ok: true });
});
test("issuing session record deleted before transactional call still succeeds", async () => {
    setup();
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("connection");
    const sessionA = uniqueId("session-issue");
    const sessionB = uniqueId("session-tx");
    await store.bindSessionToConnection(sessionA, connectionId);
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: sessionA,
        connectionId,
    });
    // Issuing session binding no longer points at the token connection — continuity
    // must use connectionBinding, not a store lookup of session A.
    await store.bindSessionToConnection(sessionA, uniqueId("other-connection"));
    await store.bindSessionToConnection(sessionB, connectionId);
    const validation = await runWithMcpSessionContext({ sessionId: sessionB, connectionId }, () => validateRouteTokenForTool(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: sessionB,
        connectionId,
    }));
    assert.equal(validation.ok, true);
});
test("connectionRef-resolved same connection succeeds across sessions", async () => {
    setup();
    const connectionId = uniqueId("connection");
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: uniqueId("session-issue"),
        connectionId,
    });
    const validation = await validateRouteTokenForTool(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-tx"),
        connectionId,
    });
    assert.equal(validation.ok, true);
});
test("different connection rejects despite both being connected", async () => {
    setup();
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: uniqueId("session-a"),
        connectionId: uniqueId("connection-a"),
    });
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-b"),
        connectionId: uniqueId("connection-b"),
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "wrong_session");
    }
});
test("forged connection binding / wrong connectionRef target rejects", async () => {
    setup();
    const realConnection = uniqueId("connection-real");
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: uniqueId("session-a"),
        connectionId: realConnection,
    });
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-b"),
        connectionId: uniqueId("connection-forged"),
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "wrong_session");
    }
    const noMatch = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-c"),
        connectionId: "   ",
    });
    assert.equal(noMatch.ok, false);
});
test("token issued before connection remains session-bound", async () => {
    setup();
    const sessionA = uniqueId("session-pre-connect");
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: sessionA,
    });
    assert.equal(issued.payload.connectionBinding, undefined);
    assert.equal(validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: sessionA,
    }).ok, true);
    const later = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-after-connect"),
        connectionId: uniqueId("connection-later"),
    });
    assert.equal(later.ok, false);
    if (!later.ok) {
        assert.equal(later.reason, "wrong_session");
    }
});
test("validation resolves connection before route-token session check", async () => {
    setup();
    const connectionId = uniqueId("connection");
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: uniqueId("session-issue"),
        connectionId,
    });
    const order = [];
    const wrapped = wrapRouteTokenHandler("brc_create_customer", async () => {
        order.push("handler");
        return { ok: true };
    });
    await runWithMcpSessionContext({ sessionId: uniqueId("session-tx"), connectionId }, async () => {
        order.push("connection-context-ready");
        assert.ok(getCurrentConnectionId());
        const result = await wrapped({ routeToken: issued.routeToken });
        order.push("after-route-guard");
        assert.deepEqual(result, { ok: true });
    });
    assert.deepEqual(order, [
        "connection-context-ready",
        "handler",
        "after-route-guard",
    ]);
});
test("multi-instance configured secret remains valid with connection binding", () => {
    resetRouteTokenStateForTests({ signingSecret: SECRET });
    const connectionId = uniqueId("connection-shared");
    const issuedOnInstanceA = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: uniqueId("session-a"),
        connectionId,
    });
    assert.equal(getRouteTokenSigningSecretSource(), "configured");
    assert.ok(issuedOnInstanceA.payload.connectionBinding);
    resetRouteTokenStateForTests({ signingSecret: SECRET });
    assert.equal(getRouteTokenSigningSecretSource(), "configured");
    const validation = validateRouteToken(issuedOnInstanceA.routeToken, {
        toolName: "brc_create_customer",
        sessionId: uniqueId("session-b"),
        connectionId,
    });
    assert.equal(validation.ok, true);
});
test("two app instances sharing the configured signing secret accept each other's tokens", () => {
    resetRouteTokenStateForTests({ signingSecret: SECRET });
    const issuedOnInstanceA = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "shared-secret-session",
    });
    assert.equal(getRouteTokenSigningSecretSource(), "configured");
    // Simulate a second process that pins the same configured secret.
    resetRouteTokenStateForTests({ signingSecret: SECRET });
    assert.equal(getRouteTokenSigningSecretSource(), "configured");
    const validation = validateRouteToken(issuedOnInstanceA.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "shared-secret-session",
    });
    assert.equal(validation.ok, true);
});
test("differing signing secrets reject tokens across instances", () => {
    resetRouteTokenStateForTests({ signingSecret: SECRET });
    const issuedOnInstanceA = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "diff-secret-session",
    });
    resetRouteTokenStateForTests({ signingSecret: SECRET_B });
    const validation = validateRouteToken(issuedOnInstanceA.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "diff-secret-session",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "bad_signature");
    }
});
test("ephemeral signing secrets differ when the configured secret is missing", () => {
    resetRouteTokenStateForTests({ signingSecret: null });
    delete process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV];
    const issuedA = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "ephemeral-session",
    });
    assert.equal(getRouteTokenSigningSecretSource(), "ephemeral");
    resetRouteTokenStateForTests({ signingSecret: null });
    delete process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV];
    const validation = validateRouteToken(issuedA.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "ephemeral-session",
    });
    assert.equal(getRouteTokenSigningSecretSource(), "ephemeral");
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "bad_signature");
    }
    resetRouteTokenStateForTests({ signingSecret: SECRET });
});
test("message-hash mismatch is rejected when a message is supplied to the validator", () => {
    setup();
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "msg-hash-session",
    });
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "msg-hash-session",
        message: "add a different customer request",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "wrong_message");
    }
    assert.equal(issued.payload.messageHash, hashRouteMessage("add a customer"));
});
test("workflow mismatch is rejected when an expected workflow is supplied", () => {
    setup();
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "workflow-session",
    });
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "workflow-session",
        workflow: "create_sales_invoice",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "wrong_workflow");
    }
});
test("tool-name mismatch is rejected", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_sales_invoice", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    const result = (await wrapped({
        routeToken: routed.routeToken,
    }));
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.error, ROUTE_REQUIRED_ERROR);
    assert.equal(handlerCalled, false);
    const validation = validateRouteToken(routed.routeToken, {
        toolName: "brc_create_sales_invoice",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "wrong_tool");
    }
});
test("first use of an unexpired token is accepted and not consumed", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    assert.ok(routed.routeToken);
    const first = validateRouteToken(routed.routeToken, {
        toolName: "brc_create_customer",
    });
    assert.equal(first.ok, true);
    const second = validateRouteToken(routed.routeToken, {
        toolName: "brc_create_customer",
    });
    assert.equal(second.ok, true);
});
test("preview reuse is allowed; consumption only after confirmed write", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    const writeWrapped = wrapWriteToolHandler("brc_create_customer", async () => ({ posted: true }));
    const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);
    const previewOne = (await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme", code: "ACME" },
    }));
    const previewOneBody = JSON.parse(previewOne.content[0].text);
    assert.equal(previewOneBody.status ?? previewOneBody.error, "confirmation_required");
    const previewTwo = (await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme", code: "ACME" },
    }));
    const previewTwoBody = JSON.parse(previewTwo.content[0].text);
    assert.equal(previewTwoBody.status ?? previewTwoBody.error, "confirmation_required");
    const posted = await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme", code: "ACME" },
        confirmWrite: true,
    });
    assert.deepEqual(posted, { posted: true });
    const replay = (await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme", code: "ACME" },
        confirmWrite: true,
    }));
    const body = JSON.parse(replay.content[0].text);
    assert.equal(body.error, ROUTE_REQUIRED_ERROR);
});
test("create_customer with the correct action token reaches normal preflight", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    assert.ok(routed.routeToken);
    let handlerCalled = false;
    const writeWrapped = wrapWriteToolHandler("brc_create_customer", async () => {
        handlerCalled = true;
        return { posted: true };
    });
    const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);
    const result = (await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme" },
    }));
    const body = JSON.parse(result.content[0].text);
    assert.equal(handlerCalled, false);
    assert.equal(body.status ?? body.error, "confirmation_required");
    assert.ok(body.payloadPreview || body.confirmationField === "confirmWrite", "expected preview-before-posting payload");
});
test("preview-before-posting remains mandatory even with a valid routeToken", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    const writeWrapped = wrapWriteToolHandler("brc_create_customer", async () => ({ posted: true }));
    const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);
    const preview = (await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme" },
    }));
    const previewBody = JSON.parse(preview.content[0].text);
    assert.equal(previewBody.status ?? previewBody.error, "confirmation_required");
});
test("create_sales_invoice rejects a create_customer token", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    let handlerCalled = false;
    const wrapped = wrapRouteTokenHandler("brc_create_sales_invoice", async () => {
        handlerCalled = true;
        return { ok: true };
    });
    const result = (await wrapped({
        routeToken: routed.routeToken,
    }));
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.error, ROUTE_REQUIRED_ERROR);
    assert.equal(handlerCalled, false);
});
test("expired tokens are rejected", () => {
    setup();
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        now: Date.now() - ROUTE_TOKEN_TTL_MS - 1000,
        ttlMs: 1000,
    });
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "expired");
    }
});
test("altered tokens are rejected", () => {
    setup();
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
    });
    const altered = `${issued.routeToken.slice(0, -4)}xxxx`;
    const validation = validateRouteToken(altered, {
        toolName: "brc_create_customer",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.ok(validation.reason === "bad_signature" ||
            validation.reason === "malformed");
    }
});
test("replayed (consumed) tokens are rejected", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    const validation = validateRouteToken(routed.routeToken, {
        toolName: "brc_create_customer",
    });
    assert.equal(validation.ok, true);
    if (!validation.ok) {
        return;
    }
    markRouteTokenConsumed(validation.payload.jti, validation.payload.exp);
    const again = validateRouteToken(routed.routeToken, {
        toolName: "brc_create_customer",
    });
    assert.equal(again.ok, false);
    if (!again.ok) {
        assert.equal(again.reason, "consumed");
    }
});
test("confirmed write consumes the routeToken (replay rejected)", async () => {
    setup();
    const routed = await routeRequest("add a customer");
    const writeWrapped = wrapWriteToolHandler("brc_create_customer", async () => ({ posted: true }));
    const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);
    const posted = await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme" },
        confirmWrite: true,
    });
    assert.deepEqual(posted, { posted: true });
    const replay = (await wrapped({
        routeToken: routed.routeToken,
        companyName: "Demo",
        payload: { name: "Acme" },
        confirmWrite: true,
    }));
    const body = JSON.parse(replay.content[0].text);
    assert.equal(body.error, ROUTE_REQUIRED_ERROR);
});
test("cross-session tokens are rejected when sessions do not share a connection", () => {
    setup();
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "session-a",
    });
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "session-b",
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
        assert.equal(validation.reason, "wrong_session");
    }
});
test("forged help-mode style payload is not accepted as action token", () => {
    setup();
    const payload = {
        jti: "abc",
        mode: "help",
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        messageHash: "x",
        sessionId: "s1",
        iat: Date.now(),
        exp: Date.now() + ROUTE_TOKEN_TTL_MS,
    };
    const token = encodeRouteTokenForTests(payload);
    const validation = validateRouteToken(token, {
        toolName: "brc_create_customer",
        sessionId: "s1",
    });
    assert.equal(validation.ok, false);
});
test("help routing does not persist into the next request", async () => {
    setup();
    const help = await routeRequest("how do I add a customer", {
        helpSources: { freshdeskArticles: [] },
    });
    assert.equal(help.mode, "help");
    assert.equal(help.routeToken, undefined);
    const action = await routeRequest("add a customer");
    assert.equal(action.mode, "action");
    assert.ok(action.routeToken);
});
test("requiresRouteToken covers transactional groups and exempts help/session", () => {
    assert.equal(requiresRouteToken("brc_create_customer"), true);
    assert.equal(requiresRouteToken("brc_create_sales_invoice"), true);
    assert.equal(requiresRouteToken("brc_delete_sales_invoice"), true);
    assert.equal(requiresRouteToken("brc_batch_sales_invoices"), true);
    assert.equal(requiresRouteToken("brc_send_quote_email"), true);
    assert.equal(requiresRouteToken("brc_route_request"), false);
    assert.equal(requiresRouteToken("brc_red_help"), false);
    assert.equal(requiresRouteToken("brc_find_help_resources"), false);
    assert.equal(requiresRouteToken("brc_start_company_connection"), false);
    assert.equal(requiresRouteToken("brc_list_customers"), false);
});
test("session id diagnostic hashes are stable and non-reversible length", () => {
    const hash = hashSessionIdForDiagnostics("session-abc");
    assert.equal(hash.length, 16);
    assert.equal(hashSessionIdForDiagnostics("session-abc"), hash);
    assert.notEqual(hashSessionIdForDiagnostics("session-xyz"), hash);
});
test("late-loaded signing secret does not flip away from a pinned ephemeral secret", () => {
    resetRouteTokenStateForTests({ signingSecret: null });
    delete process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV];
    const issued = issueActionRouteToken({
        workflow: "create_customer",
        allowedTools: ["brc_create_customer"],
        message: "add a customer",
        sessionId: "pin-session",
    });
    assert.equal(getRouteTokenSigningSecretSource(), "ephemeral");
    // Env appears later in the process lifetime — pin must keep verifying.
    process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV] = SECRET;
    assert.equal(getRouteTokenSigningSecretSource(), "ephemeral");
    const validation = validateRouteToken(issued.routeToken, {
        toolName: "brc_create_customer",
        sessionId: "pin-session",
    });
    assert.equal(validation.ok, true);
    resetRouteTokenStateForTests({ signingSecret: SECRET });
});
