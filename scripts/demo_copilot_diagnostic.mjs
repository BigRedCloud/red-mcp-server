import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getFreePort, startHttpTestServer } from "../build/tests/http_test_server.js";

const cleanup = [];
const client = new Client({ name: "copilot-diagnostic-demo", version: "1.0.0" });
try {
  const port = await getFreePort();
  await startHttpTestServer({ after: (fn) => cleanup.push(fn) }, port, {}, 90_000);
  const endpoint = `http://127.0.0.1:${port}/mcp/copilot`;
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  console.log(`Initialized ${endpoint}`);
  console.log(JSON.stringify(await client.listTools(), null, 2));
  console.log(JSON.stringify(await client.callTool({ name: "brc_copilot_connector_status", arguments: {} }), null, 2));
} finally {
  await client.close();
  for (const fn of cleanup.reverse()) await fn();
}
