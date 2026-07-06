import assert from "node:assert/strict";
import test from "node:test";
import { confirmWriteSchema } from "../guards/write_confirmation.js";
import { registerSalesEntryInvoiceTools } from "./sales-emails/sales_entry_inv_tools.js";
import { registerQuoteTools } from "./sales-emails/quotes_tools.js";
import { registerBatchTools } from "./general/batch_tools.js";
import { registerCompanyContextTools } from "./setup/company_context_tools.js";
import { registerNominalReportTools } from "./journals/nominal_report_tools.js";
import { SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION, SALES_DOCUMENT_RAW_PAYLOAD_STRUCTURE_DESCRIPTION, } from "./general/payloads_tools.js";
/**
 * Registers the given tool modules against a recording server and returns a map
 * of tool name -> { description, schema } so tests can assert on the registered
 * schemas/descriptions (the live wording a model sees), not just runtime helpers.
 */
function captureRegisteredTools() {
    const tools = new Map();
    const recorder = {
        tool(name, description, schema) {
            tools.set(name, { description, schema });
        },
        resource() { },
        prompt() { },
    };
    for (const register of [
        registerSalesEntryInvoiceTools,
        registerQuoteTools,
        registerBatchTools,
        registerCompanyContextTools,
        registerNominalReportTools,
    ]) {
        register(recorder);
    }
    return tools;
}
const tools = captureRegisteredTools();
function getTool(name) {
    const tool = tools.get(name);
    assert.ok(tool, `expected tool ${name} to be registered`);
    return tool;
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
test("brc_confirm_company_connection returns connectionRef guidance", () => {
    const confirm = getTool("brc_confirm_company_connection");
    assert.match(confirm.description, /connectionRef/i);
    assert.match(confirm.description, /rotates session ids/i);
});
test("brc_start_company_connection guides reconnect and fresh-link behaviour", () => {
    const { description } = getTool("brc_start_company_connection");
    assert.match(description, /reconnect/i);
    assert.match(description, /generates a fresh one-time secure Red connection link/i);
    assert.match(description, /never reuse a previous connection link/i);
    assert.match(description, /expired session credentials/i);
    assert.match(description, /stale secure connection link/i);
    assert.match(description, /paste an API key into chat/i);
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
    assert.match(description, /all listed customers/i);
});
test("Sales VAT category wording appears in single, gen_ref, and batch tool descriptions", () => {
    const singleInvoice = getTool("brc_create_sales_invoice").description;
    const genRef = getTool("brc_create_sales_invoice_gen_ref").description;
    const batch = getTool("brc_batch_sales_invoices").description;
    for (const description of [singleInvoice, genRef, batch]) {
        assert.ok(description.includes(SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION), "expected Sales VAT category wording in description");
        assert.match(description, /Sales invoices must use Sales VAT rates/);
    }
});
test("sales invoice tool descriptions state productId 0 and 1 are blocked before preview-before-posting and posting", () => {
    for (const name of [
        "brc_create_sales_invoice",
        "brc_create_sales_invoice_gen_ref",
        "brc_batch_sales_invoices",
    ]) {
        const { description } = getTool(name);
        assert.match(description, /productId 0 (and|\/) 1/i);
        assert.match(description, /before preview-before-posting and (before )?posting|before preview-before-posting and posting/i);
    }
});
test("write tool descriptions do not describe BRC previews as drafts", () => {
    const writeToolNames = [
        "brc_create_sales_invoice",
        "brc_create_sales_invoice_gen_ref",
        "brc_batch_sales_invoices",
        "brc_create_quote",
        "brc_create_quote_gen_ref",
    ];
    for (const name of writeToolNames) {
        const { description } = getTool(name);
        assert.equal(/\bdraft\b/i.test(description), false, `${name} description must not use 'draft'`);
    }
    const confirmWriteDesc = confirmWriteSchema.description ?? "";
    assert.equal(/\bdraft\b/i.test(confirmWriteDesc), false);
});
test("nominal report tools state monthly values are period movements", () => {
    for (const name of [
        "brc_grouped_nominal_accounts_report",
        "brc_multi_company_nom_ac_report",
        "brc_get_nom_ac_ledger_by_ids",
    ]) {
        const { description } = getTool(name);
        assert.match(description, /period movement/i);
        assert.match(description, /not balance/i);
    }
});
test("raw multi-line sales invoice gen_ref wording explains required line structure", () => {
    const { description, schema } = getTool("brc_create_sales_invoice_gen_ref");
    assert.match(description, /productTrans/i);
    assert.match(description, /acEntries/i);
    assert.match(description, /reconcil/i);
    assert.match(description, /preview before posting|preview-before-posting/i);
    assert.ok(description.includes(SALES_DOCUMENT_RAW_PAYLOAD_STRUCTURE_DESCRIPTION));
    assert.ok(schema.payload, "expected payload field");
    assert.match(schema.payload.description, /productTrans/i);
    assert.match(schema.payload.description, /acEntries/i);
});
