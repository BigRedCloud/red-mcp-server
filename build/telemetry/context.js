/**
 * Builds safe Red telemetry context for HTTP / MCP requests.
 * Never includes secrets, connectionRef, session IDs, or company data payloads.
 */
import { createHash } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { ensureConnectionStoreInitialized, getConnectionStore, getConnectionStoreTargetName, getDeploymentEnvironmentLabel, resolveConnectionIdForActiveSessionWithMeta, } from "../auth/connection_store.js";
import { hydrateSessionKeyStoreFromConnectionStore } from "../auth/connection_persistence.js";
import { extractConnectionRefFromToolArgs, isConnectionRefFormat, prefixConnectionRef, } from "../auth/connection_ref.js";
import { registerHttpSessionKeyStore, } from "../shared.js";
import { ENDUSER_PSEUDO_ID_ATTRIBUTE } from "./identity.js";
import { buildTelemetryCustomDimensions, generateTelemetryUuid, isValidTelemetryUuid, mergeRedTelemetryContext, readTelemetryClientIdFromCookieHeader, TELEMETRY_CLIENT_ID_FORM_FIELD, } from "./identity.js";
import { detectClientPlatform, logPlatformDetectionDiagnostics, resolveClientPlatform, resolveRedTelemetryEnvironment, storeSessionPlatform, toPlatformDetectionDiagnostics, } from "./platform.js";
/** Boolean-only diagnostics for the connect-page client ID path. Never log UUIDs. */
export function logTelemetryClientIdPathDiagnostics(diagnostics) {
    try {
        console.info("Red telemetry client id path:", JSON.stringify(diagnostics));
    }
    catch {
        // ignore
    }
}
export function hashConnectionCodeForDiagnostics(code) {
    const trimmed = code.trim();
    if (!trimmed) {
        return "none";
    }
    return createHash("sha256").update(trimmed, "utf8").digest("hex").slice(0, 12);
}
export function logConnectTelemetryFlowDiagnostics(diagnostics) {
    try {
        console.info("Red connect telemetry flow:", JSON.stringify({
            cookieIdPresent: diagnostics.cookieIdPresent,
            localStorageIdPresent: diagnostics.localStorageIdPresent,
            hiddenFieldIdPresent: diagnostics.hiddenFieldIdPresent,
            submittedIdValid: diagnostics.submittedIdValid,
            fallbackGenerated: diagnostics.fallbackGenerated,
            idsMatched: diagnostics.idsMatched,
            requestHost: diagnostics.requestHost,
            platform: diagnostics.platform,
            connectionCodeHash: diagnostics.connectionCodeHash,
        }));
    }
    catch {
        // ignore
    }
}
function prefixId(value, length = 8) {
    if (!value)
        return null;
    return value.slice(0, Math.min(length, value.length));
}
export async function logConnectionRefResolutionDiagnostics(args) {
    try {
        const ref = args.connectionRef?.trim();
        const connectionId = args.resolution.connectionId;
        let companyCount = 0;
        let expiresAt = null;
        if (connectionId) {
            try {
                const companies = await getConnectionStore().listConnectedCompanies(connectionId);
                companyCount = companies.length;
                if (companies.length > 0) {
                    expiresAt = Math.min(...companies.map((c) => c.expiresAt));
                }
            }
            catch {
                // ignore — diagnostics must not break requests
            }
        }
        const requestedCompanyLoaded = typeof args.companyName === "string" && args.companyName.trim()
            ? args.keyStoreSize > 0
            : null;
        const lookupResult = !ref
            ? "absent"
            : args.resolution.connectionRefResolved
                ? "resolved"
                : "invalid";
        const diagnostics = {
            deploymentEnvironment: getDeploymentEnvironmentLabel(),
            connectionStoreTargetName: getConnectionStoreTargetName(),
            recordType: "connectionRefLookup",
            connectionRefPresent: Boolean(ref),
            connectionRefPrefix: prefixConnectionRef(ref) ?? null,
            connectionRefLookupResult: lookupResult,
            connectionIdPrefix: prefixId(connectionId),
            partitionKeyName: "pk",
            partitionKeyValuePrefix: connectionId
                ? prefixId(`connection:${connectionId}`, 18)
                : ref
                    ? prefixId(`ref:${ref}`, 12)
                    : null,
            expiresAt,
            ttl: null,
            currentTimestamp: Date.now(),
            recordFound: Boolean(connectionId),
            credentialCount: args.keyStoreSize,
            companyCount,
            sessionBindingFound: args.resolution.sessionBindingFound,
            clientClaimInherited: args.resolution.clientClaimInherited,
            telemetryMergePerformed: false,
            companiesPreservedAfterMerge: true,
            requestedCompanyLoaded,
            recordDeletedOrConsumed: false,
        };
        console.info("Red connectionRef resolution:", JSON.stringify(diagnostics));
    }
    catch {
        // ignore
    }
}
/**
 * Prefer a valid form/localStorage body value (explicit submit), then cookie,
 * else generate a safe UUID. Malformed values are never accepted.
 *
 * Prefer {@link resolveCanonicalTelemetryClientId} for /connect so a
 * server-seeded ID from an earlier GET is reused instead of minting a second
 * fallback when cookies are missing (common in Mistral embedded browsers).
 */
export function resolveTelemetryClientIdFromRequest(req) {
    return resolveCanonicalTelemetryClientId(req);
}
/**
 * Canonical connect-flow client ID selection:
 * 1) valid submitted hidden field
 * 2) valid first-party cookie
 * 3) server-seeded ID (persisted for this connection on an earlier GET)
 * 4) generate one fallback only if all are unavailable
 *
 * Never invents a second fallback when a server seed already exists.
 */
export function resolveCanonicalTelemetryClientId(args) {
    const cookieHeader = args.headers?.cookie;
    const cookieId = readTelemetryClientIdFromCookieHeader(typeof cookieHeader === "string"
        ? cookieHeader
        : Array.isArray(cookieHeader)
            ? cookieHeader[0]
            : undefined);
    const cookieClientIdPresent = Boolean(cookieId);
    const body = args.body && typeof args.body === "object"
        ? args.body
        : {};
    const bodyRaw = body[TELEMETRY_CLIENT_ID_FORM_FIELD] ?? body.telemetry_client_id;
    const postClientIdPresent = typeof bodyRaw === "string" && bodyRaw.trim() !== "";
    const bodyId = typeof bodyRaw === "string" && isValidTelemetryUuid(bodyRaw)
        ? bodyRaw.trim().toLowerCase()
        : undefined;
    const postClientIdValid = Boolean(bodyId);
    const serverSeed = typeof args.serverSeed === "string" && isValidTelemetryUuid(args.serverSeed)
        ? args.serverSeed.trim().toLowerCase()
        : undefined;
    const serverSeedPresent = Boolean(serverSeed);
    const presentIds = [bodyId, cookieId, serverSeed].filter((value) => Boolean(value));
    const idsMatched = presentIds.length <= 1 || presentIds.every((id) => id === presentIds[0]);
    if (bodyId) {
        return {
            clientId: bodyId,
            source: "body",
            fromCookie: false,
            fromBody: true,
            fromServerSeed: false,
            fallbackGenerated: false,
            replacedMalformed: false,
            cookieClientIdPresent,
            postClientIdPresent,
            postClientIdValid,
            serverSeedPresent,
            idsMatched,
        };
    }
    if (cookieId) {
        return {
            clientId: cookieId,
            source: "cookie",
            fromCookie: true,
            fromBody: false,
            fromServerSeed: false,
            fallbackGenerated: false,
            replacedMalformed: false,
            cookieClientIdPresent,
            postClientIdPresent,
            postClientIdValid,
            serverSeedPresent,
            idsMatched,
        };
    }
    if (serverSeed) {
        return {
            clientId: serverSeed,
            source: "serverSeed",
            fromCookie: false,
            fromBody: false,
            fromServerSeed: true,
            fallbackGenerated: false,
            replacedMalformed: false,
            cookieClientIdPresent,
            postClientIdPresent,
            postClientIdValid,
            serverSeedPresent,
            idsMatched,
        };
    }
    const malformed = postClientIdPresent ||
        Boolean(readRawCookieValue(typeof cookieHeader === "string"
            ? cookieHeader
            : Array.isArray(cookieHeader)
                ? cookieHeader[0]
                : undefined));
    const clientId = generateTelemetryUuid();
    return {
        clientId,
        source: "fallback",
        fromCookie: false,
        fromBody: false,
        fromServerSeed: false,
        fallbackGenerated: true,
        replacedMalformed: malformed,
        cookieClientIdPresent,
        postClientIdPresent,
        postClientIdValid,
        serverSeedPresent,
        idsMatched,
    };
}
function readRawCookieValue(cookieHeader) {
    if (!cookieHeader)
        return undefined;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)red_telemetry_client_id=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
/**
 * Resolve the connect-page client ID and persist it on first assignment so
 * later cookie-less GET/POST for the same connection reuse one canonical UUID.
 */
export async function resolveAndPersistConnectTelemetryClientId(args) {
    const existing = await loadConnectionTelemetryContext(args.connectionId);
    const resolved = resolveCanonicalTelemetryClientId({
        headers: args.headers,
        body: args.body,
        serverSeed: existing.telemetryClientId,
    });
    // Never introduce a second fallback for a connection that already has an id.
    if (resolved.fallbackGenerated && existing.telemetryClientId) {
        return {
            ...resolved,
            clientId: existing.telemetryClientId,
            source: "serverSeed",
            fromServerSeed: true,
            fallbackGenerated: false,
            serverSeedPresent: true,
        };
    }
    const shouldPersist = !existing.telemetryClientId ||
        resolved.source === "body" ||
        resolved.source === "cookie";
    if (shouldPersist) {
        try {
            await getConnectionStore().saveConnectionTelemetry(args.connectionId, {
                telemetryClientId: resolved.clientId,
            });
        }
        catch {
            // continue — response still uses the resolved id
        }
    }
    return resolved;
}
export function buildConnectTelemetryFlowDiagnostics(args) {
    const headers = args.headers ??
        (args.req?.headers ?? {});
    const hostHeader = headers.host;
    const requestHost = Array.isArray(hostHeader)
        ? hostHeader[0] ?? ""
        : typeof hostHeader === "string"
            ? hostHeader
            : "";
    return {
        cookieIdPresent: args.resolution.cookieClientIdPresent,
        localStorageIdPresent: Boolean(args.localStorageIdPresent),
        hiddenFieldIdPresent: args.resolution.postClientIdPresent,
        submittedIdValid: args.resolution.postClientIdValid,
        fallbackGenerated: args.resolution.fallbackGenerated,
        idsMatched: args.resolution.idsMatched,
        requestHost,
        platform: detectClientPlatform(headers),
        connectionCodeHash: hashConnectionCodeForDiagnostics(args.code),
    };
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
    const clientPlatform = args.clientPlatform ??
        resolveClientPlatform({
            clientInfo: args.clientInfo,
            storedPlatform: args.storedPlatform,
            headers,
        }).platform;
    return {
        telemetryClientId: args.telemetryClientId,
        connectionSessionId: args.connectionSessionId,
        clientPlatform,
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
        sourceStoreName: options.sourceStoreName,
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
            sourceStoreName: diagnostics.sourceStoreName ?? null,
        }));
    }
    catch {
        // ignore
    }
}
export function logMcpTelemetryLoadDiagnostics(args) {
    try {
        console.info("Red telemetry MCP load:", JSON.stringify({
            telemetryRecordFound: args.telemetryRecordFound,
            telemetryClientIdPresent: args.telemetryClientIdPresent,
            connectionSessionIdPresent: args.connectionSessionIdPresent,
            sourceStoreName: args.sourceStoreName,
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
 * 5) resolve client platform (clientInfo → stored session → headers → UA)
 * 6) build Red telemetry context
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
            // Hydrate into a temp map first — never clear the live key store before a
            // successful reload (decrypt/store errors must not wipe credentials).
            const hydrated = new Map();
            await hydrateSessionKeyStoreFromConnectionStore(connectionId, hydrated);
            args.keyStore.clear();
            for (const [key, value] of hydrated) {
                args.keyStore.set(key, value);
            }
            registerHttpSessionKeyStore(args.sessionId, args.keyStore);
        }
        catch (error) {
            console.error("Red: failed to hydrate session credentials from connection store:", error instanceof Error ? error.message : error);
        }
    }
    await logConnectionRefResolutionDiagnostics({
        resolution,
        connectionRef: args.connectionRef,
        sessionId: args.sessionId,
        keyStoreSize: args.keyStore.size,
        companyName: args.companyName,
    });
    const stored = await loadConnectionTelemetryContext(connectionId || undefined);
    const companyCount = await countCompaniesForConnection(connectionId || undefined, args.keyStore.size);
    const sourceStoreName = getConnectionStoreTargetName();
    logMcpTelemetryLoadDiagnostics({
        telemetryRecordFound: stored.recordFound,
        telemetryClientIdPresent: Boolean(stored.telemetryClientId),
        connectionSessionIdPresent: Boolean(stored.connectionSessionId),
        sourceStoreName,
    });
    // Platform must be resolved after session rehydration supplies storedPlatform,
    // and before the telemetry context is built.
    const platformDetection = resolveClientPlatform({
        clientInfo: args.clientInfo,
        storedPlatform: args.storedPlatform,
        headers: args.headers,
    });
    logPlatformDetectionDiagnostics(toPlatformDetectionDiagnostics(platformDetection));
    if (platformDetection.platform !== "unknown") {
        storeSessionPlatform(args.sessionId, platformDetection.platform);
    }
    const context = buildRequestTelemetryContext({
        headers: args.headers,
        connectionId: connectionId || undefined,
        telemetryClientId: stored.telemetryClientId,
        connectionSessionId: stored.connectionSessionId,
        connectedCompanyCount: companyCount,
        toolName: args.toolName,
        clientPlatform: platformDetection.platform,
    });
    const diagnostics = buildRedTelemetryDiagnostics(context, {
        telemetryRecordFound: stored.recordFound,
        connectionContextFound: Boolean(connectionId),
        sourceStoreName,
    });
    return {
        connectionId,
        context,
        diagnostics,
        platformDetection,
    };
}
export function activatePreparedTelemetry(prepared) {
    mergeRedTelemetryContext(prepared.context);
    applyRedTelemetryToActiveSpan(prepared.context);
    logRedTelemetryDiagnostics(prepared.diagnostics);
}
