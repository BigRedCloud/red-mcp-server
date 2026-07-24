/**
 * OpenTelemetry span enrichment for Red Application Insights dimensions.
 *
 * Sets anonymous enduser.pseudo.id (App Insights user id) from
 * red.telemetry_client_id when available. Does not set enduser.id
 * (authenticated user) because Red has no BRC OAuth yet.
 */
import { buildTelemetryCustomDimensions, getRedTelemetryContext, isValidTelemetryUuid, } from "./identity.js";
/** Experimental OTel attribute mapped to Application Insights anonymous user id. */
export const ENDUSER_PSEUDO_ID_ATTRIBUTE = "enduser.pseudo.id";
export class RedTelemetrySpanProcessor {
    forceFlush() {
        return Promise.resolve();
    }
    shutdown() {
        return Promise.resolve();
    }
    onStart(_span, _parentContext) {
        // Dimensions are applied onEnd so request ALS context is populated.
    }
    onEnd(span) {
        try {
            const context = getRedTelemetryContext();
            const dimensions = buildTelemetryCustomDimensions(context);
            const attrs = span.attributes;
            for (const [key, value] of Object.entries(dimensions)) {
                attrs[key] = value;
            }
            if (context.telemetryClientId &&
                isValidTelemetryUuid(context.telemetryClientId)) {
                // Anonymous user id only — never authenticated user id without OAuth.
                attrs[ENDUSER_PSEUDO_ID_ATTRIBUTE] = context.telemetryClientId;
            }
        }
        catch {
            // Telemetry enrichment must never throw into the request path.
        }
    }
}
