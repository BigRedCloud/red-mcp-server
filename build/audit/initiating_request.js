import { AsyncLocalStorage } from "node:async_hooks";
/**
 * Captures the natural-language instruction the MCP server actually received
 * via brc_route_request (`message`), then associates it with later confirmed
 * writes for the same route token.
 *
 * Red does not see the full host conversation. Never invent a user request.
 */
export const MAX_INITIATING_REQUEST_LENGTH = 400;
const initiatingRequestAls = new AsyncLocalStorage();
const routeRequestByJti = new Map();
export function sanitizeInitiatingRequest(raw) {
    if (typeof raw !== "string") {
        return undefined;
    }
    let text = raw.replace(/\s+/g, " ").trim();
    if (!text) {
        return undefined;
    }
    text = text
        .replace(/Bearer\s+\S+/gi, "<REDACTED>")
        .replace(/api[_-]?key["']?\s*[:=]\s*["']?\S+/gi, "apiKey=<REDACTED>")
        .replace(/\b(?:access)?token["']?\s*[:=]\s*["']?\S+/gi, "token=<REDACTED>")
        .replace(/password["']?\s*[:=]\s*["']?\S+/gi, "password=<REDACTED>")
        .replace(/Authorization:\s*\S+/gi, "<REDACTED>")
        .replace(/redconn_[A-Za-z0-9]+/gi, "<REDACTED>")
        .replace(/redroute_[A-Za-z0-9._-]+/gi, "<REDACTED>")
        .replace(/routeToken["']?\s*[:=]\s*["']?\S+/gi, "routeToken=<REDACTED>")
        .replace(/connectionRef["']?\s*[:=]\s*["']?\S+/gi, "connectionRef=<REDACTED>");
    if (text.length > MAX_INITIATING_REQUEST_LENGTH) {
        text = `${text.slice(0, MAX_INITIATING_REQUEST_LENGTH).trimEnd()}…`;
    }
    return text || undefined;
}
function pruneExpiredRouteRequests(now = Date.now()) {
    for (const [jti, record] of routeRequestByJti) {
        if (record.exp <= now) {
            routeRequestByJti.delete(jti);
        }
    }
}
export function rememberInitiatingRequestForRoute(args) {
    pruneExpiredRouteRequests();
    const requestSummary = sanitizeInitiatingRequest(args.message);
    if (!args.jti.trim() || !requestSummary) {
        return;
    }
    routeRequestByJti.set(args.jti, {
        requestSummary,
        exp: args.exp,
    });
}
export function peekInitiatingRequestForRoute(jti) {
    pruneExpiredRouteRequests();
    return routeRequestByJti.get(jti)?.requestSummary;
}
export function getActiveInitiatingRequest() {
    return initiatingRequestAls.getStore()?.requestSummary;
}
export async function runWithInitiatingRequest(requestSummary, operation) {
    const sanitized = sanitizeInitiatingRequest(requestSummary);
    if (!sanitized) {
        return await operation();
    }
    return initiatingRequestAls.run({ requestSummary: sanitized }, async () => operation());
}
export function __resetInitiatingRequestsForTests() {
    routeRequestByJti.clear();
}
