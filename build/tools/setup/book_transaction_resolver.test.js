import test from "node:test";
import assert from "node:assert/strict";
import { resolveBookTransactionType, } from "./deployment_tools.js";
test("resolves a dynamically assigned Sales Entry bookTranTypeId", async () => {
    const result = await resolveBookTransactionType("Company Test", 777, {
        brcFetch: async () => ({
            Items: [
                {
                    id: 777,
                    description: "Sales Entry",
                    code: "",
                },
            ],
            NextPageLink: "",
            Count: 1,
        }),
    });
    assert.equal(result.resolved, true);
    assert.equal(result.mapped, true);
    assert.equal(result.bookTranTypeDescription, "Sales Entry");
    assert.equal(result.documentKind, "sales_entry");
});
test("reports an id that BRC did not return", async () => {
    const result = await resolveBookTransactionType("Company Test", 999, {
        brcFetch: async () => ({
            Items: [],
            NextPageLink: "",
            Count: 0,
        }),
    });
    assert.equal(result.resolved, false);
    assert.equal(result.mapped, false);
    assert.equal(result.documentKind, "unknown");
});
test("distinguishes a BRC type that exists but Red does not map", async () => {
    const result = await resolveBookTransactionType("Company Test", 55, {
        brcFetch: async () => ({
            Items: [
                {
                    id: 55,
                    description: "Future BRC Transaction Type",
                    code: "",
                },
            ],
            NextPageLink: "",
            Count: 1,
        }),
    });
    assert.equal(result.resolved, true);
    assert.equal(result.mapped, false);
    assert.equal(result.documentKind, "unknown");
});
