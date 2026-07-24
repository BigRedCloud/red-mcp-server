import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelemetryClientIdSetCookie,
  buildTelemetryCustomDimensions,
  generateConnectionSessionId,
  generateTelemetryUuid,
  getRedTelemetryContext,
  isValidTelemetryUuid,
  looksSensitiveTelemetryValue,
  normaliseTelemetryClientId,
  parseCookieHeader,
  readTelemetryClientIdFromCookieHeader,
  runWithRedTelemetryContext,
  TELEMETRY_CLIENT_ID_COOKIE,
} from "./identity.js";
import {
  ENDUSER_PSEUDO_ID_ATTRIBUTE,
  RedTelemetrySpanProcessor,
} from "./enrichment.js";
import {
  detectClientPlatform,
  resolveRedTelemetryEnvironment,
} from "./platform.js";
import {
  buildRequestTelemetryContext,
  resolveTelemetryClientIdFromRequest,
} from "./context.js";

test("first visit creates a client ID when cookie and body are absent", () => {
  const first = resolveTelemetryClientIdFromRequest({ headers: {}, body: {} });
  assert.equal(isValidTelemetryUuid(first.clientId), true);
  assert.equal(first.fromCookie, false);
});

test("repeat visit reuses the same client ID from cookie", () => {
  const id = generateTelemetryUuid();
  const first = resolveTelemetryClientIdFromRequest({
    headers: { cookie: `${TELEMETRY_CLIENT_ID_COOKIE}=${id}` },
    body: {},
  });
  const second = resolveTelemetryClientIdFromRequest({
    headers: { cookie: `${TELEMETRY_CLIENT_ID_COOKIE}=${id}` },
    body: { telemetryClientId: generateTelemetryUuid() },
  });
  assert.equal(first.clientId, id.toLowerCase());
  assert.equal(second.clientId, id.toLowerCase());
  assert.equal(second.fromCookie, true);
});

test("malformed client ID is rejected or replaced safely", () => {
  const result = resolveTelemetryClientIdFromRequest({
    headers: {},
    body: { telemetryClientId: "not-a-uuid" },
  });
  assert.equal(isValidTelemetryUuid(result.clientId), true);
  assert.notEqual(result.clientId, "not-a-uuid");
  assert.equal(result.replacedMalformed, true);

  assert.equal(isValidTelemetryUuid(normaliseTelemetryClientId("")), true);
  assert.equal(isValidTelemetryUuid(normaliseTelemetryClientId("abc")), true);
  assert.equal(
    normaliseTelemetryClientId("550e8400-e29b-41d4-a716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000"
  );
});

test("cookie helper builds SameSite Secure cookie without HttpOnly", () => {
  const id = generateTelemetryUuid();
  const cookie = buildTelemetryClientIdSetCookie(id, { secure: true });
  assert.match(cookie, new RegExp(`^${TELEMETRY_CLIENT_ID_COOKIE}=`));
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.equal(/HttpOnly/i.test(cookie), false);
  assert.equal(
    readTelemetryClientIdFromCookieHeader(cookie.split(";")[0]),
    id.toLowerCase()
  );
});

test("parseCookieHeader reads multiple cookies", () => {
  const parsed = parseCookieHeader("a=1; red_telemetry_client_id=550e8400-e29b-41d4-a716-446655440000");
  assert.equal(parsed.a, "1");
  assert.equal(
    parsed.red_telemetry_client_id,
    "550e8400-e29b-41d4-a716-446655440000"
  );
});

test("telemetry dimensions are attached without sensitive fields", () => {
  const dims = buildTelemetryCustomDimensions({
    telemetryClientId: "550e8400-e29b-41d4-a716-446655440000",
    connectionSessionId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    clientPlatform: "vibe",
    environment: "staging",
    connectedCompanyCount: 2,
    toolName: "brc_list_customers",
  });

  assert.equal(dims["red.telemetry_client_id"], "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(dims["red.connection_session_id"], "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
  assert.equal(dims["red.client_platform"], "vibe");
  assert.equal(dims["red.environment"], "staging");
  assert.equal(dims["red.connected_company_count"], "2");
  assert.equal(dims["red.tool_name"], "brc_list_customers");

  const blob = JSON.stringify(dims);
  assert.equal(/apiKey/i.test(blob), false);
  assert.equal(/connectionRef/i.test(blob), false);
  assert.equal(/redconn_/i.test(blob), false);
  assert.equal(/password/i.test(blob), false);
  assert.equal(/@/.test(blob), false);
});

test("missing telemetry context does not fail requests", () => {
  assert.deepEqual(getRedTelemetryContext(), {});
  assert.doesNotThrow(() =>
    runWithRedTelemetryContext({}, () => {
      assert.deepEqual(buildTelemetryCustomDimensions(), {});
      return "ok";
    })
  );
});

test("span processor attaches dimensions and anonymous user id only", () => {
  const processor = new RedTelemetrySpanProcessor();
  const attrs: Record<string, string> = {};
  const span = { attributes: attrs } as any;

  runWithRedTelemetryContext(
    {
      telemetryClientId: "550e8400-e29b-41d4-a716-446655440000",
      connectionSessionId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      clientPlatform: "mistral",
      environment: "production",
      connectedCompanyCount: 1,
      toolName: "brc_company_readiness_check",
    },
    () => {
      processor.onEnd(span);
    }
  );

  assert.equal(attrs["red.telemetry_client_id"], "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(attrs["red.connection_session_id"], "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
  assert.equal(attrs["red.client_platform"], "mistral");
  assert.equal(attrs["red.environment"], "production");
  assert.equal(attrs[ENDUSER_PSEUDO_ID_ATTRIBUTE], "550e8400-e29b-41d4-a716-446655440000");
  assert.equal("enduser.id" in attrs, false);
});

test("span processor swallows enrichment errors", () => {
  const processor = new RedTelemetrySpanProcessor();
  assert.doesNotThrow(() => processor.onEnd({ attributes: null } as any));
});

test("platform is set correctly where known", () => {
  assert.equal(
    detectClientPlatform({ "x-vibe-user-id": "abc" }),
    "vibe"
  );
  assert.equal(
    detectClientPlatform({ "x-mistral-user-id": "abc" }),
    "mistral"
  );
  assert.equal(
    detectClientPlatform({ "user-agent": "ChatGPT-User/1.0" }),
    "chatgpt"
  );
  assert.equal(
    detectClientPlatform({ "user-agent": "claude-desktop" }),
    "claude"
  );
  assert.equal(
    detectClientPlatform({ "user-agent": "Cursor/1.0" }),
    "cursor"
  );
});

test("unknown platform fallback", () => {
  assert.equal(detectClientPlatform({}), "unknown");
  assert.equal(detectClientPlatform({ "user-agent": "" }), "unknown");
  assert.equal(detectClientPlatform({ "user-agent": "Mozilla/5.0" }), "unknown");
});

test("environment is staging/production as configured", () => {
  assert.equal(
    resolveRedTelemetryEnvironment({ BRC_DEPLOYMENT_ENV: "staging" } as NodeJS.ProcessEnv),
    "staging"
  );
  assert.equal(
    resolveRedTelemetryEnvironment({ BRC_DEPLOYMENT_ENV: "production" } as NodeJS.ProcessEnv),
    "production"
  );
  assert.equal(
    resolveRedTelemetryEnvironment({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    "production"
  );
});

test("looksSensitiveTelemetryValue catches secret-like strings", () => {
  assert.equal(looksSensitiveTelemetryValue("brc_list_customers"), false);
  assert.equal(looksSensitiveTelemetryValue("redconn_abc"), true);
  assert.equal(looksSensitiveTelemetryValue("user@example.com"), true);
});

test("buildRequestTelemetryContext stays free of secrets", () => {
  const ctx = buildRequestTelemetryContext({
    req: {
      headers: { "x-vibe-session-id": "vibe-1" },
    } as any,
    telemetryClientId: generateTelemetryUuid(),
    connectionSessionId: generateConnectionSessionId(),
    connectedCompanyCount: 3,
    toolName: "brc_list_customers",
  });
  const dims = buildTelemetryCustomDimensions(ctx);
  assert.equal(dims["red.client_platform"], "vibe");
  assert.equal(dims["red.connected_company_count"], "3");
  assert.equal(/session/i.test(JSON.stringify(dims).replace(/connection_session/g, "")), false);
});
