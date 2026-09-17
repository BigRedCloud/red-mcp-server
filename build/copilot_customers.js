import { createHash } from "node:crypto";
import { z } from "zod";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { ownerKey } from "./auth/entra_store.js";
import { getConnectionStore, ensureConnectionStoreInitialized } from "./auth/connection_store.js";
import { encryptCredentialSecret } from "./auth/credential_encryption.js";
import { decodeStoredApiKey } from "./auth/credential_secret.js";
import { openSsoEnvelope, ssoPublicBase } from "./auth/entra_browser.js";
import { runWithSessionKeyStore } from "./shared.js";
import { listBrcCustomers } from "./tools/general/list_tools.js";
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const response = (data, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, ...(isError ? { isError: true } : {}) });
const fields = new Set(["id", "customerid", "code", "customercode", "name", "customername", "email", "emailaddress", "telephone", "phone", "address1", "address2", "address3", "address4", "postcode", "country", "contact", "contactname", "balance", "dormant", "isdormant"]);
export async function listCopilotCustomers(args) {
    const owner = entraRequestOwner.getStore();
    if (!owner)
        return response({ status: "authentication_required", message: "Sign in with Microsoft to list your customers." }, true);
    try {
        await ensureConnectionStoreInitialized();
        const store = getConnectionStore().entra;
        const companies = await store.listCompanies(owner);
        if (!companies.length) {
            const base = ssoPublicBase();
            const request = await store.createPendingRequest(owner);
            return response({ status: "connection_required", message: "Connect your Big Red Cloud companies securely using your Microsoft sign-in. Enter credentials only on the connection page.", connectionUrl: `${base}/connect?request=${request}` });
        }
        const snapshot = createHash("sha256").update(JSON.stringify(companies.map(c => [c.companyName, c.updatedAt]))).digest("hex");
        let cursor = { owner: ownerKey(owner), snapshot, index: 0, page: 1, pageSize: args.pageSize ?? 20, exp: Date.now() + 600_000 };
        if (args.cursor) {
            try {
                cursor = JSON.parse(openSsoEnvelope(args.cursor));
            }
            catch {
                return response({ status: "invalid_cursor", message: "Restart the customer list." }, true);
            }
            if (cursor.owner !== ownerKey(owner) || cursor.snapshot !== snapshot || cursor.exp <= Date.now() || !Number.isInteger(cursor.index) || cursor.index < 0 || cursor.index >= companies.length || !Number.isInteger(cursor.page) || cursor.page < 1 || !Number.isInteger(cursor.pageSize) || cursor.pageSize < 1 || cursor.pageSize > 50 || (args.pageSize !== undefined && args.pageSize !== cursor.pageSize))
                return response({ status: "invalid_cursor", message: "Restart the customer list." }, true);
        }
        if (cursor.pageSize < 1 || cursor.pageSize > 50)
            return response({ status: "invalid_request" }, true);
        const secrets = [owner.tenantId, owner.objectId, ...companies.flatMap(c => { const key = decodeStoredApiKey(c.encryptedSecret); return [key, Buffer.from(`${key}:`).toString("base64")]; })];
        const clean = (value) => { let s = value; for (const secret of secrets)
            if (secret)
                s = s.split(secret).join("[redacted]"); return s.replace(/Bearer\s+\S+/gi, "[redacted]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]"); };
        const groups = [];
        // At most three BRC pages per invocation; cursor retains the next company/page.
        for (let requests = 0; requests < 3 && cursor.index < companies.length; requests++) {
            const company = companies[cursor.index];
            const group = { companyName: clean(company.companyName), page: cursor.page, pageSize: cursor.pageSize };
            try {
                const contexts = new Map([[company.companyName.toLowerCase(), { companyName: company.companyName, apiKey: decodeStoredApiKey(company.encryptedSecret), expiresAt: company.expiresAt }]]);
                const data = await runWithSessionKeyStore(contexts, () => listBrcCustomers(company.companyName, cursor.page, cursor.pageSize));
                const obj = data;
                const items = Array.isArray(data) ? data : obj?.Items ?? obj?.items;
                if (!Array.isArray(items) || items.length > cursor.pageSize)
                    throw new Error("Unsupported customer response.");
                const safeItems = items.map(item => {
                    if (!item || typeof item !== "object")
                        throw new Error();
                    const row = {};
                    for (const [key, value] of Object.entries(item))
                        if (fields.has(key.toLowerCase())) {
                            if (typeof value === "string") {
                                if (value.length > 4000)
                                    throw new Error();
                                row[key] = clean(value);
                            }
                            else if (value === null || typeof value === "boolean" || typeof value === "number")
                                row[key] = value;
                        }
                    return row;
                });
                if (Buffer.byteLength(JSON.stringify(safeItems)) > 128_000)
                    throw new Error("Customer page is too large.");
                Object.assign(group, { status: "ok", customers: safeItems });
                // A full page always warrants a next-page check, independent of Count semantics.
                if (items.length === cursor.pageSize)
                    cursor.page++;
                else {
                    cursor.index++;
                    cursor.page = 1;
                }
            }
            catch {
                Object.assign(group, { status: "company_unavailable", message: "Could not list this company's customers. Retry this company by restarting the list.", customers: [] });
                cursor.index++;
                cursor.page = 1;
            }
            groups.push(group);
        }
        const nextCursor = cursor.index < companies.length ? encryptCredentialSecret(JSON.stringify(cursor)) : undefined;
        return response({ status: groups.some(g => g.status !== "ok") ? "partial_failure" : "ok", companies: groups, ...(nextCursor ? { nextCursor } : {}), complete: !nextCursor });
    }
    catch {
        return response({ status: "service_unavailable", message: "Customer listing is unavailable. Please try again." }, true);
    }
}
export function registerCopilotCustomers(server) {
    server.registerTool("brc_copilot_list_all_customers", { title: "List Big Red Cloud customers", description: "List customers across companies linked to your Microsoft sign-in. Returns bounded pages grouped by company; pass nextCursor to continue.", annotations, inputSchema: z.object({ cursor: z.string().max(4096).optional(), pageSize: z.number().int().min(1).max(50).optional() }).strict() }, listCopilotCustomers);
}
