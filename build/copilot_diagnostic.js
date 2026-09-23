import { registerCopilotAccountingFacade } from "./copilot_facade.js";
import { registerCopilotCustomers } from "./copilot_customers.js";
import { registerFindHelpResourcesTool } from "./tools/edu/help_resources_tools.js";
export const COPILOT_INSTRUCTIONS = [
    "RED by Big Red Cloud is exposed in Microsoft 365 through a federated connector. Query companies linked to the verified signed-in Microsoft user.",
    "Use search_customers or other searches; empty query lists records. Fetch with fetch_customer or other fetch tools using exact IDs and companyName from results. Use get_financial_year for period dates. IDs are company-scoped. Omit companyName to search linked companies.",
    "Start new lists without nextCursor. Keep the same query to continue, even after empty pages.",
    "For search tools and get_allocation_candidates/get_allocated_transactions: when a response has nextCursor and complete:false and the user asks to continue, show more or show remaining results, invoke the SAME RED tool with the exact previous nextCursor, same companyName and same resource identifier/query parameters, including bookTranId and filters. Do not ask the user to manually copy an opaque cursor. Omit nextCursor only for a new list; do not automatically restart at page one.",
].join("\n");
export const COPILOT_DIAGNOSTIC_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};
export const COPILOT_DIAGNOSTIC_STATUS = {
    status: "ok",
    service: "RED by Big Red Cloud",
    profile: "copilot-diagnostic",
    message: "Microsoft 365 Copilot successfully invoked the RED MCP server.",
};
/** HTTP federated profile; legacy diagnostic mode is retained for local diagnostics. */
export function registerCopilotDiagnosticTools(server, authenticated = false) {
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
    const publicHelpServer = Object.create(server);
    publicHelpServer.tool = ((name, description, inputSchema, handler) => {
        if (name !== "brc_find_help_resources")
            throw new Error("Unexpected diagnostic tool");
        return server.registerTool(name, {
            title: "Find Help Resources",
            description,
            inputSchema,
            annotations: COPILOT_DIAGNOSTIC_ANNOTATIONS,
        }, handler);
    });
    registerFindHelpResourcesTool(publicHelpServer);
}
