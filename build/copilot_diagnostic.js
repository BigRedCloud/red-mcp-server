import { registerCopilotCustomers } from "./copilot_customers.js";
import { registerFindHelpResourcesTool } from "./tools/edu/help_resources_tools.js";
export const COPILOT_INSTRUCTIONS = [
    "RED by Big Red Cloud is exposed in Microsoft 365 as the Red For Excel federated source.",
    "Use brc_copilot_connector_status to check whether Microsoft 365 Copilot can reach RED. No BRC company connection is required.",
    "Use brc_copilot_list_all_customers to retrieve Big Red Cloud customers for companies linked to the verified signed-in Microsoft user.",
    "Start the customer tool without a cursor. If it returns nextCursor, pass that value as cursor to continue.",
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
/** Temporary HTTP-only registry. Deliberately bypasses company-aware wrappers. */
export function registerCopilotDiagnosticTools(server, authenticated = false) {
    server.registerTool("brc_copilot_connector_status", {
        title: "Check RED connectivity",
        description: "Check Microsoft 365 Copilot connectivity to RED. No company connection required.",
        inputSchema: {},
        annotations: COPILOT_DIAGNOSTIC_ANNOTATIONS,
    }, async () => ({
        content: [{ type: "text", text: JSON.stringify(COPILOT_DIAGNOSTIC_STATUS) }],
        structuredContent: { ...COPILOT_DIAGNOSTIC_STATUS },
    }));
    if (authenticated) {
        registerCopilotCustomers(server);
        return;
    }
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
