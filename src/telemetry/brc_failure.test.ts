import assert from "node:assert/strict";
import test from "node:test";

import { wrapWriteToolHandler } from "../guards/write_confirmation.js";
import { __resetRedAuditLogForTests } from "../shared.js";
import {
  __getLastBrcFailureTelemetryForTests,
  __resetBrcFailureTelemetryForTests,
  buildBrcFailureTelemetryDimensions,
  recordBrcDownstreamFailureTelemetry,
} from "./brc_failure.js";
import {
  buildTelemetryCustomDimensions,
  runWithRedTelemetryContext,
} from "./identity.js";

const STAGING_CONNECTION_SESSION_ID = "7f9104a2-f4bc-455b-8bac-f8ebbd796878";
const STAGING_TELEMETRY_CLIENT_ID = "41a462cb-e28c-4964-8e64-968c10509d46";

const GET_FAILURE = new Error(
  'BRC API GET /v1/quotes/999999999 failed for "Company C": 500 Internal Server Error. Unknown error occurred. Please contact the Big Red Cloud Support Team.'
);

test("downstream BRC failure telemetry uses the same Azure correlation IDs as customDimensions", () => {
  __resetBrcFailureTelemetryForTests();
  runWithRedTelemetryContext(
    {
      connectionSessionId: STAGING_CONNECTION_SESSION_ID,
      telemetryClientId: STAGING_TELEMETRY_CLIENT_ID,
      environment: "staging",
      toolName: "brc_update_quote",
    },
    () => {
      const azure = buildTelemetryCustomDimensions();
      recordBrcDownstreamFailureTelemetry({
        method: "GET",
        path: "/v1/quotes/999999999",
        statusCode: 500,
        statusText: "Internal Server Error",
        stage: "preflight",
        operation: "update",
        recordType: "Quote",
        recordId: 999999999,
        toolName: "brc_update_quote",
        errorSummary:
          "Write did not complete (500 Internal Server Error). Unknown error occurred.",
      });

      const recorded = __getLastBrcFailureTelemetryForTests();
      assert.ok(recorded);
      assert.equal(
        recorded!.dimensions["red.connection_session_id"],
        azure["red.connection_session_id"]
      );
      assert.equal(
        recorded!.dimensions["red.telemetry_client_id"],
        azure["red.telemetry_client_id"]
      );
      assert.equal(
        recorded!.dimensions["red.connection_session_id"],
        STAGING_CONNECTION_SESSION_ID
      );
      assert.equal(
        recorded!.dimensions["red.telemetry_client_id"],
        STAGING_TELEMETRY_CLIENT_ID
      );
      assert.equal(recorded!.dimensions["red.environment"], "staging");
      assert.equal(recorded!.dimensions["red.tool_name"], "brc_update_quote");
      assert.equal(recorded!.dimensions["red.brc_method"], "GET");
      assert.equal(recorded!.dimensions["red.brc_path"], "/v1/quotes/999999999");
      assert.equal(recorded!.dimensions["red.brc_status_code"], "500");
      assert.equal(recorded!.dimensions["red.failure_stage"], "preflight");
      assert.equal(recorded!.dimensions["red.outcome"], "failure");
      assert.equal(recorded!.dimensions["red.operation"], "update");
      assert.equal(recorded!.dimensions["red.record_type"], "Quote");
      assert.equal(recorded!.dimensions["red.record_id"], "999999999");
      assert.equal("userId" in recorded!.dimensions, false);
      assert.equal("red.user_id" in recorded!.dimensions, false);
      assert.equal("requestBody" in recorded!.dimensions, false);
      assert.equal("payload" in recorded!.dimensions, false);

      const blob = JSON.stringify(recorded);
      assert.equal(/apiKey/i.test(blob), false);
      assert.equal(/Authorization/i.test(blob), false);
      assert.equal(/redconn_/i.test(blob), false);
      assert.equal(/redroute_/i.test(blob), false);
      assert.equal(/password/i.test(blob), false);
      assert.equal(/access.?token/i.test(blob), false);
      assert.equal(blob.includes("userId"), false);
    }
  );
});

test("confirmed Quote preflight GET failure records searchable BRC telemetry", async () => {
  __resetRedAuditLogForTests();
  __resetBrcFailureTelemetryForTests();

  await runWithRedTelemetryContext(
    {
      connectionSessionId: STAGING_CONNECTION_SESSION_ID,
      telemetryClientId: STAGING_TELEMETRY_CLIENT_ID,
      environment: "staging",
      toolName: "brc_update_quote",
    },
    async () => {
      const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        throw GET_FAILURE;
      });
      await assert.rejects(() =>
        Promise.resolve(
          wrapped({
            companyName: "Company C",
            id: 999999999,
            reference: "QA0001",
            confirmWrite: true,
          })
        )
      );

      const azure = buildTelemetryCustomDimensions();
      const recorded = __getLastBrcFailureTelemetryForTests();
      assert.ok(recorded);
      assert.equal(
        recorded!.dimensions["red.connection_session_id"],
        azure["red.connection_session_id"]
      );
      assert.equal(recorded!.dimensions["red.brc_method"], "GET");
      assert.equal(recorded!.dimensions["red.brc_path"], "/v1/quotes/999999999");
      assert.equal(recorded!.dimensions["red.brc_status_code"], "500");
      assert.equal(recorded!.dimensions["red.failure_stage"], "preflight");
      assert.equal(recorded!.dimensions["red.tool_name"], "brc_update_quote");
      assert.equal(recorded!.dimensions["red.outcome"], "failure");
    }
  );
});

test("failure telemetry omits sensitive values and request payloads", () => {
  __resetBrcFailureTelemetryForTests();
  const dimensions = buildBrcFailureTelemetryDimensions({
    method: "PUT",
    path: "/v1/quotes/42?apiKey=super-secret-company-key",
    statusCode: 500,
    stage: "write",
    toolName: "brc_update_quote",
    errorSummary:
      "Authorization: Bearer secret-token apiKey=super-secret-company-key",
  });

  assert.equal(dimensions["red.brc_path"], "/v1/quotes/42");
  assert.equal(JSON.stringify(dimensions).includes("super-secret-company-key"), false);

  recordBrcDownstreamFailureTelemetry({
    method: "PUT",
    path: "/v1/quotes/42",
    statusCode: 500,
    stage: "write",
    toolName: "brc_update_quote",
    errorSummary:
      "Authorization: Bearer secret-token apiKey=super-secret-company-key",
  });

  const recorded = __getLastBrcFailureTelemetryForTests();
  assert.ok(recorded);
  assert.equal(recorded!.errorSummary, undefined);
  const blob = JSON.stringify(recorded);
  assert.equal(blob.includes("super-secret-company-key"), false);
  assert.equal(blob.includes("secret-token"), false);
  assert.equal(blob.includes("grossAmount"), false);
  assert.equal(blob.includes("requestBody"), false);
  assert.equal("userId" in recorded!.dimensions, false);
});
