import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceTransactionSettingsOrThrow,
  type CompanyProcessingSettings,
} from "./company_processing_settings.js";
import {
  applySalesPriceBasisToRawPayload,
  buildSalesInvoicePayload,
} from "../tools/general/payloads_tools.js";

function grossPriceSettings(): CompanyProcessingSettings {
  return {
    raw: {},
    cashReceiptVatMode: "not_enabled",
    grossPriceSalesInvoicingEnabled: true,
  };
}

const BARE_INVOICE_PAYLOAD = {
  customerId: 1,
  acCode: "TEST",
  total: 123,
  productTrans: [{ id: 0, productId: 1, quantity: 1, unitPrice: 123 }],
};

test("Gross Price Entry enabled with no priceBasis is blocked", () => {
  assert.throws(
    () =>
      enforceTransactionSettingsOrThrow(
        grossPriceSettings(),
        "sales_invoice",
        BARE_INVOICE_PAYLOAD
      ),
    /Gross Price Entry is enabled[\s\S]*priceBasis: "gross"[\s\S]*priceBasis: "net"/
  );
});

test("Gross Price Entry enabled with top-level priceBasis gross is allowed", () => {
  assert.doesNotThrow(() =>
    enforceTransactionSettingsOrThrow(
      grossPriceSettings(),
      "sales_invoice",
      BARE_INVOICE_PAYLOAD,
      { priceBasis: "gross" }
    )
  );
});

test("Gross Price Entry enabled with top-level priceBasis net is allowed", () => {
  assert.doesNotThrow(() =>
    enforceTransactionSettingsOrThrow(
      grossPriceSettings(),
      "sales_invoice",
      BARE_INVOICE_PAYLOAD,
      { priceBasis: "net" }
    )
  );
});

test("Gross Price Entry enabled is allowed when payload productTrans line states price basis", () => {
  const payload = {
    ...BARE_INVOICE_PAYLOAD,
    productTrans: [
      { id: 0, productId: 1, quantity: 1, unitPrice: 123, useTaxInclusiveUnitPrice: true },
    ],
  };

  assert.doesNotThrow(() =>
    enforceTransactionSettingsOrThrow(grossPriceSettings(), "sales_invoice", payload)
  );
});

function structuredInvoiceArgs(priceBasis?: "net" | "gross") {
  return {
    priceBasis,
    customerId: 1,
    acCode: "CUST",
    note: "Invoice",
    entryDate: "2026-01-01",
    procDate: "2026-01-01",
    bookTranTypeId: 6,
    analysisCategoryId: 10,
    accountCode: "S01",
    description: "Widget",
    netAmount: 100,
    vatRateId: 1,
    vatPercentage: 23,
    productId: 5,
    productCode: "WID",
    quantity: 1,
    unitPrice: 123,
    saleRepId: 2,
    saleRepCode: "REP",
  };
}

test("Structured invoice with gross unitPrice 123 and VAT 23% creates net 100, VAT 23, gross 123", () => {
  const payload = buildSalesInvoicePayload(structuredInvoiceArgs("gross")) as Record<
    string,
    unknown
  >;

  assert.equal(payload.totalNet, 100);
  assert.equal(payload.totalVAT, 23);
  assert.equal(payload.total, 123);
  assert.equal(payload.useTaxInclusiveUnitPrice, true);

  const line = (payload.productTrans as Record<string, unknown>[])[0];
  assert.equal(line.amountNet, 100);
  assert.equal(line.vat, 23);
  assert.equal(line.amount, 123);
  assert.equal(line.useTaxInclusiveUnitPrice, true);
});

test("Structured invoice with net priceBasis keeps net behaviour and useTaxInclusiveUnitPrice false", () => {
  const payload = buildSalesInvoicePayload({
    ...structuredInvoiceArgs("net"),
    unitPrice: 100,
  }) as Record<string, unknown>;

  assert.equal(payload.totalNet, 100);
  assert.equal(payload.totalVAT, 23);
  assert.equal(payload.total, 123);
  assert.equal(payload.useTaxInclusiveUnitPrice, false);

  const line = (payload.productTrans as Record<string, unknown>[])[0];
  assert.equal(line.useTaxInclusiveUnitPrice, false);
});

test("Raw gen_ref priceBasis gross adds useTaxInclusiveUnitPrice true to payload and productTrans lines", () => {
  const result = applySalesPriceBasisToRawPayload(
    {
      customerId: 1,
      productTrans: [
        { id: 0, productId: 1, quantity: 1, unitPrice: 123 },
        { id: 0, productId: 2, quantity: 2, unitPrice: 50 },
      ],
    },
    "gross"
  );

  assert.equal(result.useTaxInclusiveUnitPrice, true);
  for (const line of result.productTrans as Record<string, unknown>[]) {
    assert.equal(line.useTaxInclusiveUnitPrice, true);
  }
});

test("Raw gen_ref priceBasis net adds useTaxInclusiveUnitPrice false to payload and productTrans lines", () => {
  const result = applySalesPriceBasisToRawPayload(
    {
      customerId: 1,
      productTrans: [{ id: 0, productId: 1, quantity: 1, unitPrice: 100 }],
    },
    "net"
  );

  assert.equal(result.useTaxInclusiveUnitPrice, false);
  for (const line of result.productTrans as Record<string, unknown>[]) {
    assert.equal(line.useTaxInclusiveUnitPrice, false);
  }
});

test("Raw gen_ref with no priceBasis leaves payload unchanged so the guard can still block", () => {
  const original = {
    customerId: 1,
    productTrans: [{ id: 0, productId: 1, quantity: 1, unitPrice: 100 }],
  };

  const result = applySalesPriceBasisToRawPayload(original, undefined);

  assert.equal("useTaxInclusiveUnitPrice" in result, false);
});
