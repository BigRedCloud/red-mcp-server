import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSalesInvoicePayload,
  normaliseDeliveryTo,
  resolveSalesDocumentNote,
} from "./payloads_tools.js";

/**
 * Base structured sales invoice args (net price basis) used across the note /
 * deliveryTo behaviour tests. Individual tests override only what they need.
 */
function invoiceArgs(
  overrides: Partial<Parameters<typeof buildSalesInvoicePayload>[0]> = {}
): Parameters<typeof buildSalesInvoicePayload>[0] {
  return {
    customerId: 1,
    acCode: "CUST",
    entryDate: "2026-01-01",
    procDate: "2026-01-01",
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

test("invoice note defaults to the customer name when no note is provided", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerName: "Acme Trading Ltd" })
  ) as Record<string, unknown>;

  assert.equal(payload.note, "Acme Trading Ltd");
});

test("explicit user note is preserved over the customer name", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerName: "Acme Trading Ltd", note: "Deposit for March order" })
  ) as Record<string, unknown>;

  assert.equal(payload.note, "Deposit for March order");
});

test("product name / description is not used as the note by default", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerName: "Acme Trading Ltd", description: "Blue Widget" })
  ) as Record<string, unknown>;

  assert.equal(payload.note, "Acme Trading Ltd");
  assert.notEqual(payload.note, "Blue Widget");
});

test("note is omitted when neither an explicit note nor a customer name is available", () => {
  const payload = buildSalesInvoicePayload(invoiceArgs()) as Record<string, unknown>;

  assert.equal("note" in payload, false);
});

test("deliveryTo is omitted when no delivery address is provided", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ customerName: "Acme Trading Ltd" })
  ) as Record<string, unknown>;

  assert.equal("deliveryTo" in payload, false);
});

test("deliveryTo is never defaulted to a placeholder such as MCP Test", () => {
  const payload = buildSalesInvoicePayload(invoiceArgs()) as Record<string, unknown>;

  assert.equal(JSON.stringify(payload).includes("MCP Test"), false);
});

test("explicit deliveryTo string is preserved as an array", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ deliveryTo: "12 Main Street, Dublin" })
  ) as Record<string, unknown>;

  assert.deepEqual(payload.deliveryTo, ["12 Main Street, Dublin"]);
});

test("explicit deliveryTo array is preserved", () => {
  const payload = buildSalesInvoicePayload(
    invoiceArgs({ deliveryTo: ["Unit 4", "Industrial Estate", "Cork"] })
  ) as Record<string, unknown>;

  assert.deepEqual(payload.deliveryTo, ["Unit 4", "Industrial Estate", "Cork"]);
});

test("resolveSalesDocumentNote prefers explicit note, then customer name, else undefined", () => {
  assert.equal(resolveSalesDocumentNote("My note", "Acme"), "My note");
  assert.equal(resolveSalesDocumentNote("   ", "Acme"), "Acme");
  assert.equal(resolveSalesDocumentNote(undefined, "Acme"), "Acme");
  assert.equal(resolveSalesDocumentNote(undefined, undefined), undefined);
  assert.equal(resolveSalesDocumentNote("", ""), undefined);
});

test("normaliseDeliveryTo drops blanks and returns undefined when empty", () => {
  assert.equal(normaliseDeliveryTo(undefined), undefined);
  assert.equal(normaliseDeliveryTo(""), undefined);
  assert.equal(normaliseDeliveryTo(["", "   "]), undefined);
  assert.deepEqual(normaliseDeliveryTo("  Dublin  "), ["Dublin"]);
  assert.deepEqual(normaliseDeliveryTo(["A", "", "B"]), ["A", "B"]);
});
