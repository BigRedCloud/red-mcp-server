import { z } from "zod";
import { clearRedConnectAuditLog, getRedConnectAuditLog, textResponse, } from "../shared.js";
export function registerAuditTools(server) {
    server.tool("brc_list_audit_log", "Show a record of data changes (create, update, delete, batch, quote close/reopen, emails, etc.) made through this Red Connect MCP server session. Read-only API calls are not logged.", {
        includeTechnicalDetails: z
            .boolean()
            .default(false)
            .describe("Only set this to true if the user asks for technical details. Sensitive values are still redacted."),
    }, async ({ includeTechnicalDetails }) => {
        const entries = getRedConnectAuditLog({ includeTechnicalDetails });
        if (entries.length === 0) {
            return textResponse("No company changes have been recorded in this Red Connect session yet.");
        }
        return textResponse(JSON.stringify({
            message: "Here is the Red Connect audit log for this MCP server session.",
            count: entries.length,
            entries,
        }, null, 2));
    });
    server.tool("brc_clear_audit_log", "Clear the Red Connect audit log for this MCP server session.", {
        confirmClear: z
            .boolean()
            .default(false)
            .describe("Must be true to confirm that the session audit log should be cleared."),
    }, async ({ confirmClear }) => {
        if (!confirmClear) {
            return textResponse("Please confirm you want to clear the Red Connect audit log for this session.");
        }
        const clearedCount = clearRedConnectAuditLog();
        return textResponse(`Cleared ${clearedCount} Red Connect audit log entr${clearedCount === 1 ? "y" : "ies"} from this session.`);
    });
}
