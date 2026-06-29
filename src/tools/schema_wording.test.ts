import assert from "node:assert/strict";
import test from "node:test";

import { registerSalesEntryInvoiceTools } from "./sales-emails/sales_entry_inv_tools.js";
import { registerBatchTools } from "./general/batch_tools.js";
import { registerCompanyContextTools } from "./setup/company_context_tools.js";
import { SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION } from "./general/payloads_tools.js";

type RegisteredTool = { description: string; schema: Record<string, any> };

/**
 * Registers the given tool modules against a recording server and returns a map
 * of tool name -> { description, schema } so tests can assert on the registered
 * schemas/descriptions (the live wording a model sees), not just runtime helpers.
 */
function captureRegisteredTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();

  const recorder = {
    tool(name: string, description: string, schema: Record<string, any>) {
      tools.set(name, { description, schema });
    },
    resource() {},
    prompt() {},
  };

  for (const register of [
    registerSalesEntryInvoiceTools,
    registerBatchTools,
    registerCompanyContextTools,
  ]) {
    register(recorder as never);
  }

  return tools;
}

const tools = captureRegisteredTools();

function getTool(name: string): RegisteredTool {
  const tool = tools.get(name);
  assert.ok(tool, `expected tool ${name} to be registered`);
  return tool!;
}

test("brc_create_sales_invoice note is optional with customer-name default wording", () => {
  const { schema } = getTool("brc_create_sales_invoice");
  const note = schema.note;
  assert.ok(note, "expected a note field");
  assert.equal(note.isOptional(), true);
  assert.match(note.description, /customer name/i);
  assert.match(note.description, /product name/i);
});

test("brc_create_sales_invoice deliveryTo is optional and says not to invent/default it", () => {
  const { schema } = getTool("brc_create_sales_invoice");
  const deliveryTo = schema.deliveryTo;
  assert.ok(deliveryTo, "expected a deliveryTo field");
  assert.equal(deliveryTo.isOptional(), true);
  assert.match(deliveryTo.description, /deliveryTo|delivery address/i);
  assert.match(deliveryTo.description, /do not invent or default/i);
});

test("brc_create_sales_invoice exposes an optional customerName for the note default", () => {
  const { schema } = getTool("brc_create_sales_invoice");
  assert.ok(schema.customerName, "expected a customerName field");
  assert.equal(schema.customerName.isOptional(), true);
});

test("connection tools use 'confirmation code', not 'confirmation command'", () => {
  const start = getTool("brc_start_company_connection");
  const confirm = getTool("brc_confirm_company_connection");

  for (const tool of [start, confirm]) {
    assert.match(tool.description, /confirmation code/i);
    assert.equal(/confirmation command/i.test(tool.description), false);
  }
});

test("brc_list_company_contexts says connection credentials, not API keys", () => {
  const { description } = getTool("brc_list_company_contexts");
  assert.match(description, /connection credentials are never returned/i);
  assert.equal(/api keys are never returned/i.test(description), false);
});

test("brc_batch_sales_invoices exposes batch-level confirmCrAnalysisCategory", () => {
  const { schema, description } = getTool("brc_batch_sales_invoices");
  assert.ok(schema.confirmCrAnalysisCategory, "expected confirmCrAnalysisCategory in batch schema");
  assert.equal(schema.confirmCrAnalysisCategory.isOptional(), true);
  // Batch description states it covers all listed customers.
  assert.match(description, /all listed customers/i);
});

test("Sales VAT category wording appears in single, gen_ref, and batch tool descriptions", () => {
  const singleInvoice = getTool("brc_create_sales_invoice").description;
  const genRef = getTool("brc_create_sales_invoice_gen_ref").description;
  const batch = getTool("brc_batch_sales_invoices").description;

  for (const description of [singleInvoice, genRef, batch]) {
    assert.ok(
      description.includes(SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION),
      "expected Sales VAT category wording in description"
    );
    assert.match(description, /Sales invoices must use Sales VAT rates/);
  }
});

test("sales invoice tool descriptions state productId 0 and 1 are blocked before draft and posting", () => {
  for (const name of [
    "brc_create_sales_invoice",
    "brc_create_sales_invoice_gen_ref",
    "brc_batch_sales_invoices",
  ]) {
    const { description } = getTool(name);
    assert.match(description, /productId 0 (and|\/) 1/i);
    assert.match(description, /before .*draft.* (and|before) .*post|before the draft preview and before posting|before draft and posting/i);
  }
});
