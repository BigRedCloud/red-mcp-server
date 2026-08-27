import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { enforceTransactionSettingsOrThrow } from "../../guards/company_processing_settings.js";
import { wrapWriteToolHandler } from "../../guards/write_confirmation.js";
import { normalizeBatchItems } from "../general/payloads_tools.js";
import { registerCashPaymentTools } from "./cash_payments_tools.js";
const dates = { entryDate: "2026-08-24", procDate: "2026-08-24" };
const structuredReceipt = {
    total: 123,
    note: "Structured analysed cash receipt",
    ...dates,
    bookTranTypeId: 1,
    acEntries: [{ accountCode: "CR01", analysisCategoryId: 4393832, description: "Cash receipt", value: 123 }],
};
const structuredReceiptWithVat = {
    ...structuredReceipt,
    vatEntries: [{ vatRateId: 1596277, percentage: 23, amount: 123 }],
};
const flatReceipt = {
    total: 123,
    note: "Flat analysed cash receipt",
    ...dates,
    bookTranTypeId: 1,
    analysisCategoryId: 4393832,
    accountCode: "CR01",
    description: "Cash receipt",
};
const customerReceipt = {
    total: 50,
    note: "Customer receipt",
    ...dates,
    bookTranTypeId: 1,
    customerId: 26540869,
    acCode: "878",
    ledger: 50,
};
const supplierCashPayment = {
    total: 20,
    note: "Supplier cash payment",
    ...dates,
    bookTranTypeId: 2,
    supplierId: 28665986,
    acCode: "RVS01",
    ledger: 20,
};
const bankLodgement = {
    total: 20,
    note: "Bank lodgement",
    ...dates,
    bookTranTypeId: 2,
    bankAccountId: 12345,
    bankAccountCode: "BANK1",
    lodgement: 20,
};
const analysedCashPayment = {
    total: 123,
    note: "Standalone analysed cash payment",
    ...dates,
    bookTranTypeId: 2,
    analysisCategoryId: 4393832,
    accountCode: "CP01",
    description: "Cash expense",
};
const supplierBankPayment = {
    total: 12,
    note: "Supplier bank payment",
    ...dates,
    bookTranTypeId: 3,
    bankAccountId: 12345,
    bankAccountCode: "BANK1",
    supplierId: 28665986,
    acCode: "RVS01",
};
const analysedBankPayment = {
    total: 12,
    note: "Analysed bank payment",
    ...dates,
    bookTranTypeId: 3,
    bankAccountId: 12345,
    bankAccountCode: "BANK1",
    analysisCategoryId: 4393999,
    accountCode: "BP01",
    description: "Bank expense",
};
const registered = new Map();
registerCashPaymentTools({
    tool(name, _description, schema) {
        registered.set(name, { schema });
    },
    resource() { },
    prompt() { },
});
function itemsSchema(name) {
    const schema = registered.get(name)?.schema.items;
    assert.ok(schema, `Expected ${name} items schema`);
    return schema;
}
function valid(name, item) {
    return itemsSchema(name).safeParse([{ opCode: 1, item }]).success;
}
function assertStrictWrapper(name, item, branches) {
    const schema = itemsSchema(name);
    assert.equal(schema.safeParse([{ arbitrary: true }]).success, false);
    assert.equal(schema.safeParse([{ opCode: 1 }]).success, false);
    assert.equal(schema.safeParse([{ item }]).success, false);
    assert.equal(schema.safeParse([{ opCode: 2, item }]).success, false);
    assert.equal(schema.safeParse([{ opCode: 1, item, arbitrary: true }]).success, false);
    const json = z.toJSONSchema(schema);
    assert.equal(json.items.additionalProperties, false);
    assert.deepEqual(json.items.required.sort(), ["item", "opCode"]);
    assert.equal(json.items.properties.opCode.const, 1);
    assert.equal(json.items.properties.item.oneOf.length, branches);
}
test("Group B registrations publish only relevant strict batch controls", () => {
    for (const name of ["brc_batch_cash_receipts", "brc_batch_cash_payments", "brc_batch_payments"]) {
        const schema = registered.get(name).schema;
        assert.equal("priceBasis" in schema, false);
        assert.equal("confirmCrAnalysisCategory" in schema, false);
    }
    assertStrictWrapper("brc_batch_cash_receipts", structuredReceipt, 3);
    assertStrictWrapper("brc_batch_cash_payments", supplierCashPayment, 3);
    assertStrictWrapper("brc_batch_payments", supplierBankPayment, 2);
});
test("Cash Receipt publishes three exclusive, reconciled modes", () => {
    for (const fixture of [structuredReceipt, structuredReceiptWithVat, flatReceipt, customerReceipt]) {
        assert.equal(valid("brc_batch_cash_receipts", fixture), true);
    }
    const flatWithVat = { ...flatReceipt, vatRateId: 1596277, vatPercentage: 23 };
    assert.equal(valid("brc_batch_cash_receipts", flatWithVat), true);
    assert.equal(valid("brc_batch_cash_receipts", { ...flatReceipt, vatRateId: 1596277 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...flatReceipt, vatPercentage: 23 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...customerReceipt, analysisCategoryId: 4393832 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...structuredReceipt, customerId: 26540869 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...structuredReceipt, total: 122 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...structuredReceiptWithVat, vatEntries: [{ ...structuredReceiptWithVat.vatEntries[0], amount: 100 }] }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...customerReceipt, ledger: 49 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...flatReceipt, entryDate: undefined }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...flatReceipt, bookTranTypeId: 2 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...flatReceipt, total: 0 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...flatReceipt, analysisCategoryId: 0 }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...structuredReceipt, customFields: [] }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...structuredReceipt, detailCollection: ["allocation"] }), false);
    assert.equal(valid("brc_batch_cash_receipts", { ...structuredReceipt, allocationDetails: {} }), false);
    const disabled = normalizeBatchItems("/v1/cashReceipts", [{ opCode: 1, item: structuredReceiptWithVat }], { vatOnCashReceiptEnabled: false });
    const disabledPayload = disabled[0].item;
    assert.equal(disabledPayload.acEntries[0].analysisCategoryId, 4393832);
    assert.deepEqual(disabledPayload.vatEntries, []);
    const enabled = normalizeBatchItems("/v1/cashReceipts", [{ opCode: 1, item: flatWithVat }], { vatOnCashReceiptEnabled: true });
    assert.equal(enabled[0].item.vatEntries[0].amount, 123);
    assert.equal(normalizeBatchItems("/v1/cashReceipts", [{ opCode: 1, item: customerReceipt }])[0].item.unallocated, 50);
});
test("Cash Receipt VAT-enabled manual preflight requires verified VAT details", () => {
    const manualSettings = { raw: {}, vatOnCashReceiptsEnabled: true, cashReceiptVatMode: "manual" };
    assert.doesNotThrow(() => enforceTransactionSettingsOrThrow(manualSettings, "cash_receipt", structuredReceiptWithVat));
    assert.throws(() => enforceTransactionSettingsOrThrow(manualSettings, "cash_receipt", structuredReceipt));
    assert.doesNotThrow(() => enforceTransactionSettingsOrThrow({ raw: {}, vatOnCashReceiptsEnabled: false, cashReceiptVatMode: "not_enabled" }, "cash_receipt", structuredReceipt));
});
test("Cash Payment publishes three exclusive modes with builder-owned accounting fields", () => {
    for (const fixture of [supplierCashPayment, bankLodgement, analysedCashPayment]) {
        assert.equal(valid("brc_batch_cash_payments", fixture), true);
    }
    assert.equal(valid("brc_batch_cash_payments", { ...supplierCashPayment, ledger: 19 }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...bankLodgement, lodgement: 19 }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...analysedCashPayment, supplierId: 1 }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...supplierCashPayment, bankAccountId: 1 }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...analysedCashPayment, acEntries: [] }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...analysedCashPayment, procDate: undefined }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...analysedCashPayment, bookTranTypeId: 3 }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...analysedCashPayment, total: -1 }), false);
    assert.equal(valid("brc_batch_cash_payments", { ...analysedCashPayment, analysisCategoryId: 0 }), false);
    const analysed = normalizeBatchItems("/v1/cashPayments", [{ opCode: 1, item: analysedCashPayment }])[0].item;
    assert.equal(analysed.acEntries[0].value, 123);
    assert.equal(analysed.ledger, 0);
    assert.equal(analysed.lodgement, 0);
    const supplier = normalizeBatchItems("/v1/cashPayments", [{ opCode: 1, item: supplierCashPayment }])[0].item;
    assert.equal(supplier.ledger, 20);
    assert.deepEqual(supplier.acEntries, []);
});
test("Payments publishes exclusive supplier-bank and analysed-bank modes", () => {
    for (const fixture of [supplierBankPayment, analysedBankPayment]) {
        assert.equal(valid("brc_batch_payments", fixture), true);
    }
    assert.equal(valid("brc_batch_payments", { ...supplierBankPayment, analysisCategoryId: 123 }), false);
    assert.equal(valid("brc_batch_payments", { ...analysedBankPayment, supplierId: 123 }), false);
    assert.equal(valid("brc_batch_payments", { ...analysedBankPayment, bankAccountId: 0 }), false);
    assert.equal(valid("brc_batch_payments", { ...analysedBankPayment, entryDate: undefined }), false);
    assert.equal(valid("brc_batch_payments", { ...analysedBankPayment, bookTranTypeId: 2 }), false);
    assert.equal(valid("brc_batch_payments", { ...analysedBankPayment, total: 0 }), false);
    assert.equal(valid("brc_batch_payments", { ...analysedBankPayment, unallocated: 0 }), false);
    const supplier = normalizeBatchItems("/v1/payments", [{ opCode: 1, item: supplierBankPayment }])[0].item;
    assert.equal(supplier.unallocated, 12);
    assert.deepEqual(supplier.acEntries, []);
    const analysed = normalizeBatchItems("/v1/payments", [{ opCode: 1, item: analysedBankPayment }])[0].item;
    assert.equal(analysed.unallocated, 0);
    assert.equal(analysed.acEntries[0].value, 12);
});
function body(result) {
    return JSON.parse(result.content[0].text);
}
test("Cash Payment and Payment batches preserve counterparty then write confirmation", async () => {
    for (const [name, fixture] of [
        ["brc_batch_cash_payments", analysedCashPayment],
        ["brc_batch_payments", analysedBankPayment],
    ]) {
        let called = false;
        const wrapped = wrapWriteToolHandler(name, async () => { called = true; return "posted"; });
        const args = { items: [{ opCode: 1, item: fixture }] };
        assert.equal(body(await wrapped(args)).status, "counterparty_confirmation_required");
        assert.equal(body(await wrapped({ ...args, confirmCounterpartyExplicit: true })).status, "confirmation_required");
        assert.equal(called, false);
    }
});
