/**
 * OpenTelemetry span enrichment for Red Application Insights dimensions.
 *
 * Sets anonymous enduser.pseudo.id (App Insights user id) from
 * red.telemetry_client_id when available. Does not set enduser.id
 * (authenticated user) because Red has no BRC OAuth yet.
 */
import { buildTelemetryCustomDimensions, ENDUSER_PSEUDO_ID_ATTRIBUTE, getRedTelemetryContext, isValidTelemetryUuid, } from "./identity.js";
export { ENDUSER_PSEUDO_ID_ATTRIBUTE } from "./identity.js";
export class RedTelemetrySpanProcessor {
    forceFlush() {
        return Promise.resolve();
    }
    shutdown() {
        return Promise.resolve();
    }
    onStart(_span, _parentContext) {
        // Dimensions are applied onEnd / via applyRedTelemetryToActiveSpan.
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
            // Ensure authenticated user id is never set from Red telemetry.
            if ("enduser.id" in attrs) {
                delete attrs["enduser.id"];
            }
        }
        catch {
            // Telemetry enrichment must never throw into the request path.
        }
    }
}
