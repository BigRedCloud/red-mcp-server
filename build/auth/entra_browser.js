import { createHash, randomBytes } from "node:crypto";
import { decryptCredentialSecret, encryptCredentialSecret } from "./credential_encryption.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./connection_store.js";
import { entraRequestOwner, verifyEntraToken } from "./entra_auth.js";
import { ownerKey } from "./entra_store.js";
import { renderConnectPage } from "./connection_page.js";
import { validateCompanyApiKeyCredential } from "./credential_validation.js";
import { getApiKeyExpirationMs } from "../config/server_config.js";
const COOKIE = "__Host-red-sso";
const random = () => randomBytes(32).toString("base64url");
export function ssoPublicBase() {
    const url = new URL(process.env.RED_ENTRA_PUBLIC_BASE_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
        throw new Error("SSO HTTPS origin is not configured.");
    return url.origin;
}
function headers(res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
}
function cookie(res, value) {
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(encryptCredentialSecret(JSON.stringify(value)))}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=600`);
}
export function openSsoEnvelope(value) {
    // Node's base64 decoder is permissive; reject noncanonical/trailing input.
    const parts = value.split(".");
    if (value.length > 8192 || parts.length !== 3 || parts.some(part => !part || Buffer.from(part, "base64").toString("base64") !== part))
        throw new Error("Invalid SSO state.");
    return decryptCredentialSecret(value);
}
function readCookie(req) {
    const value = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!value)
        throw new Error("Sign-in required.");
    const data = JSON.parse(openSsoEnvelope(decodeURIComponent(value)));
    if (!data.exp || data.exp <= Date.now())
        throw new Error("Sign-in expired.");
    return data;
}
function sameOrigin(req) { if (req.headers.origin !== ssoPublicBase())
    throw new Error("Invalid request origin."); }
function safe(handler) {
    return async (req, res) => { headers(res); try {
        await handler(req, res);
    }
    catch {
        res.status(401).send("Sign-in or connection link is invalid, expired, or already used. Return to Copilot and try again.");
    } };
}
export function registerEntraBrowserRoutes(app) {
    // The fragment is never sent in the HTTP URL or an access log.
    app.get("/connect", (req, res, next) => {
        if (req.query.code !== undefined) {
            next();
            return;
        } // Existing anonymous flow.
        headers(res);
        if (req.query.sso !== "1") {
            res.type("html").send(`<!doctype html><title>Connect RED</title><p>Continue with Microsoft to connect your companies.</p><form method="post" action="/connect/sso/start"><input type="hidden" name="link" id="link"><button>Sign in with Microsoft</button></form><script>document.getElementById('link').value=new URLSearchParams(location.hash.slice(1)).get('sso')||'';history.replaceState(null,'','/connect');</script>`);
            return;
        }
        void safe(async (request, response) => {
            const session = readCookie(request);
            if (session.purpose !== "connected" || !session.owner)
                throw new Error();
            await ensureConnectionStoreInitialized();
            if (!await getConnectionStore().entra.checkLink(session.owner, session.link))
                throw new Error();
            response.type("html").send(renderConnectPage(session.state, { sso: true }));
        })(req, res);
    });
    app.post("/connect/sso/start", safe(async (req, res) => {
        sameOrigin(req);
        const link = req.body.link;
        if (typeof link !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(link))
            throw new Error();
        const client = process.env.RED_ENTRA_WEB_CLIENT_ID;
        if (!client)
            throw new Error();
        const session = { purpose: "oauth", exp: Date.now() + 600_000, link, state: random(), nonce: random(), verifier: random() };
        cookie(res, session);
        const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
        url.search = new URLSearchParams({ client_id: client, response_type: "code", response_mode: "form_post", redirect_uri: `${ssoPublicBase()}/connect/sso/callback`, scope: "openid profile", state: session.state, nonce: session.nonce, code_challenge: createHash("sha256").update(session.verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
        res.redirect(303, url.toString());
    }));
    app.post("/connect/sso/callback", safe(async (req, res) => {
        const session = readCookie(req);
        if (session.purpose !== "oauth" || !session.verifier || !session.nonce || req.body.state !== session.state || typeof req.body.code !== "string")
            throw new Error();
        const client = process.env.RED_ENTRA_WEB_CLIENT_ID, secret = process.env.RED_ENTRA_WEB_CLIENT_SECRET;
        if (!client || !secret)
            throw new Error();
        const response = await fetch("https://login.microsoftonline.com/organizations/oauth2/v2.0/token", {
            method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error",
            body: new URLSearchParams({ grant_type: "authorization_code", client_id: client, client_secret: secret, code: req.body.code, code_verifier: session.verifier, redirect_uri: `${ssoPublicBase()}/connect/sso/callback` }),
        });
        if (!response.ok)
            throw new Error();
        const result = await response.json();
        if (!result.id_token)
            throw new Error();
        const owner = await verifyEntraToken(result.id_token, { audience: client, nonce: session.nonce });
        await ensureConnectionStoreInitialized();
        if (!await getConnectionStore().entra.checkLink(owner, session.link))
            throw new Error();
        cookie(res, { purpose: "connected", exp: session.exp, link: session.link, owner, state: random() });
        res.redirect(303, "/connect?sso=1");
    }));
    app.post("/connect/sso/complete", safe(async (req, res) => {
        sameOrigin(req);
        const session = readCookie(req);
        if (session.purpose !== "connected" || !session.owner || req.body.code !== session.state)
            throw new Error();
        ownerKey(session.owner);
        const names = Array.isArray(req.body.companyName) ? req.body.companyName : [req.body.companyName];
        const keys = Array.isArray(req.body.apiKey) ? req.body.apiKey : [req.body.apiKey];
        if (names.length !== keys.length || names.length > 5)
            throw new Error();
        const companies = [];
        for (let i = 0; i < names.length; i++) {
            if (!names[i] && !keys[i])
                continue;
            if (typeof names[i] !== "string" || typeof keys[i] !== "string" || !names[i].trim() || !keys[i].trim() || names[i].length > 200 || keys[i].length > 4096)
                throw new Error();
            companies.push({ companyName: names[i].trim(), apiKey: keys[i].trim(), expiresAt: Date.now() + getApiKeyExpirationMs(), credentialValidatedAt: Date.now() });
        }
        if (!companies.length)
            throw new Error();
        await ensureConnectionStoreInitialized();
        const store = getConnectionStore().entra;
        if (!await store.checkLink(session.owner, session.link, true))
            throw new Error();
        const validated = [];
        for (const company of companies) {
            const result = await entraRequestOwner.run(session.owner, () => validateCompanyApiKeyCredential(company.companyName, company.apiKey));
            if (result.valid)
                validated.push(company);
        }
        await store.saveCompanies(session.owner, validated);
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0`);
        res.type("html").send(`<title>RED connection</title><p>${validated.length} of ${companies.length} companies connected. Return to Copilot. If any failed, request a new connection link and retry.</p>`);
    }));
}
