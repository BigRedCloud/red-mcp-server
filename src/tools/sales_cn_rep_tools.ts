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
  import { buildSalesCreditNotePayload, SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION, requireSalesRepInPayload } from "./general/payloads_tools.js";

  export function registerSalesCreditNoteAndRepTools(server: ServerType){
// Sales credit note tools ----------------------------------------------------

server.tool(
    "brc_create_sales_credit_note",
    `Creates a BRC sales credit note using structured MCP fields. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION}`,
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
      quantity: z.number().positive(),
      unitPrice: z.number().positive(),
      saleRepId: z.number().int().positive().describe("Sales rep id from brc_list_sales_reps."),
      saleRepCode: z.string().min(1).describe("Sales rep code from brc_list_sales_reps."),
      reference: z.string().optional(),
    },
    async ({ companyName, ...args }) => {
      let payload: unknown;
      try {
        payload = buildSalesCreditNotePayload(args);
        const createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesCreditNotes", payload);
        return jsonResponse({ message: "Sales credit note created using structured MCP fields.", companyName, payloadSent: payload, createResponse });
      } catch (error) {
        return jsonResponse({ message: "Error creating sales credit note.", companyName, endpoint: "POST /v1/salesCreditNotes", inputArgs: args, payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );
  server.tool(
    "brc_create_sales_credit_note_gen_ref",
    `Creates a BRC sales credit note with an auto-generated reference using a raw BRC payload. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION}`,
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
        "/v1/salesCreditNotes/createCreditNoteWithGeneratingReference",
        finalPayload
      );
  
      return jsonResponse({
        message: "Sales credit note created with generated reference.",
        companyName,
        payloadSent: finalPayload,
        response,
      });
    }
  );
  
  
  server.tool(
    "brc_update_sales_credit_note",
    "Updates a BRC sales credit note using structured safe text/reference fields.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales credit note id."),
      note: z.string().optional(),
      reference: z.string().optional(),
    },
    async ({ companyName, id, note, reference }) => {
      const current = await brcFetch(companyName, `/v1/salesCreditNotes/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read sales credit note ${id} before update.`);
      const payload = cloneJson(current) as JsonRecord;
      if (note !== undefined) payload.note = note;
      if (reference !== undefined) payload.reference = reference;
      const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/salesCreditNotes/${encodeURIComponent(id)}`, payload);
      const verification = await brcFetch(companyName, `/v1/salesCreditNotes/${encodeURIComponent(id)}`);
      return jsonResponse({ message: "Sales credit note updated using structured MCP fields.", companyName, payloadSent: payload, updateResponse, verification });
    }
  );
  
  server.tool(
    "brc_delete_sales_credit_note",
    "Deletes a BRC sales credit note by id using timestamp confirmation.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales credit note id."),
      confirmDelete: z.boolean().default(false),
    },
    async ({ companyName, id, confirmDelete }) => {
      if (!confirmDelete) throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
      const creditNote = await brcFetch(companyName, `/v1/salesCreditNotes/${encodeURIComponent(id)}`);
      if (!creditNote || typeof creditNote !== "object" || Array.isArray(creditNote)) throw new Error(`Could not read sales credit note ${id} before deletion.`);
      const timestamp = getTimestampFromRecord(creditNote as JsonRecord, `sales credit note ${id}`);
      const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/salesCreditNotes/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
      return jsonResponse({ deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
    }
  );
  
  // Sales rep tools ------------------------------------------------------------
  
  server.tool(
    "brc_create_sales_rep",
    "Creates a BRC sales rep using structured MCP fields.",
    {
      companyName: companyNameSchema,
      code: z.string().describe("Sales rep code."),
      name: z.string().describe("Sales rep name."),
    },
    async ({ companyName, code, name }) => {
      const payload = { code, name };
      const response = await brcJsonRequest(companyName, "POST", "/v1/salesReps", payload);
      return jsonResponse({ message: "Sales rep create request sent.", companyName, payloadSent: payload, response });
    }
  );
  
  server.tool(
    "brc_update_sales_rep",
    "Updates a BRC sales rep using structured MCP fields.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales rep id."),
      code: z.string().optional(),
      name: z.string().optional(),
    },
    async ({ companyName, id, code, name }) => {
      const current = await brcFetch(companyName, `/v1/salesReps/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read sales rep ${id} before update.`);
      const payload = cloneJson(current) as JsonRecord;
      if (code !== undefined) payload.code = code;
      if (name !== undefined) payload.name = name;
      const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/salesReps/${encodeURIComponent(id)}`, payload);
      const verification = await brcFetch(companyName, `/v1/salesReps/${encodeURIComponent(id)}`);
      return jsonResponse({ message: "Sales rep updated.", companyName, payloadSent: payload, updateResponse, verification });
    }
  );
  
  server.tool(
    "brc_delete_sales_rep",
    "Deletes a BRC sales rep by id using timestamp confirmation.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Sales rep id."),
      confirmDelete: z.boolean().default(false),
    },
    async ({ companyName, id, confirmDelete }) => {
      if (!confirmDelete) throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
      const current = await brcFetch(companyName, `/v1/salesReps/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read sales rep ${id} before deletion.`);
      const timestamp = getTimestampFromRecord(current as JsonRecord, `sales rep ${id}`);
      const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/salesReps/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
      return jsonResponse({ deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
    }
  );
} 