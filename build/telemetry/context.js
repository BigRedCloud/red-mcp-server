/**
 * Builds safe Red telemetry context for HTTP / MCP requests.
 * Never includes secrets, connectionRef, session IDs, or company data payloads.
 */
import { getConnectionStore } from "../auth/connection_store.js";
import { isValidTelemetryUuid, normaliseTelemetryClientId, readTelemetryClientIdFromCookieHeader, TELEMETRY_CLIENT_ID_FORM_FIELD, } from "./identity.js";
import { detectClientPlatform, resolveRedTelemetryEnvironment } from "./platform.js";
export function resolveTelemetryClientIdFromRequest(req) {
    const cookieId = readTelemetryClientIdFromCookieHeader(req.headers?.cookie);
    const body = req.body && typeof req.body === "object" ? req.body : {};
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
export async function loadConnectionTelemetryContext(connectionId) {
    if (!connectionId) {
        return {};
    }
    try {
        const record = await getConnectionStore().getConnectionTelemetry(connectionId);
        if (!record) {
            return {};
        }
        return {
            telemetryClientId: isValidTelemetryUuid(record.telemetryClientId)
                ? record.telemetryClientId
                : undefined,
            connectionSessionId: isValidTelemetryUuid(record.connectionSessionId)
                ? record.connectionSessionId
                : undefined,
        };
    }
    catch {
        return {};
    }
}
export function buildRequestTelemetryContext(args) {
    const headers = (args.req?.headers ?? {});
    return {
        telemetryClientId: args.telemetryClientId,
        connectionSessionId: args.connectionSessionId,
        clientPlatform: detectClientPlatform(headers),
        environment: resolveRedTelemetryEnvironment(),
        connectedCompanyCount: args.connectedCompanyCount,
        toolName: args.toolName,
    };
}
