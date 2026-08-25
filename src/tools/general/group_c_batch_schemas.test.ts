import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { registerBatchTools } from "./batch_tools.js";
import { normalizeBatchItems } from "./payloads_tools.js";

type PublishedTool = { description: string; schema: Record<string, z.ZodType> };

function captureGroupCTools(): Map<string, PublishedTool> {
  const tools = new Map<string, PublishedTool>();
  const recorder = {
    tool(name: string, description: string, schema: Record<string, z.ZodType>) {
      tools.set(name, { description, schema });
    },
    resource() {},
    prompt() {},
  };
  registerBatchTools(recorder as never);
  return tools;
}

const published = captureGroupCTools();
const groupCToolNames = [
  "brc_batch_products",
  "brc_batch_customers",
  "brc_batch_suppliers",
  "brc_batch_sales_reps",
] as const;

function itemsSchema(toolName: string): z.ZodType {
  const schema = published.get(toolName)?.schema.items;
  assert.ok(schema, `Expected ${toolName} to publish items`);
  return schema;
}

function valid(toolName: string, item: Record<string, unknown>): boolean {
  return itemsSchema(toolName).safeParse([{ opCode: 1, item }]).success;
}

function assertStrictWrapper(toolName: string, item: Record<string, unknown>) {
  const schema = itemsSchema(toolName);
  assert.equal(schema.safeParse([{ opCode: 1, item }]).success, true);
  assert.equal(schema.safeParse([{ arbitrary: true }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1 }]).success, false);
  assert.equal(schema.safeParse([{ item }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 2, item }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1, item, arbitrary: true }]).success, false);
  assert.equal(schema.safeParse([{ opCode: 1, item: { ...item, arbitrary: true } }]).success, false);
  const json = z.toJSONSchema(schema) as Record<string, any>;
  assert.equal(json.items.additionalProperties, false);
  assert.equal(json.items.properties.item.additionalProperties, false);
  assert.deepEqual(json.items.required.sort(), ["item", "opCode"]);
  assert.equal(json.items.properties.opCode.const, 1);
}

const product = {
  stockCode: "LDBP123",
  details: ["Batch Product"],
  productTypeId: 4,
  vatRateId: 1670008,
  vatAnalysisTypeId: 1,
  unitPrice: 0,
  grossUnitPrice: false,
  hasDefaultVatRate: true,
};

const customer = {
  code: "CUST0001",
  name: "Batch Customer",
  vatType: 1,
  vatAnalysisTypeId: 0,
  contact: "Accounts",
  email: "accounts@example.com",
  phone: "0890000000",
  mobile: "0870000000",
  fax: "",
  vatReg: "",
  address: ["1 Main Street"],
  additionalEmails: ["billing@example.com"],
  businessIdentifierCode: "",
  internationalBankAccountNumber: "",
  creditTerms: 30,
  vatRegistered: true,
};

const supplier = {
  ...customer,
  code: "SUPP0001",
  name: "Batch Supplier",
};

const salesRep = { code: "REP01", name: "Batch Sales Rep" };

test("Group C registrations publish strict wrappers without irrelevant shared controls", () => {
  for (const toolName of groupCToolNames) {
    const tool = published.get(toolName);
    assert.ok(tool);
    assert.equal("priceBasis" in tool.schema, false);
    assert.equal("confirmCrAnalysisCategory" in tool.schema, false);
  }
  assertStrictWrapper("brc_batch_products", product);
  assertStrictWrapper("brc_batch_customers", customer);
  assertStrictWrapper("brc_batch_suppliers", supplier);
  assertStrictWrapper("brc_batch_sales_reps", salesRep);

  const requiredItemFields = (toolName: string) => {
    const json = z.toJSONSchema(itemsSchema(toolName)) as Record<string, any>;
    return [...json.items.properties.item.required].sort();
  };
  assert.deepEqual(requiredItemFields("brc_batch_products"), [
    "details", "grossUnitPrice", "hasDefaultVatRate", "productTypeId",
    "stockCode", "unitPrice", "vatAnalysisTypeId", "vatRateId",
  ]);
  assert.deepEqual(requiredItemFields("brc_batch_customers"), [
    "code", "name", "vatAnalysisTypeId", "vatType",
  ]);
  assert.deepEqual(requiredItemFields("brc_batch_suppliers"), [
    "code", "name", "vatAnalysisTypeId", "vatType",
  ]);
  assert.deepEqual(requiredItemFields("brc_batch_sales_reps"), ["code", "name"]);

  const customerJson = z.toJSONSchema(itemsSchema("brc_batch_customers")) as Record<string, any>;
  assert.equal(customerJson.items.properties.item.properties.vatType.enum, undefined);
});

test("Product schema accepts zero price and preserves canonical classifications", () => {
  assert.equal(valid("brc_batch_products", product), true);
  const normalized = normalizeBatchItems("/v1/products", [{ opCode: 1, item: product }]);
  assert.deepEqual(normalized[0]!.item, { id: 0, ...product });

  assert.equal(valid("brc_batch_products", { ...product, unitPrice: -1 }), false);
  assert.equal(valid("brc_batch_products", { ...product, productTypeId: 0 }), false);
  assert.equal(valid("brc_batch_products", { ...product, vatRateId: 0 }), false);
  assert.equal(valid("brc_batch_products", { ...product, vatAnalysisTypeId: -1 }), false);
  assert.equal(valid("brc_batch_products", { ...product, stockCode: " " }), false);
  assert.equal(valid("brc_batch_products", { ...product, details: [] }), false);
  assert.equal(valid("brc_batch_products", { ...product, details: [" "] }), false);
  for (const field of ["code", "description", "name", "price", "useDefaultVatRate", "id", "timestamp", "dormant"]) {
    assert.equal(valid("brc_batch_products", { ...product, [field]: field === "id" ? 2 : true }), false);
  }
});

test("Customer and supplier schemas enforce identity limits and owned owner types", () => {
  for (const [toolName, path, fixture, ownerTypeId] of [
    ["brc_batch_customers", "/v1/customers", customer, 1],
    ["brc_batch_suppliers", "/v1/suppliers", supplier, 3],
  ] as const) {
    assert.equal(valid(toolName, fixture), true);
    assert.equal(valid(toolName, { ...fixture, code: "A" }), true);
    assert.equal(valid(toolName, { ...fixture, code: "123456789" }), false);
    assert.equal(valid(toolName, { ...fixture, code: " " }), false);
    assert.equal(valid(toolName, { ...fixture, name: " " }), false);
    assert.equal(valid(toolName, { ...fixture, vatType: 0 }), false);
    assert.equal(valid(toolName, { ...fixture, vatAnalysisTypeId: -1 }), false);
    for (const field of ["acCode", "contactName", "address1", "ownerTypeId", "dormant", "id", "timestamp", "openingBalance", "currencyId", "purchaseVatCategoryId"]) {
      assert.equal(valid(toolName, { ...fixture, [field]: true }), false);
    }

    const normalized = normalizeBatchItems(path, [{ opCode: 1, item: fixture }]);
    const payload = normalized[0]!.item as Record<string, unknown>;
    assert.equal(payload.ownerTypeId, ownerTypeId);
    assert.equal(payload.code, fixture.code);
    assert.equal(payload.name, fixture.name);
    assert.equal(payload.vatType, fixture.vatType);
    assert.equal(payload.vatAnalysisTypeId, fixture.vatAnalysisTypeId);
  }
});

test("Blank optional contact fields remain valid and normalize by omission", () => {
  for (const [toolName, path, fixture] of [
    ["brc_batch_customers", "/v1/customers", customer],
    ["brc_batch_suppliers", "/v1/suppliers", supplier],
  ] as const) {
    const blank = { ...fixture, contact: " ", email: "", phone: "", mobile: "", fax: "", vatReg: "", businessIdentifierCode: "", internationalBankAccountNumber: "" };
    assert.equal(valid(toolName, blank), true);
    const payload = normalizeBatchItems(path, [{ opCode: 1, item: blank }])[0]!.item as Record<string, unknown>;
    for (const field of ["contact", "email", "phone", "mobile", "fax", "vatReg", "businessIdentifierCode", "internationalBankAccountNumber"]) {
      assert.equal(field in payload, false);
    }
  }
});

test("Sales representative schema publishes only canonical create fields", () => {
  assert.equal(valid("brc_batch_sales_reps", salesRep), true);
  assert.deepEqual(
    normalizeBatchItems("/v1/salesReps", [{ opCode: 1, item: salesRep }])[0]!.item,
    salesRep,
  );
  assert.equal(valid("brc_batch_sales_reps", { ...salesRep, code: " " }), false);
  assert.equal(valid("brc_batch_sales_reps", { ...salesRep, name: "" }), false);
  assert.equal(valid("brc_batch_sales_reps", { ...salesRep, id: 1 }), false);
  assert.equal(valid("brc_batch_sales_reps", { ...salesRep, timestamp: "x" }), false);
  assert.equal(valid("brc_batch_sales_reps", { ...salesRep, Code: "REP02" }), false);
});
