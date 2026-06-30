import assert from "node:assert/strict";
import test from "node:test";
import {
  isPendingConnectionExpired,
  PENDING_CONNECTION_NEVER_EXPIRES_AT,
} from "./connection_pending.js";

test("pending connection never-expire sentinel is not treated as expired", () => {
  assert.equal(isPendingConnectionExpired(PENDING_CONNECTION_NEVER_EXPIRES_AT), false);
});

test("pending connection expires when expiry time is in the past", () => {
  assert.equal(isPendingConnectionExpired(999, 1_000), true);
});

test("pending connection is still valid when expiry time is in the future", () => {
  assert.equal(isPendingConnectionExpired(1_001, 1_000), false);
});
