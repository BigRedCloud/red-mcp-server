import { createHash } from "node:crypto";
import type { Request } from "express";

import {
  ensureConnectionStoreInitialized,
  getMcpSessionContext,
  resolveConnectionIdForActiveSessionWithMeta,
  runWithMcpSessionContext,
} from "./connection_store.js";
import {
  ensureCredentialsForCurrentSession,
  normaliseCompanyName,
  resolveHttpClientKey,
  resolveSessionKeyStore,
  runWithActiveConnectionRef,
  runWithHttpClientKey,
  runWithHttpRequestSessionId,
  runWithSessionKeyStore,
} from "../shared.js";
import {
  extractConnectionRefFromToolArgs,
  prefixConnectionRef,
} from "./connection_ref.js";
import { runWithRedTelemetryContext } from "../telemetry/identity.js";
import {
  activatePreparedTelemetry,
  prepareMcpTelemetryContext,
} from "../telemetry/context.js";
import {
  getStoredSessionPlatform,
  storeSessionPlatform,
} from "../telemetry/platform.js";

export const MCP_SESSION_HEADER_NAMES = [
  "mcp-session-id",
  "x-mcp-session-id",
] as const;

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
] as const;

export type HttpClientKeySource = "stable-identity" | "ip-only";

export type HttpClientKeyResolution = {
  /** Short opaque key used for durable claim storage (never log raw). */
  clientKey: string;
  source: HttpClientKeySource;
  /**
   * True only when the key is derived from stable identity headers.
   * IP-only keys are too volatile for Claude MCP session rotation and must
   * not be used to inherit connections across sessions.
   */
  inheritEligible: boolean;
};

function fingerprintSecretMaterial(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/** Safe diagnostic hash of a client key (never log the key itself). */
export function hashClientKeyForDiagnostics(
  clientKey: string | null | undefined,
): string | null {
  const value = clientKey?.trim();
  if (!value) {
    return null;
  }
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/** Safe diagnostic hash of the current app instance (Azure WEBSITE_INSTANCE_ID). */
export function hashInstanceIdForDiagnostics(): string | null {
  const raw =
    process.env.WEBSITE_INSTANCE_ID?.trim() ||
    process.env.COMPUTERNAME?.trim() ||
    process.env.HOSTNAME?.trim() ||
    "";
  if (!raw) {
    return null;
  }
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

export function hashSessionIdForClientKeyDiagnostics(
  sessionId: string | null | undefined,
): string | null {
  const value = sessionId?.trim();
  if (!value) {
    return null;
  }
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function resolveClientIpFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string {
  const forwardedFor = normalizeHeaderValue(headers["x-forwarded-for"]);
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return (
    normalizeHeaderValue(headers["x-real-ip"]) ??
    normalizeHeaderValue(headers["cf-connecting-ip"]) ??
    "unknown"
  );
}

/**
 * Builds a scoped client key from non-secret request metadata.
 *
 * Prefer stable identity headers (Authorization, x-user-id, …) WITHOUT the
 * request IP — Claude/Azure often rotate source IPs between tool calls, which
 * previously caused confirm and route_request to hash different keys and miss
 * the durable Cosmos claim (clientKeyPresent=true, clientClaimInherited=false).
 *
 * When no stable identity header is present, fall back to an IP-only key that
 * is NOT eligible for cross-session claim inheritance.
 */
export function resolveHttpClientKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  clientIp?: string
): HttpClientKeyResolution {
  const identityParts: string[] = [];

  for (const name of MCP_CLIENT_IDENTITY_HEADER_NAMES) {
    const value = normalizeHeaderValue(headers[name]);
    if (!value) {
      continue;
    }
    identityParts.push(`${name}:${fingerprintSecretMaterial(value)}`);
  }

  if (identityParts.length > 0) {
    identityParts.sort();
    const clientKey = createHash("sha256")
      .update(`stable|${identityParts.join("|")}`, "utf8")
      .digest("hex")
      .slice(0, 16);
    return {
      clientKey,
      source: "stable-identity",
      inheritEligible: true,
    };
  }

  const ip = clientIp?.trim() || resolveClientIpFromHeaders(headers);
  const clientKey = createHash("sha256")
    .update(`ip-only|${ip}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return {
    clientKey,
    source: "ip-only",
    inheritEligible: false,
  };
}

/**
 * @deprecated Prefer resolveHttpClientKeyFromHeaders for inheritEligible.
 * Returns the clientKey string only (stable-identity or ip-only).
 */
export function buildHttpClientKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  clientIp?: string
): string {
  return resolveHttpClientKeyFromHeaders(headers, clientIp).clientKey;
}

export function buildHttpClientKeyFromRequest(req: Request): string {
  return resolveHttpClientKeyFromHeaders(
    req.headers as Record<string, string | string[] | undefined>,
    getClientIpFromRequest(req)
  ).clientKey;
}

export function resolveHttpClientKeyFromRequest(
  req: Request
): HttpClientKeyResolution {
  return resolveHttpClientKeyFromHeaders(
    req.headers as Record<string, string | string[] | undefined>,
    getClientIpFromRequest(req)
  );
}

export function getClientIpFromRequest(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

export function resolveMcpSessionIdFromRequest(req: Request): string | undefined {
  return resolveMcpSessionIdFromHeaders(
    req.headers as Record<string, string | string[] | undefined>
  );
}

export function resolveMcpSessionIdFromExtra(
  extra?: McpToolRequestExtra
): string | undefined {
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

export function buildHttpClientKeyFromExtra(
  extra?: McpToolRequestExtra
): string | undefined {
  return resolveHttpClientKeyDetailsFromExtra(extra)?.clientKey;
}

export function resolveHttpClientKeyDetailsFromExtra(
  extra?: McpToolRequestExtra
): HttpClientKeyResolution | undefined {
  const headers = extra?.requestInfo?.headers;
  if (!headers) {
    return undefined;
  }

  return resolveHttpClientKeyFromHeaders(headers);
}

export function logHttpClientKeyResolved(args: {
  clientKey: string | null | undefined;
  source: string;
  sessionId?: string | null;
  platform?: string | null;
}): void {
  console.info(
    JSON.stringify({
      event: "http_client_key_resolved",
      clientKeyHash: hashClientKeyForDiagnostics(args.clientKey),
      source: args.source,
      sessionHash: hashSessionIdForClientKeyDiagnostics(args.sessionId),
      platform: args.platform ?? "unknown",
      instanceIdHash: hashInstanceIdForDiagnostics(),
    }),
  );
}

export function logConnectionClaimSaved(args: {
  clientKey: string | null | undefined;
  connectionPresent: boolean;
  durableStoreWriteSucceeded: boolean;
}): void {
  console.info(
    JSON.stringify({
      event: "connection_claim_saved",
      clientKeyHash: hashClientKeyForDiagnostics(args.clientKey),
      connectionPresent: args.connectionPresent,
      durableStoreWriteSucceeded: args.durableStoreWriteSucceeded,
      instanceIdHash: hashInstanceIdForDiagnostics(),
    }),
  );
}

export function logConnectionClaimLookup(args: {
  clientKey: string | null | undefined;
  claimFound: boolean;
  connectionPresent: boolean;
}): void {
  console.info(
    JSON.stringify({
      event: "connection_claim_lookup",
      clientKeyHash: hashClientKeyForDiagnostics(args.clientKey),
      claimFound: args.claimFound,
      connectionPresent: args.connectionPresent,
      instanceIdHash: hashInstanceIdForDiagnostics(),
    }),
  );
}

export type McpToolRequestExtra = {
  sessionId?: string;
  requestInfo?: {
    headers?: Record<string, string | string[] | undefined>;
  };
};

export type McpSessionDiagnostic = {
  transportSessionId?: string;
  resolvedSessionId?: string;
  sessionIdSource:
    | "transport"
    | "extra-session-id"
    | "extra-header"
    | "unresolved";
  connectionIdPresent: boolean;
  connectionIdPrefix?: string;
  sessionBindingFound: boolean;
  clientClaimInherited: boolean;
  connectionRefResolved: boolean;
  connectionRefInvalid: boolean;
  connectionRefPresent: boolean;
  connectionRefPrefix?: string;
  clientKeyPresent: boolean;
  clientIdentityHeaderNamesPresent: string[];
  mcpSessionHeaderNamesPresent: string[];
  credentialCount: number;
  companiesLoaded: string[];
  requestedCompany?: string;
  requestedCompanyLoaded?: boolean;
  toolName?: string;
  /** Staging/debug signal — true when Vibe connectionRef flow looks healthy. */
  vibeConnectionHealthy?: boolean;
};

export type VibeConnectionHealthChecks = {
  connectionRefPresent: boolean;
  connectionRefResolved: boolean;
  connectionIdPresent: boolean;
  hasCredentials: boolean;
  connectionRefInvalid: boolean;
};

export type VibeConnectionHealth = {
  healthy: boolean;
  checks: VibeConnectionHealthChecks;
  shouldReconnect: false;
};

/**
 * Safe staging/debug check for a healthy Vibe connectionRef call.
 * Does not log or expose secrets — only boolean flags and counts.
 */
export function assessVibeConnectionHealth(
  diagnostic: Pick<
    McpSessionDiagnostic,
    | "connectionRefPresent"
    | "connectionRefResolved"
    | "connectionIdPresent"
    | "connectionRefInvalid"
    | "credentialCount"
  >
): VibeConnectionHealth {
  const checks: VibeConnectionHealthChecks = {
    connectionRefPresent: diagnostic.connectionRefPresent,
    connectionRefResolved: diagnostic.connectionRefResolved,
    connectionIdPresent: diagnostic.connectionIdPresent,
    hasCredentials: diagnostic.credentialCount > 0,
    connectionRefInvalid: diagnostic.connectionRefInvalid,
  };

  const healthy =
    checks.connectionRefPresent &&
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

function sessionDebugEnabled(): boolean {
  const configured = process.env.RED_CONNECT_SESSION_DEBUG?.trim().toLowerCase();
  if (configured === "false") {
    return false;
  }
  return process.env.RED_CONNECT_HTTP_MODE === "true";
}

export function normalizeHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    const joined = value.map((part) => part.trim()).filter(Boolean).join(", ");
    return joined || undefined;
  }

  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function resolveMcpSessionIdFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  for (const name of MCP_SESSION_HEADER_NAMES) {
    const value = normalizeHeaderValue(headers[name]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function listPresentHeaderNames(
  headers: Record<string, string | string[] | undefined>,
  candidates: readonly string[]
): string[] {
  return candidates.filter((name) => Boolean(normalizeHeaderValue(headers[name])));
}

/**
 * Per-MCP-session client keys captured from the HTTP request layer. Tool handlers
 * often receive `extra` without requestInfo.headers (SDK/host gaps); without this
 * registry, nested tool wrappers drop clientKey and skip claim inheritance —
 * which is exactly why brc_route_request was issuing tokens with no connectionBinding.
 */
const sessionClientKeys = new Map<string, HttpClientKeyResolution>();

export function registerSessionClientKey(
  sessionId: string,
  clientKeyOrResolution: string | HttpClientKeyResolution | undefined,
  inheritEligible = true
): void {
  const id = sessionId.trim();
  if (!id || !clientKeyOrResolution) {
    return;
  }

  const resolution: HttpClientKeyResolution =
    typeof clientKeyOrResolution === "string"
      ? {
          clientKey: clientKeyOrResolution.trim(),
          source: inheritEligible ? "stable-identity" : "ip-only",
          inheritEligible,
        }
      : clientKeyOrResolution;

  if (!resolution.clientKey.trim()) {
    return;
  }
  sessionClientKeys.set(id, resolution);
}

export function getRegisteredSessionClientKey(
  sessionId: string | undefined
): string | undefined {
  return getRegisteredSessionClientKeyResolution(sessionId)?.clientKey;
}

export function getRegisteredSessionClientKeyResolution(
  sessionId: string | undefined
): HttpClientKeyResolution | undefined {
  const id = sessionId?.trim();
  if (!id) {
    return undefined;
  }
  return sessionClientKeys.get(id);
}

export function clearRegisteredSessionClientKey(sessionId: string): void {
  sessionClientKeys.delete(sessionId.trim());
}

/** Test helper. */
export function clearSessionClientKeysForTests(): void {
  sessionClientKeys.clear();
}

/**
 * Resolve the verified client key for claim inheritance.
 * Prefer request headers on this tool call, then the outer HTTP ALS key, then
 * the key registered for this MCP session at request entry.
 *
 * Only inheritEligible keys are returned for claim lookup — IP-only keys are
 * logged but not used to inherit connections across Claude session rotations.
 */
export function resolveClientKeyForToolSession(
  sessionId: string | undefined,
  extra?: McpToolRequestExtra
): string | undefined {
  return resolveClientKeyDetailsForToolSession(sessionId, extra)?.clientKey;
}

export function resolveClientKeyDetailsForToolSession(
  sessionId: string | undefined,
  extra?: McpToolRequestExtra
): HttpClientKeyResolution | undefined {
  const fromExtra = resolveHttpClientKeyDetailsFromExtra(extra);
  if (fromExtra) {
    return fromExtra;
  }

  const fromAls = resolveHttpClientKey()?.trim();
  if (fromAls) {
    const registered = getRegisteredSessionClientKeyResolution(sessionId);
    if (registered) {
      return registered;
    }
    // ALS alone does not prove inherit eligibility (could be a volatile IP-only
    // key). Prefer connectionRef or a registry entry captured at HTTP entry.
    return {
      clientKey: fromAls,
      source: "ip-only",
      inheritEligible: false,
    };
  }

  return getRegisteredSessionClientKeyResolution(sessionId);
}

/** Client key to pass into claim inheritance — undefined when IP-only / ineligible. */
export function clientKeyForClaimInheritance(
  resolution: HttpClientKeyResolution | undefined
): string | undefined {
  if (!resolution?.inheritEligible) {
    return undefined;
  }
  return resolution.clientKey.trim() || undefined;
}

function prefixId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.slice(0, 8);
}

export function logMcpSessionDiagnostic(details: McpSessionDiagnostic): void {
  if (!sessionDebugEnabled()) {
    return;
  }

  console.info("Red MCP session:", JSON.stringify(details));
}

export type HttpToolSessionScope = {
  sessionId: string;
  keyStore: Map<string, import("../shared.js").CompanyApiContext>;
  connectionId: string;
  clientKey?: string;
  resolution: {
    connectionId: string | null;
    sessionBindingFound: boolean;
    clientClaimInherited: boolean;
    connectionRefResolved: boolean;
    connectionRefInvalid: boolean;
  };
};

export async function prepareHttpToolSessionScope(
  sessionId: string,
  keyStore: Map<string, import("../shared.js").CompanyApiContext>,
  clientKeyOrResolution?: string | HttpClientKeyResolution,
  connectionRef?: string
): Promise<HttpToolSessionScope> {
  await ensureConnectionStoreInitialized();

  const resolutionDetails: HttpClientKeyResolution | undefined =
    typeof clientKeyOrResolution === "string"
      ? clientKeyOrResolution.trim()
        ? {
            clientKey: clientKeyOrResolution.trim(),
            // Plain strings from older call sites / tests are treated as
            // inherit-eligible stable keys (explicit test fixtures).
            source: "stable-identity",
            inheritEligible: true,
          }
        : undefined
      : clientKeyOrResolution;

  if (resolutionDetails) {
    registerSessionClientKey(sessionId, resolutionDetails);
  }

  const inheritKey = clientKeyForClaimInheritance(resolutionDetails);

  const resolution = await resolveConnectionIdForActiveSessionWithMeta({
    sessionId,
    clientKey: inheritKey,
    connectionRef,
  });

  if (resolutionDetails) {
    logConnectionClaimLookup({
      clientKey: resolutionDetails.clientKey,
      claimFound: resolution.clientClaimInherited,
      connectionPresent: Boolean(resolution.connectionId),
    });
  }

  return {
    sessionId,
    keyStore,
    connectionId: resolution.connectionId ?? "",
    clientKey: resolutionDetails?.clientKey,
    resolution,
  };
}

export async function runWithHttpToolSession<T>(
  scope: HttpToolSessionScope,
  fn: () => Promise<T> | T
): Promise<T> {
  const runScoped = async () => {
    await ensureCredentialsForCurrentSession();
    return fn();
  };

  if (scope.clientKey) {
    return runWithHttpRequestSessionId(scope.sessionId, () =>
      runWithHttpClientKey(scope.clientKey!, () =>
        runWithSessionKeyStore(scope.keyStore, () =>
          runWithMcpSessionContext(
            {
              sessionId: scope.sessionId,
              connectionId: scope.connectionId,
            },
            runScoped
          )
        )
      )
    );
  }

  return runWithHttpRequestSessionId(scope.sessionId, () =>
    runWithSessionKeyStore(scope.keyStore, () =>
      runWithMcpSessionContext(
        {
          sessionId: scope.sessionId,
          connectionId: scope.connectionId,
        },
        runScoped
      )
    )
  );
}

export async function runHttpToolSessionFromExtra<T>(
  transportSessionId: string | undefined,
  keyStore: Map<string, import("../shared.js").CompanyApiContext> | undefined,
  extra: McpToolRequestExtra | undefined,
  fn: () => Promise<T> | T,
  options?: {
    connectionRef?: string;
    companyName?: string;
    toolName?: string;
  }
): Promise<T> {
  if (!process.env.RED_CONNECT_HTTP_MODE) {
    return fn();
  }

  const outerContext = getMcpSessionContext();
  const sessionId =
    transportSessionId?.trim() || resolveMcpSessionIdFromExtra(extra);
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
  // Critical: tool `extra` often omits requestInfo.headers. Fall back to the
  // HTTP-request ALS client key and the per-session registry so route_request
  // inherits the same verified client claim as transactional tools.
  const clientKeyDetails = resolveClientKeyDetailsForToolSession(
    sessionId,
    extra
  );
  if (clientKeyDetails) {
    registerSessionClientKey(sessionId, clientKeyDetails);
  }
  const clientKey = clientKeyDetails?.clientKey;

  const headers = (extra?.requestInfo?.headers ?? {}) as Record<
    string,
    string | string[] | undefined
  >;

  // Restore platform before telemetry context so blank UAs keep the initialize result.
  const storedPlatform = getStoredSessionPlatform(sessionId);

  const prepared = await prepareMcpTelemetryContext({
    sessionId,
    keyStore: store,
    clientKey,
    connectionRef,
    headers,
    toolName: options?.toolName,
    companyName: options?.companyName,
    storedPlatform,
  });

  if (prepared.platformDetection.platform !== "unknown") {
    storeSessionPlatform(sessionId, prepared.platformDetection.platform);
  }

  const scope = await prepareHttpToolSessionScope(
    sessionId,
    store,
    clientKeyDetails,
    connectionRef
  );

  if (!scope.connectionId && prepared.connectionId) {
    scope.connectionId = prepared.connectionId;
  }

  // Nested tool wrappers must not wipe a connection the outer HTTP request
  // already resolved for this same session (claim inheritance / binding).
  if (
    !scope.connectionId?.trim() &&
    outerContext?.connectionId?.trim() &&
    outerContext.sessionId === sessionId
  ) {
    scope.connectionId = outerContext.connectionId.trim();
  }

  return runWithActiveConnectionRef(connectionRef, () =>
    runWithHttpToolSession(scope, async () =>
      runWithRedTelemetryContext(prepared.context, async () => {
        activatePreparedTelemetry(prepared);
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
      })
    )
  );
}

export function buildMcpSessionDiagnostic(args: {
  transportSessionId?: string;
  extra?: McpToolRequestExtra;
  resolution?: {
    connectionId: string | null;
    sessionBindingFound: boolean;
    clientClaimInherited: boolean;
    connectionRefResolved: boolean;
    connectionRefInvalid: boolean;
  };
  connectionRef?: string;
  credentialCount?: number;
  companiesLoaded?: string[];
  requestedCompany?: string;
  requestedCompanyLoaded?: boolean;
  toolName?: string;
}): McpSessionDiagnostic {
  const headers = args.extra?.requestInfo?.headers ?? {};

  let sessionIdSource: McpSessionDiagnostic["sessionIdSource"] = "unresolved";
  let resolvedSessionId = args.transportSessionId?.trim();

  if (resolvedSessionId) {
    sessionIdSource = "transport";
  } else if (args.extra?.sessionId?.trim()) {
    resolvedSessionId = args.extra.sessionId.trim();
    sessionIdSource = "extra-session-id";
  } else {
    const fromHeader = resolveMcpSessionIdFromExtra(args.extra);
    if (fromHeader) {
      resolvedSessionId = fromHeader;
      sessionIdSource = "extra-header";
    }
  }

  const diagnostic: McpSessionDiagnostic = {
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
    clientKeyPresent: Boolean(
      buildHttpClientKeyFromExtra(args.extra) ||
        resolveHttpClientKey() ||
        getRegisteredSessionClientKey(resolvedSessionId)
    ),
    clientIdentityHeaderNamesPresent: listPresentHeaderNames(
      headers,
      MCP_CLIENT_IDENTITY_HEADER_NAMES
    ),
    mcpSessionHeaderNamesPresent: listPresentHeaderNames(
      headers,
      MCP_SESSION_HEADER_NAMES
    ),
    credentialCount: args.credentialCount ?? 0,
    companiesLoaded: args.companiesLoaded ?? [],
    requestedCompany: args.requestedCompany,
    requestedCompanyLoaded: args.requestedCompanyLoaded,
    toolName: args.toolName,
  };

  diagnostic.vibeConnectionHealthy = assessVibeConnectionHealth(diagnostic).healthy;

  return diagnostic;
}

function listLoadedCompanyNames(
  keyStore: Map<string, import("../shared.js").CompanyApiContext>
): string[] {
  return Array.from(keyStore.values()).map((entry) => entry.companyName);
}

async function logToolSessionDiagnosticIfNeeded(args: {
  transportSessionId?: string;
  sessionId: string;
  keyStore: Map<string, import("../shared.js").CompanyApiContext>;
  scope: HttpToolSessionScope;
  extra?: McpToolRequestExtra;
  connectionRef?: string;
  companyName?: string;
  toolName?: string;
}): Promise<void> {
  if (!sessionDebugEnabled()) {
    return;
  }

  const companiesLoaded = listLoadedCompanyNames(args.keyStore);
  const requestedCompany = args.companyName?.trim();
  const requestedCompanyLoaded = requestedCompany
    ? args.keyStore.has(normaliseCompanyName(requestedCompany))
    : undefined;

  logMcpSessionDiagnostic(
    buildMcpSessionDiagnostic({
      transportSessionId: args.transportSessionId ?? args.sessionId,
      extra: args.extra,
      resolution: args.scope.resolution,
      connectionRef: args.connectionRef,
      credentialCount: companiesLoaded.length,
      companiesLoaded,
      requestedCompany,
      requestedCompanyLoaded,
      toolName: args.toolName,
    })
  );
}

/**
 * Wraps an MCP tool handler so HTTP tool calls re-bind the active session using
 * transport session id and/or MCP SDK request extra metadata.
 */
export function wrapHttpSessionAwareToolHandler<
  TArgs extends Record<string, unknown>,
  TResult,
>(
  handler: (
    args: TArgs,
    extra?: McpToolRequestExtra
  ) => Promise<TResult> | TResult,
  options?: {
    transportSessionId?: string;
    keyStore?: Map<string, import("../shared.js").CompanyApiContext>;
    toolName?: string;
  }
): (args: TArgs, extra?: McpToolRequestExtra) => Promise<TResult> {
  return async (args, extra) => {
    const connectionRef = extractConnectionRefFromToolArgs(args);
    const companyName =
      typeof args.companyName === "string" ? args.companyName : undefined;

    return runHttpToolSessionFromExtra(
      options?.transportSessionId,
      options?.keyStore,
      extra,
      () => handler(args, extra),
      {
        connectionRef,
        companyName,
        toolName: options?.toolName,
      }
    );
  };
}
