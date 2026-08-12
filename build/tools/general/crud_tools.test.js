import assert from "node:assert/strict";
import test from "node:test";
import { buildCashReceiptPayload, mergeCashReceiptUpdateFromCurrent, } from "./payloads_tools.js";
test("cash receipt note-only update preserves existing VAT and monetary fields", () => {
    const current = {
        id: 550078131,
        timestamp: "AAAAAAA=",
        note: "Updated cash receipt 3868026",
        customerId: 26540869,
        total: 5,
        unallocated: 5,
        discount: 0,
        ledger: 0,
        acCode: 878,
        entryDate: "2026-05-01",
        procDate: "2026-05-26",
        vatTypeId: null,
        totalNet: 5,
        totalVAT: 0,
        reference: "CR-REF",
        vatEntries: [],
        acEntries: [],
    };
    const requestedUpdates = {
        note: "CASH RECEIPT MERGE TEST",
    };
    const built = buildCashReceiptPayload({
        ...current,
        ...requestedUpdates,
    });
    const result = mergeCashReceiptUpdateFromCurrent(built, current, requestedUpdates);
    assert.equal(result.note, "CASH RECEIPT MERGE TEST");
    assert.equal(result.id, 550078131);
    assert.equal(result.timestamp, "AAAAAAA=");
    assert.equal(result.total, 5);
    assert.equal(result.unallocated, 5);
    assert.equal(result.discount, 0);
    assert.equal(result.ledger, 0);
    assert.equal(result.customerId, 26540869);
    assert.equal(result.acCode, 878);
    assert.equal(result.entryDate, "2026-05-01");
    assert.equal(result.procDate, "2026-05-26");
    assert.equal(result.vatTypeId, null);
    assert.equal(result.totalNet, 5);
    assert.equal(result.totalVAT, 0);
    assert.equal(result.reference, "CR-REF");
    assert.deepEqual(result.vatEntries, []);
    assert.deepEqual(result.acEntries, []);
});
test("cash receipt builder uses total as vatEntries amount for analysed create", () => {
    const payload = buildCashReceiptPayload({
        total: 12.3,
        accountCode: "CR02",
        analysisCategoryId: 4216690,
        description: "Cash sale",
        vatRateId: 1596277,
        vatPercentage: 23,
        note: "Analysed cash receipt",
    });
    const acEntry = payload.acEntries[0];
    const vatEntry = payload.vatEntries[0];
    assert.equal(acEntry.value, 12.3);
    assert.equal("netAmount" in acEntry, false);
    assert.equal(vatEntry.amount, 12.3);
    assert.equal("vatAmount" in vatEntry, false);
    assert.equal("netAmount" in vatEntry, false);
});
