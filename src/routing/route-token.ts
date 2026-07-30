/**
 * Opaque short-lived route tokens issued by brc_route_request for action mode.
 *
 * A routeToken is routing permission only — it does not replace preview-before-posting
 * or explicit user confirmation (confirmWrite).
 *
 * Tokens are HMAC-signed (stateless verification) with an in-memory consume set for
 * one-time use after a confirmed write. They contain no credentials.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import { getToolSkillGroup } from "../config/server_config.js";
import { getCurrentMcpSessionId } from "../auth/connection_store.js";
import { isWriteActionConfirmed } from "../guards/write_confirmation.js";
import { jsonResponse } from "../shared.js";

export const ROUTE_TOKEN_TTL_MS = 5 * 60 * 1000;
export const ROUTE_TOKEN_SIGNING_SECRET_ENV = "BRC_ROUTE_TOKEN_SIGNING_SECRET";
export const ROUTE_TOKEN_PREFIX = "redroute_";

export const ROUTE_REQUIRED_ERROR = "route_required";
export const ROUTE_REQUIRED_MESSAGE =
  "Call brc_route_request first with the user's complete original request, then use the returned routeToken for the permitted workflow.";

export type RouteTokenPayload = {
  jti: string;
  mode: "action";
  workflow: string;
  allowedTools: string[];
  messageHash: string;
  sessionId: string;
  iat: number;
  exp: number;
};

export type RouteTokenValidationOk = {
  ok: true;
  payload: RouteTokenPayload;
};

export type RouteTokenValidationFail = {
  ok: false;
  reason:
    | "missing"
    | "malformed"
    | "bad_signature"
    | "expired"
    | "wrong_mode"
    | "wrong_session"
    | "wrong_tool"
    | "consumed"
    | "altered";
};

export type RouteTokenValidationResult =
  | RouteTokenValidationOk
  | RouteTokenValidationFail;

const consumedTokens = new Map<string, number>();
let ephemeralSigningSecret: string | null = null;

export const routeTokenSchema = z
  .string()
  .min(1)
  .describe(
    "Opaque routeToken from brc_route_request for this action workflow. Required for transactional tools. Routing permission only — does not replace preview-before-posting or confirmWrite.",
  );

export const ROUTE_TOKEN_TOOL_SUFFIX =
  " Requires routeToken from brc_route_request for the matching action workflow. Call brc_route_request first with the user's complete original message. A routeToken is not permission to post — preview-before-posting and confirmWrite still apply.";

function toBase64Url(value: Buffer | string): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    return Buffer.from(normalized + padding, "base64");
  } catch {
    return null;
  }
}

function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function getSigningSecret(): string {
  const fromEnv = process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (!ephemeralSigningSecret) {
    ephemeralSigningSecret = randomBytes(32).toString("hex");
  }
  return ephemeralSigningSecret;
}

/** Test helper — reset ephemeral secret and consumed set. */
export function resetRouteTokenStateForTests(options?: {
  signingSecret?: string;
}): void {
  consumedTokens.clear();
  ephemeralSigningSecret = null;
  if (options?.signingSecret) {
    process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV] = options.signingSecret;
  }
}

export function hashRouteMessage(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

/**
 * Transactional accounting tools that require an action routeToken.
 * Help, connection, session, read, and most dev tools are exempt.
 */
export function requiresRouteToken(toolName: string): boolean {
  const group = getToolSkillGroup(toolName);
  return (
    group === "update" ||
    group === "delete" ||
    group === "batch" ||
    group === "email"
  );
}

function pruneConsumed(now: number): void {
  for (const [jti, exp] of consumedTokens) {
    if (exp <= now) {
      consumedTokens.delete(jti);
    }
  }
}

export function markRouteTokenConsumed(
  jti: string,
  expMs: number = Date.now() + ROUTE_TOKEN_TTL_MS,
): void {
  pruneConsumed(Date.now());
  consumedTokens.set(jti, expMs);
}

export function isRouteTokenConsumed(jti: string): boolean {
  pruneConsumed(Date.now());
  return consumedTokens.has(jti);
}

export function issueActionRouteToken(args: {
  workflow: string;
  allowedTools: readonly string[];
  message: string;
  sessionId?: string | null;
  now?: number;
  ttlMs?: number;
}): { routeToken: string; payload: RouteTokenPayload } {
  const now = args.now ?? Date.now();
  const ttlMs = args.ttlMs ?? ROUTE_TOKEN_TTL_MS;
  const sessionId =
    (args.sessionId ?? getCurrentMcpSessionId() ?? "anonymous").trim() ||
    "anonymous";

  const payload: RouteTokenPayload = {
    jti: randomBytes(16).toString("hex"),
    mode: "action",
    workflow: args.workflow,
    allowedTools: [...args.allowedTools],
    messageHash: hashRouteMessage(args.message),
    sessionId,
    iat: now,
    exp: now + ttlMs,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(
    createHmac("sha256", getSigningSecret())
      .update(encodedPayload, "utf8")
      .digest(),
  );

  return {
    routeToken: `${ROUTE_TOKEN_PREFIX}${encodedPayload}.${signature}`,
    payload,
  };
}

function parseAndVerifySignature(
  token: string,
): { payload: RouteTokenPayload } | RouteTokenValidationFail {
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (!trimmed) {
    return { ok: false, reason: "missing" };
  }

  const withoutPrefix = trimmed.startsWith(ROUTE_TOKEN_PREFIX)
    ? trimmed.slice(ROUTE_TOKEN_PREFIX.length)
    : trimmed;

  const separatorIndex = withoutPrefix.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= withoutPrefix.length - 1) {
    return { ok: false, reason: "malformed" };
  }

  const encodedPayload = withoutPrefix.slice(0, separatorIndex);
  const encodedSignature = withoutPrefix.slice(separatorIndex + 1);
  const expected = toBase64Url(
    createHmac("sha256", getSigningSecret())
      .update(encodedPayload, "utf8")
      .digest(),
  );

  if (!safeEqualText(encodedSignature, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  const payloadBuffer = fromBase64Url(encodedPayload);
  if (!payloadBuffer) {
    return { ok: false, reason: "malformed" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuffer.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as RouteTokenPayload).mode !== "action" ||
    typeof (parsed as RouteTokenPayload).jti !== "string" ||
    typeof (parsed as RouteTokenPayload).workflow !== "string" ||
    !Array.isArray((parsed as RouteTokenPayload).allowedTools) ||
    typeof (parsed as RouteTokenPayload).exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  return { payload: parsed as RouteTokenPayload };
}

export function validateRouteToken(
  token: unknown,
  options: {
    toolName: string;
    sessionId?: string | null;
    now?: number;
  },
): RouteTokenValidationResult {
  if (typeof token !== "string" || !token.trim()) {
    return { ok: false, reason: "missing" };
  }

  const verified = parseAndVerifySignature(token);
  if ("ok" in verified && verified.ok === false) {
    return verified;
  }

  const { payload } = verified as { payload: RouteTokenPayload };
  const now = options.now ?? Date.now();

  if (payload.mode !== "action") {
    return { ok: false, reason: "wrong_mode" };
  }

  if (payload.exp <= now) {
    return { ok: false, reason: "expired" };
  }

  if (isRouteTokenConsumed(payload.jti)) {
    return { ok: false, reason: "consumed" };
  }

  const currentSession =
    (options.sessionId ?? getCurrentMcpSessionId() ?? "anonymous").trim() ||
    "anonymous";
  if (payload.sessionId && payload.sessionId !== currentSession) {
    return { ok: false, reason: "wrong_session" };
  }

  if (!payload.allowedTools.includes(options.toolName)) {
    return { ok: false, reason: "wrong_tool" };
  }

  return { ok: true, payload };
}

export function buildRouteRequiredResponse(): ReturnType<typeof jsonResponse> {
  return jsonResponse({
    error: ROUTE_REQUIRED_ERROR,
    message: ROUTE_REQUIRED_MESSAGE,
  });
}

export function appendRouteTokenDescription(description: string): string {
  if (description.includes("routeToken")) {
    return description;
  }
  return `${description}${ROUTE_TOKEN_TOOL_SUFFIX}`;
}

/**
 * Guard wrapper: reject transactional tools without a valid action routeToken
 * before any lookup or write. Consumes the token after a confirmed write.
 */
export function wrapRouteTokenHandler<T extends Record<string, unknown>>(
  toolName: string,
  handler: (args: T) => Promise<unknown> | unknown,
): (args: T) => Promise<unknown> | unknown {
  if (!requiresRouteToken(toolName)) {
    return handler;
  }

  return async (args: T) => {
    const validation = validateRouteToken(args.routeToken, {
      toolName,
      sessionId: getCurrentMcpSessionId(),
    });

    if (!validation.ok) {
      return buildRouteRequiredResponse();
    }

    const result = await handler(args);

    if (isWriteActionConfirmed(args as Record<string, unknown>)) {
      markRouteTokenConsumed(validation.payload.jti, validation.payload.exp);
    }

    return result;
  };
}

/** Test helper: forge an unsigned/altered token string from a payload. */
export function encodeRouteTokenForTests(
  payload: RouteTokenPayload,
  options?: { signature?: string; signingSecret?: string },
): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature =
    options?.signature ??
    toBase64Url(
      createHmac("sha256", options?.signingSecret ?? getSigningSecret())
        .update(encodedPayload, "utf8")
        .digest(),
    );
  return `${ROUTE_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}
