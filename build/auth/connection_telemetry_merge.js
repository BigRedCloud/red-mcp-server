/**
 * Shared merge helpers for connection telemetry records.
 * Never clears a stored telemetryClientId when a later patch only sets session id.
 */
import { isValidTelemetryUuid } from "../telemetry/identity.js";
export function pickValidTelemetryUuid(...candidates) {
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
export function mergeConnectionTelemetryRecord(connectionId, existing, patch) {
    const telemetryClientId = pickValidTelemetryUuid(patch.telemetryClientId, existing?.telemetryClientId);
    const connectionSessionId = pickValidTelemetryUuid(patch.connectionSessionId, existing?.connectionSessionId);
    return {
        connectionId,
        telemetryClientId,
        connectionSessionId,
        updatedAt: Date.now(),
    };
}
