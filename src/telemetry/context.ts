/**
 * Builds safe Red telemetry context for HTTP / MCP requests.
 * Never includes secrets, connectionRef, session IDs, or company data payloads.
 */

import type { Request } from "express";
import { trace } from "@opentelemetry/api";
import {
  ensureConnectionStoreInitialized,
  getConnectionStore,
  resolveConnectionIdForActiveSessionWithMeta,
} from "../auth/connection_store.js";
import { hydrateSessionKeyStoreFromConnectionStore } from "../auth/connection_persistence.js";
import {
  extractConnectionRefFromToolArgs,
  isConnectionRefFormat,
} from "../auth/connection_ref.js";
import {
  registerHttpSessionKeyStore,
  type CompanyApiContext,
} from "../shared.js";
import { ENDUSER_PSEUDO_ID_ATTRIBUTE } from "./identity.js";
import {
  buildTelemetryCustomDimensions,
  isValidTelemetryUuid,
  mergeRedTelemetryContext,
  normaliseTelemetryClientId,
  readTelemetryClientIdFromCookieHeader,
  TELEMETRY_CLIENT_ID_FORM_FIELD,
  type RedTelemetryContext,
} from "./identity.js";
import { detectClientPlatform, resolveRedTelemetryEnvironment } from "./platform.js";

export type RedTelemetryDiagnostics = {
  telemetryRecordFound: boolean;
  connectionContextFound: boolean;
  companyCount: number;
  platform: string;
  clientIdPresent: boolean;
  connectionSessionIdPresent: boolean;
};

export function resolveTelemetryClientIdFromRequest(req: {
  headers?: { cookie?: string };
  body?: unknown;
}): { clientId: string; fromCookie: boolean; replacedMalformed: boolean } {
  const cookieId = readTelemetryClientIdFromCookieHeader(req.headers?.cookie);
  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};
  const bodyRaw = body[TELEMETRY_CLIENT_ID_FORM_FIELD] ?? body.telemetry_client_id;
  const bodyId =
    typeof bodyRaw === "string" && isValidTelemetryUuid(bodyRaw)
      ? bodyRaw.trim().toLowerCase()
      : undefined;

  if (cookieId) {
    return { clientId: cookieId, fromCookie: true, replacedMalformed: false };
  }

  if (bodyId) {
    return { clientId: bodyId, fromCookie: false, replacedMalformed: false };
  }

  const malformed =
    (typeof bodyRaw === "string" && bodyRaw.trim() !== "") ||
    Boolean(readRawCookieValue(req.headers?.cookie));

  return {
    clientId: normaliseTelemetryClientId(bodyRaw),
    fromCookie: false,
    replacedMalformed: malformed,
  };
}

function readRawCookieValue(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)red_telemetry_client_id=([^;]*)`)
  );
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Pulls connectionRef from an MCP JSON-RPC body when present (e.g. tools/call).
 * Returns undefined for non-tool requests. Never logs the value.
 */
export function extractConnectionRefFromMcpBody(
  body: unknown
): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const args = (params as { arguments?: unknown }).arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }

  const value = extractConnectionRefFromToolArgs(args as Record<string, unknown>);
  if (!value || !isConnectionRefFormat(value)) {
    return undefined;
  }

  return value.trim();
}

export async function loadConnectionTelemetryContext(
  connectionId: string | undefined
): Promise<{
  telemetryClientId?: string;
  connectionSessionId?: string;
  recordFound: boolean;
}> {
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
  } catch {
    return { recordFound: false };
  }
}

export async function countCompaniesForConnection(
  connectionId: string | undefined,
  keyStoreSize = 0
): Promise<number> {
  if (!connectionId) {
    return keyStoreSize;
  }

  try {
    const companies = await getConnectionStore().listConnectedCompanies(
      connectionId
    );
    if (companies.length > 0) {
      return companies.length;
    }
  } catch {
    // fall through to in-memory count
  }

  return keyStoreSize;
}

export function buildRequestTelemetryContext(args: {
  req?: Request;
  headers?: Record<string, string | string[] | undefined>;
  connectionId?: string;
  telemetryClientId?: string;
  connectionSessionId?: string;
  connectedCompanyCount?: number;
  toolName?: string;
}): RedTelemetryContext {
  const headers =
    args.headers ??
    ((args.req?.headers ?? {}) as Record<string, string | string[] | undefined>);

  return {
    telemetryClientId: args.telemetryClientId,
    connectionSessionId: args.connectionSessionId,
    clientPlatform: detectClientPlatform(headers),
    environment: resolveRedTelemetryEnvironment(),
    connectedCompanyCount: args.connectedCompanyCount,
    toolName: args.toolName,
  };
}

export function buildRedTelemetryDiagnostics(
  context: RedTelemetryContext,
  options: {
    telemetryRecordFound: boolean;
    connectionContextFound: boolean;
  }
): RedTelemetryDiagnostics {
  return {
    telemetryRecordFound: options.telemetryRecordFound,
    connectionContextFound: options.connectionContextFound,
    companyCount:
      typeof context.connectedCompanyCount === "number"
        ? context.connectedCompanyCount
        : 0,
    platform: context.clientPlatform ?? "unknown",
    clientIdPresent: Boolean(context.telemetryClientId),
    connectionSessionIdPresent: Boolean(context.connectionSessionId),
  };
}

/**
 * Writes current telemetry dimensions onto the active OTel span (HTTP request
 * span or tool span). Safe no-op when telemetry is disabled.
 */
export function applyRedTelemetryToActiveSpan(
  context: RedTelemetryContext = {}
): void {
  try {
    const span = trace.getActiveSpan();
    if (!span) {
      return;
    }

    const dimensions = buildTelemetryCustomDimensions(context);
    for (const [key, value] of Object.entries(dimensions)) {
      span.setAttribute(key, value);
    }

    if (
      context.telemetryClientId &&
      isValidTelemetryUuid(context.telemetryClientId)
    ) {
      span.setAttribute(ENDUSER_PSEUDO_ID_ATTRIBUTE, context.telemetryClientId);
    }
  } catch {
    // never break requests for telemetry
  }
}

export function logRedTelemetryDiagnostics(
  diagnostics: RedTelemetryDiagnostics
): void {
  try {
    console.info(
      "Red telemetry context:",
      JSON.stringify({
        telemetryRecordFound: diagnostics.telemetryRecordFound,
        connectionContextFound: diagnostics.connectionContextFound,
        companyCount: diagnostics.companyCount,
        platform: diagnostics.platform,
        clientIdPresent: diagnostics.clientIdPresent,
        connectionSessionIdPresent: diagnostics.connectionSessionIdPresent,
      })
    );
  } catch {
    // ignore
  }
}

export type PreparedMcpTelemetry = {
  connectionId: string;
  context: RedTelemetryContext;
  diagnostics: RedTelemetryDiagnostics;
};

/**
 * Ordered MCP telemetry preparation:
 * 1) resolve connection (session binding / client claim / connectionRef)
 * 2) restore company credentials into the session key store
 * 3) load stored connection telemetry
 * 4) count companies for the active connection
 * 5) build Red telemetry context
 */
export async function prepareMcpTelemetryContext(args: {
  sessionId: string;
  keyStore: Map<string, CompanyApiContext>;
  clientKey?: string;
  connectionRef?: string;
  headers?: Record<string, string | string[] | undefined>;
  toolName?: string;
  companyName?: string;
}): Promise<PreparedMcpTelemetry> {
  await ensureConnectionStoreInitialized();

  const resolution = await resolveConnectionIdForActiveSessionWithMeta({
    sessionId: args.sessionId,
    clientKey: args.clientKey,
    connectionRef: args.connectionRef,
  });

  const connectionId = resolution.connectionId ?? "";

  if (connectionId) {
    try {
      // Hydrate the caller's key store (same map used by tool handlers / diagnostics).
      args.keyStore.clear();
      await hydrateSessionKeyStoreFromConnectionStore(connectionId, args.keyStore);
      registerHttpSessionKeyStore(args.sessionId, args.keyStore);
    } catch {
      // continue with whatever is already loaded
    }
  }

  const stored = await loadConnectionTelemetryContext(connectionId || undefined);
  const companyCount = await countCompaniesForConnection(
    connectionId || undefined,
    args.keyStore.size
  );

  const context = buildRequestTelemetryContext({
    headers: args.headers,
    connectionId: connectionId || undefined,
    telemetryClientId: stored.telemetryClientId,
    connectionSessionId: stored.connectionSessionId,
    connectedCompanyCount: companyCount,
    toolName: args.toolName,
  });

  const diagnostics = buildRedTelemetryDiagnostics(context, {
    telemetryRecordFound: stored.recordFound,
    connectionContextFound: Boolean(connectionId),
  });

  return {
    connectionId,
    context,
    diagnostics,
  };
}

export function activatePreparedTelemetry(
  prepared: PreparedMcpTelemetry
): void {
  mergeRedTelemetryContext(prepared.context);
  applyRedTelemetryToActiveSpan(prepared.context);
  logRedTelemetryDiagnostics(prepared.diagnostics);
}
