import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetRedAuditLogForTests,
  auditEntryMatchesScope,
  getRedAuditLog,
  recordRedAuditEntry,
  type RedAuditEntry,
} from "../shared.js";

function recordForScope(args: {
  mcpSessionId: string;
  connectionId: string;
  companyName: string;
  path?: string;
}): RedAuditEntry {
  return recordRedAuditEntry({
    companyName: args.companyName,
    method: "POST",
    path: args.path ?? "/v1/salesInvoices",
    mcpSessionId: args.mcpSessionId,
    connectionId: args.connectionId,
  });
}

const SESSION_A = { mcpSessionId: "session-A", connectionId: "conn-A" };
const SESSION_B = { mcpSessionId: "session-B", connectionId: "conn-B" };

test("1. session A sees Test3 entries while Test3 is connected", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: ["Test1", "Test2", "Test3", "Test4"],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].companyName, "Test3");
});

test("2. after clearing companies, the audit log returns no company-change entries", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });

  // No companies currently connected (cleared) -> nothing returned.
  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: [],
  });

  assert.equal(entries.length, 0);
});

test("3. reconnecting only Test1/Test2/Test4 does not return old Test3 entries", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });
  recordForScope({ ...SESSION_A, companyName: "Test1" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: ["Test1", "Test2", "Test4"],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].companyName, "Test1");
  assert.equal(entries.some((e) => e.companyName === "Test3"), false);
});

test("4. session B cannot see session A audit entries", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });

  const entries = getRedAuditLog({
    scope: SESSION_B,
    connectedCompanyNames: ["Test3"],
  });

  assert.equal(entries.length, 0);
});

test("5. session B using the same company names/keys still cannot see session A entries", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });
  recordForScope({ ...SESSION_A, companyName: "Test1" });

  // Session B has the very same companies connected (same names/keys), but a
  // different MCP session -> it must see none of session A's activity.
  const entries = getRedAuditLog({
    scope: SESSION_B,
    connectedCompanyNames: ["Test1", "Test3"],
  });

  assert.equal(entries.length, 0);
});

test("6. entries from disconnected companies are ignored even within the same session", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });
  recordForScope({ ...SESSION_A, companyName: "Test2" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: ["Test2"], // Test3 disconnected
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].companyName, "Test2");
});

test("7. yesterday/last week queries cannot bypass the session/company filter", () => {
  __resetRedAuditLogForTests();

  // Old Test3 activity from yesterday, now disconnected.
  const old = recordForScope({ ...SESSION_A, companyName: "Test3" });
  old.timestamp = "2026-06-29T09:00:00.000Z";

  // Old activity from another session.
  const otherSession = recordForScope({ ...SESSION_B, companyName: "Test2" });
  otherSession.timestamp = "2026-06-23T09:00:00.000Z"; // last week

  recordForScope({ ...SESSION_A, companyName: "Test2" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: ["Test1", "Test2", "Test4"],
  });

  // Only the current-session, currently-connected Test2 entry is visible; the
  // log is scoped, not time-filtered, so date ranges cannot widen it.
  assert.equal(entries.length, 1);
  assert.equal(entries[0].companyName, "Test2");
  // Scope fields are never exposed in the default (non-technical) response.
  assert.equal("mcpSessionId" in entries[0], false);
});

test("8. no current connection/session scope returns no entries (no global fallback)", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });

  const entries = getRedAuditLog({
    scope: { mcpSessionId: undefined, connectionId: undefined },
    connectedCompanyNames: ["Test3"],
  });

  assert.equal(entries.length, 0);
});

test("9. no currently connected companies returns no entries", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: [],
  });

  assert.equal(entries.length, 0);
});

test("company-name matching is case/whitespace-insensitive against connected companies", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: ["  test3  "],
  });

  assert.equal(entries.length, 1);
});

test("includeTechnicalDetails path is also scoped and company-filtered", () => {
  __resetRedAuditLogForTests();
  recordForScope({ ...SESSION_A, companyName: "Test3" });
  recordForScope({ ...SESSION_B, companyName: "Test3" });

  const entries = getRedAuditLog({
    scope: SESSION_A,
    connectedCompanyNames: ["Test3"],
    includeTechnicalDetails: true,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].mcpSessionId, SESSION_A.mcpSessionId);
});

test("auditEntryMatchesScope requires a matching session and (when known) connection", () => {
  const entry = recordRedAuditEntry({
    companyName: "Test3",
    method: "POST",
    path: "/v1/salesInvoices",
    mcpSessionId: "session-A",
    connectionId: "conn-A",
  });

  assert.equal(auditEntryMatchesScope(entry, SESSION_A), true);
  assert.equal(auditEntryMatchesScope(entry, SESSION_B), false);
  assert.equal(
    auditEntryMatchesScope(entry, { mcpSessionId: "session-A", connectionId: "conn-X" }),
    false
  );
  assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: undefined }), false);
});
