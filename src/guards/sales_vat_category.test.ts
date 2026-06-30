import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSalesVatRatesOrThrow,
  buildSalesVatCategoryContext,
  classifyVatCategoryName,
  collectSalesLineVatRateIds,
} from "./sales_vat_category.js";

/**
 * Sample BRC VAT categories: 1 = Sales, 2 = Purchases for Resale,
 * 3 = Purchases not for Resale.
 */
const CATEGORIES = {
  items: [
    { id: 1, name: "Sales" },
    { id: 2, name: "Purchases for Resale" },
    { id: 3, name: "Purchases not for Resale" },
  ],
};

/**
 * Sample VAT rates. Note rate 10 (Sales) and rate 20 (Purchases for Resale)
 * both have 23% — same percentage, different category.
 */
const RATES = {
  items: [
    { id: 10, percentage: 23, vatCategoryId: 1 },
    { id: 11, percentage: 13.5, vatCategoryId: 1 },
    { id: 20, percentage: 23, vatCategoryId: 2 },
    { id: 30, percentage: 23, vatCategoryId: 3 },
  ],
};

function invoicePayload(vatRateId: number): Record<string, unknown> {
  return {
    customerId: 1,
    productTrans: [{ id: 0, productId: 5023355, quantity: 1, unitPrice: 100, vatRateId }],
  };
}

const PURCHASE_MESSAGE = /belongs to a purchase VAT category[\s\S]*Sales VAT rate/;

test("classifyVatCategoryName recognises sales, purchase and other", () => {
  assert.equal(classifyVatCategoryName("Sales"), "sales");
  assert.equal(classifyVatCategoryName("Purchases for Resale"), "purchase");
  assert.equal(classifyVatCategoryName("Purchases not for Resale"), "purchase");
  assert.equal(classifyVatCategoryName("Resale"), "purchase");
  assert.equal(classifyVatCategoryName("Something else"), "other");
  assert.equal(classifyVatCategoryName(""), "other");
});

test("1. a Sales VAT rate passes on a sales invoice", () => {
  const context = buildSalesVatCategoryContext(CATEGORIES, RATES);
  assert.doesNotThrow(() => assertSalesVatRatesOrThrow(invoicePayload(10), context));
});

test("2. a Purchases for Resale VAT rate is blocked on a sales invoice", () => {
  const context = buildSalesVatCategoryContext(CATEGORIES, RATES);
  assert.throws(
    () => assertSalesVatRatesOrThrow(invoicePayload(20), context),
    PURCHASE_MESSAGE
  );
});

test("3. a Purchases not for Resale VAT rate is blocked on a sales invoice", () => {
  const context = buildSalesVatCategoryContext(CATEGORIES, RATES);
  assert.throws(
    () => assertSalesVatRatesOrThrow(invoicePayload(30), context),
    PURCHASE_MESSAGE
  );
});

test("4. same percentage but a purchase VAT category is still blocked", () => {
  const context = buildSalesVatCategoryContext(CATEGORIES, RATES);
  // Rate 20 is 23% just like the Sales rate 10, but belongs to a purchase category.
  assert.throws(
    () => assertSalesVatRatesOrThrow(invoicePayload(20), context),
    PURCHASE_MESSAGE
  );
  assert.doesNotThrow(() => assertSalesVatRatesOrThrow(invoicePayload(10), context));
});

test("5. batch sales invoice items apply the same Sales VAT category validation", () => {
  const context = buildSalesVatCategoryContext(CATEGORIES, RATES);

  // Flat/top-level batch item shape with a Sales rate passes.
  assert.doesNotThrow(() =>
    assertSalesVatRatesOrThrow(
      { customerId: 1, productId: 5023355, quantity: 1, unitPrice: 100, vatRateId: 10 },
      context
    )
  );

  // Flat/top-level batch item shape with a purchase rate is blocked.
  assert.throws(
    () =>
      assertSalesVatRatesOrThrow(
        { customerId: 1, productId: 5023355, quantity: 1, unitPrice: 100, vatRateId: 20 },
        context
      ),
    PURCHASE_MESSAGE
  );
});

test("non-Sales (other) category is blocked with a clear non-Sales message", () => {
  const categories = { items: [{ id: 1, name: "Sales" }, { id: 9, name: "EU Acquisitions" }] };
  const rates = { items: [{ id: 10, vatCategoryId: 1 }, { id: 90, vatCategoryId: 9 }] };
  const context = buildSalesVatCategoryContext(categories, rates);

  assert.throws(
    () => assertSalesVatRatesOrThrow(invoicePayload(90), context),
    /non-Sales VAT category/
  );
});

test("validation is skipped when no Sales category can be identified", () => {
  const categories = { items: [{ id: 2, name: "Purchases for Resale" }] };
  const rates = { items: [{ id: 20, vatCategoryId: 2 }] };
  const context = buildSalesVatCategoryContext(categories, rates);

  assert.equal(context.hasSalesCategory, false);
  assert.doesNotThrow(() => assertSalesVatRatesOrThrow(invoicePayload(20), context));
});

test("an unknown line VAT rate id is not blocked", () => {
  const context = buildSalesVatCategoryContext(CATEGORIES, RATES);
  assert.doesNotThrow(() => assertSalesVatRatesOrThrow(invoicePayload(99999), context));
});

test("collectSalesLineVatRateIds reads productTrans and flat shapes", () => {
  assert.deepEqual(
    collectSalesLineVatRateIds({ productTrans: [{ vatRateId: 10 }, { vatRateId: 20 }] }),
    [10, 20]
  );
  assert.deepEqual(collectSalesLineVatRateIds({ vatRateId: 30 }), [30]);
  assert.deepEqual(collectSalesLineVatRateIds({}), []);
});
