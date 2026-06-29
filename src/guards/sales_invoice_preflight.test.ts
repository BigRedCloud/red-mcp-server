import assert from "node:assert/strict";
import test, { after } from "node:test";

import { wrapWriteToolHandler } from "./write_confirmation.js";
import {
  buildSalesVatCategoryContext,
  setSalesVatCategoryContextLoaderForTests,
} from "./sales_vat_category.js";

/**
 * Sample VAT reference data: category 1 = Sales (rate 10), category 2 =
 * Purchases for Resale (rate 20). The write wrapper loads this via the injected
 * loader so the Sales VAT guard runs without a live BRC connection.
 */
const VAT_CATEGORIES = {
  items: [
    { id: 1, name: "Sales" },
    { id: 2, name: "Purchases for Resale" },
  ],
};
const VAT_RATES = {
  items: [
    { id: 10, percentage: 23, vatCategoryId: 1 },
    { id: 20, percentage: 23, vatCategoryId: 2 },
  ],
};

setSalesVatCategoryContextLoaderForTests(async () =>
  buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES)
);

after(() => setSalesVatCategoryContextLoaderForTests());

/**
 * These tests prove the placeholder productId guard runs in the write wrapper
 * BEFORE the draft/confirmation step and before the underlying handler, so a
 * placeholder productId can never reach payloadPreview or BRC.
 */

test("placeholder productId 0 is blocked before the create handler runs", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice", async () => {
    handlerCalled = true;
    return "posted";
  });

  await assert.rejects(
    async () => wrapped({ productId: 0, quantity: 1, unitPrice: 100 }),
    /placeholder productId/
  );
  assert.equal(handlerCalled, false);
});

test("placeholder productId 1 is blocked before the gen_ref handler runs", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice_gen_ref", async () => {
    handlerCalled = true;
    return "posted";
  });

  await assert.rejects(
    async () =>
      wrapped({ payload: { productTrans: [{ productId: 1, quantity: 1, unitPrice: 100 }] } }),
    /placeholder productId/
  );
  assert.equal(handlerCalled, false);
});

test("batch sales invoices block a placeholder productId before the handler runs", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_batch_sales_invoices", async () => {
    handlerCalled = true;
    return "posted";
  });

  await assert.rejects(
    async () =>
      wrapped({
        items: [
          { productId: 5023355, quantity: 1, unitPrice: 1, vatRateId: 10 },
          { productId: 1, quantity: 1, unitPrice: 1, vatRateId: 10 },
        ],
      }),
    /placeholder productId/
  );
  assert.equal(handlerCalled, false);
});

test("a valid productId passes the preflight without throwing and without posting", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice", async () => {
    handlerCalled = true;
    return "posted";
  });

  // No companyName and no acCode => counterparty check returns a structured
  // response (not a throw), proving the productId preflight allowed a real id.
  const result = await wrapped({ productId: 5023355, quantity: 1, unitPrice: 100 });
  assert.equal(handlerCalled, false);
  assert.equal(typeof result, "object");
});

const PURCHASE_VAT_MESSAGE = /belongs to a purchase VAT category[\s\S]*Sales VAT rate/;

test("1. brc_create_sales_invoice blocks a wrong VAT category before draft preview", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice", async () => {
    handlerCalled = true;
    return "posted";
  });

  await assert.rejects(
    async () =>
      wrapped({
        companyName: "YOUR-COMPANY",
        customerId: 1,
        acCode: "CUST",
        productId: 5023355,
        quantity: 1,
        unitPrice: 100,
        vatRateId: 20,
      }),
    PURCHASE_VAT_MESSAGE
  );
  assert.equal(handlerCalled, false);
});

test("2. brc_create_sales_invoice_gen_ref blocks a wrong VAT category before draft preview", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice_gen_ref", async () => {
    handlerCalled = true;
    return "posted";
  });

  await assert.rejects(
    async () =>
      wrapped({
        companyName: "YOUR-COMPANY",
        payload: {
          customerId: 1,
          acCode: "CUST",
          productTrans: [{ productId: 5023355, quantity: 1, unitPrice: 100, vatRateId: 20 }],
        },
      }),
    PURCHASE_VAT_MESSAGE
  );
  assert.equal(handlerCalled, false);
});

test("3. no payloadPreview/response is produced when the wrong VAT category is blocked", async () => {
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice", async () => "posted");

  // A blocked call throws before any confirmation response is built, so the
  // wrong vatRateId can never appear in a payloadPreview.
  await assert.rejects(
    async () =>
      wrapped({
        companyName: "YOUR-COMPANY",
        customerId: 1,
        acCode: "CUST",
        productId: 5023355,
        quantity: 1,
        unitPrice: 100,
        vatRateId: 20,
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, PURCHASE_VAT_MESSAGE);
      assert.equal(message.includes("payloadPreview"), false);
      return true;
    }
  );

  // A Sales VAT rate passes the VAT preflight and reaches the confirmation gate
  // (a structured response object), confirming only the wrong rate is blocked.
  const result = await wrapped({
    companyName: "YOUR-COMPANY",
    customerId: 1,
    acCode: "CUST",
    productId: 5023355,
    quantity: 1,
    unitPrice: 100,
    vatRateId: 10,
  });
  assert.equal(typeof result, "object");
});

test("4. batch sales invoices block a wrong VAT category before any preview", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_batch_sales_invoices", async () => {
    handlerCalled = true;
    return "posted";
  });

  await assert.rejects(
    async () =>
      wrapped({
        companyName: "YOUR-COMPANY",
        items: [
          { customerId: 1, acCode: "CUST", productId: 5023355, quantity: 1, unitPrice: 1, vatRateId: 20 },
        ],
      }),
    PURCHASE_VAT_MESSAGE
  );
  assert.equal(handlerCalled, false);
});
