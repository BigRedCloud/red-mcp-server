import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { requiresRouteToken } from "../routing/route-token.js";
import { COPILOT_FULL_TOOL_ALLOWLIST, } from "../tool_profiles.js";
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
test("HTTP MCP paths expose isolated full, diagnostic, and router-free Copilot catalogues", async (t) => {
    const port = await getFreePort();
    await startHttpTestServer(t, port, { RED_MCP_TOOL_PROFILE: undefined }, 90_000);
    const [{ client: fullClient, transport: fullTransport }, { client: diagnosticClient, transport: diagnosticTransport }, { client: copilotFullClient, transport: copilotFullTransport },] = await Promise.all([
        connectClient(t, new URL(`http://127.0.0.1:${port}/mcp`)),
        connectClient(t, new URL(`http://127.0.0.1:${port}/mcp/copilot`)),
        connectClient(t, new URL(`http://127.0.0.1:${port}/mcp/copilot-full`)),
    ]);
    const [fullResponse, diagnosticResponse, copilotFullResponse] = await Promise.all([
        fullClient.listTools(),
        diagnosticClient.listTools(),
        copilotFullClient.listTools(),
    ]);
    const fullNames = fullResponse.tools.map((tool) => tool.name).sort();
    const diagnosticNames = diagnosticResponse.tools.map((tool) => tool.name).sort();
    const copilotFullNames = copilotFullResponse.tools.map((tool) => tool.name).sort();
    const routeToolName = "brc_route_request";
    assert.equal(fullNames.length, 159);
    assert.equal(new Set(fullNames).size, 159);
    assert.deepEqual(diagnosticNames, [
        "brc_copilot_connector_status",
        "brc_copilot_list_all_customers",
    ]);
    assert.equal(copilotFullNames.length, 158);
    assert.ok(fullNames.includes(routeToolName));
    for (const name of [
        "brc_start_company_connection",
        "brc_confirm_company_connection",
        "brc_list_company_contexts",
        "brc_list_nominal_accounts",
        "brc_list_customers",
        "brc_create_customer",
    ]) {
        assert.equal(diagnosticNames.includes(name), false, name);
    }
    for (const tool of diagnosticResponse.tools) {
        assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
        assert.equal(tool.annotations?.destructiveHint, false, tool.name);
        assert.equal(tool.annotations?.idempotentHint, true, tool.name);
        assert.equal(tool.annotations?.openWorldHint, false, tool.name);
    }
    assert.equal(diagnosticNames.includes(routeToolName), false);
    assert.equal(copilotFullNames.includes(routeToolName), false);
    assert.ok(fullNames
        .filter(requiresRouteToken)
        .every((name) => copilotFullNames.includes(name)));
    assert.deepEqual(copilotFullNames, [...COPILOT_FULL_TOOL_ALLOWLIST].sort());
    for (const tool of copilotFullResponse.tools) {
        assert.equal(Object.hasOwn(tool.inputSchema.properties ?? {}, "routeToken"), false, tool.name);
    }
    const excludedCall = await copilotFullClient.callTool({
        name: "brc_route_request",
        arguments: { message: "test" },
    });
    assert.equal(excludedCall.isError, true);
    assert.match(JSON.stringify(excludedCall.content), /not found|unknown tool/i);
    for (const [transport, otherPath] of [
        [fullTransport, "/mcp/copilot-full"],
        [diagnosticTransport, "/mcp/copilot-full"],
        [copilotFullTransport, "/mcp"],
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
    await startHttpTestServer(t, port, { RED_MCP_TOOL_PROFILE: undefined }, 90_000);
    const response = await fetch(`http://127.0.0.1:${port}/mcp/unknown`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(response.status, 404);
    const removedAliasResponse = await fetch(`http://127.0.0.1:${port}/mcp/copilot/read-only`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
    });
    assert.equal(removedAliasResponse.status, 404);
});
