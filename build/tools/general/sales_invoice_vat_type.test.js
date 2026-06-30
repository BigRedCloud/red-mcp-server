import assert from "node:assert/strict";
import test from "node:test";
import { buildSalesInvoicePayload, resolveSalesDocumentVatTypeId, } from "./payloads_tools.js";
import { extractCustomerVatType, resolveCustomerVatType, setCustomerVatTypeLoaderForTests, } from "../../guards/customer_vat_type.js";
// BRC VAT types (same enumeration on customer `vatType` and document
// `vatTypeId`): Domestic, Other EU, Foreign – Non EU, VAT Exempt.
const DOMESTIC = 1;
const FOREIGN_NON_EU = 3;
function invoiceArgs(overrides = {}) {
    return {
        customerId: 1,
        acCode: "CUST",
        entryDate: "2026-06-01",
        procDate: "2026-06-30",
        bookTranTypeId: 6,
        analysisCategoryId: 10,
        accountCode: "S01",
        description: "Blue Widget",
        netAmount: 100,
        vatRateId: 1,
        vatPercentage: 23,
        productId: 5,
        productCode: "WID",
        quantity: 1,
        unitPrice: 100,
        saleRepId: 2,
        saleRepCode: "REP",
        ...overrides,
    };
}
test("domestic customer keeps the domestic VAT type", () => {
    const payload = buildSalesInvoicePayload(invoiceArgs({ customerVatType: DOMESTIC }));
    assert.equal(payload.vatTypeId, DOMESTIC);
});
test("foreign non-EU customer defaults the invoice to foreign non-EU, not domestic", () => {
    const payload = buildSalesInvoicePayload(invoiceArgs({ customerVatType: FOREIGN_NON_EU }));
    assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
    assert.notEqual(payload.vatTypeId, DOMESTIC);
});
test("explicit vatTypeId override wins over the customer VAT type", () => {
    const payload = buildSalesInvoicePayload(invoiceArgs({ customerVatType: DOMESTIC, vatTypeId: FOREIGN_NON_EU }));
    assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
});
test("missing/unknown customer VAT type does not default to domestic", () => {
    const payload = buildSalesInvoicePayload(invoiceArgs());
    // The field is omitted entirely rather than silently set to Domestic (1).
    assert.equal("vatTypeId" in payload, false);
    assert.notEqual(payload.vatTypeId, DOMESTIC);
});
test("resolveSalesDocumentVatTypeId prefers override, then customer, else undefined", () => {
    assert.equal(resolveSalesDocumentVatTypeId(FOREIGN_NON_EU, DOMESTIC), FOREIGN_NON_EU);
    assert.equal(resolveSalesDocumentVatTypeId(undefined, FOREIGN_NON_EU), FOREIGN_NON_EU);
    assert.equal(resolveSalesDocumentVatTypeId(undefined, DOMESTIC), DOMESTIC);
    assert.equal(resolveSalesDocumentVatTypeId(undefined, undefined), undefined);
    assert.equal(resolveSalesDocumentVatTypeId(0, 0), undefined);
});
test("extractCustomerVatType reads the BRC customer vatType field across casings", () => {
    assert.equal(extractCustomerVatType({ vatType: FOREIGN_NON_EU }), FOREIGN_NON_EU);
    assert.equal(extractCustomerVatType({ VatType: 2 }), 2);
    assert.equal(extractCustomerVatType({ vatTypeId: DOMESTIC }), DOMESTIC);
    assert.equal(extractCustomerVatType({}), undefined);
    assert.equal(extractCustomerVatType(null), undefined);
    assert.equal(extractCustomerVatType({ vatType: 0 }), undefined);
});
test("resolveCustomerVatType reads the selected customer record", async () => {
    setCustomerVatTypeLoaderForTests(async (_company, customerId) => {
        if (String(customerId) === "42") {
            return { id: 42, name: "Adwin Ko", vatType: FOREIGN_NON_EU };
        }
        return { id: Number(customerId), name: "Domestic Co", vatType: DOMESTIC };
    });
    try {
        assert.equal(await resolveCustomerVatType("ACME", 42), FOREIGN_NON_EU);
        assert.equal(await resolveCustomerVatType("ACME", 7), DOMESTIC);
    }
    finally {
        setCustomerVatTypeLoaderForTests();
    }
});
test("resolveCustomerVatType returns undefined (never domestic) when the customer cannot be read", async () => {
    setCustomerVatTypeLoaderForTests(async () => {
        throw new Error("customer read failed");
    });
    try {
        const resolved = await resolveCustomerVatType("ACME", 99);
        assert.equal(resolved, undefined);
        assert.notEqual(resolved, DOMESTIC);
    }
    finally {
        setCustomerVatTypeLoaderForTests();
    }
});
test("a foreign non-EU customer drives the built invoice payload end to end", async () => {
    setCustomerVatTypeLoaderForTests(async () => ({
        id: 42,
        name: "Adwin Ko",
        vatType: FOREIGN_NON_EU,
    }));
    try {
        const customerVatType = await resolveCustomerVatType("ACME", 42);
        const payload = buildSalesInvoicePayload(invoiceArgs({ customerId: 42, customerVatType }));
        assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
    }
    finally {
        setCustomerVatTypeLoaderForTests();
    }
});
