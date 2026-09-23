import { COPILOT_FEDERATED_TOOL_NAMES } from "../copilot_facade.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { COPILOT_DIAGNOSTIC_ANNOTATIONS } from "../copilot_diagnostic.js";
import { TOOL_ANNOTATIONS } from "../tool_annotations.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";

test("Copilot federated discovery exposes only audited read-only tools without company or BRC IO", async (t) => {
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
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...COPILOT_FEDERATED_TOOL_NAMES].sort());
  assert.equal(listed.tools.length, 53);
  assert.ok(listed.tools.every(tool => /^(search|fetch|get)_/.test(tool.name)));
  for (const tool of listed.tools) assert.deepEqual(tool.annotations, COPILOT_DIAGNOSTIC_ANNOTATIONS);
  await assert.rejects(client.callTool({name:"search_customers",arguments:{query:""}}));
  await assert.rejects(client.callTool({name:"fetch_customer",arguments:{customerId:"1",companyName:"A"}}));
  for (const name of ["brc_copilot_connector_status", "brc_copilot_list_all_customers", "brc_start_company_connection", "brc_confirm_company_connection", "brc_list_company_contexts", "brc_create_customer", "brc_list_customers", "brc_list_suppliers", "brc_get_supplier", "brc_list_accounts", "brc_list_quotes", "brc_get_quote", "brc_list_bank_accounts", "brc_list_cash_payments", "brc_get_payment"]) {
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
