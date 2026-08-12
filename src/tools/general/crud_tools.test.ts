import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCashReceiptUpdateFromCurrent,
} from "./payloads_tools.js";

test("cash receipt note-only update preserves existing VAT and monetary fields", () => {
  const current = {
    id: 550078131,
    note: "Updated cash receipt 3868026",
    customerId: 26540869,
    total: 5,
    unallocated: 5,
    discount: 0,
    ledger: 0,
    acCode: 878,
    entryDate: "2026-05-01",
    procDate: "2026-05-26",
    vatTypeId: null,
    vatEntries: [],
    acEntries: [],
  };

  const built = {
    ...current,
    note: "CASH RECEIPT MERGE TEST",
  };

  const requestedUpdates = {
    note: "CASH RECEIPT MERGE TEST",
  };

  const result = mergeCashReceiptUpdateFromCurrent(
    built,
    current,
    requestedUpdates
  );

  assert.equal(result.note, "CASH RECEIPT MERGE TEST");
  assert.equal(result.total, 5);
  assert.equal(result.unallocated, 5);
  assert.equal(result.discount, 0);
  assert.equal(result.ledger, 0);
  assert.equal(result.customerId, 26540869);
  assert.equal(result.acCode, 878);
  assert.equal(result.entryDate, "2026-05-01");
  assert.equal(result.procDate, "2026-05-26");
  assert.equal(result.vatTypeId, null);
  assert.deepEqual(result.vatEntries, []);
  assert.deepEqual(result.acEntries, []);
});