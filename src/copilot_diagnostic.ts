import { registerCopilotAccountingFacade } from "./copilot_facade.js";
import { registerCopilotCustomers } from "./copilot_customers.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFindHelpResourcesTool } from "./tools/edu/help_resources_tools.js";

export const COPILOT_INSTRUCTIONS = [
  "RED by Big Red Cloud is exposed in Microsoft 365 through a federated connector.",
  "Use search_customers to search customers in companies linked to the verified signed-in Microsoft user. Use an empty query to list customers.",
  "Start without nextCursor. If a response returns nextCursor, pass it with the same query to continue, even when the current page has no matches.",
  "Use fetch_customer with the exact customerId and companyName from search results to retrieve one customer. Customer IDs are company-scoped.",
  "Use the other search tools for suppliers, products, sales invoices, purchases and accounts. Omit companyName to search linked companies. Keep all filters unchanged with nextCursor. Fetch a result using its returned identifier and companyName.",
].join("\n");

export const COPILOT_DIAGNOSTIC_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const COPILOT_DIAGNOSTIC_STATUS = {
  status: "ok",
  service: "RED by Big Red Cloud",
  profile: "copilot-diagnostic",
  message: "Microsoft 365 Copilot successfully invoked the RED MCP server.",
} as const;

/** HTTP federated profile; legacy diagnostic mode is retained for local diagnostics. */
export function registerCopilotDiagnosticTools(server: McpServer, authenticated = false): void {
  if (authenticated) {
    registerCopilotCustomers(server);
    registerCopilotAccountingFacade(server);
    return;
  }

  server.registerTool("brc_copilot_connector_status", {
    title: "Check RED connectivity",
    description: "Check Microsoft 365 Copilot connectivity to RED. No company connection required.",
    inputSchema: {},
    annotations: COPILOT_DIAGNOSTIC_ANNOTATIONS,
  }, async () => ({
    content: [{ type: "text", text: JSON.stringify(COPILOT_DIAGNOSTIC_STATUS) }],
    structuredContent: { ...COPILOT_DIAGNOSTIC_STATUS },
  }));

  // Reuse the existing tool's schema and handler with profile-local annotations.
  const publicHelpServer = Object.create(server) as McpServer;
  publicHelpServer.tool = ((name: string, description: string, inputSchema: any, handler: any) => {
    if (name !== "brc_find_help_resources") throw new Error("Unexpected diagnostic tool");
    return server.registerTool(name, {
      title: "Find Help Resources",
      description,
      inputSchema,
      annotations: COPILOT_DIAGNOSTIC_ANNOTATIONS,
    }, handler);
  }) as McpServer["tool"];
  registerFindHelpResourcesTool(publicHelpServer);
}
