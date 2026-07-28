/**
 * Builds safe Red telemetry context for HTTP / MCP requests.
 * Never includes secrets, connectionRef, session IDs, or company data payloads.
 */
import { trace } from "@opentelemetry/api";
import { ensureConnectionStoreInitialized, getConnectionStore, resolveConnectionIdForActiveSessionWithMeta, } from "../auth/connection_store.js";
import { hydrateSessionKeyStoreFromConnectionStore } from "../auth/connection_persistence.js";
import { extractConnectionRefFromToolArgs, isConnectionRefFormat, } from "../auth/connection_ref.js";
import { registerHttpSessionKeyStore, } from "../shared.js";
import { ENDUSER_PSEUDO_ID_ATTRIBUTE } from "./identity.js";
import { buildTelemetryCustomDimensions, isValidTelemetryUuid, mergeRedTelemetryContext, normaliseTelemetryClientId, readTelemetryClientIdFromCookieHeader, TELEMETRY_CLIENT_ID_FORM_FIELD, } from "./identity.js";
import { detectClientPlatform, resolveRedTelemetryEnvironment } from "./platform.js";
export function resolveTelemetryClientIdFromRequest(req) {
    const cookieId = readTelemetryClientIdFromCookieHeader(req.headers?.cookie);
    const body = req.body && typeof req.body === "object"
        ? req.body
        : {};
    const bodyRaw = body[TELEMETRY_CLIENT_ID_FORM_FIELD] ?? body.telemetry_client_id;
    const bodyId = typeof bodyRaw === "string" && isValidTelemetryUuid(bodyRaw)
        ? bodyRaw.trim().toLowerCase()
        : undefined;
    if (cookieId) {
        return { clientId: cookieId, fromCookie: true, replacedMalformed: false };
    }
    if (bodyId) {
        return { clientId: bodyId, fromCookie: false, replacedMalformed: false };
    }
    const malformed = (typeof bodyRaw === "string" && bodyRaw.trim() !== "") ||
        Boolean(readRawCookieValue(req.headers?.cookie));
    return {
        clientId: normaliseTelemetryClientId(bodyRaw),
        fromCookie: false,
        replacedMalformed: malformed,
    };
}
function readRawCookieValue(cookieHeader) {
    if (!cookieHeader)
        return undefined;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)red_telemetry_client_id=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
/**
 * Pulls connectionRef from an MCP JSON-RPC body when present (e.g. tools/call).
 * Returns undefined for non-tool requests. Never logs the value.
 */
export function extractConnectionRefFromMcpBody(body) {
    if (!body || typeof body !== "object") {
        return undefined;
    }
    const params = body.params;
    if (!params || typeof params !== "object") {
        return undefined;
    }
    const args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        return undefined;
    }
    const value = extractConnectionRefFromToolArgs(args);
    if (!value || !isConnectionRefFormat(value)) {
        return undefined;
    }
    return value.trim();
}
export async function loadConnectionTelemetryContext(connectionId) {
    if (!connectionId) {
        return { recordFound: false };
    }
    try {
        const record = await getConnectionStore().getConnectionTelemetry(connectionId);
        if (!record) {
            return { recordFound: false };
        }
        return {
            recordFound: true,
            telemetryClientId: isValidTelemetryUuid(record.telemetryClientId)
                ? record.telemetryClientId
                : undefined,
            connectionSessionId: isValidTelemetryUuid(record.connectionSessionId)
                ? record.connectionSessionId
                : undefined,
        };
    }
    catch {
        return { recordFound: false };
    }
}
export async function countCompaniesForConnection(connectionId, keyStoreSize = 0) {
    if (!connectionId) {
        return keyStoreSize;
    }
    try {
        const companies = await getConnectionStore().listConnectedCompanies(connectionId);
        if (companies.length > 0) {
            return companies.length;
        }
    }
    catch {
        // fall through to in-memory count
    }
    return keyStoreSize;
}
export function buildRequestTelemetryContext(args) {
    const headers = args.headers ??
        (args.req?.headers ?? {});
    return {
        telemetryClientId: args.telemetryClientId,
        connectionSessionId: args.connectionSessionId,
        clientPlatform: detectClientPlatform(headers),
        environment: resolveRedTelemetryEnvironment(),
        connectedCompanyCount: args.connectedCompanyCount,
        toolName: args.toolName,
    };
}
export function buildRedTelemetryDiagnostics(context, options) {
    return {
        telemetryRecordFound: options.telemetryRecordFound,
        connectionContextFound: options.connectionContextFound,
        companyCount: typeof context.connectedCompanyCount === "number"
            ? context.connectedCompanyCount
            : 0,
        platform: context.clientPlatform ?? "unknown",
        clientIdPresent: Boolean(context.telemetryClientId),
        connectionSessionIdPresent: Boolean(context.connectionSessionId),
    };
}
/**
 * Writes current telemetry dimensions onto the active OTel span (HTTP request
 * span or tool span). Safe no-op when telemetry is disabled.
 */
export function applyRedTelemetryToActiveSpan(context = {}) {
    try {
        const span = trace.getActiveSpan();
        if (!span) {
            return;
        }
        const dimensions = buildTelemetryCustomDimensions(context);
        for (const [key, value] of Object.entries(dimensions)) {
            span.setAttribute(key, value);
        }
        if (context.telemetryClientId &&
            isValidTelemetryUuid(context.telemetryClientId)) {
            span.setAttribute(ENDUSER_PSEUDO_ID_ATTRIBUTE, context.telemetryClientId);
        }
    }
    catch {
        // never break requests for telemetry
    }
}
export function logRedTelemetryDiagnostics(diagnostics) {
    try {
        console.info("Red telemetry context:", JSON.stringify({
            telemetryRecordFound: diagnostics.telemetryRecordFound,
            connectionContextFound: diagnostics.connectionContextFound,
            companyCount: diagnostics.companyCount,
            platform: diagnostics.platform,
            clientIdPresent: diagnostics.clientIdPresent,
            connectionSessionIdPresent: diagnostics.connectionSessionIdPresent,
        }));
    }
    catch {
        // ignore
    }
}
/**
 * Ordered MCP telemetry preparation:
 * 1) resolve connection (session binding / client claim / connectionRef)
 * 2) restore company credentials into the session key store
 * 3) load stored connection telemetry
 * 4) count companies for the active connection
 * 5) build Red telemetry context
 */
export async function prepareMcpTelemetryContext(args) {
    await ensureConnectionStoreInitialized();
    const resolution = await resolveConnectionIdForActiveSessionWithMeta({
        sessionId: args.sessionId,
        clientKey: args.clientKey,
        connectionRef: args.connectionRef,
    });
    const connectionId = resolution.connectionId ?? "";
    if (connectionId) {
        try {
            // Hydrate the caller's key store (same map used by tool handlers / diagnostics).
            args.keyStore.clear();
            await hydrateSessionKeyStoreFromConnectionStore(connectionId, args.keyStore);
            registerHttpSessionKeyStore(args.sessionId, args.keyStore);
        }
        catch {
            // continue with whatever is already loaded
        }
    }
    const stored = await loadConnectionTelemetryContext(connectionId || undefined);
    const companyCount = await countCompaniesForConnection(connectionId || undefined, args.keyStore.size);
    const context = buildRequestTelemetryContext({
        headers: args.headers,
        connectionId: connectionId || undefined,
        telemetryClientId: stored.telemetryClientId,
        connectionSessionId: stored.connectionSessionId,
        connectedCompanyCount: companyCount,
        toolName: args.toolName,
    });
    const diagnostics = buildRedTelemetryDiagnostics(context, {
        telemetryRecordFound: stored.recordFound,
        connectionContextFound: Boolean(connectionId),
    });
    return {
        connectionId,
        context,
        diagnostics,
    };
}
export function activatePreparedTelemetry(prepared) {
    mergeRedTelemetryContext(prepared.context);
    applyRedTelemetryToActiveSpan(prepared.context);
    logRedTelemetryDiagnostics(prepared.diagnostics);
}
