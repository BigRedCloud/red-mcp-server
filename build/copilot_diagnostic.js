import { registerAllTools } from "./register_all_tools.js";
import { registerCopilotCustomers } from "./copilot_customers.js";
import { registerFindHelpResourcesTool } from "./tools/edu/help_resources_tools.js";
export const COPILOT_INSTRUCTIONS = [
    "RED by Big Red Cloud is exposed in Microsoft 365 through a federated connector.",
    "Use search_customers to search customers in companies linked to the verified signed-in Microsoft user. Use an empty query to list customers.",
    "Start without nextCursor. If a response returns nextCursor, pass it with the same query to continue, even when the current page has no matches.",
    "Use fetch_customer with the exact customerId and companyName from search results to retrieve one customer. Customer IDs are company-scoped.",
    "Accounting query tools require companyName (or companyNames) from your linked companies. Use empty customer search to discover names. Use list filters and pagination before fetching exact records.",
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
        registerAllTools(server, { profile: "full", federatedReadOnly: true });
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
