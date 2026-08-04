/**
 * Client platform and deployment environment helpers for Red telemetry.
 *
 * Supported customer platforms (normalised values only):
 *   claude | chatgpt | mistral | unknown
 *
 * Detection priority:
 *   A. MCP initialize clientInfo
 *   B. Existing stored MCP session platform
 *   C. Explicit allow-listed client headers
 *   D. User-Agent fallback
 *   E. unknown
 */
/** In-process map: MCP session id → detected platform (survives Session object rebuild). */
const sessionPlatformStore = new Map();
const KNOWN_PLATFORMS = new Set([
    "claude",
    "chatgpt",
    "mistral",
]);
function headerValue(headers, name) {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(raw)) {
        return typeof raw[0] === "string" ? raw[0].trim() : undefined;
    }
    return typeof raw === "string" ? raw.trim() : undefined;
}
function hasHeader(headers, name) {
    return Boolean(headerValue(headers, name));
}
/**
 * Case-insensitive match against clear platform terms only.
 * Ambiguous / unsupported clients (cursor, browsers, etc.) stay unmatched.
 */
export function matchPlatformFromText(text) {
    if (!text || typeof text !== "string") {
        return undefined;
    }
    const lower = text.toLowerCase();
    if (!lower.trim()) {
        return undefined;
    }
    if (lower.includes("claude") || lower.includes("anthropic")) {
        return "claude";
    }
    if (lower.includes("chatgpt") || lower.includes("openai")) {
        return "chatgpt";
    }
    if (lower.includes("mistral") || lower.includes("vibe")) {
        return "mistral";
    }
    return undefined;
}
export function normalizeClientPlatform(value) {
    if (!value || typeof value !== "string") {
        return "unknown";
    }
    const lower = value.trim().toLowerCase();
    if (KNOWN_PLATFORMS.has(lower)) {
        return lower;
    }
    // Legacy / alias values
    if (lower === "vibe") {
        return "mistral";
    }
    return "unknown";
}
export function extractMcpInitializeClientInfo(body) {
    const messages = Array.isArray(body) ? body : body ? [body] : [];
    for (const message of messages) {
        if (!message || typeof message !== "object") {
            continue;
        }
        const record = message;
        if (record.method !== "initialize") {
            continue;
        }
        const params = record.params;
        if (!params || typeof params !== "object" || Array.isArray(params)) {
            return undefined;
        }
        const clientInfo = params.clientInfo;
        if (!clientInfo || typeof clientInfo !== "object" || Array.isArray(clientInfo)) {
            return undefined;
        }
        const info = clientInfo;
        const name = typeof info.name === "string" && info.name.trim()
            ? info.name.trim()
            : undefined;
        const version = typeof info.version === "string" && info.version.trim()
            ? info.version.trim()
            : undefined;
        if (!name && !version) {
            return undefined;
        }
        return { name, version };
    }
    return undefined;
}
function detectFromAllowListedHeaders(headers) {
    // Vibe is Mistral's coding agent — map to mistral.
    if (hasHeader(headers, "x-vibe-user-id") ||
        hasHeader(headers, "x-vibe-session-id") ||
        hasHeader(headers, "x-mistral-user-id") ||
        hasHeader(headers, "x-lechat-user-id")) {
        return "mistral";
    }
    return undefined;
}
function detectFromUserAgent(headers) {
    return matchPlatformFromText(headerValue(headers, "user-agent"));
}
/**
 * Resolve platform using the documented priority order.
 * Does not record the full initialize payload — only name/version when present.
 */
export function resolveClientPlatform(args) {
    const headers = args.headers ?? {};
    const clientInfoName = typeof args.clientInfo?.name === "string" && args.clientInfo.name.trim()
        ? args.clientInfo.name.trim()
        : undefined;
    const clientInfoVersion = typeof args.clientInfo?.version === "string" &&
        args.clientInfo.version.trim()
        ? args.clientInfo.version.trim()
        : undefined;
    const clientInfoNamePresent = Boolean(clientInfoName);
    const normalisedStored = normalizeClientPlatform(args.storedPlatform);
    const storedPlatformFound = normalisedStored !== "unknown";
    // A. MCP initialize clientInfo
    if (clientInfoName) {
        const fromName = matchPlatformFromText(clientInfoName);
        if (fromName) {
            return {
                platform: fromName,
                detectionSource: "clientInfo",
                clientInfoName,
                clientInfoVersion,
                clientInfoNamePresent,
                storedPlatformFound,
            };
        }
    }
    // B. Existing stored MCP session platform
    if (storedPlatformFound) {
        return {
            platform: normalisedStored,
            detectionSource: "storedSession",
            clientInfoName,
            clientInfoVersion,
            clientInfoNamePresent,
            storedPlatformFound,
        };
    }
    // C. Explicit allow-listed client headers
    const fromHeaders = detectFromAllowListedHeaders(headers);
    if (fromHeaders) {
        return {
            platform: fromHeaders,
            detectionSource: "headers",
            clientInfoName,
            clientInfoVersion,
            clientInfoNamePresent,
            storedPlatformFound,
        };
    }
    // D. User-Agent fallback
    const fromUa = detectFromUserAgent(headers);
    if (fromUa) {
        return {
            platform: fromUa,
            detectionSource: "userAgent",
            clientInfoName,
            clientInfoVersion,
            clientInfoNamePresent,
            storedPlatformFound,
        };
    }
    // E. unknown
    return {
        platform: "unknown",
        detectionSource: "unknown",
        clientInfoName,
        clientInfoVersion,
        clientInfoNamePresent,
        storedPlatformFound,
    };
}
/**
 * Header-only convenience used by older call sites.
 * Prefer {@link resolveClientPlatform} when clientInfo / stored platform exist.
 */
export function detectClientPlatform(headers = {}) {
    return resolveClientPlatform({ headers }).platform;
}
export function storeSessionPlatform(sessionId, platform) {
    const id = sessionId.trim();
    if (!id) {
        return;
    }
    const normalised = normalizeClientPlatform(platform);
    if (normalised === "unknown") {
        return;
    }
    sessionPlatformStore.set(id, normalised);
}
export function getStoredSessionPlatform(sessionId) {
    const id = sessionId.trim();
    if (!id) {
        return undefined;
    }
    return sessionPlatformStore.get(id);
}
export function clearSessionPlatform(sessionId) {
    const id = sessionId.trim();
    if (!id) {
        return;
    }
    sessionPlatformStore.delete(id);
}
/** Test helper — clears in-process session platform state. */
export function clearAllSessionPlatformsForTests() {
    sessionPlatformStore.clear();
}
export function toPlatformDetectionDiagnostics(result) {
    return {
        clientInfoNamePresent: result.clientInfoNamePresent,
        matchedPlatform: result.platform,
        detectionSource: result.detectionSource,
        storedPlatformFound: result.storedPlatformFound,
    };
}
/**
 * Safe temporary diagnostics — booleans / enum values only.
 * Never logs headers, payloads, connectionRef, API keys, or session IDs.
 */
export function logPlatformDetectionDiagnostics(diagnostics) {
    try {
        console.info("Red platform detection:", JSON.stringify({
            clientInfoNamePresent: diagnostics.clientInfoNamePresent,
            matchedPlatform: diagnostics.matchedPlatform,
            detectionSource: diagnostics.detectionSource,
            storedPlatformFound: diagnostics.storedPlatformFound,
        }));
    }
    catch {
        // ignore
    }
}
export function resolveRedTelemetryEnvironment(env = process.env) {
    const configured = env.BRC_DEPLOYMENT_ENV?.trim().toLowerCase();
    if (configured === "staging" || configured === "production") {
        return configured;
    }
    if (configured === "test" || configured === "development") {
        return configured;
    }
    const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
    if (nodeEnv === "production") {
        return "production";
    }
    if (nodeEnv === "test") {
        return "test";
    }
    return "development";
}
