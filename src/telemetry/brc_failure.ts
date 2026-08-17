/**
 * Safe Application Insights telemetry for downstream Big Red Cloud HTTP failures.
 *
 * The outer MCP POST /mcp request stays success=true when a BRC call fails.
 * This records a CLIENT span (dependencies) plus a structured console event
 * (traces) using the same red.* custom dimensions as request telemetry.
 *
 * Never logs API keys, tokens, Authorization headers, connection references,
 * or request bodies.
 */

import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  buildTelemetryCustomDimensions,
  getRedTelemetryContext,
  looksSensitiveTelemetryValue,
} from "./identity.js";

export type BrcFailureTelemetryInput = {
  method: string;
  path: string;
  statusCode?: number;
  statusText?: string;
  stage?: "preflight" | "write";
  operation?: string;
  recordType?: string;
  recordId?: string | number;
  companyId?: string | number;
  toolName?: string;
  errorSummary?: string;
};

export type BrcFailureTelemetryRecord = {
  dimensions: Record<string, string>;
  errorSummary?: string;
};

let lastFailureForTests: BrcFailureTelemetryRecord | undefined;

function safeDimension(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  if (!text || looksSensitiveTelemetryValue(text)) {
    return undefined;
  }
  return text.slice(0, 200);
}

function pathnameOnly(path: string): string {
  return path.split("?")[0] ?? path;
}

export function buildBrcFailureTelemetryDimensions(
  args: BrcFailureTelemetryInput
): Record<string, string> {
  const dimensions = buildTelemetryCustomDimensions(getRedTelemetryContext());
  const toolName = safeDimension(args.toolName);
  if (toolName) {
    dimensions["red.tool_name"] = toolName;
  }

  const method = safeDimension(args.method?.toUpperCase());
  if (method) {
    dimensions["red.brc_method"] = method;
  }
  const path = safeDimension(pathnameOnly(args.path));
  if (path) {
    dimensions["red.brc_path"] = path;
  }
  if (typeof args.statusCode === "number" && Number.isFinite(args.statusCode)) {
    dimensions["red.brc_status_code"] = String(args.statusCode);
  }
  const stage = safeDimension(args.stage);
  if (stage) {
    dimensions["red.failure_stage"] = stage;
  }
  const operation = safeDimension(args.operation);
  if (operation) {
    dimensions["red.operation"] = operation;
  }
  dimensions["red.outcome"] = "failure";
  const recordType = safeDimension(args.recordType);
  if (recordType) {
    dimensions["red.record_type"] = recordType;
  }
  if (args.recordId !== undefined && args.recordId !== "") {
    const recordId = safeDimension(args.recordId);
    if (recordId) {
      dimensions["red.record_id"] = recordId;
    }
  }
  if (
    args.companyId !== undefined &&
    (typeof args.companyId === "number" || typeof args.companyId === "string")
  ) {
    const companyId = safeDimension(args.companyId);
    if (companyId) {
      dimensions["red.company_id"] = companyId;
    }
  }

  return dimensions;
}

/**
 * Records searchable App Insights telemetry for a failed BRC HTTP call.
 * Safe no-op when OpenTelemetry is not initialised.
 */
export function recordBrcDownstreamFailureTelemetry(
  args: BrcFailureTelemetryInput
): void {
  try {
    const dimensions = buildBrcFailureTelemetryDimensions(args);
    let errorSummary = args.errorSummary
      ? args.errorSummary.replace(/\s+/g, " ").trim().slice(0, 280)
      : undefined;
    if (errorSummary && looksSensitiveTelemetryValue(errorSummary)) {
      errorSummary = undefined;
    }
    lastFailureForTests = { dimensions, errorSummary };

    const tracer = trace.getTracer("red-brc");
    const spanName = `BRC ${args.method.toUpperCase()} ${pathnameOnly(args.path)}`;
    const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
    for (const [key, value] of Object.entries(dimensions)) {
      span.setAttribute(key, value);
    }
    const statusMessage = errorSummary ?? "BRC request failed";
    span.setStatus({ code: SpanStatusCode.ERROR, message: statusMessage });
    span.recordException(new Error(statusMessage));
    span.end();

    console.info(
      "Red BRC request failed:",
      JSON.stringify({
        event: "brc_request_failed",
        ...dimensions,
        ...(errorSummary ? { errorSummary } : {}),
      })
    );
  } catch {
    // Telemetry must never break the request path.
  }
}

export function __getLastBrcFailureTelemetryForTests():
  | BrcFailureTelemetryRecord
  | undefined {
  return lastFailureForTests;
}

export function __resetBrcFailureTelemetryForTests(): void {
  lastFailureForTests = undefined;
}

export function telemetryIdsFromContext(): {
  telemetryConnectionSessionId?: string;
  telemetryClientId?: string;
} {
  const dimensions = buildTelemetryCustomDimensions(getRedTelemetryContext());
  return {
    telemetryConnectionSessionId: dimensions["red.connection_session_id"],
    telemetryClientId: dimensions["red.telemetry_client_id"],
  };
}
