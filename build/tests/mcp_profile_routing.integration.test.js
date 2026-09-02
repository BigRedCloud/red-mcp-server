import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { requiresRouteToken } from "../routing/route-token.js";
import { COPILOT_FULL_TOOL_ALLOWLIST } from "../tool_profiles.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";
async function connectClient(t, endpoint) {
    const client = new Client({ name: "profile-routing-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(endpoint);
    await client.connect(transport);
    t.after(async () => {
        await client.close().catch(() => { });
    });
    return { client, transport };
}
test("HTTP MCP paths expose isolated full and Copilot Full catalogues without environment selection", async (t) => {
    const port = await getFreePort();
    await startHttpTestServer(t, port, { RED_MCP_TOOL_PROFILE: undefined });
    const [{ client: fullClient, transport: fullTransport }, { client: copilotClient, transport: copilotTransport }] = await Promise.all([
        connectClient(t, new URL(`http://127.0.0.1:${port}/mcp`)),
        connectClient(t, new URL(`http://127.0.0.1:${port}/mcp/copilot`)),
    ]);
    const [fullResponse, copilotResponse] = await Promise.all([
        fullClient.listTools(),
        copilotClient.listTools(),
    ]);
    const fullNames = fullResponse.tools.map((tool) => tool.name).sort();
    const copilotNames = copilotResponse.tools.map((tool) => tool.name).sort();
    const routeToolName = "brc_route_request";
    assert.equal(fullNames.length, 159);
    assert.equal(new Set(fullNames).size, 159);
    assert.equal(copilotNames.length, 80);
    assert.ok(fullNames.includes(routeToolName));
    assert.ok(copilotNames.some((name) => name === "brc_list_nominal_accounts"));
    assert.equal(copilotNames.includes(routeToolName), false);
    assert.ok(fullNames
        .filter(requiresRouteToken)
        .every((name) => !copilotNames.some((candidate) => candidate === name)));
    assert.deepEqual(copilotNames, [...COPILOT_FULL_TOOL_ALLOWLIST].sort());
    const excludedCall = await copilotClient.callTool({
        name: "brc_route_request",
        arguments: { message: "test" },
    });
    assert.equal(excludedCall.isError, true);
    assert.match(JSON.stringify(excludedCall.content), /not found|unknown tool/i);
    for (const [transport, otherPath] of [
        [fullTransport, "/mcp/copilot"],
        [copilotTransport, "/mcp"],
    ]) {
        assert.ok(transport.sessionId);
        const crossed = await fetch(`http://127.0.0.1:${port}${otherPath}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-session-id": transport.sessionId,
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }),
        });
        assert.equal(crossed.status, 400);
        assert.match(await crossed.text(), /profile mismatch/i);
    }
});
test("unknown MCP profile paths fail closed", async (t) => {
    const port = await getFreePort();
    await startHttpTestServer(t, port, { RED_MCP_TOOL_PROFILE: undefined });
    const response = await fetch(`http://127.0.0.1:${port}/mcp/unknown`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(response.status, 404);
});
