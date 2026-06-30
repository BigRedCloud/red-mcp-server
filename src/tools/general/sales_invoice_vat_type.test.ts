import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSalesInvoicePayload,
  resolveSalesDocumentVatTypeId,
} from "./payloads_tools.js";
import {
  extractCustomerVatType,
  resolveCustomerVatType,
  setCustomerVatTypeLoaderForTests,
} from "../../guards/customer_vat_type.js";

// BRC VAT types (same enumeration on customer `vatType` and document
// `vatTypeId`): Domestic, Other EU, Foreign – Non EU, VAT Exempt.
const DOMESTIC = 1;
const FOREIGN_NON_EU = 3;

function invoiceArgs(
  overrides: Partial<Parameters<typeof buildSalesInvoicePayload>[0]> = {}
): Parameters<typeof buildSalesInvoicePayload>[0] {
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
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: DOMESTIC })
  ) as Record<string, unknown>;

  assert.equal(payload.vatTypeId, DOMESTIC);
});

test("foreign non-EU customer defaults the invoice to foreign non-EU, not domestic", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: FOREIGN_NON_EU })
  ) as Record<string, unknown>;

  assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
  assert.notEqual(payload.vatTypeId, DOMESTIC);
});

test("explicit vatTypeId override wins over the customer VAT type", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: DOMESTIC, vatTypeId: FOREIGN_NON_EU })
  ) as Record<string, unknown>;

  assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
});

test("REGRESSION: vatTypeId is always present so BRC posting does not fail", () => {
  // BRC's /v1/salesInvoices requires vatTypeId. A previous change omitted the
  // field when the customer VAT type could not be resolved, which broke
  // posting. The payload must always carry a vatTypeId.
  const noVatInfo = buildSalesInvoicePayload(invoiceArgs()) as Record<
    string,
    unknown
  >;
  assert.equal("vatTypeId" in noVatInfo, true);
  assert.equal(typeof noVatInfo.vatTypeId, "number");

  const foreign = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: FOREIGN_NON_EU })
  ) as Record<string, unknown>;
  assert.equal("vatTypeId" in foreign, true);

  const override = buildSalesInvoicePayload(
    invoiceArgs({ vatTypeId: FOREIGN_NON_EU })
  ) as Record<string, unknown>;
  assert.equal("vatTypeId" in override, true);
});

test("unknown customer VAT type falls back to Domestic (BRC requires a VAT type)", () => {
  const payload = buildSalesInvoicePayload(invoiceArgs()) as Record<
    string,
    unknown
  >;

  // Domestic is only the last-resort default; the customer/override values
  // (covered above) still take priority, preserving the foreign/EU fix.
  assert.equal(payload.vatTypeId, DOMESTIC);
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
  } finally {
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
  } finally {
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
    const payload = buildSalesInvoicePayload(
      invoiceArgs({ customerId: 42, customerVatType })
    ) as Record<string, unknown>;

    assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
  } finally {
    setCustomerVatTypeLoaderForTests();
  }
});
