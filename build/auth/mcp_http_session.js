import { createHash } from "node:crypto";
import { ensureConnectionStoreInitialized, resolveConnectionIdForActiveSessionWithMeta, runWithMcpSessionContext, } from "./connection_store.js";
import { ensureCredentialsForCurrentSession, normaliseCompanyName, resolveSessionKeyStore, runWithActiveConnectionRef, runWithHttpClientKey, runWithHttpRequestSessionId, runWithSessionKeyStore, } from "../shared.js";
import { extractConnectionRefFromToolArgs, prefixConnectionRef, } from "./connection_ref.js";
import { runWithRedTelemetryContext } from "../telemetry/identity.js";
import { loadConnectionTelemetryContext } from "../telemetry/context.js";
import { detectClientPlatform, resolveRedTelemetryEnvironment, } from "../telemetry/platform.js";
export const MCP_SESSION_HEADER_NAMES = [
    "mcp-session-id",
    "x-mcp-session-id",
];
/** Non-secret headers that may identify a stable hosted MCP client instance. */
export const MCP_CLIENT_IDENTITY_HEADER_NAMES = [
    "authorization",
    "x-client-id",
    "x-instance-id",
    "x-user-id",
    "x-mistral-user-id",
    "x-lechat-user-id",
    "x-vibe-user-id",
    "x-vibe-session-id",
];
/**
 * Safe staging/debug check for a healthy Vibe connectionRef call.
 * Does not log or expose secrets — only boolean flags and counts.
 */
export function assessVibeConnectionHealth(diagnostic) {
    const checks = {
        connectionRefPresent: diagnostic.connectionRefPresent,
        connectionRefResolved: diagnostic.connectionRefResolved,
        connectionIdPresent: diagnostic.connectionIdPresent,
        hasCredentials: diagnostic.credentialCount > 0,
        connectionRefInvalid: diagnostic.connectionRefInvalid,
    };
    const healthy = checks.connectionRefPresent &&
        checks.connectionRefResolved &&
        checks.connectionIdPresent &&
        checks.hasCredentials &&
        !checks.connectionRefInvalid;
    return {
        healthy,
        checks,
        shouldReconnect: false,
    };
}
function sessionDebugEnabled() {
    const configured = process.env.RED_CONNECT_SESSION_DEBUG?.trim().toLowerCase();
    if (configured === "false") {
        return false;
    }
    return process.env.RED_CONNECT_HTTP_MODE === "true";
}
export function normalizeHeaderValue(value) {
    if (Array.isArray(value)) {
        const joined = value.map((part) => part.trim()).filter(Boolean).join(", ");
        return joined || undefined;
    }
    const trimmed = value?.trim();
    return trimmed || undefined;
}
export function resolveMcpSessionIdFromHeaders(headers) {
    for (const name of MCP_SESSION_HEADER_NAMES) {
        const value = normalizeHeaderValue(headers[name]);
        if (value) {
            return value;
        }
    }
    return undefined;
}
export function listPresentHeaderNames(headers, candidates) {
    return candidates.filter((name) => Boolean(normalizeHeaderValue(headers[name])));
}
function fingerprintSecretMaterial(value) {
    return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}
export function resolveClientIpFromHeaders(headers) {
    const forwardedFor = normalizeHeaderValue(headers["x-forwarded-for"]);
    if (forwardedFor) {
        return forwardedFor.split(",")[0].trim();
    }
    return (normalizeHeaderValue(headers["x-real-ip"]) ??
        normalizeHeaderValue(headers["cf-connecting-ip"]) ??
        "unknown");
}
/**
 * Builds a scoped client key from non-secret request metadata.
 * Includes IP plus hashed optional identity headers (for example Authorization)
 * so hosted clients that rotate MCP session ids can still inherit safely when
 * a stable per-user token is present.
 */
export function buildHttpClientKeyFromHeaders(headers, clientIp) {
    const ip = clientIp?.trim() || resolveClientIpFromHeaders(headers);
    const identityParts = [];
    for (const name of MCP_CLIENT_IDENTITY_HEADER_NAMES) {
        const value = normalizeHeaderValue(headers[name]);
        if (!value) {
            continue;
        }
        identityParts.push(`${name}:${fingerprintSecretMaterial(value)}`);
    }
    const material = [ip, ...identityParts].join("|");
    return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}
export function buildHttpClientKeyFromRequest(req) {
    return buildHttpClientKeyFromHeaders(req.headers, getClientIpFromRequest(req));
}
export function getClientIpFromRequest(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim();
    }
    return req.ip || req.socket.remoteAddress || "unknown";
}
export function resolveMcpSessionIdFromRequest(req) {
    return resolveMcpSessionIdFromHeaders(req.headers);
}
export function resolveMcpSessionIdFromExtra(extra) {
    const fromExtra = extra?.sessionId?.trim();
    if (fromExtra) {
        return fromExtra;
    }
    const headers = extra?.requestInfo?.headers;
    if (!headers) {
        return undefined;
    }
    return resolveMcpSessionIdFromHeaders(headers);
}
export function buildHttpClientKeyFromExtra(extra) {
    const headers = extra?.requestInfo?.headers;
    if (!headers) {
        return undefined;
    }
    return buildHttpClientKeyFromHeaders(headers);
}
function prefixId(value) {
    if (!value) {
        return undefined;
    }
    return value.slice(0, 8);
}
export function logMcpSessionDiagnostic(details) {
    if (!sessionDebugEnabled()) {
        return;
    }
    console.info("Red MCP session:", JSON.stringify(details));
}
export async function prepareHttpToolSessionScope(sessionId, keyStore, clientKey, connectionRef) {
    await ensureConnectionStoreInitialized();
    const resolution = await resolveConnectionIdForActiveSessionWithMeta({
        sessionId,
        clientKey,
        connectionRef,
    });
    return {
        sessionId,
        keyStore,
        connectionId: resolution.connectionId ?? "",
        clientKey,
        resolution,
    };
}
export async function runWithHttpToolSession(scope, fn) {
    const runScoped = async () => {
        await ensureCredentialsForCurrentSession();
        return fn();
    };
    if (scope.clientKey) {
        return runWithHttpRequestSessionId(scope.sessionId, () => runWithHttpClientKey(scope.clientKey, () => runWithSessionKeyStore(scope.keyStore, () => runWithMcpSessionContext({
            sessionId: scope.sessionId,
            connectionId: scope.connectionId,
        }, runScoped))));
    }
    return runWithHttpRequestSessionId(scope.sessionId, () => runWithSessionKeyStore(scope.keyStore, () => runWithMcpSessionContext({
        sessionId: scope.sessionId,
        connectionId: scope.connectionId,
    }, runScoped)));
}
export async function runHttpToolSessionFromExtra(transportSessionId, keyStore, extra, fn, options) {
    if (!process.env.RED_CONNECT_HTTP_MODE) {
        return fn();
    }
    const sessionId = transportSessionId?.trim() || resolveMcpSessionIdFromExtra(extra);
    const connectionRef = options?.connectionRef;
    if (!sessionId) {
        // Still honour an explicit connectionRef when the transport did not supply a
        // session id (Vibe/Mistral session rotation edge cases).
        if (connectionRef) {
            return runWithActiveConnectionRef(connectionRef, fn);
        }
        return fn();
    }
    const store = keyStore ?? resolveSessionKeyStore(sessionId);
    const clientKey = buildHttpClientKeyFromExtra(extra);
    const scope = await prepareHttpToolSessionScope(sessionId, store, clientKey, connectionRef);
    return runWithActiveConnectionRef(connectionRef, () => runWithHttpToolSession(scope, async () => {
        const storedTelemetry = await loadConnectionTelemetryContext(scope.connectionId || undefined);
        const headers = (extra?.requestInfo?.headers ?? {});
        return runWithRedTelemetryContext({
            toolName: options?.toolName,
            telemetryClientId: storedTelemetry.telemetryClientId,
            connectionSessionId: storedTelemetry.connectionSessionId,
            connectedCompanyCount: store.size,
            clientPlatform: detectClientPlatform(headers),
            environment: resolveRedTelemetryEnvironment(),
        }, async () => {
            await ensureCredentialsForCurrentSession(options?.companyName);
            await logToolSessionDiagnosticIfNeeded({
                transportSessionId,
                sessionId,
                keyStore: store,
                scope,
                extra,
                connectionRef,
                companyName: options?.companyName,
                toolName: options?.toolName,
            });
            return fn();
        });
    }));
}
export function buildMcpSessionDiagnostic(args) {
    const headers = args.extra?.requestInfo?.headers ?? {};
    let sessionIdSource = "unresolved";
    let resolvedSessionId = args.transportSessionId?.trim();
    if (resolvedSessionId) {
        sessionIdSource = "transport";
    }
    else if (args.extra?.sessionId?.trim()) {
        resolvedSessionId = args.extra.sessionId.trim();
        sessionIdSource = "extra-session-id";
    }
    else {
        const fromHeader = resolveMcpSessionIdFromExtra(args.extra);
        if (fromHeader) {
            resolvedSessionId = fromHeader;
            sessionIdSource = "extra-header";
        }
    }
    const diagnostic = {
        transportSessionId: prefixId(args.transportSessionId),
        resolvedSessionId: prefixId(resolvedSessionId),
        sessionIdSource,
        connectionIdPresent: Boolean(args.resolution?.connectionId),
        connectionIdPrefix: prefixId(args.resolution?.connectionId ?? undefined),
        sessionBindingFound: args.resolution?.sessionBindingFound ?? false,
        clientClaimInherited: args.resolution?.clientClaimInherited ?? false,
        connectionRefResolved: args.resolution?.connectionRefResolved ?? false,
        connectionRefInvalid: args.resolution?.connectionRefInvalid ?? false,
        connectionRefPresent: Boolean(args.connectionRef?.trim()),
        connectionRefPrefix: prefixConnectionRef(args.connectionRef),
        clientKeyPresent: Boolean(buildHttpClientKeyFromExtra(args.extra)),
        clientIdentityHeaderNamesPresent: listPresentHeaderNames(headers, MCP_CLIENT_IDENTITY_HEADER_NAMES),
        mcpSessionHeaderNamesPresent: listPresentHeaderNames(headers, MCP_SESSION_HEADER_NAMES),
        credentialCount: args.credentialCount ?? 0,
        companiesLoaded: args.companiesLoaded ?? [],
        requestedCompany: args.requestedCompany,
        requestedCompanyLoaded: args.requestedCompanyLoaded,
        toolName: args.toolName,
    };
    diagnostic.vibeConnectionHealthy = assessVibeConnectionHealth(diagnostic).healthy;
    return diagnostic;
}
function listLoadedCompanyNames(keyStore) {
    return Array.from(keyStore.values()).map((entry) => entry.companyName);
}
async function logToolSessionDiagnosticIfNeeded(args) {
    if (!sessionDebugEnabled()) {
        return;
    }
    const companiesLoaded = listLoadedCompanyNames(args.keyStore);
    const requestedCompany = args.companyName?.trim();
    const requestedCompanyLoaded = requestedCompany
        ? args.keyStore.has(normaliseCompanyName(requestedCompany))
        : undefined;
    logMcpSessionDiagnostic(buildMcpSessionDiagnostic({
        transportSessionId: args.transportSessionId ?? args.sessionId,
        extra: args.extra,
        resolution: args.scope.resolution,
        connectionRef: args.connectionRef,
        credentialCount: companiesLoaded.length,
        companiesLoaded,
        requestedCompany,
        requestedCompanyLoaded,
        toolName: args.toolName,
    }));
}
/**
 * Wraps an MCP tool handler so HTTP tool calls re-bind the active session using
 * transport session id and/or MCP SDK request extra metadata.
 */
export function wrapHttpSessionAwareToolHandler(handler, options) {
    return async (args, extra) => {
        const connectionRef = extractConnectionRefFromToolArgs(args);
        const companyName = typeof args.companyName === "string" ? args.companyName : undefined;
        return runHttpToolSessionFromExtra(options?.transportSessionId, options?.keyStore, extra, () => handler(args, extra), {
            connectionRef,
            companyName,
            toolName: options?.toolName,
        });
    };
}
