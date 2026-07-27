import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { RedTelemetrySpanProcessor } from "./telemetry/enrichment.js";

/**
 * Hosted HTTP only (imported from remote.ts).
 * When APPLICATIONINSIGHTS_CONNECTION_STRING is unset, telemetry stays disabled.
 */
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  try {
    useAzureMonitor({
      spanProcessors: [new RedTelemetrySpanProcessor()],
    });
  } catch (error) {
    console.error(
      "Red telemetry: failed to initialise Application Insights:",
      error instanceof Error ? error.message : error
    );
  }
}

export {
  buildTelemetryClientIdSetCookie,
  buildTelemetryCustomDimensions,
  generateConnectionSessionId,
  generateTelemetryUuid,
  getRedTelemetryContext,
  isValidTelemetryUuid,
  mergeRedTelemetryContext,
  normaliseTelemetryClientId,
  runWithRedTelemetryContext,
  TELEMETRY_CLIENT_ID_COOKIE,
  TELEMETRY_CLIENT_ID_FORM_FIELD,
} from "./telemetry/identity.js";
export {
  detectClientPlatform,
  extractMcpInitializeClientInfo,
  getStoredSessionPlatform,
  matchPlatformFromText,
  normalizeClientPlatform,
  resolveClientPlatform,
  resolveRedTelemetryEnvironment,
  storeSessionPlatform,
} from "./telemetry/platform.js";
export {
  hashConnectionCodeForDiagnostics,
  resolveAndPersistConnectTelemetryClientId,
  resolveCanonicalTelemetryClientId,
} from "./telemetry/context.js";
