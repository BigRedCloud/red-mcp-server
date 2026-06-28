import assert from "node:assert/strict";
import test from "node:test";

import { enforceSalesProductLineProductIdOrThrow } from "./payloads_tools.js";

function invoicePayload(productId?: unknown): Record<string, unknown> {
  const line: Record<string, unknown> = {
    id: 0,
    quantity: 1,
    unitPrice: 100,
  };
  if (productId !== undefined) {
    line.productId = productId;
  }
  return { customerId: 1, productTrans: [line] };
}

const PLACEHOLDER_MESSAGE = /placeholder productId/;

test("sales invoice with productTrans line productId 0 is blocked", () => {
  assert.throws(
    () => enforceSalesProductLineProductIdOrThrow(invoicePayload(0)),
    /placeholder productId 0[\s\S]*brc_list_products[\s\S]*such as 0 or 1/
  );
});

test("sales invoice with productTrans line productId 1 is blocked", () => {
  assert.throws(
    () => enforceSalesProductLineProductIdOrThrow(invoicePayload(1)),
    /placeholder productId 1[\s\S]*brc_list_products/
  );
});

test("sales invoice with a valid productId is allowed", () => {
  assert.doesNotThrow(() =>
    enforceSalesProductLineProductIdOrThrow(invoicePayload(5023355))
  );
});

test("sales invoice with no productId field is not blocked by this guard", () => {
  assert.doesNotThrow(() =>
    enforceSalesProductLineProductIdOrThrow(invoicePayload(undefined))
  );
});

test("placeholder productId as a string is still blocked", () => {
  assert.throws(
    () => enforceSalesProductLineProductIdOrThrow(invoicePayload("1")),
    PLACEHOLDER_MESSAGE
  );
});

test("flat/top-level placeholder productId (batch shape) is blocked", () => {
  assert.throws(
    () =>
      enforceSalesProductLineProductIdOrThrow({
        customerId: 1,
        productId: 1,
        quantity: 1,
        unitPrice: 100,
      }),
    PLACEHOLDER_MESSAGE
  );
});

test("flat/top-level valid productId (batch shape) is allowed", () => {
  assert.doesNotThrow(() =>
    enforceSalesProductLineProductIdOrThrow({
      customerId: 1,
      productId: 5023355,
      quantity: 1,
      unitPrice: 100,
    })
  );
});

test("only one valid line among several is allowed; any placeholder line blocks", () => {
  assert.doesNotThrow(() =>
    enforceSalesProductLineProductIdOrThrow({
      productTrans: [{ productId: 5023355 }, { quantity: 1 }],
    })
  );

  assert.throws(
    () =>
      enforceSalesProductLineProductIdOrThrow({
        productTrans: [{ productId: 5023355 }, { productId: 0 }],
      }),
    /placeholder productId 0/
  );
});
