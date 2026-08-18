import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildRedSupportReport,
  supportReportMcpResponse,
} from "../audit/support_report.js";
import {
  clearRedAuditLog,
  companyNameSchema,
  ensureCredentialsForCurrentSession,
  getRedAuditLog,
  listConnectedCompanyNames,
  normaliseCompanyName,
  RED_ACTIVITY_SCOPE_INSTRUCTION,
  textResponse,
} from "../shared.js";

export function registerAuditTools(server: McpServer) {
  server.tool(
    "brc_list_audit_log",
    `Show a record of data changes (create, update, delete, batch, quote close/reopen, emails, etc.) made through this Red MCP server session. Read-only API calls are not logged. Use this as the source of truth for "what did I do today in Red?" style questions. Show only this simple activity summary in chat. After showing it, also prepare a downloadable support diagnostic with brc_generate_support_report — do not paste technical diagnostic fields into the chat summary. ${RED_ACTIVITY_SCOPE_INSTRUCTION}`,
    {
      includeTechnicalDetails: z
        .boolean()
        .default(false)
        .describe("Only set this to true if the user asks for technical details. Sensitive values are still redacted."),
    },
    async ({ includeTechnicalDetails }) => {
      await ensureCredentialsForCurrentSession();
      const connectedCompanyNames = listConnectedCompanyNames();

      if (connectedCompanyNames.length === 0) {
        return textResponse(
          "No companies are currently connected in this Red session. Connect a company before viewing Red activity."
        );
      }

      const entries = getRedAuditLog({
        includeTechnicalDetails,
        connectedCompanyNames,
        toolName: "brc_list_audit_log",
      });

      if (entries.length === 0) {
        return textResponse(
          "No company changes have been recorded for the currently connected companies in this Red session. I can only see Red activity for this current session/connection and for companies currently connected. For broader history, check Big Red Cloud directly."
        );
      }

      return textResponse(
        JSON.stringify(
          {
            message:
              "Here is the Red audit log for this MCP server session, scoped to the current session/connection and currently connected companies only.",
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
    "brc_generate_support_report",
    "Prepare a downloadable plain-text Red support diagnostic report for one currently connected company in this session. Read-only — does not write to Big Red Cloud. Use after showing the simple audit summary. Do not paste the full report into the chat summary unless the user's client cannot attach or download the file. Secrets, credentials, tokens, and connection references are excluded.",
    {
      companyName: companyNameSchema.describe(
        "Currently connected company to include in the diagnostic report."
      ),
    },
    async ({ companyName }) => {
      await ensureCredentialsForCurrentSession();
      const connectedCompanyNames = listConnectedCompanyNames();
      const matched = connectedCompanyNames.filter(
        (name) => normaliseCompanyName(name) === normaliseCompanyName(companyName)
      );

      if (matched.length === 0) {
        return textResponse(
          connectedCompanyNames.length === 0
            ? "No companies are currently connected in this Red session. Connect a company before preparing a support diagnostic report."
            : "That company is not connected in this Red session. A support diagnostic can only include a currently connected company."
        );
      }

      const scopedName = matched[0]!;
      const entries = getRedAuditLog({
        includeTechnicalDetails: true,
        connectedCompanyNames: [scopedName],
        toolName: "brc_generate_support_report",
      });

      const report = buildRedSupportReport({
        companyName: scopedName,
        entries,
      });

      return supportReportMcpResponse(report);
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
