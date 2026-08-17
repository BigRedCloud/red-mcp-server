import type { RedAuditEntry } from "../shared.js";
import { resolveRedTelemetryEnvironment } from "../telemetry/platform.js";

const REQUEST_CAPTURE_LIMITATION =
  "Red records the instruction passed to request routing (the user's original accounting request). Red does not receive the full chat transcript. If no routed instruction was available for an action, a generated action summary is shown instead — nothing is invented.";

export type RedSupportReport = {
  filename: string;
  mimeType: "text/plain";
  generatedAtUtc: string;
  companyName: string;
  text: string;
};

function sanitizeFilenamePart(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return cleaned || "company";
}

function filenameTimestamp(isoUtc: string): string {
  return isoUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildSupportReportFilename(
  companyName: string,
  generatedAtUtc: string
): string {
  return `red-support-report-${sanitizeFilenamePart(companyName)}-${filenameTimestamp(generatedAtUtc)}.txt`;
}

function line(label: string, value: string | number | undefined): string {
  if (value === undefined || value === "") {
    return `${label}: not available`;
  }
  return `${label}: ${value}`;
}

function formatStage(stage: RedAuditEntry["stage"]): string {
  if (stage === "preflight") {
    return "Preflight";
  }
  if (stage === "write") {
    return "Write";
  }
  return "not available";
}

function brcResponseLine(entry: RedAuditEntry): string {
  if (entry.statusCode !== undefined) {
    return [entry.statusCode, entry.statusText].filter(Boolean).join(" ");
  }

  const fromSummary = entry.errorSummary?.match(
    /\((\d{3}(?:\s+[A-Za-z][A-Za-z ]*)?)\)/
  );
  if (fromSummary?.[1]) {
    return fromSummary[1].trim();
  }

  return "not available";
}

function generatedActionSummary(entry: RedAuditEntry): string {
  const record =
    entry.recordId !== undefined
      ? `${entry.recordType} ${entry.recordId}`
      : entry.recordType;
  const verb =
    entry.operation === "create"
      ? "Create"
      : entry.operation === "update"
        ? "Update"
        : entry.operation === "delete"
          ? "Delete"
          : entry.operation === "batch"
            ? "Batch"
            : entry.action || entry.operation;
  return `${verb} ${record}`.trim();
}

function formatActivityBlock(entry: RedAuditEntry): string {
  const userRequest = entry.initiatingRequest
    ? entry.initiatingRequest
    : "not received by Red for this action";

  return [
    "--------------------------------------------------",
    entry.timestampUtc,
    `Company: ${entry.companyName}`,
    "User request:",
    userRequest,
    "",
    "Action:",
    generatedActionSummary(entry),
    "",
    "Outcome:",
    entry.outcome.toUpperCase(),
    "",
    "Stage:",
    formatStage(entry.stage),
    "",
    "BRC response:",
    brcResponseLine(entry),
    "",
    "Error:",
    entry.outcome === "failure"
      ? entry.errorSummary ?? "Write did not complete."
      : "none",
    "",
    "Correlation:",
    line("mcpSessionId", entry.mcpSessionId),
    line("connectionId", entry.connectionId),
    line("method", entry.method),
    line("path", entry.path),
    ...(entry.toolName ? [line("toolName", entry.toolName)] : []),
    "--------------------------------------------------",
  ].join("\n");
}

export function buildRedSupportReport(args: {
  companyName: string;
  entries: RedAuditEntry[];
  generatedAtUtc?: string;
  redVersion?: string;
  environment?: string;
}): RedSupportReport {
  const generatedAtUtc = args.generatedAtUtc ?? new Date().toISOString();
  const filename = buildSupportReportFilename(args.companyName, generatedAtUtc);
  const entries = [...args.entries].sort((a, b) =>
    a.timestampUtc.localeCompare(b.timestampUtc)
  );

  const writes = entries.filter(
    (entry) =>
      entry.operation === "create" ||
      entry.operation === "update" ||
      entry.operation === "delete" ||
      entry.operation === "batch" ||
      entry.operation === "email" ||
      entry.operation === "change"
  );
  const successes = writes.filter((entry) => entry.outcome === "success").length;
  const failures = writes.filter((entry) => entry.outcome === "failure").length;
  const companyId = entries.find((entry) => entry.companyId !== undefined)
    ?.companyId;
  const sessionId = entries.find((entry) => entry.mcpSessionId)?.mcpSessionId;
  const connectionId = entries.find((entry) => entry.connectionId)
    ?.connectionId;
  const start = entries[0]?.timestampUtc;
  const end = entries[entries.length - 1]?.timestampUtc;
  const environment =
    args.environment ?? resolveRedTelemetryEnvironment();
  const redVersion =
    args.redVersion ?? process.env.npm_package_version ?? "unknown";

  const text = [
    "Red Support Diagnostic Report",
    "",
    "Secrets have been excluded. This file is for Red / Big Red Cloud customer service and developers. It is more detailed than the in-chat activity summary.",
    "",
    "REPORT HEADER",
    line("generatedAtUtc", generatedAtUtc),
    line("companyName", args.companyName),
    line("companyId", companyId),
    line("redVersion", redVersion),
    line("environment", environment),
    line("mcpSessionId", sessionId),
    line("connectionId", connectionId),
    "",
    "USER REQUEST CAPTURE",
    REQUEST_CAPTURE_LIMITATION,
    "",
    "SESSION SUMMARY",
    line("attemptedWrites", writes.length),
    line("successes", successes),
    line("failures", failures),
    line("firstActivityUtc", start),
    line("lastActivityUtc", end),
    "",
    "CHRONOLOGICAL ACTIVITY",
    entries.length === 0
      ? "No Red activity was recorded for this company in the current session."
      : entries.map(formatActivityBlock).join("\n"),
    "",
  ].join("\n");

  return {
    filename,
    mimeType: "text/plain",
    generatedAtUtc,
    companyName: args.companyName,
    text,
  };
}

export function supportReportMcpResponse(report: RedSupportReport): {
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "resource";
        resource: { uri: string; mimeType: string; text: string };
      }
  >;
} {
  const uri = `red://support-report/${encodeURIComponent(report.filename)}`;
  return {
    content: [
      {
        type: "text",
        text: [
          "I've prepared a diagnostic report you can share with the Red customer service team if you need help investigating an issue.",
          "",
          `Filename: ${report.filename}`,
          "The file is attached as a plain-text diagnostic report. It is more detailed than the activity summary in chat. Secrets have been excluded.",
          "If your chat client does not offer a download, copy the report below and send that file to support.",
          "",
          report.text,
        ].join("\n"),
      },
      {
        type: "resource",
        resource: {
          uri,
          mimeType: report.mimeType,
          text: report.text,
        },
      },
    ],
  };
}
