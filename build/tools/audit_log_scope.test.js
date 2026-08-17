import assert from "node:assert/strict";
import test from "node:test";
import { __resetRedAuditLogForTests, auditEntryMatchesScope, getRedAuditLog, recordRedAuditEntry, } from "../shared.js";
function recordForScope(args) {
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
test("successful write audit events include server timestampUtc and operation/outcome", () => {
    __resetRedAuditLogForTests();
    const first = recordForScope({ ...SESSION_A, companyName: "Test3" });
    const second = recordRedAuditEntry({
        companyName: "Test3",
        method: "PUT",
        path: "/v1/quotes/42",
        mcpSessionId: SESSION_A.mcpSessionId,
        connectionId: SESSION_A.connectionId,
        requestBody: { reference: "QT0002" },
        responseBody: { id: 42, reference: "QT0002" },
    });
    const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const beforeMs = Date.now() - 5_000;
    assert.match(first.timestampUtc, isoUtc);
    assert.equal(first.timestampUtc, first.timestamp);
    assert.ok(Date.parse(first.timestampUtc) >= beforeMs);
    assert.ok(Date.parse(first.timestampUtc) <= Date.now() + 1_000);
    const ignoredClientStamp = recordRedAuditEntry({
        companyName: "Test3",
        method: "POST",
        path: "/v1/quotes",
        mcpSessionId: SESSION_A.mcpSessionId,
        connectionId: SESSION_A.connectionId,
        timestampUtc: "1999-01-01T00:00:00.000Z",
        timestamp: "1999-01-01T00:00:00.000Z",
    });
    assert.notEqual(ignoredClientStamp.timestampUtc, "1999-01-01T00:00:00.000Z");
    assert.match(ignoredClientStamp.timestampUtc, isoUtc);
    assert.equal(first.outcome, "success");
    assert.equal(first.operation, "create");
    assert.equal(second.outcome, "success");
    assert.equal(second.operation, "update");
    assert.equal(first.mcpSessionId, second.mcpSessionId);
    assert.equal("userId" in first, false);
    assert.equal("userId" in second, false);
    const customerFacing = getRedAuditLog({
        scope: SESSION_A,
        connectedCompanyNames: ["Test3"],
    });
    assert.equal(customerFacing.length, 3);
    for (const entry of customerFacing) {
        assert.match(entry.timestampUtc, isoUtc);
        assert.equal("userId" in entry, false);
        assert.equal("mcpSessionId" in entry, false);
        assert.equal("connectionId" in entry, false);
        assert.equal("requestBody" in entry, false);
        assert.equal("responseBody" in entry, false);
    }
});
test("failed writes record outcome metadata without credentials", () => {
    __resetRedAuditLogForTests();
    const entry = recordRedAuditEntry({
        companyName: "Test3",
        method: "PUT",
        path: "/v1/salesInvoices/123",
        mcpSessionId: SESSION_A.mcpSessionId,
        connectionId: SESSION_A.connectionId,
        requestBody: {
            amount: 20,
            apiKey: "super-secret-company-key",
            token: "access-token-value",
        },
        responseBody: { statusCode: 422, statusText: "Unprocessable Entity" },
        outcome: "failure",
        errorSummary: "Write did not complete (422 Unprocessable Entity). Invoice is closed.",
    });
    assert.equal(entry.outcome, "failure");
    assert.equal(entry.operation, "update");
    assert.match(entry.timestampUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(entry.errorSummary ?? "", /Invoice is closed/);
    assert.equal("userId" in entry, false);
    const customerFacing = getRedAuditLog({
        scope: SESSION_A,
        connectedCompanyNames: ["Test3"],
    });
    assert.equal(customerFacing.length, 1);
    assert.equal(customerFacing[0].outcome, "failure");
    assert.equal(customerFacing[0].errorSummary, entry.errorSummary);
    assert.equal("userId" in customerFacing[0], false);
    assert.equal("requestBody" in customerFacing[0], false);
    assert.equal(JSON.stringify(customerFacing[0]).includes("super-secret-company-key"), false);
    assert.equal(JSON.stringify(customerFacing[0]).includes("access-token-value"), false);
    const technical = getRedAuditLog({
        scope: SESSION_A,
        connectedCompanyNames: ["Test3"],
        includeTechnicalDetails: true,
    });
    assert.equal(technical.length, 1);
    assert.equal(technical[0].mcpSessionId, SESSION_A.mcpSessionId);
    assert.equal("userId" in technical[0], false);
    const technicalJson = JSON.stringify(technical[0]);
    assert.equal(technicalJson.includes("super-secret-company-key"), false);
    assert.equal(technicalJson.includes("access-token-value"), false);
    assert.match(technicalJson, /<REDACTED>/);
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
    assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: "session-A", connectionId: "conn-X" }), false);
    assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: undefined }), false);
});
