import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashReceiptPayload,
  buildCustomerLikePayload,
  mergeCashReceiptUpdateFromCurrent,
} from "./payloads_tools.js";

test("cash receipt single-rate VAT amount is the receipt total, not net", () => {
  const payload = buildCashReceiptPayload({
    total: 12.3,
    note: "Analysed cash receipt",
    accountCode: "CR02",
    analysisCategoryId: 4216690,
    description: "Cash sale",
    vatRateId: 1596277,
    vatPercentage: 23,
  });

  assert.equal(payload.total, 12.3);
  assert.equal(payload.ledger, 0);

  const acEntries = payload.acEntries as Record<string, unknown>[];
  assert.equal(acEntries.length, 1);
  assert.equal(acEntries[0].accountCode, "CR02");
  assert.equal(acEntries[0].analysisCategoryId, 4216690);
  assert.equal(acEntries[0].description, "Cash sale");
  assert.equal(acEntries[0].value, 12.3);
  assert.equal("netAmount" in acEntries[0], false);
  assert.equal("vatAmount" in acEntries[0], false);
  assert.equal("vatRateId" in acEntries[0], false);
  assert.equal("vatPercentage" in acEntries[0], false);

  const vatEntries = payload.vatEntries as Record<string, unknown>[];
  assert.equal(vatEntries.length, 1);
  assert.equal(vatEntries[0].vatRateId, 1596277);
  assert.equal(vatEntries[0].percentage, 23);
  assert.equal(vatEntries[0].amount, 12.3);
  assert.equal("vatAmount" in vatEntries[0], false);
  assert.equal("netAmount" in vatEntries[0], false);

  assert.equal("totalNet" in payload, false);
  assert.equal("totalVAT" in payload, false);
  assert.equal("totalVat" in payload, false);
  assert.equal("vatTypeId" in payload, false);
  assert.equal("customerId" in payload, false);
  assert.equal("acCode" in payload, false);
});

test("cash receipt raw entries strip Sales Invoice-style fields", () => {
  const payload = buildCashReceiptPayload({
    total: 12.3,
    note: "Raw analysed cash receipt",
    ledger: 0,
    acEntries: [
      {
        accountCode: "CR02",
        analysisCategoryId: 4216690,
        description: "Cash sale",
        value: 12.3,
        netAmount: 10,
        vatAmount: 2.3,
        vatRateId: 1596277,
        vatPercentage: 23,
      },
    ],
    vatEntries: [
      {
        vatRateId: 1596277,
        percentage: 23,
        amount: 12.3,
        netAmount: 10,
        vatAmount: 2.3,
      },
    ],
  });

  const acEntry = (payload.acEntries as Record<string, unknown>[])[0];
  assert.deepEqual(Object.keys(acEntry).sort(), [
    "accountCode",
    "analysisCategoryId",
    "description",
    "value",
  ]);
  assert.equal(acEntry.value, 12.3);

  const vatEntry = (payload.vatEntries as Record<string, unknown>[])[0];
  assert.deepEqual(Object.keys(vatEntry).sort(), [
    "amount",
    "percentage",
    "vatRateId",
  ]);
  assert.equal(vatEntry.amount, 12.3);
});

test("cash receipt preserves explicitly supplied customer ledger fields", () => {
  const payload = buildCashReceiptPayload({
    total: 50,
    note: "Customer receipt",
    customerId: 26540869,
    acCode: "878",
  });

  assert.equal(payload.customerId, 26540869);
  assert.equal(payload.acCode, "878");
  assert.equal(payload.ledger, 50);
  assert.equal(payload.unallocated, 50);
  assert.deepEqual(payload.acEntries, []);
  assert.deepEqual(payload.vatEntries, []);
});

test("cash receipt note-only update merge preserves VAT monetary and allocation fields", () => {
  const current = {
    id: 550078131,
    timestamp: "AAAAAAA=",
    note: "Updated cash receipt 3868026",
    customerId: 26540869,
    total: 12.3,
    unallocated: 12.3,
    discount: 0,
    ledger: 0,
    acCode: "878",
    entryDate: "2026-05-01",
    procDate: "2026-05-26",
    vatTypeId: 1,
    totalNet: 10,
    totalVAT: 2.3,
    reference: "REF-1",
    vatEntries: [
      {
        vatRateId: 1596277,
        percentage: 23,
        amount: 12.3,
      },
    ],
    acEntries: [
      {
        accountCode: "CR02",
        analysisCategoryId: 4216690,
        description: "Cash sale",
        value: 12.3,
      },
    ],
  };

  const requestedUpdates = {
    note: "CASH RECEIPT MERGE TEST",
  };

  const built = buildCashReceiptPayload({
    ...current,
    ...requestedUpdates,
  });

  const result = mergeCashReceiptUpdateFromCurrent(
    built,
    current,
    requestedUpdates
  );

  assert.equal(result.note, "CASH RECEIPT MERGE TEST");
  assert.equal(result.id, 550078131);
  assert.equal(result.timestamp, "AAAAAAA=");
  assert.equal(result.total, 12.3);
  assert.equal(result.unallocated, 12.3);
  assert.equal(result.discount, 0);
  assert.equal(result.ledger, 0);
  assert.equal(result.customerId, 26540869);
  assert.equal(result.acCode, "878");
  assert.equal(result.entryDate, "2026-05-01");
  assert.equal(result.procDate, "2026-05-26");
  assert.equal(result.vatTypeId, 1);
  assert.equal(result.totalNet, 10);
  assert.equal(result.totalVAT, 2.3);
  assert.equal(result.reference, "REF-1");
  assert.deepEqual(result.vatEntries, current.vatEntries);
  assert.deepEqual(result.acEntries, current.acEntries);
});

test("unrelated customer payload builder behaviour is unchanged", () => {
  const payload = buildCustomerLikePayload(
    {
      code: "ACME",
      name: "Acme Ltd",
    },
    1
  );

  assert.equal(payload.code, "ACME");
  assert.equal(payload.name, "Acme Ltd");
  assert.equal(payload.ownerTypeId, 1);
  assert.equal("address" in payload, false);
});
