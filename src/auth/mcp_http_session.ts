import { createHash } from "node:crypto";
import type { Request } from "express";

import {
  ensureConnectionStoreInitialized,
  resolveConnectionIdForActiveSessionWithMeta,
  runWithMcpSessionContext,
} from "./connection_store.js";
import {
  ensureCredentialsForCurrentSession,
  runWithHttpClientKey,
  resolveSessionKeyStore,
  runWithHttpRequestSessionId,
  runWithSessionKeyStore,
} from "../shared.js";

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
  clientKeyPresent: boolean;
  clientIdentityHeaderNamesPresent: string[];
  mcpSessionHeaderNamesPresent: string[];
  credentialCount: number;
  companiesLoaded: string[];
};

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

function fingerprintSecretMaterial(value: string): string {
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
 * Includes IP plus hashed optional identity headers (for example Authorization)
 * so hosted clients that rotate MCP session ids can still inherit safely when
 * a stable per-user token is present.
 */
export function buildHttpClientKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  clientIp?: string
): string {
  const ip = clientIp?.trim() || resolveClientIpFromHeaders(headers);
  const identityParts: string[] = [];

  for (const name of MCP_CLIENT_IDENTITY_HEADER_NAMES) {
    const value = normalizeHeaderValue(headers[name]);
    if (!value) {
      continue;
    }

    identityParts.push(`${name}:${fingerprintSecretMaterial(value)}`);
  }

  const material = [ip, ...identityParts].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}

export function buildHttpClientKeyFromRequest(req: Request): string {
  return buildHttpClientKeyFromHeaders(
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
  const headers = extra?.requestInfo?.headers;
  if (!headers) {
    return undefined;
  }

  return buildHttpClientKeyFromHeaders(headers);
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
  };
};

export async function prepareHttpToolSessionScope(
  sessionId: string,
  keyStore: Map<string, import("../shared.js").CompanyApiContext>,
  clientKey?: string
): Promise<HttpToolSessionScope> {
  await ensureConnectionStoreInitialized();

  const resolution = await resolveConnectionIdForActiveSessionWithMeta({
    sessionId,
    clientKey,
  });

  return {
    sessionId,
    keyStore,
    connectionId: resolution.connectionId ?? "",
    clientKey,
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
  fn: () => Promise<T> | T
): Promise<T> {
  if (!process.env.RED_CONNECT_HTTP_MODE) {
    return fn();
  }

  const sessionId =
    transportSessionId?.trim() || resolveMcpSessionIdFromExtra(extra);

  if (!sessionId) {
    return fn();
  }

  const store = keyStore ?? resolveSessionKeyStore(sessionId);
  const clientKey = buildHttpClientKeyFromExtra(extra);
  const scope = await prepareHttpToolSessionScope(sessionId, store, clientKey);

  return runWithHttpToolSession(scope, fn);
}

export function buildMcpSessionDiagnostic(args: {
  transportSessionId?: string;
  extra?: McpToolRequestExtra;
  resolution?: {
    connectionId: string | null;
    sessionBindingFound: boolean;
    clientClaimInherited: boolean;
  };
  credentialCount?: number;
  companiesLoaded?: string[];
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

  return {
    transportSessionId: prefixId(args.transportSessionId),
    resolvedSessionId: prefixId(resolvedSessionId),
    sessionIdSource,
    connectionIdPresent: Boolean(args.resolution?.connectionId),
    connectionIdPrefix: prefixId(args.resolution?.connectionId ?? undefined),
    sessionBindingFound: args.resolution?.sessionBindingFound ?? false,
    clientClaimInherited: args.resolution?.clientClaimInherited ?? false,
    clientKeyPresent: Boolean(buildHttpClientKeyFromExtra(args.extra)),
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
  };
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
  }
): (args: TArgs, extra?: McpToolRequestExtra) => Promise<TResult> {
  return async (args, extra) =>
    runHttpToolSessionFromExtra(
      options?.transportSessionId,
      options?.keyStore,
      extra,
      () => handler(args, extra)
    );
}
