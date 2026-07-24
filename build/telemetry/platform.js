/**
 * Client platform and deployment environment helpers for Red telemetry.
 */
function headerValue(headers, name) {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(raw)) {
        return typeof raw[0] === "string" ? raw[0].trim() : undefined;
    }
    return typeof raw === "string" ? raw.trim() : undefined;
}
function hasHeader(headers, name) {
    const value = headerValue(headers, name);
    return Boolean(value);
}
/**
 * Prefer MCP/client identity headers over User-Agent (often blank for Vibe/Mistral).
 */
export function detectClientPlatform(headers = {}) {
    if (hasHeader(headers, "x-vibe-user-id") ||
        hasHeader(headers, "x-vibe-session-id")) {
        return "vibe";
    }
    if (hasHeader(headers, "x-mistral-user-id") ||
        hasHeader(headers, "x-lechat-user-id")) {
        return "mistral";
    }
    const userAgent = (headerValue(headers, "user-agent") ?? "").toLowerCase();
    if (!userAgent) {
        return "unknown";
    }
    if (userAgent.includes("chatgpt") || userAgent.includes("openai")) {
        return "chatgpt";
    }
    if (userAgent.includes("claude") || userAgent.includes("anthropic")) {
        return "claude";
    }
    if (userAgent.includes("cursor")) {
        return "cursor";
    }
    return "unknown";
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
