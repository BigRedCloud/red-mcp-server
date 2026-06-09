import {z} from "zod";
import type {ServerType} from "../server.js"
import {
    brcFetch,
    brcJsonRequest,
    cloneJson,
    companyNameSchema,
    getTimestampFromRecord,
    jsonResponse,
    round2,
    type JsonRecord,
  }  from "../shared.js";

  export function registerSalesCreditNoteAndRepTools(server: ServerType){
// Sales credit note tools ----------------------------------------------------

server.tool(
    "brc_create_sales_credit_note",
    "Creates a BRC sales credit note using structured MCP fields.",
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
      saleRepId: z.number().int().positive().optional(),
      saleRepCode: z.string().optional(),
      reference: z.string().optional(),
    },
    async (args) => {
      const { companyName } = args;
      const net = -round2(args.netAmount);
      const vat = -round2(args.netAmount * (args.vatPercentage / 100));
      const total = round2(net + vat);
      const quantity = -Math.abs(args.quantity);
  
      const payload = {
        ourReference: args.reference ?? "MCP_TEST_CN_TOOL",
        yourReference: args.reference ?? "MCP_TEST_CN_TOOL",
        loType: "1",
        deliveryTo: ["MCP Test"],
        productTrans: [
          {
            id: 0,
            amount: total,
            amountNet: net,
            percentage: args.vatPercentage,
            productId: args.productId,
            productCode: args.productCode,
            quantity,
            unitPrice: args.unitPrice,
            vat,
            vatRateId: args.vatRateId,
            vatAnalysisTypeId: 0,
            useTaxInclusiveUnitPrice: false,
            tranNotes: [args.description],
            acEntries: [
              {
                id: 0,
                accountCode: args.accountCode,
                analysisCategoryId: args.analysisCategoryId,
                description: args.description,
                value: net,
              },
            ],
          },
        ],
        saleRepId: args.saleRepId ?? 153528,
        saleRepCode: args.saleRepCode ?? "9991",
        useTaxInclusiveUnitPrice: false,
        customerId: args.customerId,
        reference: args.reference ?? "MCP_TEST_CN_TOOL",
        details: null,
        vatTypeId: 1,
        totalNet: net,
        totalVAT: vat,
        id: 0,
        bookTranTypeId: args.bookTranTypeId,
        acCode: args.acCode,
        note: args.note,
        entryDate: args.entryDate,
        procDate: args.procDate,
        total,
        customFields: [],
      };
  
      try {
        const createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesCreditNotes", payload);
        return jsonResponse({ message: "Sales credit note created using negative productTrans MCP payload.", companyName, payloadSent: payload, createResponse });
      } catch (error) {
        return jsonResponse({ message: "Error creating sales credit note.", companyName, endpoint: "POST /v1/salesCreditNotes", payloadSent: payload, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );
  server.tool(
    "brc_create_sales_credit_note_gen_ref",
    "Creates a BRC sales credit note with an auto-generated reference using a raw BRC payload.",
    {
      companyName: companyNameSchema,
      payload: z.record(z.string(),z.unknown()),
    },
    async ({ companyName, payload }) => {
      const response = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/salesCreditNotes/createCreditNoteWithGeneratingReference",
        payload
      );
  
      return jsonResponse({
        message: "Sales credit note created with generated reference.",
        companyName,
        payloadSent: payload,
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