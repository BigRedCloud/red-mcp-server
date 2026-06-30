import {z} from "zod";
import type {ServerType} from "../../server.js"
import {
    brcFetch,
    brcJsonRequest,
    cloneJson,
    companyNameSchema,
    getTimestampFromRecord,
    jsonResponse,
    round2,
    type JsonRecord,
  }  from "../../shared.js";
  import{buildPurchasePayload} from "../general/payloads_tools.js";
  import { loadAndEnforceTransactionSettings } from "../../guards/company_processing_settings.js";
  import { loadAndEnforceReferenceSettings } from "../../guards/company_reference_settings.js";

export function registerPurchaseTools(server: ServerType){

// Purchase tools -------------------------------------------------------------

server.tool(
    "brc_create_purchase",
    "Creates a BRC purchase using structured MCP fields. Requires a reference when the company is configured for manual purchase references; otherwise prefer brc_create_purchase_gen_ref.",
    {
      companyName: companyNameSchema,
      supplierId: z.string().describe("Supplier id, for example 26180406."),
      acCode: z.string().describe("Supplier account code, for example SUP001."),
      note: z.string().describe("Purchase note."),
      entryDate: z.string().describe("Entry date in ISO format."),
      procDate: z.string().describe("Processing date in ISO format."),
      bookTranTypeId: z.number().int().describe("Purchase book transaction type id."),
      analysisCategoryId: z.number().int().describe("Purchases analysis category id."),
      accountCode: z.string().describe("Nominal/account code."),
      description: z.string().describe("Analysis line description."),
      netAmount: z.number().describe("Net amount before VAT."),
      vatRateId: z.number().int().describe("VAT rate id."),
      vatPercentage: z.number().describe("VAT percentage."),
      reference: z.string().optional().describe("Required when the company is configured for manual purchase references."),
    },
    async ({ companyName, ...args }) => {
      const payload = buildPurchasePayload(args);
      if (args.reference !== undefined) (payload as JsonRecord).reference = args.reference;

      await loadAndEnforceTransactionSettings(String(companyName), "purchase", payload);
      const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
        String(companyName),
        "purchase",
        payload,
        "manual"
      );
  
      const createResponse = await brcJsonRequest(companyName, "POST", "/v1/purchases", payload);
      return jsonResponse({ message: "Purchase created using structured MCP fields.", companyName, payloadSent: payload, referenceWarnings: referenceWarnings.length > 0 ? referenceWarnings : undefined, createResponse });
    }
  );
  
  server.tool(
    "brc_create_purchase_gen_ref",
    "Creates a Purchases Book purchase with a generated reference using structured fields. Use when the company is configured for auto-generated purchase references.",
    {
      companyName: companyNameSchema,
      supplierId: z.number().int().positive(),
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
    async ({ companyName, ...args }) => {
      const payload = buildPurchasePayload({ ...args, supplierId: String(args.supplierId) });
      await loadAndEnforceTransactionSettings(String(companyName), "purchase", payload);
      const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
        String(companyName),
        "purchase",
        payload,
        "generated"
      );
      const createResponse = await brcJsonRequest(companyName, "POST", "/v1/purchases/createPurchaseWithGeneratingReference", payload);
      return jsonResponse({ message: "Purchase created through BRC API.", companyName, payloadSent: payload, referenceWarnings: referenceWarnings.length > 0 ? referenceWarnings : undefined, createResponse });
    }
  );
  
  server.tool(
    "brc_update_purchase",
    "Updates a BRC purchase using structured MCP fields.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Purchase id."),
      supplierId: z.string().optional(),
      acCode: z.string().optional(),
      note: z.string().optional(),
      entryDate: z.string().optional(),
      procDate: z.string().optional(),
      bookTranTypeId: z.number().int().optional(),
      analysisCategoryId: z.number().int().optional(),
      accountCode: z.string().optional(),
      description: z.string().optional(),
      netAmount: z.number().optional(),
      vatRateId: z.number().int().optional(),
      vatPercentage: z.number().optional(),
    },
    async ({ companyName, id, supplierId, acCode, note, entryDate, procDate, bookTranTypeId, analysisCategoryId, accountCode, description, netAmount, vatRateId, vatPercentage }) => {
      const current = await brcFetch(companyName, `/v1/purchases/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read purchase ${id} before update.`);
  
      const payload = cloneJson(current) as JsonRecord;
      if (supplierId !== undefined) payload.supplierId = Number(supplierId);
      if (acCode !== undefined) payload.acCode = acCode;
      if (note !== undefined) payload.note = note;
      if (entryDate !== undefined) payload.entryDate = entryDate;
      if (procDate !== undefined) payload.procDate = procDate;
      if (bookTranTypeId !== undefined) payload.bookTranTypeId = bookTranTypeId;
  
      const shouldRebuildMoney = netAmount !== undefined || vatRateId !== undefined || vatPercentage !== undefined || analysisCategoryId !== undefined || accountCode !== undefined || description !== undefined;
  
      if (shouldRebuildMoney) {
        const existingAcEntry = Array.isArray(payload.acEntries) && payload.acEntries[0] ? (payload.acEntries[0] as JsonRecord) : {};
        const existingVatEntry = Array.isArray(payload.vatEntries) && payload.vatEntries[0] ? (payload.vatEntries[0] as JsonRecord) : {};
        const finalNet = netAmount !== undefined ? round2(netAmount) : typeof payload.totalNet === "number" ? round2(payload.totalNet) : 0;
        const finalVatPercentage = vatPercentage !== undefined ? vatPercentage : typeof existingVatEntry.percentage === "number" ? existingVatEntry.percentage : 23;
        const finalVatRateId = vatRateId !== undefined ? vatRateId : typeof existingVatEntry.vatRateId === "number" ? existingVatEntry.vatRateId : 0;
        const finalVat = round2(finalNet * (finalVatPercentage / 100));
        const finalTotal = round2(finalNet + finalVat);
  
        payload.totalNet = finalNet;
        payload.totalVAT = finalVat;
        payload.total = finalTotal;
        payload.unpaid = finalTotal;
        payload.netGoods = 0;
        payload.netServices = 0;
        payload.acEntries = [{ ...existingAcEntry, accountCode: accountCode ?? existingAcEntry.accountCode, analysisCategoryId: analysisCategoryId ?? existingAcEntry.analysisCategoryId, description: description ?? existingAcEntry.description ?? "Purchase", value: finalNet }];
        payload.vatEntries = [{ ...existingVatEntry, vatRateId: finalVatRateId, percentage: finalVatPercentage, amount: finalNet }];
      }
  
      const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/purchases/${encodeURIComponent(id)}`, payload);
      const verification = await brcFetch(companyName, `/v1/purchases/${encodeURIComponent(id)}`);
      return jsonResponse({ message: "Purchase updated using structured MCP fields.", companyName, payloadSent: payload, updateResponse, verification });
    }
  );
  
  server.tool(
    "brc_delete_purchase",
    "Deletes a BRC purchase by id using timestamp confirmation.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Purchase id."),
      confirmDelete: z.boolean().default(false),
    },
    async ({ companyName, id, confirmDelete }) => {
      if (!confirmDelete) throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
      const purchase = await brcFetch(companyName, `/v1/purchases/${encodeURIComponent(id)}`);
      if (!purchase || typeof purchase !== "object" || Array.isArray(purchase)) throw new Error(`Could not read purchase ${id} before deletion.`);
      const timestamp = getTimestampFromRecord(purchase as JsonRecord, `purchase ${id}`);
      const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/purchases/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
      return jsonResponse({ deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
    }
  );
}