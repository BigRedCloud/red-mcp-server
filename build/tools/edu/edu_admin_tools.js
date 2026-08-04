import { buildOpenEduAdminToolPayload, getBrcEduAdminProtectedPath, getBrcEduAdminPublicUrl, } from "../../edu/brc_edu_admin_auth.js";
import { jsonResponse } from "../../shared.js";
export const OPEN_EDU_ADMIN_TOOL_DESCRIPTION = [
    "Return the protected URL for Red's content administration page (Freshdesk articles, YouTube videos, and visibility controls).",
    "Use when a Big Red Book / Big Red Cloud staff member asks to open Red's admin page, the BRC Edu admin page, or the content resources admin.",
    "Returns only the customer-facing protected admin URL — never a shared secret, query parameter, token, or bypass link.",
    "Opening the link still requires Microsoft Entra sign-in; only authorised staff can access the page.",
    "Does not bypass authentication. Does not require a connected company.",
    "Do not invent or append secret query parameters. Do not expose BRC_EDU_ADMIN_UPLOAD_SECRET or any upload secret.",
].join(" ");
export function registerEduAdminTools(server) {
    server.tool("brc_open_edu_admin", OPEN_EDU_ADMIN_TOOL_DESCRIPTION, async () => {
        const payload = buildOpenEduAdminToolPayload();
        return jsonResponse({
            adminUrl: payload.adminUrl,
            protectedPath: payload.protectedPath,
            message: payload.message,
            // Explicit fields for hosts that prefer Markdown links.
            customerFacingMarkdown: `[Open Red's BRC Edu admin page](${payload.adminUrl})`,
        });
    });
}
export function getEduAdminToolUrlForTests() {
    return {
        adminUrl: getBrcEduAdminPublicUrl(),
        protectedPath: getBrcEduAdminProtectedPath(),
    };
}
