import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { COPILOT_DIAGNOSTIC_ANNOTATIONS, COPILOT_DIAGNOSTIC_STATUS } from "../copilot_diagnostic.js";
import { TOOL_ANNOTATIONS } from "../tool_annotations.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";

test("Copilot diagnostic initializes, exposes only public read-only tools, and performs no company or BRC IO", async (t) => {
  const port = await getFreePort();
  const child = await startHttpTestServer(t, port, {
    NODE_OPTIONS: "--import=./scripts/tests/lib/diagnostic_guards.mjs",
    RED_MCP_TOOL_PROFILE: undefined,
    BRC_EDU_SOURCE: "local",
    AZURE_STORAGE_CONNECTION_STRING: "",
  }, 90_000);
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const client = new Client({ name: "diagnostic-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/copilot`));
  t.after(() => client.close());
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    "brc_copilot_connector_status", "brc_copilot_list_all_customers",
  ]);
  for (const tool of listed.tools) assert.deepEqual(tool.annotations, COPILOT_DIAGNOSTIC_ANNOTATIONS);
  assert.deepEqual(listed.tools[0].inputSchema.properties, {});
  const result = await client.callTool({ name: "brc_copilot_connector_status", arguments: {} });
  assert.deepEqual(result.structuredContent, COPILOT_DIAGNOSTIC_STATUS);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(COPILOT_DIAGNOSTIC_STATUS) }]);
  for (const name of ["brc_start_company_connection", "brc_confirm_company_connection", "brc_list_company_contexts", "brc_list_customers", "brc_create_customer"]) {
    assert.equal((await client.callTool({ name, arguments: {} })).isError, true, name);
  }
  // The same server still exposes the complete production registry on /mcp.
  const full = new Client({ name: "full-regression", version: "1.0.0" });
  t.after(() => full.close());
  // Main initialization legitimately accesses the company store, so verify
  // it separately below without the diagnostic-only fail-on-access guard.
  assert.doesNotMatch(errors, /DIAGNOSTIC_FORBIDDEN_IO/);
  const fullPort = await getFreePort();
  await startHttpTestServer(t, fullPort, { RED_MCP_TOOL_PROFILE: undefined }, 90_000);
  await full.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${fullPort}/mcp`)));
  const fullNames = (await full.listTools()).tools.map((tool) => tool.name).sort();
  const developmentOnly = new Set(["brc_set_company_api_key", "brc_get_dev_mode_details", "brc_dev_diagnose_company_processing_settings", "brc_get_connection_store_diagnostics"]);
  assert.deepEqual(fullNames, Object.keys(TOOL_ANNOTATIONS).filter((name) => !developmentOnly.has(name)).sort());
  assert.equal(fullNames.includes("brc_copilot_connector_status"), false);
});
