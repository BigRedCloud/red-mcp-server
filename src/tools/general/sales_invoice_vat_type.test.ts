import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSalesInvoicePayload,
  buildSalesCreditNotePayload,
  resolveSalesInvoiceVatTypeId,
} from "./payloads_tools.js";
import {
  extractCustomerVatType,
  resolveCustomerVatType,
  setCustomerVatTypeLoaderForTests,
} from "../../guards/customer_vat_type.js";

// BRC VAT types (same enumeration on customer `vatType` and document
// `vatTypeId`): 1 Domestic, 2 Other EU, 3 Foreign – Non EU, 4 VAT Exempt.
const DOMESTIC = 1;
const FOREIGN_NON_EU = 3;

function invoiceArgs(
  overrides: Partial<Parameters<typeof buildSalesInvoicePayload>[0]> = {}
): Parameters<typeof buildSalesInvoicePayload>[0] {
  return {
    customerId: 1,
    acCode: "CUST",
    entryDate: "2026-06-01",
    procDate: "2026-06-01",
    bookTranTypeId: 6,
    analysisCategoryId: 10,
    accountCode: "S01",
    description: "Blue Widget",
    netAmount: 100,
    vatRateId: 7,
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

test("1. Foreign Non-EU customer (vatType 3) builds a sales invoice with vatTypeId 3", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: FOREIGN_NON_EU })
  ) as Record<string, unknown>;

  assert.equal(payload.vatTypeId, FOREIGN_NON_EU);
  assert.notEqual(payload.vatTypeId, DOMESTIC);
});

test("2. Domestic customer (vatType 1) builds a sales invoice with vatTypeId 1", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: DOMESTIC })
  ) as Record<string, unknown>;

  assert.equal(payload.vatTypeId, DOMESTIC);
});

test("missing customer VAT type falls back to Domestic (1)", () => {
  const payload = buildSalesInvoicePayload(invoiceArgs()) as Record<
    string,
    unknown
  >;

  assert.equal(payload.vatTypeId, DOMESTIC);
});

test("3. VAT rate / percentage / totals are unchanged by the customer VAT type", () => {
  const domestic = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: DOMESTIC })
  ) as Record<string, unknown>;
  const foreign = buildSalesInvoicePayload(
    invoiceArgs({ customerVatType: FOREIGN_NON_EU })
  ) as Record<string, unknown>;

  // VAT type does not map to VAT percentage and does not change rate selection.
  for (const payload of [domestic, foreign]) {
    const line = (payload.productTrans as Record<string, unknown>[])[0];
    assert.equal(line.vatRateId, 7);
    assert.equal(line.percentage, 23);
    assert.equal(line.vat, 23); // 100 net @ 23%
    assert.equal(payload.totalNet, 100);
    assert.equal(payload.totalVAT, 23);
    assert.equal(payload.total, 123);
  }

  // Only the document VAT type differs between the two.
  assert.equal(domestic.vatTypeId, DOMESTIC);
  assert.equal(foreign.vatTypeId, FOREIGN_NON_EU);
});

test("4. shared builder is unchanged for non-invoice-creation callers (credit notes default to Domestic)", () => {
  // buildSalesCreditNotePayload reuses buildSalesInvoicePayload but does not
  // pass a customer VAT type, so its behaviour is unchanged (vatTypeId 1).
  const creditNote = buildSalesCreditNotePayload(
    invoiceArgs() as Parameters<typeof buildSalesCreditNotePayload>[0]
  ) as Record<string, unknown>;

  assert.equal(creditNote.vatTypeId, DOMESTIC);
});

test("resolveSalesInvoiceVatTypeId returns the customer VAT type or Domestic", () => {
  assert.equal(resolveSalesInvoiceVatTypeId(FOREIGN_NON_EU), FOREIGN_NON_EU);
  assert.equal(resolveSalesInvoiceVatTypeId(DOMESTIC), DOMESTIC);
  assert.equal(resolveSalesInvoiceVatTypeId(undefined), DOMESTIC);
  assert.equal(resolveSalesInvoiceVatTypeId(0), DOMESTIC);
  assert.equal(resolveSalesInvoiceVatTypeId("3"), FOREIGN_NON_EU);
});

test("extractCustomerVatType reads the BRC customer vatType across casings", () => {
  assert.equal(extractCustomerVatType({ vatType: FOREIGN_NON_EU }), FOREIGN_NON_EU);
  assert.equal(extractCustomerVatType({ VatType: 2 }), 2);
  assert.equal(extractCustomerVatType({ vatTypeId: DOMESTIC }), DOMESTIC);
  assert.equal(extractCustomerVatType({}), undefined);
  assert.equal(extractCustomerVatType(null), undefined);
  assert.equal(extractCustomerVatType({ vatType: 0 }), undefined);
});

test("resolveCustomerVatType reads the selected customer record", async () => {
  setCustomerVatTypeLoaderForTests(async (_company, customerId) =>
    String(customerId) === "42"
      ? { id: 42, name: "Adwin Ko", vatType: FOREIGN_NON_EU }
      : { id: Number(customerId), name: "Domestic Co", vatType: DOMESTIC }
  );

  try {
    assert.equal(await resolveCustomerVatType("ACME", 42), FOREIGN_NON_EU);
    assert.equal(await resolveCustomerVatType("ACME", 7), DOMESTIC);
  } finally {
    setCustomerVatTypeLoaderForTests();
  }
});

test("resolveCustomerVatType returns undefined when the customer cannot be read", async () => {
  setCustomerVatTypeLoaderForTests(async () => {
    throw new Error("customer read failed");
  });

  try {
    assert.equal(await resolveCustomerVatType("ACME", 99), undefined);
  } finally {
    setCustomerVatTypeLoaderForTests();
  }
});
