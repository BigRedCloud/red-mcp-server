import { getRedPublicBaseUrl } from "../config/red_public_base_url.js";
import { validateBrcEduAdminUploadSecret } from "./brc_edu_upload_store.js";
export const BRC_EDU_ADMIN_DEFAULT_PROTECTED_PATH = "/internal/brc-edu/resources/upload";
export const BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE = "This area is available only to authorised Big Red Cloud staff.";
export const EASY_AUTH_CLIENT_PRINCIPAL_HEADER = "x-ms-client-principal";
export const EASY_AUTH_CLIENT_PRINCIPAL_NAME_HEADER = "x-ms-client-principal-name";
const TENANT_CLAIM_TYPES = [
    "http://schemas.microsoft.com/identity/claims/tenantid",
    "tid",
];
const GROUP_CLAIM_TYPES = [
    "groups",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
];
const ROLE_CLAIM_TYPES = [
    "roles",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
];
const IDENTITY_CLAIM_TYPES = [
    "preferred_username",
    "emails",
    "email",
    "upn",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    "name",
    "oid",
    "http://schemas.microsoft.com/identity/claims/objectidentifier",
];
export function getBrcEduAdminProtectedPath() {
    const configured = process.env.BRC_EDU_ADMIN_PROTECTED_PATH?.trim();
    if (!configured) {
        return BRC_EDU_ADMIN_DEFAULT_PROTECTED_PATH;
    }
    return configured.startsWith("/") ? configured : `/${configured}`;
}
/**
 * Customer-facing absolute URL for the protected BRC Edu admin page.
 * Prefer BRC_EDU_ADMIN_PUBLIC_URL; otherwise derive from the Red public base URL.
 */
export function getBrcEduAdminPublicUrl() {
    const configured = process.env.BRC_EDU_ADMIN_PUBLIC_URL?.trim();
    if (configured) {
        return configured.replace(/\/$/, "");
    }
    const base = getRedPublicBaseUrl().replace(/\/$/, "");
    return `${base}${getBrcEduAdminProtectedPath()}`;
}
export function getBrcEduAdminEntraConfig() {
    const tenantId = process.env.BRC_EDU_ADMIN_ENTRA_TENANT_ID?.trim() ?? "";
    const groupId = process.env.BRC_EDU_ADMIN_ENTRA_GROUP_ID?.trim() || null;
    const appRole = process.env.BRC_EDU_ADMIN_ENTRA_APP_ROLE?.trim() || null;
    if (!tenantId) {
        return null;
    }
    if (!groupId && !appRole) {
        return null;
    }
    return { tenantId, groupId, appRole };
}
export function isBrcEduAdminEntraConfigured() {
    return getBrcEduAdminEntraConfig() !== null;
}
export function isBrcEduAdminSecretFallbackEnabled() {
    const raw = process.env.BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK?.trim().toLowerCase();
    if (raw === "false" || raw === "0" || raw === "no") {
        return false;
    }
    // Emergency fallback remains available unless explicitly disabled.
    return true;
}
function headerValue(headers, name) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0] : undefined;
    }
    return typeof value === "string" ? value : undefined;
}
export function parseEasyAuthClientPrincipal(encoded) {
    const trimmed = encoded?.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const json = Buffer.from(trimmed, "base64").toString("utf8");
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function claimValues(principal, claimTypes) {
    const types = new Set(claimTypes.map((type) => type.toLowerCase()));
    const values = [];
    for (const claim of principal.claims ?? []) {
        if (!claim?.typ || claim.val === undefined || claim.val === null) {
            continue;
        }
        if (!types.has(String(claim.typ).toLowerCase())) {
            continue;
        }
        const value = String(claim.val).trim();
        if (value) {
            values.push(value);
        }
    }
    return values;
}
export function resolveEasyAuthIdentity(principal, principalNameHeader) {
    const fromHeader = principalNameHeader?.trim();
    if (fromHeader) {
        return fromHeader;
    }
    if (!principal) {
        return null;
    }
    for (const claimType of IDENTITY_CLAIM_TYPES) {
        const values = claimValues(principal, [claimType]);
        if (values[0]) {
            return values[0];
        }
    }
    return null;
}
export function getEasyAuthPrincipalFromHeaders(headers) {
    const encoded = headerValue(headers, EASY_AUTH_CLIENT_PRINCIPAL_HEADER);
    const principal = parseEasyAuthClientPrincipal(encoded);
    const nameHeader = headerValue(headers, EASY_AUTH_CLIENT_PRINCIPAL_NAME_HEADER);
    const identity = resolveEasyAuthIdentity(principal, nameHeader);
    return { principal, identity };
}
export function buildEasyAuthLoginRedirectUrl(returnPath) {
    const normalized = returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
    return `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(normalized)}`;
}
export function evaluateEntraStaffAccess(principal, config) {
    const tenantIds = claimValues(principal, TENANT_CLAIM_TYPES);
    const tenantOk = tenantIds.some((tenantId) => tenantId.toLowerCase() === config.tenantId.toLowerCase());
    if (!tenantOk) {
        // Some Easy Auth payloads omit tid; fall back to issuer when present.
        const issuers = claimValues(principal, ["iss"]);
        const issuerOk = issuers.some((issuer) => issuer.toLowerCase().includes(config.tenantId.toLowerCase()));
        if (!issuerOk) {
            return { allowed: false, reason: "wrong_tenant" };
        }
    }
    if (config.groupId) {
        const groups = claimValues(principal, GROUP_CLAIM_TYPES);
        if (groups.some((groupId) => groupId.toLowerCase() === config.groupId.toLowerCase())) {
            return { allowed: true, reason: "ok" };
        }
    }
    if (config.appRole) {
        const roles = claimValues(principal, ROLE_CLAIM_TYPES);
        if (roles.some((role) => role.toLowerCase() === config.appRole.toLowerCase())) {
            return { allowed: true, reason: "ok" };
        }
    }
    return { allowed: false, reason: "not_authorised" };
}
export function logBrcEduAdminAccess(entry) {
    const at = new Date().toISOString();
    const identity = entry.identity?.trim() || "anonymous";
    const method = entry.method ?? "none";
    const statusPart = entry.status !== undefined ? ` status=${entry.status}` : "";
    console.info(`BRC Edu admin access: identity=${identity} method=${method} result=${entry.result} at=${at}${statusPart}`);
}
/**
 * Authorise BRC Edu admin routes using Azure App Service Easy Auth (Entra)
 * as the primary path, with the shared upload secret as an emergency fallback.
 */
export function authorizeBrcEduAdminRequest(input) {
    const entraConfig = getBrcEduAdminEntraConfig();
    const { principal, identity } = getEasyAuthPrincipalFromHeaders(input.headers);
    const returnPath = input.returnPath?.trim() || getBrcEduAdminProtectedPath();
    if (principal) {
        if (!entraConfig) {
            logBrcEduAdminAccess({
                identity,
                result: "denied",
                method: "entra",
                status: 503,
            });
            return {
                ok: false,
                status: 503,
                error: "BRC Edu admin Microsoft Entra access is not configured.",
                identity,
            };
        }
        const evaluation = evaluateEntraStaffAccess(principal, entraConfig);
        if (evaluation.allowed) {
            const resolvedIdentity = identity || "entra-authenticated-staff";
            logBrcEduAdminAccess({
                identity: resolvedIdentity,
                result: "allowed",
                method: "entra",
                status: 200,
            });
            return {
                ok: true,
                method: "entra",
                identity: resolvedIdentity,
            };
        }
        logBrcEduAdminAccess({
            identity,
            result: "denied",
            method: "entra",
            status: 403,
        });
        return {
            ok: false,
            status: 403,
            error: BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE,
            identity,
        };
    }
    if (isBrcEduAdminSecretFallbackEnabled()) {
        const secretResult = validateBrcEduAdminUploadSecret(input.providedSecret);
        if (secretResult.ok) {
            logBrcEduAdminAccess({
                identity: "secret-fallback",
                result: "allowed",
                method: "secret",
                status: 200,
            });
            return {
                ok: true,
                method: "secret",
                identity: "secret-fallback",
            };
        }
        // When Entra is configured, missing/wrong secret means "sign in", not a
        // secret-configuration 503 — prefer the login redirect for unauthenticated users.
        if (!entraConfig && !secretResult.ok) {
            logBrcEduAdminAccess({
                identity: null,
                result: secretResult.status === 503 ? "unconfigured" : "denied",
                method: "secret",
                status: secretResult.status,
            });
            return {
                ok: false,
                status: secretResult.status,
                error: secretResult.error,
                identity: null,
            };
        }
    }
    else if (!entraConfig) {
        logBrcEduAdminAccess({
            identity: null,
            result: "unconfigured",
            method: "none",
            status: 503,
        });
        return {
            ok: false,
            status: 503,
            error: "BRC Edu admin access is not configured.",
            identity: null,
        };
    }
    if (entraConfig) {
        const loginUrl = buildEasyAuthLoginRedirectUrl(returnPath);
        logBrcEduAdminAccess({
            identity: null,
            result: "redirect_login",
            method: "none",
            status: 302,
        });
        return {
            ok: false,
            status: 401,
            error: "Authentication required.",
            identity: null,
            redirectToLogin: loginUrl,
        };
    }
    logBrcEduAdminAccess({
        identity: null,
        result: "denied",
        method: "none",
        status: 401,
    });
    return {
        ok: false,
        status: 401,
        error: "Unauthorized.",
        identity: null,
    };
}
/**
 * Build the MCP payload for brc_open_edu_admin.
 * Never includes BRC_EDU_ADMIN_UPLOAD_SECRET or query parameters.
 */
export function buildOpenEduAdminToolPayload() {
    const adminUrl = getBrcEduAdminPublicUrl();
    const protectedPath = getBrcEduAdminProtectedPath();
    return {
        adminUrl,
        protectedPath,
        message: "Open this link to reach Red's BRC Edu admin page. Microsoft sign-in is required; only authorised Big Red Cloud staff can access it.",
    };
}
