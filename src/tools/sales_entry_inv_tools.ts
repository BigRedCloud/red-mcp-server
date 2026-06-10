import {z} from "zod";
import type {ServerType} from "../server.js"
import {
    brcFetch,
    brcJsonRequest,
    cloneJson,
    companyNameSchema,
    getTimestampFromRecord,
    jsonResponse,
    type JsonRecord,
  }  from "../shared.js";
  import{buildSalesInvoicePayload, buildSimpleSalesEntryPayload, SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION, requireSalesRepInPayload} from "./general/payloads_tools.js";

  export function registerSalesEntryInvoiceTools(server:ServerType){
// Sales entry tools ----------------------------------------------------------

server.tool(
    "brc_create_sales_entry",
    "Creates a BRC sales entry using structured MCP fields.",
    {
      companyName: companyNameSchema,
      customerId: z.number().int().positive(),
      acCode: z.string(),
      note: z.string(),
      entryDate: z.string(),
      procDate: z.string(),
      bookTranTypeId: z.number().int().positive(),
      analysisCategoryId: z.number().int().positive(),
      accountCode: z.string(),
      description: z.string(),
      netAmount: z.number().positive(),
      vatRateId: z.number().int().positive(),
      vatPercentage: z.number(),
    },
    async ({ companyName, customerId, acCode, note, entryDate, procDate, bookTranTypeId, analysisCategoryId, accountCode, description, netAmount, vatRateId, vatPercentage }) => {
      const payload = buildSimpleSalesEntryPayload({ ownerId: customerId, ownerField: "customerId", acCode, note, entryDate, procDate, bookTranTypeId, analysisCategoryId, accountCode, description, netAmount, vatRateId, vatPercentage });
      const createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesEntries", payload);
      return jsonResponse({ message: "Sales entry created using structured MCP fields.", companyName, payloadSent: payload, createResponse });
    }
  );
  
  server.tool(
    "brc_update_sales_entry",
    "Updates a BRC sales entry using structured safe text/reference fields.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales entry id."),
      note: z.string().optional(),
      reference: z.string().optional(),
    },
    async ({ companyName, id, note, reference }) => {
      const current = await brcFetch(companyName, `/v1/salesEntries/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read sales entry ${id} before update.`);
      const payload = cloneJson(current) as JsonRecord;
      if (note !== undefined) payload.note = note;
      if (reference !== undefined) payload.reference = reference;
      const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/salesEntries/${encodeURIComponent(id)}`, payload);
      const verification = await brcFetch(companyName, `/v1/salesEntries/${encodeURIComponent(id)}`);
      return jsonResponse({ message: "Sales entry updated using structured MCP fields.", companyName, payloadSent: payload, updateResponse, verification });
    }
  );
  
  server.tool(
    "brc_delete_sales_entry",
    "Deletes a BRC sales entry by id using timestamp confirmation.",
    {
      companyName: companyNameSchema,
      id: z.number().int().positive().describe("Sales entry id."),
      confirmDelete: z.boolean().default(false),
    },
    async ({ companyName, id, confirmDelete }) => {
      if (!confirmDelete) throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
      const salesEntry = await brcFetch(companyName, `/v1/salesEntries/${encodeURIComponent(id)}`);
      if (!salesEntry || typeof salesEntry !== "object" || Array.isArray(salesEntry)) throw new Error(`Could not read sales entry ${id} before deletion.`);
      const timestamp = getTimestampFromRecord(salesEntry as JsonRecord, `sales entry ${id}`);
      const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/salesEntries/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
      return jsonResponse({ deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
    }
  );

  // Sales invoice tools --------------------------------------------------------
  
  server.tool(
    "brc_create_sales_invoice",
    `Creates a BRC sales invoice using structured MCP fields. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION}`,
    {
      companyName: companyNameSchema,
      customerId: z.number().int().positive(),
      acCode: z.string(),
      note: z.string(),
      entryDate: z.string(),
      procDate: z.string(),
      bookTranTypeId: z.number().int().positive(),
      analysisCategoryId: z.number().int().positive(),
      accountCode: z.string(),
      description: z.string(),
      netAmount: z.number().positive(),
      vatRateId: z.number().int().positive(),
      vatPercentage: z.number(),
      productId: z.number().int().positive(),
      productCode: z.string(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().positive(),
      saleRepId: z.number().int().positive().describe("Sales rep id from brc_list_sales_reps."),
      saleRepCode: z.string().min(1).describe("Sales rep code from brc_list_sales_reps."),
      reference: z.string().optional(),
    },
    async ({ companyName, ...args }) => {
      let payload: unknown;
      try {
        payload = buildSalesInvoicePayload(args);
        const createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesInvoices", payload);
        return jsonResponse({ message: "Sales invoice created using structured MCP fields.", companyName, payloadSent: payload, createResponse });
      } catch (error) {
        return jsonResponse({ message: "Error creating sales invoice.", companyName, endpoint: "POST /v1/salesInvoices", inputArgs: args, payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );
  server.tool(
    "brc_create_sales_invoice_gen_ref",
    `Creates a BRC sales invoice with an auto-generated reference using a raw BRC payload. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION}`,
    {
      companyName: companyNameSchema,
      payload: z.record(z.string(),z.unknown()),
    },
    async ({ companyName, payload }) => {
      const finalPayload = payload as Record<string, unknown>;
      requireSalesRepInPayload(finalPayload);
      const response = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/salesInvoices/createSaleInvoiceWithGeneratingReference",
        finalPayload
      );
  
      return jsonResponse({
        message: "Sales invoice created with generated reference.",
        companyName,
        payloadSent: finalPayload,
        response,
      });
    }
  );
  
  server.tool(
    "brc_update_sales_invoice",
    "Updates a BRC sales invoice using structured safe text/reference fields.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales invoice id."),
      note: z.string().optional(),
      reference: z.string().optional(),
    },
    async ({ companyName, id, note, reference }) => {
      const current = await brcFetch(companyName, `/v1/salesInvoices/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read sales invoice ${id} before update.`);
      const payload = cloneJson(current) as JsonRecord;
      if (note !== undefined) payload.note = note;
      if (reference !== undefined) payload.reference = reference;
      const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/salesInvoices/${encodeURIComponent(id)}`, payload);
      const verification = await brcFetch(companyName, `/v1/salesInvoices/${encodeURIComponent(id)}`);
      return jsonResponse({ message: "Sales invoice updated using structured MCP fields.", companyName, payloadSent: payload, updateResponse, verification });
    }
  );
  
  server.tool(
    "brc_delete_sales_invoice",
    "Deletes a BRC sales invoice by id using timestamp confirmation.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales invoice id."),
      confirmDelete: z.boolean().default(false),
    },
    async ({ companyName, id, confirmDelete }) => {
      if (!confirmDelete) throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
      const invoice = await brcFetch(companyName, `/v1/salesInvoices/${encodeURIComponent(id)}`);
      if (!invoice || typeof invoice !== "object" || Array.isArray(invoice)) throw new Error(`Could not read sales invoice ${id} before deletion.`);
      const timestamp = getTimestampFromRecord(invoice as JsonRecord, `sales invoice ${id}`);
      const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/salesInvoices/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
      return jsonResponse({ deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
    }
  );
} 