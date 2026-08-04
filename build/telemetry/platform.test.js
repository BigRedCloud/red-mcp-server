import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";
import { clearAllSessionPlatformsForTests, clearSessionPlatform, detectClientPlatform, extractMcpInitializeClientInfo, getStoredSessionPlatform, matchPlatformFromText, normalizeClientPlatform, resolveClientPlatform, storeSessionPlatform, } from "./platform.js";
import { prepareMcpTelemetryContext } from "./context.js";
import { buildTelemetryCustomDimensions, generateConnectionSessionId, generateTelemetryUuid, } from "./identity.js";
function uniqueId(prefix) {
    return `${prefix}-${randomUUID()}`;
}
test.beforeEach(() => {
    clearAllSessionPlatformsForTests();
});
test("Claude detected from clientInfo", () => {
    const result = resolveClientPlatform({
        clientInfo: { name: "claude-ai", version: "1.2.3" },
    });
    assert.equal(result.platform, "claude");
    assert.equal(result.detectionSource, "clientInfo");
    assert.equal(result.clientInfoNamePresent, true);
    assert.equal(result.clientInfoName, "claude-ai");
    assert.equal(result.clientInfoVersion, "1.2.3");
});
test("ChatGPT detected from clientInfo", () => {
    const result = resolveClientPlatform({
        clientInfo: { name: "chatgpt-mcp", version: "0.1.0" },
    });
    assert.equal(result.platform, "chatgpt");
    assert.equal(result.detectionSource, "clientInfo");
});
test("OpenAI client name detected as chatgpt", () => {
    const result = resolveClientPlatform({
        clientInfo: { name: "openai-mcp" },
    });
    assert.equal(result.platform, "chatgpt");
    assert.equal(result.detectionSource, "clientInfo");
});
test("Mistral detected from clientInfo", () => {
    const result = resolveClientPlatform({
        clientInfo: { name: "mistral-lechat" },
    });
    assert.equal(result.platform, "mistral");
    assert.equal(result.detectionSource, "clientInfo");
});
test("Vibe detected as mistral", () => {
    assert.equal(resolveClientPlatform({ clientInfo: { name: "vibe" } }).platform, "mistral");
    assert.equal(resolveClientPlatform({
        headers: { "x-vibe-user-id": "u-1" },
    }).platform, "mistral");
    assert.equal(matchPlatformFromText("Mistral Vibe CLI"), "mistral");
});
test("anthropic clientInfo maps to claude", () => {
    assert.equal(resolveClientPlatform({
        clientInfo: { name: "anthropic-claude-desktop" },
    }).platform, "claude");
});
test("case-insensitive clientInfo matching", () => {
    assert.equal(resolveClientPlatform({ clientInfo: { name: "ChatGPT" } }).platform, "chatgpt");
    assert.equal(resolveClientPlatform({ clientInfo: { name: "CLAUDE" } }).platform, "claude");
    assert.equal(resolveClientPlatform({ clientInfo: { name: "OpenAI" } }).platform, "chatgpt");
});
test("stored session platform reused on later requests", () => {
    const sessionId = uniqueId("session");
    storeSessionPlatform(sessionId, "chatgpt");
    const result = resolveClientPlatform({
        storedPlatform: getStoredSessionPlatform(sessionId),
        headers: {},
    });
    assert.equal(result.platform, "chatgpt");
    assert.equal(result.detectionSource, "storedSession");
    assert.equal(result.storedPlatformFound, true);
});
test("blank User-Agent does not lose the stored platform", () => {
    const result = resolveClientPlatform({
        storedPlatform: "mistral",
        headers: { "user-agent": "" },
    });
    assert.equal(result.platform, "mistral");
    assert.equal(result.detectionSource, "storedSession");
});
test("ambiguous client remains unknown", () => {
    assert.equal(resolveClientPlatform({ clientInfo: { name: "mcp-client" } }).platform, "unknown");
    assert.equal(resolveClientPlatform({ clientInfo: { name: "ai-assistant" } }).platform, "unknown");
    assert.equal(matchPlatformFromText("Mozilla/5.0"), undefined);
});
test("unsupported clients remain unknown", () => {
    assert.equal(resolveClientPlatform({ clientInfo: { name: "cursor" } }).platform, "unknown");
    assert.equal(detectClientPlatform({ "user-agent": "Cursor/1.0" }), "unknown");
    assert.equal(resolveClientPlatform({ clientInfo: { name: "vscode-mcp" } }).platform, "unknown");
});
test("detection priority: clientInfo over stored over headers over UA", () => {
    assert.equal(resolveClientPlatform({
        clientInfo: { name: "claude-ai" },
        storedPlatform: "chatgpt",
        headers: {
            "x-vibe-user-id": "x",
            "user-agent": "ChatGPT-User/1.0",
        },
    }).detectionSource, "clientInfo");
    assert.equal(resolveClientPlatform({
        storedPlatform: "chatgpt",
        headers: {
            "x-vibe-user-id": "x",
            "user-agent": "claude-desktop",
        },
    }).detectionSource, "storedSession");
    assert.equal(resolveClientPlatform({
        headers: {
            "x-mistral-user-id": "x",
            "user-agent": "claude-desktop",
        },
    }).detectionSource, "headers");
    assert.equal(resolveClientPlatform({
        headers: { "user-agent": "claude-desktop" },
    }).detectionSource, "userAgent");
});
test("platform survives MCP session rotation/rehydration", async () => {
    const sessionId = uniqueId("session-rotate");
    const first = await prepareMcpTelemetryContext({
        sessionId,
        keyStore: new Map(),
        clientInfo: { name: "openai-mcp", version: "2.0.0" },
        headers: { "user-agent": "openai-mcp/2.0.0" },
    });
    assert.equal(first.context.clientPlatform, "chatgpt");
    assert.equal(first.platformDetection.detectionSource, "clientInfo");
    assert.equal(getStoredSessionPlatform(sessionId), "chatgpt");
    // Simulate HTTP session object rebuild with blank UA (common after rotation).
    clearSessionPlatform(""); // no-op sanity
    const resumed = await prepareMcpTelemetryContext({
        sessionId,
        keyStore: new Map(),
        storedPlatform: getStoredSessionPlatform(sessionId),
        headers: { "user-agent": "" },
    });
    assert.equal(resumed.context.clientPlatform, "chatgpt");
    assert.equal(resumed.platformDetection.detectionSource, "storedSession");
    assert.equal(resumed.platformDetection.storedPlatformFound, true);
});
test("existing telemetry client/session identity remains unchanged", async () => {
    const { getConnectionStore, claimConnectionCodeForSession, ensureConnectionStoreInitialized, } = await import("../auth/connection_store.js");
    const { seedClaimableConnection } = await import("../auth/connection_test_helpers.js");
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const connectionId = uniqueId("conn-plat");
    const clientId = generateTelemetryUuid();
    const connectToken = uniqueId("connect").replace(/-/g, "").slice(0, 32);
    const confirmationCode = uniqueId("confirm").replace(/-/g, "").slice(0, 32);
    const sessionId = uniqueId("session-plat");
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
                apiKey: "test-key-plat-a",
            },
        ],
        expiresAt: Number.MAX_SAFE_INTEGER,
    });
    const claim = await claimConnectionCodeForSession(confirmationCode, sessionId);
    assert.equal(typeof claim.connectionSessionId, "string");
    storeSessionPlatform(sessionId, "claude");
    const prepared = await prepareMcpTelemetryContext({
        sessionId,
        keyStore: new Map(),
        storedPlatform: getStoredSessionPlatform(sessionId),
        headers: { "user-agent": "" },
    });
    assert.equal(prepared.context.telemetryClientId, clientId);
    assert.equal(prepared.context.connectionSessionId, claim.connectionSessionId);
    assert.equal(prepared.context.clientPlatform, "claude");
    assert.equal(prepared.diagnostics.clientIdPresent, true);
    assert.equal(prepared.diagnostics.connectionSessionIdPresent, true);
    const dims = buildTelemetryCustomDimensions(prepared.context);
    assert.equal(dims["red.telemetry_client_id"], clientId);
    assert.equal(dims["red.connection_session_id"], claim.connectionSessionId);
    assert.equal(dims["red.client_platform"], "claude");
});
test("extractMcpInitializeClientInfo reads name and version only", () => {
    const info = extractMcpInitializeClientInfo({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: { secrets: "must-not-appear" },
            clientInfo: { name: "chatgpt.com", version: "1.0.0", extra: "ignored" },
        },
    });
    assert.deepEqual(info, { name: "chatgpt.com", version: "1.0.0" });
});
test("normalizeClientPlatform accepts only supported values", () => {
    assert.equal(normalizeClientPlatform("claude"), "claude");
    assert.equal(normalizeClientPlatform("ChatGPT"), "chatgpt");
    assert.equal(normalizeClientPlatform("vibe"), "mistral");
    assert.equal(normalizeClientPlatform("cursor"), "unknown");
    assert.equal(normalizeClientPlatform(undefined), "unknown");
});
test("User-Agent fallback still works for known platforms", () => {
    assert.equal(detectClientPlatform({ "user-agent": "ChatGPT-User/1.0" }), "chatgpt");
    assert.equal(detectClientPlatform({ "user-agent": "claude-desktop" }), "claude");
    assert.equal(detectClientPlatform({ "user-agent": "mistral-vibe/1.0" }), "mistral");
});
test("generateConnectionSessionId remains a UUID", () => {
    assert.match(generateConnectionSessionId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
