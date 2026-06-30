import assert from "node:assert/strict";
import test from "node:test";

import {
  describeWriteStatusForUser,
  RED_ACTIVITY_SCOPE_INSTRUCTION,
} from "./shared.js";

test("201 is described as created successfully without an HTTP code", () => {
  const text = describeWriteStatusForUser(201);
  assert.equal(text, "created successfully");
  assert.equal(/201|HTTP/.test(text), false);
});

test("204 is described as saved successfully without an HTTP code", () => {
  const text = describeWriteStatusForUser(204);
  assert.equal(text, "saved successfully");
  assert.equal(/204|HTTP/.test(text), false);
});

test("200 is described as saved successfully", () => {
  assert.equal(describeWriteStatusForUser(200), "saved successfully");
});

test("401 is described as the connection no longer being valid", () => {
  const text = describeWriteStatusForUser(401);
  assert.match(text, /connection was no longer valid|needed to be refreshed/);
  assert.equal(/401|HTTP/.test(text), false);
});

test("403 reuses the connection-no-longer-valid wording", () => {
  assert.match(
    describeWriteStatusForUser(403),
    /connection was no longer valid|needed to be refreshed/
  );
});

test("technical details are only included when explicitly requested", () => {
  assert.equal(
    describeWriteStatusForUser(201, { includeTechnicalDetails: true }),
    "created successfully (HTTP 201)"
  );
});

test("Red activity scope instruction limits answers to Red/BRC activity only", () => {
  assert.match(RED_ACTIVITY_SCOPE_INSTRUCTION, /in Red|Big Red Cloud/);
  assert.match(RED_ACTIVITY_SCOPE_INSTRUCTION, /audit log/);
  assert.match(RED_ACTIVITY_SCOPE_INSTRUCTION, /BRC/);
});

test("Red activity scope instruction excludes unrelated chat history", () => {
  assert.match(RED_ACTIVITY_SCOPE_INSTRUCTION, /MCP debugging/);
  assert.match(RED_ACTIVITY_SCOPE_INSTRUCTION, /Mistral debugging/);
  assert.match(RED_ACTIVITY_SCOPE_INSTRUCTION, /coding work/);
  assert.match(
    RED_ACTIVITY_SCOPE_INSTRUCTION,
    /unless the user explicitly asks for broader chat history/
  );
});
