import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  clearRedAuditLog,
  getRedAuditLog,
  RED_ACTIVITY_SCOPE_INSTRUCTION,
  textResponse,
} from "../shared.js";

export function registerAuditTools(server: McpServer) {
  server.tool(
    "brc_list_audit_log",
    `Show a record of data changes (create, update, delete, batch, quote close/reopen, emails, etc.) made through this Red MCP server session. Read-only API calls are not logged. Use this as the source of truth for "what did I do today in Red?" style questions. ${RED_ACTIVITY_SCOPE_INSTRUCTION}`,
    {
      includeTechnicalDetails: z
        .boolean()
        .default(false)
        .describe("Only set this to true if the user asks for technical details. Sensitive values are still redacted."),
    },
    async ({ includeTechnicalDetails }) => {
      const entries = getRedAuditLog({ includeTechnicalDetails });

      if (entries.length === 0) {
        return textResponse(
          "No company changes have been recorded in this Red session yet."
        );
      }

      return textResponse(
        JSON.stringify(
          {
            message: "Here is the Red audit log for this MCP server session.",
            count: entries.length,
            entries,
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "brc_clear_audit_log",
    "Clear the Red audit log for this MCP server session.",
    {
      confirmClear: z
        .boolean()
        .default(false)
        .describe("Must be true to confirm that the session audit log should be cleared."),
    },
    async ({ confirmClear }) => {
      if (!confirmClear) {
        return textResponse(
          "Please confirm you want to clear the Red audit log for this session."
        );
      }

      const clearedCount = clearRedAuditLog();

      return textResponse(
        `Cleared ${clearedCount} Red audit log entr${
          clearedCount === 1 ? "y" : "ies"
        } from this session.`
      );
    }
  );
}