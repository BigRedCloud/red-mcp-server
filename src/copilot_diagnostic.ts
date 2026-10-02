import { registerCopilotCompanyManagement } from "./copilot_company_management.js";
import { registerCopilotHelp } from "./copilot_help.js";
import { registerCopilotAccountingFacade } from "./copilot_facade.js";
import { registerCopilotCustomers } from "./copilot_customers.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFindHelpResourcesTool } from "./tools/edu/help_resources_tools.js";

export const COPILOT_INSTRUCTIONS = [
  "RED is exposed in Microsoft 365 through a federated connector. Data requires companies linked to the verified signed-in Microsoft user. Use search_customers/fetch_customer and other accounting tools for data.",
  "For how-to/support use get_red_help; discover documentation, training and webinars with search_help_resources; fetch_help_resource loads selected details. Help needs no company connection. Do not use accounting tools for how-to questions.",
  "Lists without nextCursor; keep the same query to continue. For searches and get_allocation_candidates/get_allocated_transactions, when nextCursor and complete:false, continue, show more or show remaining results, invoke the SAME RED tool with the exact previous nextCursor, same companyName and same resource identifier/query parameters, including bookTranId and filters. Do not ask the user to manually copy an opaque cursor; do not automatically restart at page one.",
  "Use get_company_management_link to connect, manage or disconnect companies.",
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
    registerCopilotHelp(server);
    registerCopilotCompanyManagement(server);
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
