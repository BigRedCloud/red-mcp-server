import { AsyncLocalStorage } from "node:async_hooks";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
export class EntraAuthError extends Error {
    constructor() { super("Microsoft sign-in is required or the token is not valid."); }
}
const csv = (value) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const ISSUER_TEMPLATE = "https://login.microsoftonline.com/{tenantid}/v2.0";
const ORGANIZATIONS_METADATA = "https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration";
const expectedIssuer = (tenantId) => `https://login.microsoftonline.com/${tenantId}/v2.0`;
const resolvedJwkIssuer = (issuer, tenantId) => issuer.includes("{tenantid}") ? issuer.replaceAll("{tenantid}", tenantId) : issuer;
export function entraConfig() {
    return { audiences: csv(process.env.RED_ENTRA_AUDIENCES),
        scope: process.env.RED_ENTRA_REQUIRED_SCOPE?.trim() || "access_as_user", clients: csv(process.env.RED_ENTRA_ALLOWED_CLIENTS) };
}
export function createEntraVerifier(config, fetcher = fetch) {
    let discovery;
    let refreshing;
    let nextUnknownRefresh = 0;
    const refresh = () => {
        if (refreshing)
            return refreshing;
        refreshing = (async () => {
            const response = await fetcher(ORGANIZATIONS_METADATA, { signal: AbortSignal.timeout(10_000), redirect: "error" });
            if (!response.ok)
                throw new EntraAuthError();
            const metadata = await response.json();
            if (metadata.issuer !== ISSUER_TEMPLATE || !metadata.jwks_uri)
                throw new EntraAuthError();
            const url = new URL(metadata.jwks_uri);
            if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com" || url.username || url.password)
                throw new EntraAuthError();
            const jwksResponse = await fetcher(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
            if (!jwksResponse.ok)
                throw new EntraAuthError();
            const jwks = await jwksResponse.json();
            if (!Array.isArray(jwks.keys))
                throw new EntraAuthError();
            discovery = { until: Date.now() + 3600_000, keys: jwks.keys };
        })().finally(() => { refreshing = undefined; });
        return refreshing;
    };
    return async (token, idToken) => {
        try {
            if (!token || token.length > 16_384 || !config.audiences.length)
                throw new EntraAuthError();
            const unverified = decodeJwt(token);
            const tid = unverified.tid;
            if (typeof tid !== "string" || !TENANT_GUID.test(tid))
                throw new EntraAuthError();
            const tenantId = tid.toLowerCase();
            if (tenantId === CONSUMER_TENANT)
                throw new EntraAuthError();
            const header = decodeProtectedHeader(token);
            if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid)
                throw new EntraAuthError();
            const wasCached = Boolean(discovery && discovery.until >= Date.now());
            if (!wasCached)
                await refresh();
            if (wasCached && !discovery.keys.some(key => key.kid === header.kid)) {
                if (refreshing)
                    await refreshing;
                else if (Date.now() >= nextUnknownRefresh) {
                    nextUnknownRefresh = Date.now() + 30_000;
                    await refresh();
                }
            }
            const matches = discovery.keys.filter(key => key.kid === header.kid && (key.alg === undefined || key.alg === "RS256") && (key.use === undefined || key.use === "sig"));
            if (matches.length !== 1)
                throw new EntraAuthError();
            const published = matches[0];
            if (typeof published.issuer !== "string" || !published.issuer)
                throw new EntraAuthError();
            const issuer = expectedIssuer(tenantId);
            const keyIssuer = resolvedJwkIssuer(published.issuer, tenantId);
            if (keyIssuer !== issuer)
                throw new EntraAuthError();
            const signing = { ...published };
            delete signing.issuer;
            const key = await importJWK(signing, "RS256");
            const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"], issuer,
                audience: idToken?.audience ?? config.audiences, requiredClaims: ["exp", "nbf", "iat", "tid", "oid", "sub"], clockTolerance: 0 });
            if (payload.iss !== keyIssuer || typeof payload.tid !== "string" || payload.tid.toLowerCase() !== tenantId)
                throw new EntraAuthError();
            if (typeof payload.oid !== "string" || !TENANT_GUID.test(payload.oid))
                throw new EntraAuthError();
            if (idToken) {
                if (!idToken.nonce || payload.nonce !== idToken.nonce)
                    throw new EntraAuthError();
            }
            else {
                if (payload.idtyp === "app" || typeof payload.scp !== "string" || !payload.scp.split(" ").includes(config.scope))
                    throw new EntraAuthError();
                if (config.clients.length && (typeof payload.azp !== "string" || !config.clients.includes(payload.azp)))
                    throw new EntraAuthError();
            }
            return { tenantId, objectId: payload.oid.toLowerCase() };
        }
        catch {
            throw new EntraAuthError();
        }
    };
}
let cached;
export function verifyEntraToken(token, idToken) {
    const config = entraConfig(), key = JSON.stringify(config);
    if (!cached || cached.config !== key)
        cached = { config: key, verify: createEntraVerifier(config) };
    return cached.verify(token, idToken);
}
export async function verifyEntraAuthorization(header) {
    if (typeof header !== "string" || !/^Bearer [^\s]+$/i.test(header))
        throw new EntraAuthError();
    return verifyEntraToken(header.slice(7));
}
export const entraRequestOwner = new AsyncLocalStorage();
