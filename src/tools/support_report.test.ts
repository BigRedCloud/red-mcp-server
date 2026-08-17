import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetInitiatingRequestsForTests,
  MAX_INITIATING_REQUEST_LENGTH,
  peekInitiatingRequestForRoute,
  runWithInitiatingRequest,
  sanitizeInitiatingRequest,
} from "../audit/initiating_request.js";
import {
  buildRedSupportReport,
  buildSupportReportFilename,
  supportReportMcpResponse,
} from "../audit/support_report.js";
import { wrapWriteToolHandler } from "../guards/write_confirmation.js";
import { issueActionRouteToken } from "../routing/route-token.js";
import {
  __resetRedAuditLogForTests,
  clearCredentialForCompany,
  getRedAuditLog,
  recordRedAuditEntry,
  setApiKeyForCompany,
  type RedAuditEntry,
} from "../shared.js";
import {
  __resetBrcFailureTelemetryForTests,
} from "../telemetry/brc_failure.js";
import {
  buildTelemetryCustomDimensions,
  runWithRedTelemetryContext,
} from "../telemetry/identity.js";
import { registerAuditTools } from "./audit_session_tools.js";

const CUSTOMER_FACING_AUDIT_KEYS = new Set([
  "id",
  "timestamp",
  "timestampUtc",
  "companyName",
  "method",
  "path",
  "action",
  "operation",
  "outcome",
  "recordType",
  "recordId",
  "summary",
  "errorSummary",
]);

const GET_FAILURE = new Error(
  'BRC API GET /v1/quotes/999999999 failed for "Company C": 500 Internal Server Error. Unknown error occurred. Please contact the Big Red Cloud Support Team.'
);

const STAGING_CONNECTION_SESSION_ID = "7f9104a2-f4bc-455b-8bac-f8ebbd796878";
const STAGING_TELEMETRY_CLIENT_ID = "41a462cb-e28c-4964-8e64-968c10509d46";

function withStagingTelemetry<T>(fn: () => T): T {
  return runWithRedTelemetryContext(
    {
      connectionSessionId: STAGING_CONNECTION_SESSION_ID,
      telemetryClientId: STAGING_TELEMETRY_CLIENT_ID,
      environment: "staging",
      toolName: "brc_update_quote",
    },
    fn
  );
}

function listedTechnical(companyName: string): RedAuditEntry[] {
  return getRedAuditLog({
    connectedCompanyNames: [companyName],
    includeTechnicalDetails: true,
  });
}

function listedCustomer(companyName: string): RedAuditEntry[] {
  return getRedAuditLog({
    connectedCompanyNames: [companyName],
  });
}

function invokeWrapped(
  wrapped: (args: Record<string, unknown>) => Promise<unknown> | unknown,
  args: Record<string, unknown>
): Promise<unknown> {
  return Promise.resolve(wrapped(args));
}

function captureAuditToolHandler(toolName: string) {
  let handler:
    | ((args: Record<string, unknown>) => Promise<unknown> | unknown)
    | undefined;
  registerAuditTools({
    tool(
      name: string,
      _description: string,
      _schema: unknown,
      registeredHandler: (args: Record<string, unknown>) => Promise<unknown>
    ) {
      if (name === toolName) {
        handler = registeredHandler;
      }
    },
  } as never);
  assert.ok(handler, `expected ${toolName} to register`);
  return handler!;
}

test("brc_route_request message is remembered on the issued route token", () => {
  __resetInitiatingRequestsForTests();
  const issued = issueActionRouteToken({
    workflow: "update_quote",
    allowedTools: ["brc_update_quote"],
    message: "Change Quote id 999999999 reference to QA0001",
    sessionId: "local-stdio",
  });
  assert.equal(
    peekInitiatingRequestForRoute(issued.payload.jti),
    "Change Quote id 999999999 reference to QA0001"
  );
});

test("sanitizeInitiatingRequest redacts secrets and length-limits", () => {
  const sanitized = sanitizeInitiatingRequest(
    "Change Quote apiKey=super-secret-company-key with redconn_abc123TOKEN and redroute_zzz.yy Authorization: Bearer abc"
  );
  assert.ok(sanitized);
  assert.equal(sanitized!.includes("super-secret-company-key"), false);
  assert.equal(sanitized!.includes("redconn_abc123TOKEN"), false);
  assert.equal(sanitized!.includes("redroute_zzz"), false);
  assert.equal(sanitized!.includes("Bearer abc"), false);
  assert.match(sanitized!, /<REDACTED>/);

  const long = "x".repeat(MAX_INITIATING_REQUEST_LENGTH + 80);
  const clipped = sanitizeInitiatingRequest(long);
  assert.ok(clipped);
  assert.ok(clipped!.endsWith("…"));
  assert.ok(clipped!.length <= MAX_INITIATING_REQUEST_LENGTH + 1);
});

test("customer-facing audit output does not gain support-report technical fields", () => {
  __resetRedAuditLogForTests();
  recordRedAuditEntry({
    companyName: "Company C",
    method: "PUT",
    path: "/v1/quotes/42",
    outcome: "success",
    initiatingRequest: "Change Quote 42 reference to QA0001",
    stage: "write",
    toolName: "brc_update_quote",
    statusCode: 200,
    statusText: "OK",
  });

  const customerFacing = listedCustomer("Company C");
  assert.equal(customerFacing.length, 1);
  for (const key of Object.keys(customerFacing[0]!)) {
    assert.ok(
      CUSTOMER_FACING_AUDIT_KEYS.has(key),
      `unexpected customer-facing field: ${key}`
    );
  }
  assert.equal("initiatingRequest" in customerFacing[0]!, false);
  assert.equal("stage" in customerFacing[0]!, false);
  assert.equal("toolName" in customerFacing[0]!, false);
  assert.equal("mcpSessionId" in customerFacing[0]!, false);
  assert.equal("connectionId" in customerFacing[0]!, false);
  assert.equal("userId" in customerFacing[0]!, false);
  assert.equal("statusCode" in customerFacing[0]!, false);
  assert.equal("failedMethod" in customerFacing[0]!, false);
  assert.equal("failedPath" in customerFacing[0]!, false);
  assert.equal("telemetryConnectionSessionId" in customerFacing[0]!, false);
  assert.equal("telemetryClientId" in customerFacing[0]!, false);
});

test("support report includes success, confirmed Quote preflight failure, and routed request", async () => {
  __resetRedAuditLogForTests();
  __resetInitiatingRequestsForTests();
  __resetBrcFailureTelemetryForTests();

  await withStagingTelemetry(async () => {
    recordRedAuditEntry({
      companyName: "Company C",
      method: "PUT",
      path: "/v1/quotes/2892411",
      outcome: "success",
      initiatingRequest: "Update Quote 2892411 reference to QA0002",
      stage: "write",
      statusCode: 200,
      statusText: "OK",
    });

    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
      throw GET_FAILURE;
    });

    await runWithInitiatingRequest(
      "Change Quote id 999999999 reference to QA0001",
      async () => {
        await assert.rejects(() =>
          invokeWrapped(wrapped, {
            companyName: "Company C",
            id: 999999999,
            reference: "QA0001",
            confirmWrite: true,
          })
        );
      }
    );

    const azureDims = buildTelemetryCustomDimensions();
    const technical = listedTechnical("Company C");
    assert.equal(technical.length, 2);
    const report = buildRedSupportReport({
      companyName: "Company C",
      entries: technical,
      generatedAtUtc: "2026-08-17T14:02:10.718Z",
      redVersion: "1.5.0",
      environment: "staging",
    });

    assert.equal(
      report.filename,
      "red-support-report-Company-C-20260817T140210Z.txt"
    );
    assert.match(report.text, /Red Support Diagnostic Report/);
    assert.match(report.text, /generatedAtUtc: 2026-08-17T14:02:10.718Z/);
    assert.match(report.text, /companyName: Company C/);
    assert.match(report.text, /redVersion: 1.5.0/);
    assert.match(report.text, /environment: staging/);
    assert.match(report.text, /AZURE CORRELATION/);
    assert.match(
      report.text,
      new RegExp(
        `telemetryConnectionSessionId: ${STAGING_CONNECTION_SESSION_ID}`
      )
    );
    assert.match(
      report.text,
      new RegExp(`telemetryClientId: ${STAGING_TELEMETRY_CLIENT_ID}`)
    );
    assert.equal(
      report.text.match(/telemetryConnectionSessionId: ([^\r\n]+)/)?.[1],
      azureDims["red.connection_session_id"]
    );
    assert.equal(
      report.text.match(/telemetryClientId: ([^\r\n]+)/)?.[1],
      azureDims["red.telemetry_client_id"]
    );
    assert.match(
      report.text,
      /Use telemetryConnectionSessionId to locate this Red session in Application Insights/
    );
    assert.match(report.text, /mcpSessionId:/);
    assert.match(report.text, /connectionId:/);
    assert.match(report.text, /does not receive the full chat transcript/i);
    assert.match(report.text, /attemptedWrites: 2/);
    assert.match(report.text, /successes: 1/);
    assert.match(report.text, /failures: 1/);
    assert.match(report.text, /Quote 2892411/);
    assert.match(report.text, /SUCCESS/);
    assert.match(
      report.text,
      /Intended write:\r?\nPUT \/v1\/quotes\/2892411/
    );
    assert.match(
      report.text,
      /Actual BRC request:\r?\nPUT \/v1\/quotes\/2892411/
    );
    assert.match(report.text, /Quote 999999999/);
    assert.match(report.text, /FAILURE/);
    assert.match(report.text, /Preflight/);
    assert.match(
      report.text,
      /Intended write:\r?\nPUT \/v1\/quotes\/999999999/
    );
    assert.match(
      report.text,
      /Actual BRC request:\r?\nGET \/v1\/quotes\/999999999\r?\n500 Internal Server Error/
    );
    assert.match(report.text, /The intended write did not run\./);
    assert.equal(
      /Actual BRC request:\r?\nPUT \/v1\/quotes\/999999999/.test(report.text),
      false
    );
    assert.match(report.text, /500 Internal Server Error/);
    assert.match(report.text, /Unknown error occurred/);
    assert.match(report.text, /Change Quote id 999999999 reference to QA0001/);
    assert.equal(report.text.includes("userId"), false);
    assert.equal("userId" in technical[1]!, false);
    assert.equal(technical[1]!.method, "PUT");
    assert.equal(technical[1]!.failedMethod, "GET");
    assert.equal(technical[1]!.failedPath, "/v1/quotes/999999999");

    const customerFacing = listedCustomer("Company C");
    assert.equal("telemetryConnectionSessionId" in customerFacing[1]!, false);
    assert.equal("telemetryClientId" in customerFacing[1]!, false);
    assert.equal("failedMethod" in customerFacing[1]!, false);
    assert.equal(customerFacing[1]!.method, "PUT");

    const beforeCount = listedTechnical("Company C").length;
    buildRedSupportReport({
      companyName: "Company C",
      entries: listedTechnical("Company C"),
    });
    assert.equal(listedTechnical("Company C").length, beforeCount);
  });
});

test("support report does not invent a user request when routing text was not received", async () => {
  __resetRedAuditLogForTests();
  const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
    throw GET_FAILURE;
  });

  await assert.rejects(() =>
    invokeWrapped(wrapped, {
      companyName: "Company C",
      id: 999999999,
      reference: "QA0001",
      confirmWrite: true,
    })
  );

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  assert.match(report.text, /not received by Red for this action/);
  assert.match(report.text, /does not receive the full chat transcript/i);
  assert.match(report.text, /Update Quote 999999999/);
  assert.equal(report.text.includes("Change Quote id 999999999"), false);
});

test("Company C support report excludes Company B and Company D activity", () => {
  __resetRedAuditLogForTests();
  recordRedAuditEntry({
    companyName: "Company C",
    method: "PUT",
    path: "/v1/quotes/1",
    outcome: "success",
  });
  recordRedAuditEntry({
    companyName: "Company B",
    method: "POST",
    path: "/v1/quotes",
    outcome: "success",
  });
  recordRedAuditEntry({
    companyName: "Company D",
    method: "DELETE",
    path: "/v1/quotes/9",
    outcome: "failure",
    errorSummary: "should not appear",
  });

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  assert.match(report.text, /Company C/);
  assert.equal(report.text.includes("Company B"), false);
  assert.equal(report.text.includes("Company D"), false);
  assert.equal(report.text.includes("should not appear"), false);
});

test("support report redacts credentials from initiating request and never stores secrets", async () => {
  __resetRedAuditLogForTests();
  const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
    throw GET_FAILURE;
  });

  await runWithInitiatingRequest(
    "Change Quote 999999999 apiKey=super-secret-company-key token=access-token-value connectionRef=redconn_secretref routeToken=redroute_secrettok",
    async () => {
      await assert.rejects(() =>
        invokeWrapped(wrapped, {
          companyName: "Company C",
          id: 999999999,
          reference: "QA0001",
          confirmWrite: true,
        })
      );
    }
  );

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  const blob = report.text;
  assert.equal(blob.includes("super-secret-company-key"), false);
  assert.equal(blob.includes("access-token-value"), false);
  assert.equal(blob.includes("redconn_secretref"), false);
  assert.equal(blob.includes("redroute_secrettok"), false);
  assert.equal(/Authorization:/i.test(blob), false);
  assert.equal(blob.includes("userId"), false);
  assert.equal(/password/i.test(blob), false);
  assert.match(blob, /<REDACTED>/);
});

test("unrelated conversation text is not stored as the initiating request", async () => {
  __resetRedAuditLogForTests();
  const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
    throw GET_FAILURE;
  });

  await runWithInitiatingRequest(
    "Change Quote id 999999999 reference to QA0001",
    async () => {
      await assert.rejects(() =>
        invokeWrapped(wrapped, {
          companyName: "Company C",
          id: 999999999,
          reference: "QA0001",
          confirmWrite: true,
        })
      );
    }
  );

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  assert.equal(report.text.includes("how was your weekend"), false);
  assert.equal(report.text.includes("debug the MCP server"), false);
  assert.match(report.text, /Change Quote id 999999999 reference to QA0001/);
});

test("multiple failures appear in chronological order", () => {
  __resetRedAuditLogForTests();
  recordRedAuditEntry({
    companyName: "Company C",
    method: "PUT",
    path: "/v1/quotes/1",
    outcome: "failure",
    errorSummary: "first failure",
    stage: "write",
  });
  recordRedAuditEntry({
    companyName: "Company C",
    method: "PUT",
    path: "/v1/quotes/2",
    outcome: "failure",
    errorSummary: "second failure",
    stage: "preflight",
  });

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  const first = report.text.indexOf("first failure");
  const second = report.text.indexOf("second failure");
  assert.ok(first >= 0 && second > first);
  assert.match(report.text, /failures: 2/);
});

test("MCP support report response attaches a plain-text resource", () => {
  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: [],
    generatedAtUtc: "2026-08-17T14:02:10.718Z",
  });
  const response = supportReportMcpResponse(report);
  assert.equal(response.content[0]?.type, "text");
  assert.match(String(response.content[0] && "text" in response.content[0] ? response.content[0].text : ""), /diagnostic report/i);
  const resourcePart = response.content[1];
  assert.equal(resourcePart?.type, "resource");
  if (resourcePart && resourcePart.type === "resource") {
    assert.equal(resourcePart.resource.mimeType, "text/plain");
    assert.match(resourcePart.resource.uri, /^red:\/\/support-report\//);
    assert.match(resourcePart.resource.text, /Red Support Diagnostic Report/);
  }
  assert.match(buildSupportReportFilename("Company C", "2026-08-17T14:02:10.718Z"), /\.txt$/);
});

test("brc_generate_support_report is scoped to the connected company and is not a BRC write", async () => {
  __resetRedAuditLogForTests();
  setApiKeyForCompany({
    companyName: "Company C",
    apiKey: "test-key-not-for-report",
    expiresAt: Date.now() + 60_000,
  });
  recordRedAuditEntry({
    companyName: "Company C",
    method: "PUT",
    path: "/v1/quotes/42",
    outcome: "success",
  });
  recordRedAuditEntry({
    companyName: "Company B",
    method: "PUT",
    path: "/v1/quotes/99",
    outcome: "failure",
    errorSummary: "other-company-secret-should-not-leak",
  });

  const handler = captureAuditToolHandler("brc_generate_support_report");
  const before = listedTechnical("Company C").length;
  try {
    const result = (await handler({ companyName: "Company C" })) as {
      content: Array<{ type: string; text?: string }>;
    };
    const after = listedTechnical("Company C").length;
    assert.equal(after, before);

    const text = result.content.map((part) => part.text ?? "").join("\n");
    assert.match(text, /Company C/);
    assert.equal(text.includes("Company B"), false);
    assert.equal(text.includes("other-company-secret-should-not-leak"), false);
    assert.equal(text.includes("test-key-not-for-report"), false);
    assert.equal(text.includes("userId"), false);
  } finally {
    clearCredentialForCompany("Company C");
  }
});

test("preflight failure without a known BRC request is marked unavailable", () => {
  __resetRedAuditLogForTests();
  recordRedAuditEntry({
    companyName: "Company C",
    method: "PUT",
    path: "/v1/quotes/999999999",
    outcome: "failure",
    stage: "preflight",
    errorSummary: "Write did not complete. Could not read Quote 999999999.",
    initiatingRequest: "Change Quote 999999999 reference to QA0001",
  });

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  assert.match(report.text, /Intended write:\r?\nPUT \/v1\/quotes\/999999999/);
  assert.match(report.text, /Actual BRC request:\r?\nunavailable/);
  assert.equal(
    /Actual BRC request:\r?\nGET \/v1\/quotes\/999999999/.test(report.text),
    false
  );
  assert.equal(report.text.includes("The intended write did not run."), false);
  assert.match(report.text, /Preflight/);
  assert.match(report.text, /Change Quote 999999999 reference to QA0001/);
});

test("support report stamped telemetry IDs match App Insights dimensions when live context is absent", () => {
  __resetRedAuditLogForTests();
  withStagingTelemetry(() => {
    recordRedAuditEntry({
      companyName: "Company C",
      method: "PUT",
      path: "/v1/quotes/42",
      outcome: "success",
    });
  });

  const report = buildRedSupportReport({
    companyName: "Company C",
    entries: listedTechnical("Company C"),
  });
  assert.match(
    report.text,
    new RegExp(`telemetryConnectionSessionId: ${STAGING_CONNECTION_SESSION_ID}`)
  );
  assert.match(
    report.text,
    new RegExp(`telemetryClientId: ${STAGING_TELEMETRY_CLIENT_ID}`)
  );
  assert.equal(report.text.includes("userId"), false);
});
