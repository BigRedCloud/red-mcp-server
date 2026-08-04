/**
 * Opaque short-lived route tokens issued by brc_route_request for action mode.
 *
 * A routeToken is routing permission only — it does not replace preview-before-posting
 * or explicit user confirmation (confirmWrite).
 *
 * Tokens are HMAC-signed (stateless verification) with an in-memory consume set for
 * one-time use after a confirmed write. They contain no credentials.
 *
 * When issued while a company connection is active, the token also carries an HMAC
 * connectionBinding (never a raw connection id). That binding allows MCP session
 * rotation / rehydration when the transactional call resolves the same connection
 * (including via connectionRef), without requiring the issuing session record to
 * still exist in memory or Cosmos.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import { getToolSkillGroup } from "../config/server_config.js";
import {
  getBoundConnectionIdForSession,
  getCurrentMcpSessionId,
  getMcpSessionContext,
  resolveConnectionIdForActiveSessionWithMeta,
} from "../auth/connection_store.js";
import { isWriteActionConfirmed } from "../guards/write_confirmation.js";
import {
  getActiveConnectionRef,
  jsonResponse,
  resolveActiveMcpSessionId,
  resolveHttpClientKey,
} from "../shared.js";

export const ROUTE_TOKEN_TTL_MS = 5 * 60 * 1000;
export const ROUTE_TOKEN_SIGNING_SECRET_ENV = "BRC_ROUTE_TOKEN_SIGNING_SECRET";
export const ROUTE_TOKEN_PREFIX = "redroute_";

export const ROUTE_REQUIRED_ERROR = "route_required";
export const ROUTE_REQUIRED_MESSAGE =
  "Call brc_route_request first with the user's complete original request, then use the returned routeToken for the permitted workflow.";

export type RouteTokenSigningSecretSource = "configured" | "ephemeral";

export type RouteTokenPayload = {
  jti: string;
  mode: "action";
  workflow: string;
  allowedTools: string[];
  messageHash: string;
  sessionId: string;
  /**
   * HMAC of the active connection id when the token was issued while connected.
   * Never a raw connection id or connectionRef. Absent when issued with no connection
   * (strict session binding only).
   */
  connectionBinding?: string;
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
    | "wrong_workflow"
    | "wrong_message"
    | "consumed"
    | "altered";
  /** Present when the signed payload was parsed before a later check failed. */
  payload?: RouteTokenPayload;
};

export type RouteTokenValidationResult =
  | RouteTokenValidationOk
  | RouteTokenValidationFail;

const consumedTokens = new Map<string, number>();
let pinnedSigningSecret: {
  value: string;
  source: RouteTokenSigningSecretSource;
} | null = null;
let loggedEphemeralHttpWarning = false;

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

/** SHA-256 hex of a session id for safe diagnostic logs (never log raw ids). */
export function hashSessionIdForDiagnostics(
  sessionId: string | null | undefined,
): string {
  const value = (sessionId ?? "").trim() || "anonymous";
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/**
 * Resolve and pin the HMAC signing secret for this process.
 *
 * The first successful resolve is pinned so a late-loaded env var cannot flip
 * from ephemeral → configured mid-flight (which would invalidate issued tokens).
 * Multi-instance HTTP deployments must set BRC_ROUTE_TOKEN_SIGNING_SECRET to the
 * same value on every instance — ephemeral secrets differ per process.
 */
export function getRouteTokenSigningSecretInfo(): {
  value: string;
  source: RouteTokenSigningSecretSource;
} {
  if (pinnedSigningSecret) {
    return pinnedSigningSecret;
  }

  const fromEnv = process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV]?.trim();
  if (fromEnv) {
    pinnedSigningSecret = { value: fromEnv, source: "configured" };
  } else {
    pinnedSigningSecret = {
      value: randomBytes(32).toString("hex"),
      source: "ephemeral",
    };
    maybeWarnEphemeralSecretInHttpMode();
  }
  return pinnedSigningSecret;
}

function maybeWarnEphemeralSecretInHttpMode(): void {
  if (loggedEphemeralHttpWarning) {
    return;
  }
  if (!process.env.RED_CONNECT_HTTP_MODE) {
    return;
  }
  loggedEphemeralHttpWarning = true;
  console.error(
    JSON.stringify({
      event: "route_token_ephemeral_signing_secret",
      message:
        "BRC_ROUTE_TOKEN_SIGNING_SECRET is missing or blank; using an ephemeral process secret. Tokens will not verify across application instances or process restarts.",
      signingSecretSource: "ephemeral",
    }),
  );
}

function getSigningSecret(): string {
  return getRouteTokenSigningSecretInfo().value;
}

export function getRouteTokenSigningSecretSource(): RouteTokenSigningSecretSource {
  return getRouteTokenSigningSecretInfo().source;
}

/** Test helper — reset ephemeral secret and consumed set. */
export function resetRouteTokenStateForTests(options?: {
  signingSecret?: string | null;
}): void {
  consumedTokens.clear();
  pinnedSigningSecret = null;
  loggedEphemeralHttpWarning = false;
  if (options && "signingSecret" in options) {
    if (options.signingSecret) {
      process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV] = options.signingSecret;
    } else {
      delete process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV];
    }
  }
}

export function hashRouteMessage(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

/**
 * Stable HMAC binding for a connection id. Uses the route-token signing secret so
 * the value cannot be forged without the secret and matches across app instances
 * that share BRC_ROUTE_TOKEN_SIGNING_SECRET. Never embed or log the raw id.
 */
export function hashConnectionIdForBinding(connectionId: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(`route-connection-binding:${connectionId.trim()}`, "utf8")
    .digest("hex");
}

export function connectionBindingsMatch(
  tokenBinding: string | null | undefined,
  connectionId: string | null | undefined,
): boolean {
  const binding = tokenBinding?.trim();
  const id = connectionId?.trim();
  if (!binding || !id) {
    return false;
  }
  return safeEqualText(binding, hashConnectionIdForBinding(id));
}

/**
 * Resolve the active company connection for route-token issue/validation.
 * Prefers an explicit id, then a non-empty MCP session context connection id
 * (set after connectionRef / session binding / client-claim resolution), then
 * the same verified resolution path transactional tools use.
 */
export async function resolveConnectionIdForRouteToken(options?: {
  connectionId?: string | null;
  sessionId?: string | null;
}): Promise<string | null> {
  const explicit = options?.connectionId?.trim();
  if (explicit) {
    return explicit;
  }

  const fromContext = getMcpSessionContext()?.connectionId?.trim();
  if (fromContext) {
    return fromContext;
  }

  const sessionId = resolveRouteSessionId(options?.sessionId);
  if (!sessionId || sessionId === "anonymous") {
    return null;
  }

  const bound = await getBoundConnectionIdForSession(sessionId);
  if (bound?.trim()) {
    return bound.trim();
  }

  // Same path as transactional tools: inherit a recent verified client claim.
  const resolution = await resolveConnectionIdForActiveSessionWithMeta({
    sessionId,
    clientKey: resolveHttpClientKey(),
    connectionRef: getActiveConnectionRef(),
  });

  return resolution.connectionId?.trim() || null;
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

function resolveRouteSessionId(explicit?: string | null): string {
  const resolved =
    (
      explicit ??
      resolveActiveMcpSessionId() ??
      getCurrentMcpSessionId() ??
      "anonymous"
    ).trim() || "anonymous";
  return resolved;
}

export function issueActionRouteToken(args: {
  workflow: string;
  allowedTools: readonly string[];
  message: string;
  sessionId?: string | null;
  /** Active company connection id when known — hashed into connectionBinding. */
  connectionId?: string | null;
  now?: number;
  ttlMs?: number;
}): { routeToken: string; payload: RouteTokenPayload } {
  const now = args.now ?? Date.now();
  const ttlMs = args.ttlMs ?? ROUTE_TOKEN_TTL_MS;
  const sessionId = resolveRouteSessionId(args.sessionId);
  // Only bind when a real connection id is known — never the local-stdio fallback.
  const connectionId =
    args.connectionId?.trim() ||
    getMcpSessionContext()?.connectionId?.trim() ||
    "";

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

  if (connectionId) {
    payload.connectionBinding = hashConnectionIdForBinding(connectionId);
  }

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

export type ValidateRouteTokenOptions = {
  toolName: string;
  sessionId?: string | null;
  /**
   * Already-resolved active connection id for this request (from session context
   * or connectionRef). Compared via HMAC to payload.connectionBinding when the
   * MCP session id has rotated.
   */
  connectionId?: string | null;
  now?: number;
  /** When provided, must match the workflow embedded in the token. */
  workflow?: string;
  /**
   * When provided, must hash to the token's messageHash. Transactional wrappers
   * do not pass this — the hash is integrity-protected by the HMAC signature.
   */
  message?: string;
};

/**
 * Session / connection continuity check.
 *
 * - Same session → allow.
 * - Different session + matching connectionBinding ↔ current connectionId → allow
 *   (Claude/Vibe session rotation with the same company connection).
 * - Different session without a token connectionBinding → strict wrong_session
 *   (token was issued before any connection existed).
 * - Different session with binding but no/ mismatched current connection → reject.
 *
 * Presence of an arbitrary connectionRef alone is never enough.
 */
export function sessionOrConnectionAllowsToken(
  payload: RouteTokenPayload,
  options: {
    sessionId?: string | null;
    connectionId?: string | null;
  },
): boolean {
  const currentSession = resolveRouteSessionId(options.sessionId);
  if (!payload.sessionId || payload.sessionId === currentSession) {
    return true;
  }

  const tokenBinding = payload.connectionBinding?.trim();
  if (!tokenBinding) {
    return false;
  }

  return connectionBindingsMatch(tokenBinding, options.connectionId);
}

export function validateRouteToken(
  token: unknown,
  options: ValidateRouteTokenOptions,
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
    return { ok: false, reason: "wrong_mode", payload };
  }

  if (payload.exp <= now) {
    return { ok: false, reason: "expired", payload };
  }

  if (isRouteTokenConsumed(payload.jti)) {
    return { ok: false, reason: "consumed", payload };
  }

  if (
    !sessionOrConnectionAllowsToken(payload, {
      sessionId: options.sessionId,
      connectionId: options.connectionId,
    })
  ) {
    return { ok: false, reason: "wrong_session", payload };
  }

  if (options.workflow && payload.workflow !== options.workflow) {
    return { ok: false, reason: "wrong_workflow", payload };
  }

  if (
    options.message !== undefined &&
    payload.messageHash !== hashRouteMessage(options.message)
  ) {
    return { ok: false, reason: "wrong_message", payload };
  }

  if (!payload.allowedTools.includes(options.toolName)) {
    return { ok: false, reason: "wrong_tool", payload };
  }

  return { ok: true, payload };
}

/**
 * Validate a route token for a transactional tool. Resolves the active connection
 * first (session context / connectionRef already applied by the HTTP wrapper),
 * then compares session id or connectionBinding.
 */
export async function validateRouteTokenForTool(
  token: unknown,
  options: ValidateRouteTokenOptions,
): Promise<RouteTokenValidationResult> {
  const connectionId =
    options.connectionId?.trim() ||
    (await resolveConnectionIdForRouteToken({
      sessionId: options.sessionId,
    }));

  const result = validateRouteToken(token, {
    ...options,
    connectionId,
  });

  if (!result.ok) {
    logRouteTokenValidationFailure(result, {
      ...options,
      connectionId,
    });
  }

  return result;
}

/**
 * Safe diagnostic telemetry when an action routeToken is issued.
 * Never logs session ids, client keys, connection ids, connectionRefs, or tokens.
 */
export function logRouteTokenIssued(args: {
  workflow: string;
  connectionIdPresent: boolean;
  sessionBindingFound: boolean;
  clientClaimInherited: boolean;
  connectionRefResolved: boolean;
  connectionBindingAdded: boolean;
  platform: string;
}): void {
  console.info(
    JSON.stringify({
      event: "route_token_issued",
      workflow: args.workflow,
      connectionIdPresent: args.connectionIdPresent,
      sessionBindingFound: args.sessionBindingFound,
      clientClaimInherited: args.clientClaimInherited,
      connectionRefResolved: args.connectionRefResolved,
      connectionBindingAdded: args.connectionBindingAdded,
      platform: args.platform,
    }),
  );
}

/**
 * Safe diagnostic telemetry for route-token validation failures.
 * Never logs the token, signature, customer data, connectionRef, connection ids,
 * or credentials.
 */
export function logRouteTokenValidationFailure(
  failure: RouteTokenValidationFail,
  options: {
    toolName: string;
    sessionId?: string | null;
    connectionId?: string | null;
  },
): void {
  const currentSession = resolveRouteSessionId(options.sessionId);
  const tokenSession = failure.payload?.sessionId;
  const now = Date.now();
  const expired =
    typeof failure.payload?.exp === "number"
      ? failure.payload.exp <= now
      : failure.reason === "expired";
  const connectionBindingPresent = Boolean(
    failure.payload?.connectionBinding?.trim(),
  );
  const currentConnectionPresent = Boolean(options.connectionId?.trim());

  console.info(
    JSON.stringify({
      event: "route_token_validation_failed",
      rejectionReason: failure.reason,
      expectedSessionHash: hashSessionIdForDiagnostics(tokenSession),
      actualSessionHash: hashSessionIdForDiagnostics(currentSession),
      workflow: failure.payload?.workflow ?? null,
      toolName: options.toolName,
      tokenExpired: expired,
      signingSecretSource: getRouteTokenSigningSecretSource(),
      connectionBindingPresent,
      currentConnectionPresent,
      connectionBindingMatched:
        connectionBindingPresent && currentConnectionPresent
          ? connectionBindingsMatch(
              failure.payload?.connectionBinding,
              options.connectionId,
            )
          : false,
    }),
  );
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
 *
 * Expects the HTTP session wrapper to have already resolved connectionRef /
 * session binding into MCP session context so getCurrentConnectionId() is set.
 */
export function wrapRouteTokenHandler<T extends Record<string, unknown>>(
  toolName: string,
  handler: (args: T) => Promise<unknown> | unknown,
): (args: T) => Promise<unknown> | unknown {
  if (!requiresRouteToken(toolName)) {
    return handler;
  }

  return async (args: T) => {
    const sessionId =
      resolveActiveMcpSessionId() ?? getCurrentMcpSessionId() ?? null;
    // Connection must already be resolved by wrapHttpSessionAwareToolHandler
    // (outer wrapper) before this guard runs. Use context only — not the
    // local-stdio fallback — so unconnected sessions stay session-bound.
    const connectionId =
      getMcpSessionContext()?.connectionId?.trim() || null;
    const validation = await validateRouteTokenForTool(args.routeToken, {
      toolName,
      sessionId,
      connectionId,
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
