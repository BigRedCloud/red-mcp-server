/**
 * OpenTelemetry span enrichment for Red Application Insights dimensions.
 *
 * Sets anonymous enduser.pseudo.id (App Insights user id) from
 * red.telemetry_client_id when available. Does not set enduser.id
 * (authenticated user) because Red has no BRC OAuth yet.
 */

import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  buildTelemetryCustomDimensions,
  getRedTelemetryContext,
  isValidTelemetryUuid,
} from "./identity.js";

/** Experimental OTel attribute mapped to Application Insights anonymous user id. */
export const ENDUSER_PSEUDO_ID_ATTRIBUTE = "enduser.pseudo.id";

export class RedTelemetrySpanProcessor implements SpanProcessor {
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  onStart(_span: Span, _parentContext: Context): void {
    // Dimensions are applied onEnd so request ALS context is populated.
  }

  onEnd(span: ReadableSpan): void {
    try {
      const context = getRedTelemetryContext();
      const dimensions = buildTelemetryCustomDimensions(context);
      const attrs = span.attributes as Record<string, string | number | boolean>;

      for (const [key, value] of Object.entries(dimensions)) {
        attrs[key] = value;
      }

      if (
        context.telemetryClientId &&
        isValidTelemetryUuid(context.telemetryClientId)
      ) {
        // Anonymous user id only — never authenticated user id without OAuth.
        attrs[ENDUSER_PSEUDO_ID_ATTRIBUTE] = context.telemetryClientId;
      }
    } catch {
      // Telemetry enrichment must never throw into the request path.
    }
  }
}
