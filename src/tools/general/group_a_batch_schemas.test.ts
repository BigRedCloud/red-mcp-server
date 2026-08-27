import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { registerBatchTools } from "./batch_tools.js";
import { normalizeBatchItems } from "./payloads_tools.js";

const salesEntry = {
  customerId: 26540869,
  acCode: "878",
  note: "Batch Sales Entry",
  entryDate: "2026-08-13",
  procDate: "2026-08-13",
  bookTranTypeId: 5,
  analysisCategoryId: 4216701,
  accountCode: "SA01",
  description: "Batch Sales Entry",
  netAmount: 10,
  vatRateId: 1596277,
  vatPercentage: 23,
};

const flatQuote = {
  companyId: 806559,
  customerOwnerId: 26540869,
  acCode: "878",
  customerOwnerName: "Paul Conroy Ltd",
  comments: "Batch Quote",
  entryDate: "2026-08-13",
  procDate: "2026-08-13",
  vatTypeId: 1,
  saleRepId: 153992,
  saleRepCode: "7777",
  reference: "BQ1234",
  layoutType: 1,
  productId: 5023355,
  productCode: "PR001",
  quantity: 1,
  unitPrice: 10,
  vatRateId: 1596277,
  vatPercentage: 23,
  tranNote: "Batch Quote line",
  analysisCategoryId: 4216701,
  accountCode: "SA01",
};

const flatCreditNote = {
  customerId: 26540869,
  acCode: "878",
  note: "Batch Credit Note",
  entryDate: "2026-08-13",
  procDate: "2026-08-13",
  bookTranTypeId: 7,
  analysisCategoryId: 4216701,
  accountCode: "SA01",
  description: "Batch Credit Note line",
  netAmount: 10,
  vatRateId: 1596277,
  vatPercentage: 23,
  productId: 5023355,
  productCode: "PR001",
  quantity: 1,
  unitPrice: 10,
  saleRepId: 153992,
  saleRepCode: "7777",
  reference: "CN0001",
};

type PublishedTool = { schema: Record<string, z.ZodType> };

function captureGroupATools(): Map<string, PublishedTool> {
  const tools = new Map<string, PublishedTool>();
  const recorder = {
    tool(name: string, _description: string, schema: Record<string, z.ZodType>) {
      tools.set(name, { schema });
    },
    resource() {},
    prompt() {},
  };
  registerBatchTools(recorder as never);
  return tools;
}

const published = captureGroupATools();

function itemsSchema(toolName: string): z.ZodType {
  const schema = published.get(toolName)?.schema.items;
  assert.ok(schema, `Expected ${toolName} to publish items`);
  return schema;
}

function assertRejectsCommonInvalidInputs(toolName: string, validItem: Record<string, unknown>) {
  const schema = itemsSchema(toolName);
  assert.equal(schema.safeParse([{ arbitrary: true }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1 }]).success, false);
  assert.equal(schema.safeParse([{ item: validItem }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 2, item: validItem }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...validItem, arbitrary: true } }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1, item: validItem, arbitrary: true }]).success, false);
}

test("Group A registrations publish strict wrappers and the intended outer controls", () => {
  const quote = published.get("brc_batch_quotes")!;
  const creditNote = published.get("brc_batch_sales_credit_notes")!;
  const entry = published.get("brc_batch_sales_entries")!;

  assert.equal("priceBasis" in quote.schema, false);
  assert.equal("priceBasis" in entry.schema, false);
  assert.equal("priceBasis" in creditNote.schema, true);
  for (const tool of [quote, creditNote, entry]) {
    assert.equal("confirmCrAnalysisCategory" in tool.schema, true);
  }

  const quoteJson = z.toJSONSchema(itemsSchema("brc_batch_quotes")) as Record<string, any>;
  const quoteWrapper = quoteJson.items;
  assert.equal(quoteWrapper.additionalProperties, false);
  assert.deepEqual(quoteWrapper.required.sort(), ["item", "opCode"]);
  assert.equal(quoteWrapper.properties.opCode.const, 1);
  assert.ok(Array.isArray(quoteWrapper.properties.item.oneOf));
  assert.equal(quoteWrapper.properties.item.oneOf.length, 2);
  assert.equal(quoteWrapper.properties.item.oneOf[0].additionalProperties, false);
  assert.equal(quoteWrapper.properties.item.oneOf[1].additionalProperties, false);

  const creditJson = z.toJSONSchema(itemsSchema("brc_batch_sales_credit_notes")) as Record<string, any>;
  assert.ok(Array.isArray(creditJson.items.properties.item.oneOf));
  assert.equal(creditJson.items.properties.item.oneOf.length, 2);
});

test("Sales Entry schema is strict and its valid example reconciles after normalization", () => {
  const schema = itemsSchema("brc_batch_sales_entries");
  assert.equal(schema.safeParse([{ opCode: 1, item: salesEntry }]).success, true);
  assertRejectsCommonInvalidInputs("brc_batch_sales_entries", salesEntry);
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...salesEntry, customerId: 0 } }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...salesEntry, netAmount: -10 } }]).success, false);
  const missingVatRate = { ...salesEntry } as Partial<typeof salesEntry>;
  delete missingVatRate.vatRateId;
  assert.equal(schema.safeParse([{ opCode: 1, item: missingVatRate }]).success, false);

  const normalized = normalizeBatchItems("/v1/salesEntries", [{ opCode: 1, item: salesEntry }]);
  const payload = normalized[0]!.item as Record<string, any>;
  assert.equal(payload.totalNet, 10);
  assert.equal(payload.totalVAT, 2.3);
  assert.equal(payload.total, 12.3);
  assert.equal(payload.acEntries[0].analysisCategoryId, 4216701);
  assert.equal(payload.vatEntries[0].vatRateId, 1596277);
});

test("Quote schema accepts verified flat and complete nested modes", () => {
  const schema = itemsSchema("brc_batch_quotes");
  assert.equal(schema.safeParse([{ opCode: 1, item: flatQuote }]).success, true);
  assertRejectsCommonInvalidInputs("brc_batch_quotes", flatQuote);
  for (const invalidId of [0, 1]) {
    assert.equal(schema.safeParse([{ opCode: 1, item: { ...flatQuote, productId: invalidId } }]).success, false);
  }
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...flatQuote, customerOwnerId: 0 } }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...flatQuote, reference: "TOOLONG" } }]).success, false);

  const normalizedFlat = normalizeBatchItems("/v1/quotes", [{ opCode: 1, item: flatQuote }]);
  const nested = normalizedFlat[0]!.item as Record<string, any>;
  assert.equal(schema.safeParse([{ opCode: 1, item: nested }]).success, true);
  assert.deepEqual(normalizeBatchItems("/v1/quotes", [{ opCode: 1, item: nested }])[0]!.item, nested);
  assert.equal(nested.totalNet, 10);
  assert.equal(nested.totalVat, 2.3);
  assert.equal(nested.total, 12.3);
  assert.equal(nested.productTrans[0].acEntries[0].value, 10);

  assert.equal(schema.safeParse([{ opCode: 1, item: { ...nested, productTrans: [] } }]).success, false);
  const emptyAnalysis = structuredClone(nested);
  emptyAnalysis.productTrans[0].acEntries = [];
  assert.equal(schema.safeParse([{ opCode: 1, item: emptyAnalysis }]).success, false);
});

test("Credit Note schema accepts flat-positive and nested-negative modes only", () => {
  const schema = itemsSchema("brc_batch_sales_credit_notes");
  assert.equal(schema.safeParse([{ opCode: 1, item: flatCreditNote }]).success, true);
  assertRejectsCommonInvalidInputs("brc_batch_sales_credit_notes", flatCreditNote);
  for (const invalidId of [0, 1]) {
    assert.equal(schema.safeParse([{ opCode: 1, item: { ...flatCreditNote, productId: invalidId } }]).success, false);
  }
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...flatCreditNote, saleRepId: 0 } }]).success, false);
  const missingAnalysis = { ...flatCreditNote } as Partial<typeof flatCreditNote>;
  delete missingAnalysis.analysisCategoryId;
  assert.equal(schema.safeParse([{ opCode: 1, item: missingAnalysis }]).success, false);

  const normalizedFlat = normalizeBatchItems("/v1/salesCreditNotes", [{ opCode: 1, item: flatCreditNote }]);
  const nested = normalizedFlat[0]!.item as Record<string, any>;
  assert.equal(schema.safeParse([{ opCode: 1, item: nested }]).success, true);
  assert.deepEqual(
    normalizeBatchItems("/v1/salesCreditNotes", [{ opCode: 1, item: nested }])[0]!.item,
    nested,
  );
  assert.equal(nested.totalNet, -10);
  assert.equal(nested.totalVAT, -2.3);
  assert.equal(nested.total, -12.3);
  assert.equal(nested.productTrans[0].acEntries[0].value, -10);

  assert.equal(schema.safeParse([{ opCode: 1, item: { ...nested, productTrans: [] } }]).success, false);
  const emptyAnalysis = structuredClone(nested);
  emptyAnalysis.productTrans[0].acEntries = [];
  assert.equal(schema.safeParse([{ opCode: 1, item: emptyAnalysis }]).success, false);
  const positiveSigned = structuredClone(nested);
  positiveSigned.totalNet = 10;
  positiveSigned.totalVAT = 2.3;
  positiveSigned.total = 12.3;
  positiveSigned.unpaid = 12.3;
  positiveSigned.productTrans[0].amount = 12.3;
  positiveSigned.productTrans[0].amountNet = 10;
  positiveSigned.productTrans[0].vat = 2.3;
  positiveSigned.productTrans[0].vatAmount = 2.3;
  positiveSigned.productTrans[0].quantity = 1;
  positiveSigned.productTrans[0].acEntries[0].value = 10;
  assert.equal(schema.safeParse([{ opCode: 1, item: positiveSigned }]).success, false);
});
