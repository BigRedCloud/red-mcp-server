import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveTransactionDocumentKind,
  type BookTranType,
} from "./transaction-document-kind.js";

test(
  "resolves Sales Entry using the live BRC type description rather than assuming an id",
  () => {
    const types: BookTranType[] = [
      {
        id: 999,
        description: "Sales Entry",
        code: "",
      },
    ];

    assert.equal(
      resolveTransactionDocumentKind(999, types),
      "sales_entry"
    );
  }
);

test(
  "resolves Purchases Book Entry using a dynamically supplied id",
  () => {
    const types: BookTranType[] = [
      {
        id: 123,
        description: "Purchases Book Entry",
        code: "",
      },
    ];

    assert.equal(
      resolveTransactionDocumentKind(123, types),
      "purchase"
    );
  }
);

test(
  "resolves the other currently known BRC book transaction descriptions",
  () => {
    const types: BookTranType[] = [
      { id: 10, description: "Cash Receipt" },
      { id: 20, description: "Cash Payment" },
      { id: 30, description: "Cheques Entry" },
    ];

    assert.equal(
      resolveTransactionDocumentKind(10, types),
      "cash_receipt"
    );

    assert.equal(
      resolveTransactionDocumentKind(20, types),
      "cash_payment"
    );

    assert.equal(
      resolveTransactionDocumentKind(30, types),
      "cheques_entry"
    );
  }
);

test(
  "returns unknown when bookTranTypeId is absent from the live BRC list",
  () => {
    const types: BookTranType[] = [
      {
        id: 5,
        description: "Sales Entry",
      },
    ];

    assert.equal(
      resolveTransactionDocumentKind(999, types),
      "unknown"
    );
  }
);

test(
  "returns unknown for a BRC transaction description Red does not yet map",
  () => {
    const types: BookTranType[] = [
      {
        id: 42,
        description: "Future BRC Transaction Type",
      },
    ];

    assert.equal(
      resolveTransactionDocumentKind(42, types),
      "unknown"
    );
  }
);