import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFindHelpResourcesTool } from "./tools/edu/help_resources_tools.js";

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

/** Temporary HTTP-only registry. Deliberately bypasses company-aware wrappers. */
export function registerCopilotDiagnosticTools(server: McpServer): void {
  server.registerTool("brc_copilot_connector_status", {
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
