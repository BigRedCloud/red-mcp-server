import assert from "node:assert/strict";
import test from "node:test";
import { wrapWriteToolHandler } from "../../guards/write_confirmation.js";
import { summarizeBatchResponse } from "./crud_tools.js";
import { salesInvoiceBatchItemSchema } from "./batch_tools.js";
import { normalizeBatchItems } from "./payloads_tools.js";
const invoice = {
    customerId: 28665977,
    acCode: "RVC01",
    entryDate: "2026-08-25",
    procDate: "2026-08-25",
    saleRepId: 155806,
    saleRepCode: "RVREP1",
    bookTranTypeId: 6,
    totalNet: 110,
    totalVAT: 25.3,
    total: 135.3,
    unpaid: 135.3,
    note: "Review Batch Sales Invoice",
    productTrans: [
        {
            id: 0,
            amount: 135.3,
            amountNet: 110,
            percentage: 23,
            productId: 5255119,
            productCode: "RVP01",
            quantity: 1,
            unitPrice: 110,
            vat: 25.3,
            vatRateId: 1670008,
            vatAnalysisTypeId: 2,
            tranNotes: ["Review Batch Sales Invoice"],
            acEntries: [
                {
                    id: 0,
                    accountCode: "SA02",
                    analysisCategoryId: 4393839,
                    description: "Review Batch Sales Invoice",
                    value: 110,
                },
            ],
        },
    ],
};
function parseBody(result) {
    const response = result;
    return JSON.parse(response.content[0].text);
}
test("one-item sales invoice batch schema exposes the full nested invoice contract", () => {
    const parsed = salesInvoiceBatchItemSchema.safeParse({
        opCode: 1,
        item: invoice,
    });
    assert.equal(parsed.success, true);
});
test("batch sales invoice preserves the documented full invoice payload", () => {
    const normalized = normalizeBatchItems("/v1/salesInvoices", [{ opCode: 1, item: invoice }]);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].opCode, 1);
    const payloadSent = normalized[0].item;
    const line = payloadSent.productTrans[0];
    const analysis = line.acEntries[0];
    assert.equal(line.productId, 5255119);
    assert.equal(line.productCode, "RVP01");
    assert.equal(line.unitPrice, 110);
    assert.equal(line.vatRateId, 1670008);
    assert.equal(line.percentage, 23);
    assert.equal(line.vatAnalysisTypeId, 2);
    assert.deepEqual(line.tranNotes, ["Review Batch Sales Invoice"]);
    assert.equal(analysis.accountCode, "SA02");
    assert.equal(analysis.analysisCategoryId, 4393839);
    assert.equal(analysis.value, 110);
    assert.equal(payloadSent.totalNet, 110);
    assert.equal(payloadSent.totalVAT, 25.3);
    assert.equal(payloadSent.total, 135.3);
});
test("batch sales invoice priceBasis adds flags without rebuilding line values", () => {
    const normalized = normalizeBatchItems("/v1/salesInvoices", [
        { opCode: 1, item: { priceBasis: "net", ...invoice } },
    ]);
    const payload = normalized[0].item;
    const line = payload.productTrans[0];
    assert.equal(payload.useTaxInclusiveUnitPrice, false);
    assert.equal(line.useTaxInclusiveUnitPrice, false);
    assert.equal(line.unitPrice, 110);
    assert.equal(payload.total, 135.3);
    assert.equal("priceBasis" in payload, false);
});
test("nested sales credit note batch payload is preserved instead of flattened", () => {
    const creditNote = {
        ...invoice,
        bookTranTypeId: 7,
        totalNet: -110,
        totalVAT: -25.3,
        total: -135.3,
        unpaid: -135.3,
        productTrans: [
            {
                ...invoice.productTrans[0],
                amount: -135.3,
                amountNet: -110,
                vat: -25.3,
                acEntries: [{ ...invoice.productTrans[0].acEntries[0], value: -110 }],
            },
        ],
    };
    const normalized = normalizeBatchItems("/v1/salesCreditNotes", [
        { opCode: 1, item: creditNote },
    ]);
    assert.deepEqual(normalized[0].item, creditNote);
});
function assertBatchCounts(summary, submittedItemCount) {
    assert.equal(summary.succeededItemCount + summary.failedItemCount, submittedItemCount);
    assert.equal(summary.failedItems.length, summary.failedItemCount);
}
test("complete batch success has internally consistent aggregation", () => {
    const createdInvoice = {
        id: 586774712,
        reference: "000004",
        total: 135.3,
    };
    const summary = summarizeBatchResponse({ result: [{ code: 201, result: createdInvoice }] }, [{ opCode: 1 }]);
    assert.equal(summary.success, true);
    assert.equal(summary.partialSuccess, false);
    assert.equal(summary.succeededItemCount, 1);
    assert.equal(summary.failedItemCount, 0);
    assert.deepEqual(summary.failedItems, []);
    assert.deepEqual(summary.resultItems, [{ code: 201, result: createdInvoice }]);
    assert.equal(summary.resultItems[0].result.id, 586774712);
    assert.equal(summary.resultItems[0].result.reference, "000004");
    assertBatchCounts(summary, 1);
});
test("complete batch failure identifies the failed item and error", () => {
    const failed = { code: 422, result: { message: "Invalid VatRateId" } };
    const summary = summarizeBatchResponse({ result: [failed] }, [{ opCode: 1 }]);
    assert.equal(summary.success, false);
    assert.equal(summary.partialSuccess, false);
    assert.equal(summary.succeededItemCount, 0);
    assert.equal(summary.failedItemCount, 1);
    assert.deepEqual(summary.failedItems, [
        { index: 0, opCode: 1, error: "Invalid VatRateId", response: failed },
    ]);
    assertBatchCounts(summary, 1);
});
test("mixed batch response is a consistent partial success", () => {
    const createdInvoice = {
        id: 586774712,
        reference: "000004",
        total: 135.3,
    };
    const failed = { code: 422, result: { error: "Invalid VatRateId" } };
    const summary = summarizeBatchResponse({ result: [{ code: 201, result: createdInvoice }, failed] }, [{ opCode: 1 }, { opCode: 2 }]);
    assert.equal(summary.success, false);
    assert.equal(summary.partialSuccess, true);
    assert.equal(summary.succeededItemCount, 1);
    assert.equal(summary.failedItemCount, 1);
    assert.deepEqual(summary.failedItems, [
        { index: 1, opCode: 2, error: "Invalid VatRateId", response: failed },
    ]);
    assertBatchCounts(summary, 2);
    assert.match(summary.message, /partially succeeded/i);
});
test("a genuinely missing result row remains an explicit failure", () => {
    const createdInvoice = {
        id: 586774712,
        reference: "000004",
        total: 135.3,
    };
    const summary = summarizeBatchResponse({ result: [{ code: 201, result: createdInvoice }] }, [{ opCode: 1 }, { opCode: 2 }]);
    assert.equal(summary.success, false);
    assert.equal(summary.partialSuccess, true);
    assert.equal(summary.succeededItemCount, 1);
    assert.equal(summary.failedItemCount, 1);
    assert.deepEqual(summary.failedItems, [
        {
            index: 1,
            opCode: 2,
            error: "BRC returned no result for this submitted batch item.",
            response: null,
        },
    ]);
    assertBatchCounts(summary, 2);
});
test("batch sales invoice preserves counterparty and write confirmations", async () => {
    let calls = 0;
    const wrapped = wrapWriteToolHandler("brc_batch_sales_invoices", async () => {
        calls += 1;
        return "posted";
    });
    const args = {
        // Omit companyName so the Sales VAT preflight is skipped and this test
        // isolates the two existing confirmation safeguards without live state.
        items: [{ opCode: 1, item: invoice }],
    };
    const counterparty = parseBody(await wrapped(args));
    assert.equal(counterparty.status, "counterparty_confirmation_required");
    assert.equal(calls, 0);
    const preview = parseBody(await wrapped({ ...args, confirmCounterpartyExplicit: true }));
    assert.equal(preview.status, "confirmation_required");
    assert.equal(preview.confirmationField, "confirmWrite");
    assert.equal(calls, 0);
    const posted = await wrapped({
        ...args,
        confirmCounterpartyExplicit: true,
        confirmWrite: true,
    });
    assert.equal(posted, "posted");
    assert.equal(calls, 1);
});
