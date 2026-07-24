/**
 * Client platform and deployment environment helpers for Red telemetry.
 */

export type RedClientPlatform =
  | "vibe"
  | "mistral"
  | "chatgpt"
  | "claude"
  | "cursor"
  | "unknown";

export type RedTelemetryEnvironment = "staging" | "production" | "development" | "test";

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return typeof raw[0] === "string" ? raw[0].trim() : undefined;
  }
  return typeof raw === "string" ? raw.trim() : undefined;
}

function hasHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): boolean {
  const value = headerValue(headers, name);
  return Boolean(value);
}

/**
 * Prefer MCP/client identity headers over User-Agent (often blank for Vibe/Mistral).
 */
export function detectClientPlatform(
  headers: Record<string, string | string[] | undefined> = {}
): RedClientPlatform {
  if (
    hasHeader(headers, "x-vibe-user-id") ||
    hasHeader(headers, "x-vibe-session-id")
  ) {
    return "vibe";
  }

  if (
    hasHeader(headers, "x-mistral-user-id") ||
    hasHeader(headers, "x-lechat-user-id")
  ) {
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

export function resolveRedTelemetryEnvironment(
  env: NodeJS.ProcessEnv = process.env
): RedTelemetryEnvironment {
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
