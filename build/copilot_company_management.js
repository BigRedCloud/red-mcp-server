import { z } from "zod";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./auth/connection_store.js";
import { ssoPublicBase } from "./auth/entra_browser.js";
export const COMPANY_MANAGEMENT_TOOL = "get_company_management_link";
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const response = (data, isError = false) => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
});
export const COMPANY_MANAGEMENT_DESCRIPTION = "Return the secure RED page where the signed-in Microsoft user can connect, update, or disconnect Big Red Cloud companies. Use for connect my RED companies, connect another company, add a company, reconnect a company, manage my connected companies, disconnect Company B, remove a company, change my RED API key, or update company connections. This tool does not connect, update, or disconnect anything. The user must open the returned page. Never ask for an API key in chat.";
/** Read-only navigation. Credential changes happen only after a separate browser sign-in. */
export async function getCompanyManagementLink() {
    const owner = entraRequestOwner.getStore();
    if (!owner)
        return response({ status: "authentication_required", message: "Sign in with Microsoft to manage your RED companies." }, true);
    try {
        await ensureConnectionStoreInitialized();
        const names = (await getConnectionStore().entra.listCompanies(owner)).map(company => company.companyName);
        return response({
            status: "ok",
            managementUrl: `${ssoPublicBase()}/manage-companies`,
            message: "Open the RED company management page to connect, update, or disconnect your Big Red Cloud companies.",
            connectedCompanies: names,
        });
    }
    catch {
        return response({ status: "service_unavailable", message: "Company management is unavailable. Please try again." }, true);
    }
}
export function registerCopilotCompanyManagement(server) {
    server.registerTool(COMPANY_MANAGEMENT_TOOL, {
        title: "Get RED company management link",
        description: COMPANY_MANAGEMENT_DESCRIPTION,
        annotations,
        inputSchema: z.object({}).strict(),
    }, () => getCompanyManagementLink());
}
