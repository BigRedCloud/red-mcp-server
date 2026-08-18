import assert from "node:assert/strict";
import test from "node:test";
import { __resetRedAuditLogForTests, getRedAuditLog, recordRedAuditEntry, } from "../shared.js";
import { wrapWriteToolHandler } from "./write_confirmation.js";
function parseBody(result) {
    const text = result.content[0].text;
    return JSON.parse(text);
}
function listedEntries() {
    return getRedAuditLog({
        connectedCompanyNames: ["Company C"],
        includeTechnicalDetails: true,
    });
}
function listedCustomerFacing() {
    return getRedAuditLog({
        connectedCompanyNames: ["Company C"],
    });
}
function invokeWrapped(wrapped, args) {
    return Promise.resolve(wrapped(args));
}
const QUOTE_UPDATE_ARGS = {
    companyName: "Company C",
    id: 999999999,
    reference: "QA0001",
};
const GET_FAILURE = new Error('BRC API GET /v1/quotes/999999999 failed for "Company C": 500 Internal Server Error. Unknown error occurred. Please contact the Big Red Cloud Support Team.');
test("unconfirmed quote update preview does not audit a failed write", async () => {
    __resetRedAuditLogForTests();
    let handlerCalled = false;
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        handlerCalled = true;
        throw GET_FAILURE;
    });
    const preview = parseBody(await wrapped(QUOTE_UPDATE_ARGS));
    assert.equal(preview.status, "confirmation_required");
    assert.equal(handlerCalled, false);
    assert.equal(listedEntries().length, 0);
});
test("cancelled quote update preview does not audit a failed write", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        throw GET_FAILURE;
    });
    parseBody(await wrapped(QUOTE_UPDATE_ARGS));
    assert.equal(listedEntries().length, 0);
});
test("staging: confirmed quote update audits GET failure before PUT", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        throw GET_FAILURE;
    });
    parseBody(await wrapped(QUOTE_UPDATE_ARGS));
    await assert.rejects(() => invokeWrapped(wrapped, { ...QUOTE_UPDATE_ARGS, confirmWrite: true }), GET_FAILURE);
    const technical = listedEntries();
    assert.equal(technical.length, 1);
    const entry = technical[0];
    assert.equal(entry.outcome, "failure");
    assert.equal(entry.operation, "update");
    assert.equal(entry.recordType, "Quote");
    assert.equal(String(entry.recordId), "999999999");
    assert.match(entry.timestampUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.match(entry.summary, /Failed to update Quote 999999999/);
    assert.match(entry.errorSummary ?? "", /500 Internal Server Error|Unknown error occurred/i);
    assert.equal(entry.stage, "preflight");
    assert.equal(entry.method, "PUT");
    assert.equal(entry.path, "/v1/quotes/999999999");
    assert.equal(entry.failedMethod, "GET");
    assert.equal(entry.failedPath, "/v1/quotes/999999999");
    assert.equal("userId" in entry, false);
    const customerFacing = listedCustomerFacing();
    assert.equal(customerFacing.length, 1);
    assert.equal(customerFacing[0].summary, "Failed to update Quote 999999999");
    assert.equal(customerFacing[0].method, "PUT");
    assert.equal(customerFacing[0].path, "/v1/quotes/999999999");
    assert.equal("stage" in customerFacing[0], false);
    assert.equal("failedMethod" in customerFacing[0], false);
    assert.equal("failedPath" in customerFacing[0], false);
    assert.equal("mcpSessionId" in customerFacing[0], false);
    assert.equal("connectionId" in customerFacing[0], false);
    assert.equal("userId" in customerFacing[0], false);
    assert.equal("telemetryConnectionSessionId" in customerFacing[0], false);
    assert.equal("telemetryClientId" in customerFacing[0], false);
    const customerJson = JSON.stringify(customerFacing[0]);
    assert.equal(customerJson.includes("redconn_"), false);
    assert.equal(customerJson.includes("routeToken"), false);
    assert.equal(customerJson.includes("apiKey"), false);
});
test("confirmed write whose final PUT already audited is not double-logged", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        recordRedAuditEntry({
            companyName: "Company C",
            method: "PUT",
            path: "/v1/quotes/999999999",
            outcome: "failure",
            errorSummary: "Write did not complete (422 Unprocessable Entity). Quote is closed.",
            stage: "write",
        });
        throw new Error("BRC API PUT /v1/quotes/999999999 failed");
    });
    await assert.rejects(() => invokeWrapped(wrapped, { ...QUOTE_UPDATE_ARGS, confirmWrite: true }));
    const entries = listedEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome, "failure");
    assert.equal(entries[0].stage, "write");
    assert.match(entries[0].errorSummary ?? "", /Quote is closed/);
});
test("successful confirmed write is audited once", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        recordRedAuditEntry({
            companyName: "Company C",
            method: "PUT",
            path: "/v1/quotes/42",
            outcome: "success",
        });
        return "updated";
    });
    const result = await wrapped({
        companyName: "Company C",
        id: 42,
        reference: "QT0001",
        confirmWrite: true,
    });
    assert.equal(result, "updated");
    const entries = listedEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome, "success");
    assert.equal(entries[0].operation, "update");
});
test("confirmed delete audits current-record lookup failure", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_delete_cash_payment", async () => {
        throw new Error("Could not read Cash payment 581729508 before deletion.");
    });
    await assert.rejects(() => invokeWrapped(wrapped, {
        companyName: "Company C",
        id: 581729508,
        confirmDelete: true,
    }));
    const entries = listedEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome, "failure");
    assert.equal(entries[0].operation, "delete");
    assert.equal(entries[0].recordType, "Cash payment");
    assert.equal(String(entries[0].recordId), "581729508");
    assert.equal(entries[0].stage, "preflight");
});
test("unconfirmed delete_quote lookup failure is not a failed-write audit", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_delete_quote", async () => {
        throw GET_FAILURE;
    });
    await assert.rejects(() => invokeWrapped(wrapped, QUOTE_UPDATE_ARGS));
    assert.equal(listedEntries().length, 0);
});
test("nested catch-and-rethrow does not double-log a confirmed write failure", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        try {
            throw GET_FAILURE;
        }
        catch (error) {
            throw error;
        }
    });
    await assert.rejects(() => invokeWrapped(wrapped, { ...QUOTE_UPDATE_ARGS, confirmWrite: true }));
    assert.equal(listedEntries().length, 1);
    assert.equal(listedEntries()[0].outcome, "failure");
});
test("confirmed cash receipt update GET failure is audited once", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_cash_receipt", async () => {
        throw new Error("Could not read Cash receipt 42 before update.");
    });
    await assert.rejects(() => invokeWrapped(wrapped, {
        companyName: "Company C",
        id: 42,
        confirmWrite: true,
    }));
    const entries = listedEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].outcome, "failure");
    assert.equal(entries[0].operation, "update");
    assert.equal(entries[0].recordType, "Cash receipt");
    assert.equal(String(entries[0].recordId), "42");
    assert.equal(entries[0].stage, "preflight");
});
test("failed confirmed write stays scoped to the current session and connected company", async () => {
    __resetRedAuditLogForTests();
    const wrapped = wrapWriteToolHandler("brc_update_quote", async () => {
        throw GET_FAILURE;
    });
    await assert.rejects(() => invokeWrapped(wrapped, { ...QUOTE_UPDATE_ARGS, confirmWrite: true }));
    assert.equal(listedEntries().length, 1);
    assert.equal(getRedAuditLog({
        connectedCompanyNames: ["Other Co"],
        includeTechnicalDetails: true,
    }).length, 0);
    assert.equal(getRedAuditLog({
        scope: { mcpSessionId: "other-session" },
        connectedCompanyNames: ["Company C"],
        includeTechnicalDetails: true,
    }).length, 0);
});
