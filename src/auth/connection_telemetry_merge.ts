/**
 * Shared merge helpers for connection telemetry records.
 * Never clears a stored telemetryClientId when a later patch only sets session id.
 */

import { isValidTelemetryUuid } from "../telemetry/identity.js";
import type { ConnectionTelemetryRecord } from "./connection_store_types.js";

export type ConnectionTelemetryPatch = {
  telemetryClientId?: string;
  connectionSessionId?: string;
};

export function pickValidTelemetryUuid(
  ...candidates: Array<string | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (isValidTelemetryUuid(candidate)) {
      return candidate.trim().toLowerCase();
    }
  }
  return undefined;
}

/**
 * Merge a patch into an existing telemetry record.
 * Omitted patch fields keep existing values. Invalid UUIDs are ignored.
 */
export function mergeConnectionTelemetryRecord(
  connectionId: string,
  existing: ConnectionTelemetryRecord | null | undefined,
  patch: ConnectionTelemetryPatch
): ConnectionTelemetryRecord {
  const telemetryClientId = pickValidTelemetryUuid(
    patch.telemetryClientId,
    existing?.telemetryClientId
  );
  const connectionSessionId = pickValidTelemetryUuid(
    patch.connectionSessionId,
    existing?.connectionSessionId
  );

  return {
    connectionId,
    telemetryClientId,
    connectionSessionId,
    updatedAt: Date.now(),
  };
}
