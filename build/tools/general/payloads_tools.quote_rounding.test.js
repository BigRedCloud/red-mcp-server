import assert from "node:assert/strict";
import test from "node:test";
import { round2 } from "../../shared.js";
import { buildQuotePayload, buildSalesCreditNotePayload, buildSalesInvoicePayload, normalizeBatchItems, roundQuoteMoney2, } from "./payloads_tools.js";
const QUOTE_BASE = {
    companyId: 806559,
    customerOwnerId: 26540869,
    acCode: "878",
    customerOwnerName: "Paul Conroy Ltd",
    comments: "Quote rounding test",
    entryDate: "2026-08-13",
    procDate: "2026-08-13",
    vatTypeId: 1,
    saleRepId: 153992,
    saleRepCode: "7777",
    productId: 5023355,
    productCode: "PR001",
    quantity: 1,
    vatRateId: 1596277,
    vatPercentage: 23,
    tranNote: "Quote rounding test",
    analysisCategoryId: 4216701,
    accountCode: "SA01",
    reference: "QB0002",
};
function assertNoFloatArtifacts(values) {
    for (const value of values) {
        assert.equal(Number.isFinite(value), true);
        assert.equal(String(value).includes("000000"), false, String(value));
        assert.equal(String(value).includes("999999"), false, String(value));
        // At most 2 decimal places in the monetary fields we emit.
        assert.equal(round2(value), value, `expected 2dp money value, got ${value}`);
    }
}
test("roundQuoteMoney2 matches confirmed Quote midpoint 1.725 → 1.72", () => {
    assert.equal(roundQuoteMoney2(1.725), 1.72);
    assert.equal(roundQuoteMoney2(1.15), 1.15);
    assert.equal(roundQuoteMoney2(2.3), 2.3);
});
test("roundQuoteMoney2 midpoint with odd previous cent rounds up to even", () => {
    // 1.735 is a .xx5 midpoint where the cent digit before 5 is odd (3) → 1.74
    assert.equal(roundQuoteMoney2(1.735), 1.74);
});
test("Quote 7.50 @ 23% uses Quote-specific rounding accepted by staging BRC", () => {
    const payload = buildQuotePayload({ ...QUOTE_BASE, unitPrice: 7.5 });
    const line = payload.productTrans[0];
    const entry = line.acEntries[0];
    assert.equal(payload.totalNet, 7.5);
    assert.equal(payload.totalVat, 1.72);
    assert.equal(payload.total, 9.22);
    assert.equal(line.vatAmount, 1.72);
    assert.equal(line.amount, 9.22);
    assert.equal(entry.value, 7.5);
    assertNoFloatArtifacts([
        payload.totalNet,
        payload.totalVat,
        payload.total,
        line.vatAmount,
        line.amount,
        entry.value,
    ]);
});
test("Quote 5.00 @ 23% remains 1.15 / 6.15", () => {
    const payload = buildQuotePayload({ ...QUOTE_BASE, unitPrice: 5 });
    const line = payload.productTrans[0];
    assert.equal(payload.totalNet, 5);
    assert.equal(payload.totalVat, 1.15);
    assert.equal(payload.total, 6.15);
    assert.equal(line.vatAmount, 1.15);
    assert.equal(line.amount, 6.15);
});
test("Quote 10.00 @ 23% remains 2.30 / 12.30", () => {
    const payload = buildQuotePayload({ ...QUOTE_BASE, unitPrice: 10 });
    const line = payload.productTrans[0];
    assert.equal(payload.totalNet, 10);
    assert.equal(payload.totalVat, 2.3);
    assert.equal(payload.total, 12.3);
    assert.equal(line.vatAmount, 2.3);
    assert.equal(line.amount, 12.3);
});
test("Quote quantity > 1 uses the same Quote rounding helper", () => {
    // 3 * 2.5 = 7.5 net @ 23% → same midpoint path as unitPrice 7.5
    const payload = buildQuotePayload({
        ...QUOTE_BASE,
        quantity: 3,
        unitPrice: 2.5,
    });
    const line = payload.productTrans[0];
    assert.equal(payload.totalNet, 7.5);
    assert.equal(payload.totalVat, 1.72);
    assert.equal(payload.total, 9.22);
    assert.equal(line.quantity, 3);
    assert.equal(line.unitPrice, 2.5);
    assert.equal(line.vatAmount, 1.72);
    assert.equal(line.amount, 9.22);
});
test("batch Quote arithmetic matches single create for 7.50 @ 23%", () => {
    const single = buildQuotePayload({ ...QUOTE_BASE, unitPrice: 7.5 });
    const batch = normalizeBatchItems("/v1/quotes", [
        {
            opCode: 1,
            item: { ...QUOTE_BASE, unitPrice: 7.5 },
        },
    ]);
    const item = batch[0].item;
    assert.equal(item.totalNet, single.totalNet);
    assert.equal(item.totalVat, single.totalVat);
    assert.equal(item.total, single.total);
    const singleLine = single.productTrans[0];
    const batchLine = item.productTrans[0];
    assert.equal(batchLine.amount, singleLine.amount);
    assert.equal(batchLine.vatAmount, singleLine.vatAmount);
});
test("Sales Invoice 7.50 @ 23% still uses shared round2 half-up (1.73 / 9.23)", () => {
    assert.equal(round2(7.5 * 0.23), 1.73);
    const payload = buildSalesInvoicePayload({
        priceBasis: "net",
        customerId: 26540869,
        acCode: "878",
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
        bookTranTypeId: 6,
        analysisCategoryId: 4216701,
        accountCode: "SA01",
        description: "SI rounding control",
        netAmount: 7.5,
        vatRateId: 1596277,
        vatPercentage: 23,
        productId: 5023355,
        productCode: "PR001",
        quantity: 1,
        unitPrice: 7.5,
        saleRepId: 153992,
        saleRepCode: "7777",
    });
    assert.equal(payload.totalNet, 7.5);
    assert.equal(payload.totalVAT, 1.73);
    assert.equal(payload.total, 9.23);
    const line = payload.productTrans[0];
    assert.equal(line.vat, 1.73);
    assert.equal(line.amount, 9.23);
    assert.equal(line.amountNet, 7.5);
});
test("Sales Credit Note 7.50 @ 23% still uses shared round2 half-up", () => {
    const payload = buildSalesCreditNotePayload({
        customerId: 26540869,
        acCode: "878",
        note: "SCN rounding control",
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
        bookTranTypeId: 7,
        analysisCategoryId: 4216701,
        accountCode: "SA01",
        description: "SCN rounding control",
        netAmount: 7.5,
        vatRateId: 1596277,
        vatPercentage: 23,
        productId: 5023355,
        productCode: "PR001",
        quantity: 1,
        unitPrice: 7.5,
        saleRepId: 153992,
        saleRepCode: "7777",
    });
    assert.equal(payload.totalNet, -7.5);
    assert.equal(payload.totalVAT, -1.73);
    assert.equal(payload.total, -9.23);
});
