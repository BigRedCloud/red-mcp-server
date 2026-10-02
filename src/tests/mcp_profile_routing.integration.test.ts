import { COPILOT_FEDERATED_TOOL_NAMES } from "../copilot_facade.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { requiresRouteToken } from "../routing/route-token.js";
import { COPILOT_INSTRUCTIONS } from "../copilot_diagnostic.js";
import { getBrcMcpServerInstructions } from "../config/mcp_config.js";
import { getMaxBatchItems } from "../config/server_config.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";

async function connectClient(t: TestContext, endpoint: URL) {
  const client = new Client({ name: "profile-routing-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint);
  await client.connect(transport);
  t.after(async () => {
    await client.close().catch(() => {});
  });
  return { client, transport };
}

test("HTTP MCP paths expose isolated normal and read-only Copilot catalogues", async (t) => {
  const port = await getFreePort();
  await startHttpTestServer(
    t,
    port,
    { RED_MCP_TOOL_PROFILE: undefined },
    90_000,
  );

  const [
    { client: fullClient, transport: fullTransport },
    { client: diagnosticClient, transport: diagnosticTransport },
  ] =
    await Promise.all([
      connectClient(t, new URL(`http://127.0.0.1:${port}/mcp`)),
      connectClient(t, new URL(`http://127.0.0.1:${port}/mcp/copilot`)),
    ]);

  const [fullResponse, diagnosticResponse] = await Promise.all([
    fullClient.listTools(),
    diagnosticClient.listTools(),
  ]);
  const fullNames: string[] = fullResponse.tools.map((tool) => tool.name).sort();
  const diagnosticNames = diagnosticResponse.tools.map((tool) => tool.name).sort();
  const routeToolName: string = "brc_route_request";

  assert.equal(fullNames.length, 159);
  assert.equal(new Set(fullNames).size, 159);
  assert.equal(fullClient.getInstructions(), getBrcMcpServerInstructions(getMaxBatchItems(), false));
  const instructions = diagnosticClient.getInstructions();
  assert.equal(instructions, COPILOT_INSTRUCTIONS);
  assert.ok(instructions && instructions.length < 1000);
  assert.match(instructions, /Microsoft 365 through a federated connector/);
  assert.match(instructions, /verified signed-in Microsoft user/);
  assert.match(instructions, /without nextCursor/);
  assert.match(instructions, /same query to continue/);
  assert.doesNotMatch(instructions, /connectionRef/);
  assert.deepEqual(diagnosticNames, [...COPILOT_FEDERATED_TOOL_NAMES].sort());
  assert.deepEqual([...new Set(instructions.match(/(?:search_customers|fetch_customer)/g))].sort(), ["fetch_customer", "search_customers"]);
  assert.deepEqual(diagnosticResponse.tools.slice(0, 2).map(({ name, title }) => ({ name, title })), [
    { name: "search_customers", title: "Search Big Red Cloud customers" },
    { name: "fetch_customer", title: "Fetch Big Red Cloud customer" },
  ]);
  assert.doesNotMatch(instructions, /brc_[a-z0-9_]+/);
  const [search, fetchCustomer] = diagnosticResponse.tools;
  assert.deepEqual(Object.keys(search.inputSchema.properties ?? {}), ["query", "companyName", "nextCursor"]);
  assert.deepEqual(search.inputSchema.required, ["query"]);
  assert.deepEqual(Object.keys(fetchCustomer.inputSchema.properties ?? {}), ["customerId", "companyName"]);
  assert.deepEqual(fetchCustomer.inputSchema.required, ["customerId", "companyName"]);
  for (const tool of diagnosticResponse.tools) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.ok(fullNames.includes(routeToolName));
  for (const name of [
    "brc_start_company_connection",
    "brc_confirm_company_connection",
    "brc_list_company_contexts",
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
  for (const tool of fullResponse.tools.filter(tool => requiresRouteToken(tool.name))) {
    assert.ok(Object.hasOwn(tool.inputSchema.properties ?? {}, "routeToken"), tool.name);
  }

  for (const [transport, otherPath] of [
    [fullTransport, "/mcp/copilot"],
    [diagnosticTransport, "/mcp"],
  ] as const) {
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
  await startHttpTestServer(
    t,
    port,
    { RED_MCP_TOOL_PROFILE: undefined },
    90_000,
  );
  const response = await fetch(`http://127.0.0.1:${port}/mcp/unknown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(response.status, 404);

  const removedAliasResponse = await fetch(
    `http://127.0.0.1:${port}/mcp/copilot/read-only`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
    },
  );
  assert.equal(removedAliasResponse.status, 404);
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = await fetch(`http://127.0.0.1:${port}/mcp/copilot-full`, { method });
    assert.equal(response.status, 404, method);
  }
});
