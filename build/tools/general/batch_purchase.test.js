import assert from "node:assert/strict";
import test from "node:test";
import { purchaseBatchItemSchema, registerBatchTools } from "./batch_tools.js";
import { normalizeBatchItems } from "./payloads_tools.js";
const successfulStagingPurchase = {
    opCode: 1,
    item: {
        supplierId: 28665986,
        acCode: "RVS01",
        bookTranTypeId: 4,
        entryDate: "2026-12-05",
        procDate: "2026-12-06",
        description: "Review Batch Purchase",
        note: "Review Batch Purchase",
        accountCode: "PU03",
        analysisCategoryId: 4393844,
        netAmount: 20,
        vatPercentage: 23,
        vatRateId: 1670005,
        totalNet: 20,
        totalVAT: 4.6,
        total: 24.6,
        unpaid: 24.6,
        vatTypeId: 1,
    },
};
test("batch purchase schema accepts the exact successful staging contract", () => {
    const parsed = purchaseBatchItemSchema.safeParse(successfulStagingPurchase);
    assert.equal(parsed.success, true);
    if (!parsed.success)
        return;
    assert.deepEqual(parsed.data, successfulStagingPurchase);
});
test("brc_batch_purchases publishes the typed purchase item schema", () => {
    let publishedItemsSchema;
    const recorder = {
        tool(name, _description, schema) {
            if (name === "brc_batch_purchases") {
                publishedItemsSchema = schema.items;
            }
        },
        resource() { },
        prompt() { },
    };
    registerBatchTools(recorder);
    assert.ok(publishedItemsSchema, "expected the public items schema to be registered");
    assert.equal(publishedItemsSchema.safeParse([successfulStagingPurchase]).success, true);
    assert.equal(publishedItemsSchema.safeParse([{ opCode: 1, item: { arbitrary: true } }]).success, false);
});
test("batch purchase schema requires the generated-reference builder fields", () => {
    const missingNetAmount = structuredClone(successfulStagingPurchase);
    delete missingNetAmount.item.netAmount;
    assert.equal(purchaseBatchItemSchema.safeParse(missingNetAmount).success, false);
    assert.equal(purchaseBatchItemSchema.safeParse({
        ...successfulStagingPurchase,
        item: { ...successfulStagingPurchase.item, supplierId: 0 },
    }).success, false);
});
test("batch purchase normalization produces the confirmed BRC payload", () => {
    const [normalized] = normalizeBatchItems("/v1/purchases", [successfulStagingPurchase]);
    assert.equal(normalized?.opCode, 1);
    const payloadSent = normalized?.item;
    assert.equal(payloadSent.supplierId, 28665986);
    assert.equal(payloadSent.acCode, "RVS01");
    assert.equal(payloadSent.bookTranTypeId, 4);
    assert.equal(payloadSent.entryDate, "2026-12-05");
    assert.equal(payloadSent.procDate, "2026-12-06");
    assert.equal(payloadSent.note, "Review Batch Purchase");
    assert.equal(payloadSent.totalNet, 20);
    assert.equal(payloadSent.totalVAT, 4.6);
    assert.equal(payloadSent.total, 24.6);
    assert.equal(payloadSent.unpaid, 24.6);
    assert.equal(payloadSent.vatTypeId, 1);
    assert.deepEqual(payloadSent.acEntries, [
        {
            id: 0,
            accountCode: "PU03",
            analysisCategoryId: 4393844,
            description: "Review Batch Purchase",
            value: 20,
        },
    ]);
    assert.deepEqual(payloadSent.vatEntries, [
        { id: 0, vatRateId: 1670005, percentage: 23, amount: 20 },
    ]);
});
