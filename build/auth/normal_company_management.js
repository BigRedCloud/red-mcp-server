import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./connection_store.js";
import { getConnectionSuccessPage, buildConnectionSuccessPath } from "./connection_success_session.js";
import { validateAndPersistConnectedCompanies } from "./connection_persistence.js";
import { parseCompanyCsv } from "./company_csv.js";
import { getApiKeyExpirationMs } from "../config/server_config.js";
import { applyConnectionSuccessPageHeaders, renderConnectPage, renderSuccessPage, renderConnectionFailedPage, renderNormalDisconnectConfirmation, } from "./connection_page.js";
const opaque = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
/** Resolve only existing capability records; never accept a browser connection id. */
export async function resolveNormalManagementContext(kind, token) {
    if (!opaque(token) || (kind !== "pending" && kind !== "success"))
        return null;
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    if (kind === "pending") {
        const pending = await store.getPendingConnection(token);
        return pending ? { kind, token, connectionId: pending.connectionId } : null;
    }
    const page = await getConnectionSuccessPage(token);
    if (!page)
        return null;
    const pending = await store.getConnectionByConfirmationCode(page.confirmationCode);
    if (!pending?.used)
        return null;
    return { kind, token, connectionId: pending.connectionId, confirmationCode: page.confirmationCode };
}
function cookieName(req) {
    if (req.secure)
        return "__Host-red-normal-csrf";
    // The non-Secure variant is only for local development/tests, not public HTTP.
    if (["localhost", "127.0.0.1", "[::1]"].includes(req.hostname))
        return "red-normal-csrf";
    throw new Error("Secure connection required.");
}
function nonceFromCookie(req) {
    const name = cookieName(req);
    const value = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
function csrf(nonce, context) {
    return createHmac("sha256", nonce).update(`${context.kind}:${context.token}`).digest("hex");
}
export async function normalManagementView(req, res, context, notice) {
    const nonce = nonceFromCookie(req) ?? randomBytes(32).toString("hex");
    res.append("Set-Cookie", `${cookieName(req)}=${nonce}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${req.secure ? "; Secure" : ""}`);
    const companies = (await getConnectionStore().listConnectedCompanies(context.connectionId)).map(c => c.companyName);
    return { kind: context.kind, token: context.token, csrf: csrf(nonce, context), companies, notice };
}
async function authorised(req) {
    const context = await resolveNormalManagementContext(req.body?.normalContextKind, req.body?.normalContext);
    const nonce = nonceFromCookie(req);
    const submitted = req.body?.normalCsrf;
    if (!context || !nonce || typeof submitted !== "string" || !/^[a-f0-9]{64}$/.test(submitted) ||
        !timingSafeEqual(Buffer.from(submitted, "hex"), Buffer.from(csrf(nonce, context), "hex")))
        throw new Error();
    // Existing success pages use no-referrer, so native POST Origin may be null.
    // CSRF is bound to both the HttpOnly host cookie and the resolved capability.
    if (req.headers["sec-fetch-site"] === "cross-site")
        throw new Error();
    const origin = req.headers.origin;
    if (origin && origin !== "null" && origin !== `${req.protocol}://${req.get("host")}`)
        throw new Error();
    return context;
}
function back(context) {
    return context.kind === "success" ? buildConnectionSuccessPath(context.token) : `/connect?code=${encodeURIComponent(context.token)}`;
}
async function refreshSuccessSnapshot(context) {
    if (context.kind !== "success")
        return;
    const page = await getConnectionSuccessPage(context.token);
    if (!page)
        return;
    const store = getConnectionStore();
    const connectedNames = (await store.listConnectedCompanies(context.connectionId)).map(c => c.companyName);
    const connected = new Set(connectedNames.map(name => name.trim().toLowerCase()));
    const failedCompanies = (await store.listFailedCompanyValidations(context.connectionId))
        .filter(company => !connected.has(company.companyName.trim().toLowerCase()));
    // Preserve the original success-page expiry and confirmation code. After claim,
    // this existing read-only snapshot should reflect the user's final company set.
    await store.saveConnectionSuccessPage({ ...page, connectedNames, failedCompanies });
}
async function result(req, res, context, notice) {
    const view = await normalManagementView(req, res, context, notice);
    res.type("html").send(context.kind === "success"
        ? renderSuccessPage(view.companies, context.confirmationCode, [], view)
        : renderConnectPage(context.token, { management: view }));
}
export function registerNormalCompanyManagementRoutes(app, upload, toStringArray) {
    const safe = (handler) => async (req, res) => {
        applyConnectionSuccessPageHeaders(res);
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("X-Content-Type-Options", "nosniff");
        try {
            await handler(req, res);
        }
        catch {
            res.status(400).type("html").send(renderConnectionFailedPage("This company management request could not be completed. Reopen your current connection page, or ask your chat for a fresh connection link."));
        }
    };
    app.post("/connect/companies", safe(async (req, res) => {
        await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
        const context = await authorised(req);
        // Initial entry still submits once through the original /connect handler.
        if (context.kind !== "success")
            throw new Error();
        const names = toStringArray(req.body.companyName), keys = toStringArray(req.body.apiKey);
        if (!req.file && names.length !== keys.length)
            throw new Error();
        const companies = req.file ? parseCompanyCsv(req.file.buffer) : names.map((companyName, i) => ({ companyName, apiKey: keys[i] }));
        if (!companies.length)
            throw new Error();
        const outcome = await validateAndPersistConnectedCompanies({
            connectionId: context.connectionId, companies, expiresAt: Date.now() + getApiKeyExpirationMs(),
            preserveExistingOnFailure: true,
        });
        await refreshSuccessSnapshot(context);
        // Never mint, replace, extend or consume the confirmation code here.
        await result(req, res, context, outcome.failedCompanies.length
            ? "Some details could not be validated. Existing connected companies have been kept; check the company name and API key before trying again."
            : "Company details saved. Your existing confirmation code is unchanged.");
    }));
    app.post("/connect/companies/disconnect", safe(async (req, res) => {
        const context = await authorised(req);
        const companies = await getConnectionStore().listConnectedCompanies(context.connectionId);
        const name = req.body.companyName;
        if (typeof name !== "string")
            throw new Error();
        const match = companies.find(c => c.companyName.trim().toLowerCase() === name.trim().toLowerCase());
        if (!match)
            throw new Error();
        if (req.body.confirm !== "yes") {
            res.type("html").send(renderNormalDisconnectConfirmation(await normalManagementView(req, res, context), match.companyName));
            return;
        }
        await getConnectionStore().clearConnectedCompany(context.connectionId, match.companyName);
        await refreshSuccessSnapshot(context);
        res.redirect(303, back(context));
    }));
}
