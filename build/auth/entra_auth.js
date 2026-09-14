import { AsyncLocalStorage } from "node:async_hooks";
import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify } from "jose";
export class EntraAuthError extends Error {
    constructor() { super("Microsoft sign-in is required or the token is not valid."); }
}
const csv = (value) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
export function entraConfig() {
    return { tenants: csv(process.env.RED_ENTRA_ALLOWED_TENANTS).map(t => t.toLowerCase()), audiences: csv(process.env.RED_ENTRA_AUDIENCES),
        scope: process.env.RED_ENTRA_REQUIRED_SCOPE?.trim() || "access_as_user", clients: csv(process.env.RED_ENTRA_ALLOWED_CLIENTS) };
}
export function createEntraVerifier(config, fetcher = fetch) {
    const discoveries = new Map();
    return async (token, idToken) => {
        try {
            if (!token || token.length > 16_384 || !config.tenants.length || !config.audiences.length)
                throw new EntraAuthError();
            const unverified = decodeJwt(token);
            const tid = unverified.tid;
            if (typeof tid !== "string" || !/^[0-9a-f-]{36}$/i.test(tid) || !config.tenants.includes(tid.toLowerCase()))
                throw new EntraAuthError();
            const issuer = `https://login.microsoftonline.com/${tid}/v2.0`;
            let discovery = discoveries.get(tid);
            if (!discovery || discovery.until < Date.now()) {
                const response = await fetcher(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
                if (!response.ok)
                    throw new EntraAuthError();
                const metadata = await response.json();
                if (metadata.issuer !== issuer || !metadata.jwks_uri)
                    throw new EntraAuthError();
                const url = new URL(metadata.jwks_uri);
                if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com" || url.username || url.password)
                    throw new EntraAuthError();
                discovery = { until: Date.now() + 3600_000, keys: createRemoteJWKSet(url, { [customFetch]: fetcher, timeoutDuration: 10_000 }) };
                discoveries.set(tid, discovery);
            }
            const { payload } = await jwtVerify(token, discovery.keys, { algorithms: ["RS256"], issuer,
                audience: idToken?.audience ?? config.audiences, requiredClaims: ["exp", "nbf", "iat", "tid", "oid", "sub"], clockTolerance: 0 });
            if (payload.tid !== tid || typeof payload.oid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.oid))
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
            return { tenantId: tid.toLowerCase(), objectId: payload.oid.toLowerCase() };
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
