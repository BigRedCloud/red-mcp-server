import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  mergeConnectionTelemetryRecord,
  pickValidTelemetryUuid,
} from "./connection_telemetry_merge.js";

test("pickValidTelemetryUuid accepts only well-formed UUIDs", () => {
  const id = randomUUID();
  assert.equal(pickValidTelemetryUuid(undefined, "", "nope", id), id.toLowerCase());
  assert.equal(pickValidTelemetryUuid(undefined, "bad"), undefined);
});

test("merge preserves telemetryClientId when patch only adds session id", () => {
  const connectionId = `conn-${randomUUID()}`;
  const clientId = randomUUID();
  const sessionId = randomUUID();

  const first = mergeConnectionTelemetryRecord(connectionId, null, {
    telemetryClientId: clientId,
  });
  assert.equal(first.telemetryClientId, clientId.toLowerCase());
  assert.equal(first.connectionSessionId, undefined);

  const second = mergeConnectionTelemetryRecord(connectionId, first, {
    connectionSessionId: sessionId,
  });
  assert.equal(second.telemetryClientId, clientId.toLowerCase());
  assert.equal(second.connectionSessionId, sessionId.toLowerCase());
});

test("merge ignores invalid patch values and keeps existing ids", () => {
  const connectionId = `conn-${randomUUID()}`;
  const clientId = randomUUID();
  const sessionId = randomUUID();
  const existing = mergeConnectionTelemetryRecord(connectionId, null, {
    telemetryClientId: clientId,
    connectionSessionId: sessionId,
  });

  const merged = mergeConnectionTelemetryRecord(connectionId, existing, {
    telemetryClientId: "not-a-uuid",
    connectionSessionId: undefined,
  });

  assert.equal(merged.telemetryClientId, clientId.toLowerCase());
  assert.equal(merged.connectionSessionId, sessionId.toLowerCase());
});
