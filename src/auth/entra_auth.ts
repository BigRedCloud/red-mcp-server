import { AsyncLocalStorage } from "node:async_hooks";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import type { EntraOwner } from "./entra_store.js";

export class EntraAuthError extends Error {
  constructor() { super("Microsoft sign-in is required or the token is not valid."); }
}
export type EntraConfig = { audiences: string[]; scope: string; clients: string[] };
const csv = (value?: string) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const ISSUER_TEMPLATE = "https://login.microsoftonline.com/{tenantid}/v2.0";
const ORGANIZATIONS_METADATA = "https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration";
type PublishedJwk = JWK & { issuer?: unknown };
const expectedIssuer = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`;
const resolvedJwkIssuer = (issuer: string, tenantId: string) =>
  issuer.includes("{tenantid}") ? issuer.replaceAll("{tenantid}", tenantId) : issuer;

export function entraConfig(): EntraConfig {
  return { audiences: csv(process.env.RED_ENTRA_AUDIENCES),
    scope: process.env.RED_ENTRA_REQUIRED_SCOPE?.trim() || "access_as_user", clients: csv(process.env.RED_ENTRA_ALLOWED_CLIENTS) };
}
export function createEntraVerifier(config: EntraConfig, fetcher: typeof fetch = fetch) {
  let discovery: { until: number; keys: PublishedJwk[] } | undefined;
  return async (token: string, idToken?: { audience: string; nonce: string }): Promise<EntraOwner> => {
    try {
      if (!token || token.length > 16_384 || !config.audiences.length) throw new EntraAuthError();
      const unverified = decodeJwt(token);
      const tid = unverified.tid;
      if (typeof tid !== "string" || !TENANT_GUID.test(tid)) throw new EntraAuthError();
      const tenantId = tid.toLowerCase();
      if (tenantId === CONSUMER_TENANT) throw new EntraAuthError();
      const header = decodeProtectedHeader(token);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) throw new EntraAuthError();
      if (!discovery || discovery.until < Date.now()) {
        const response = await fetcher(ORGANIZATIONS_METADATA, { signal: AbortSignal.timeout(10_000), redirect: "error" });
        if (!response.ok) throw new EntraAuthError();
        const metadata = await response.json() as { issuer?: string; jwks_uri?: string };
        if (metadata.issuer !== ISSUER_TEMPLATE || !metadata.jwks_uri) throw new EntraAuthError();
        const url = new URL(metadata.jwks_uri);
        if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com" || url.username || url.password) throw new EntraAuthError();
        const jwksResponse = await fetcher(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
        if (!jwksResponse.ok) throw new EntraAuthError();
        const jwks = await jwksResponse.json() as { keys?: PublishedJwk[] };
        if (!Array.isArray(jwks.keys)) throw new EntraAuthError();
        discovery = { until: Date.now() + 3600_000, keys: jwks.keys };
      }
      const matches = discovery.keys.filter(key => key.kid === header.kid && (key.alg === undefined || key.alg === "RS256") && (key.use === undefined || key.use === "sig"));
      if (matches.length !== 1) throw new EntraAuthError();
      const published = matches[0];
      if (typeof published.issuer !== "string" || !published.issuer) throw new EntraAuthError();
      const issuer = expectedIssuer(tenantId);
      const keyIssuer = resolvedJwkIssuer(published.issuer, tenantId);
      if (keyIssuer !== issuer) throw new EntraAuthError();
      const signing = { ...published } as PublishedJwk;
      delete signing.issuer;
      const key = await importJWK(signing, "RS256");
      const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"], issuer,
        audience: idToken?.audience ?? config.audiences, requiredClaims: ["exp","nbf","iat","tid","oid","sub"], clockTolerance: 0 });
      if (payload.iss !== keyIssuer || typeof payload.tid !== "string" || payload.tid.toLowerCase() !== tenantId) throw new EntraAuthError();
      if (typeof payload.oid !== "string" || !TENANT_GUID.test(payload.oid)) throw new EntraAuthError();
      if (idToken) {
        if (!idToken.nonce || payload.nonce !== idToken.nonce) throw new EntraAuthError();
      } else {
        if (payload.idtyp === "app" || typeof payload.scp !== "string" || !payload.scp.split(" ").includes(config.scope)) throw new EntraAuthError();
        if (config.clients.length && (typeof payload.azp !== "string" || !config.clients.includes(payload.azp))) throw new EntraAuthError();
      }
      return { tenantId, objectId: payload.oid.toLowerCase() };
    } catch { throw new EntraAuthError(); }
  };
}
let cached: {config: string; verify: ReturnType<typeof createEntraVerifier>} | undefined;
export function verifyEntraToken(token: string, idToken?: {audience: string; nonce: string}) {
  const config = entraConfig(), key = JSON.stringify(config);
  if (!cached || cached.config !== key) cached = { config: key, verify: createEntraVerifier(config) };
  return cached.verify(token, idToken);
}
export async function verifyEntraAuthorization(header: unknown): Promise<EntraOwner> {
  if (typeof header !== "string" || !/^Bearer [^\s]+$/i.test(header)) throw new EntraAuthError();
  return verifyEntraToken(header.slice(7));
}
export const entraRequestOwner = new AsyncLocalStorage<EntraOwner>();
