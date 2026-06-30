import assert from "node:assert/strict";
import test from "node:test";
import { __resetRedAuditLogForTests, auditEntryMatchesScope, getRedAuditLog, recordRedAuditEntry, runWithMcpSessionContext, } from "../shared.js";
function recordForScope(args) {
    return recordRedAuditEntry({
        companyName: args.companyName,
        method: "POST",
        path: args.path ?? "/v1/salesInvoices",
        mcpSessionId: args.mcpSessionId,
        connectionId: args.connectionId,
    });
}
test("audit entries from another session are not returned", () => {
    __resetRedAuditLogForTests();
    recordForScope({ mcpSessionId: "other-session", connectionId: "C2", companyName: "MCP Demo Company 01" });
    recordForScope({ mcpSessionId: "mine", connectionId: "C1", companyName: "My Company" });
    const entries = getRedAuditLog({ scope: { mcpSessionId: "mine", connectionId: "C1" } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].companyName, "My Company");
});
test("audit entries from another company/connection in another session are not returned", () => {
    __resetRedAuditLogForTests();
    // Dave's "yesterday" activity in another session/connection/company.
    recordForScope({ mcpSessionId: "dave-yesterday", connectionId: "C-DAVE", companyName: "MCP Demo Company 01" });
    const entries = getRedAuditLog({ scope: { mcpSessionId: "mine", connectionId: "C1" } });
    assert.equal(entries.length, 0);
});
test("current-session entries are returned", () => {
    __resetRedAuditLogForTests();
    recordForScope({ mcpSessionId: "mine", connectionId: "C1", companyName: "My Company", path: "/v1/customers" });
    recordForScope({ mcpSessionId: "mine", connectionId: "C1", companyName: "My Company", path: "/v1/salesInvoices" });
    const entries = getRedAuditLog({ scope: { mcpSessionId: "mine", connectionId: "C1" } });
    assert.equal(entries.length, 2);
});
test("asking for yesterday does not bypass scope filtering", () => {
    __resetRedAuditLogForTests();
    // An older entry from another session must never surface, regardless of the
    // time range a user asks about — the audit log is scoped, not time-filtered.
    const other = recordForScope({ mcpSessionId: "other", connectionId: "C2", companyName: "Other Co" });
    other.timestamp = "2026-06-29T09:00:00.000Z"; // "yesterday"
    recordForScope({ mcpSessionId: "mine", connectionId: "C1", companyName: "My Company" });
    const entries = getRedAuditLog({ scope: { mcpSessionId: "mine", connectionId: "C1" } });
    assert.equal(entries.length, 1);
    assert.equal(entries.every((entry) => entry.companyName !== "Other Co"), true);
});
test("with no current session scope, nothing is returned (no global leakage)", () => {
    __resetRedAuditLogForTests();
    recordForScope({ mcpSessionId: "mine", connectionId: "C1", companyName: "My Company" });
    const entries = getRedAuditLog({ scope: { mcpSessionId: undefined, connectionId: undefined } });
    assert.equal(entries.length, 0);
});
test("auditEntryMatchesScope requires a matching session and (when known) connection", () => {
    const entry = recordRedAuditEntry({
        companyName: "My Company",
        method: "POST",
        path: "/v1/salesInvoices",
        mcpSessionId: "mine",
        connectionId: "C1",
    });
    assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: "mine", connectionId: "C1" }), true);
    assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: "other", connectionId: "C1" }), false);
    assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: "mine", connectionId: "C2" }), false);
    assert.equal(auditEntryMatchesScope(entry, { mcpSessionId: undefined }), false);
});
test("entries are scoped by the active MCP session context when recorded", () => {
    __resetRedAuditLogForTests();
    runWithMcpSessionContext({ sessionId: "session-a", connectionId: "conn-a" }, () => {
        recordRedAuditEntry({ companyName: "A Co", method: "POST", path: "/v1/salesInvoices" });
    });
    runWithMcpSessionContext({ sessionId: "session-b", connectionId: "conn-b" }, () => {
        recordRedAuditEntry({ companyName: "B Co", method: "POST", path: "/v1/salesInvoices" });
        const visible = getRedAuditLog();
        assert.equal(visible.length, 1);
        assert.equal(visible[0].companyName, "B Co");
    });
});
