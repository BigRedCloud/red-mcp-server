import fs from "node:fs";
import { redactSensitive, safeJsonForReport } from "./redact.mjs";
import { buildToolRegistry, registrySummary } from "./tool_classification.mjs";

export function mergeRegistryWithResults(registry, resultsByTool) {
  return registry.map((entry) => {
    const result = resultsByTool.get(entry.tool);
    if (result) {
      return {
        ...entry,
        status: result.status,
        details: result.details,
      };
    }

    return {
      ...entry,
      status: "SKIPPED",
      details: entry.skipReason || "Not exercised in this legacy script",
    };
  });
}

export function countStatuses(entries) {
  return entries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});
}

export function writeJsonReport(path, payload) {
  fs.mkdirSync("./reports", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(redactSensitive(payload), null, 2));
}

export function buildRegistryReport(toolNames, results, options = {}) {
  const registry = buildToolRegistry(toolNames, options);
  const resultsByTool = new Map(results.map((result) => [result.tool, result]));
  const classified = mergeRegistryWithResults(registry, resultsByTool);

  return {
    registry,
    classified,
    categoryCounts: registrySummary(registry),
    statusCounts: countStatuses(classified),
  };
}

/**
 * When auth preflight fails, mark unrun tools SKIPPED — not FAIL.
 */
export function buildSetupFailedRegistryReport(
  toolNames,
  results,
  setupReason = "unauthorized",
  options = {}
) {
  const registry = buildToolRegistry(toolNames, options);
  const resultsByTool = new Map(results.map((result) => [result.tool, result]));
  const skipReason = `Setup failed: ${setupReason}`;

  const classified = registry.map((entry) => {
    const result = resultsByTool.get(entry.tool);
    if (result) {
      return {
        ...entry,
        status: result.status,
        details: result.details,
      };
    }

    return {
      ...entry,
      status: "SKIPPED",
      details: skipReason,
    };
  });

  const statusCounts = countStatuses(classified);

  return {
    registry,
    classified,
    categoryCounts: registrySummary(registry),
    statusCounts,
    setup: {
      status: "setup_failed",
      reason: setupReason,
    },
  };
}

export function formatRegistryLines(classified) {
  return classified.map(
    (entry) =>
      `- ${entry.tool} [${entry.category}] ${entry.status}${
        entry.skipReason && entry.status === "SKIPPED"
          ? `: ${entry.skipReason}`
          : ""
      }`
  );
}

export { safeJsonForReport };
