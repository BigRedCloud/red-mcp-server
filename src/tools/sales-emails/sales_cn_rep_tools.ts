import {z} from "zod";
import type {ServerType} from "../../server.js"
import {
    brcFetch,
    brcJsonRequest,
    cloneJson,
    companyNameSchema,
    getTimestampFromRecord,
    jsonResponse,
    type JsonRecord,
  }  from "../../shared.js";
  import { buildSalesCreditNotePayload, SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION, SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION, enforceSalesProductLineAnalysisOrThrow, requireSalesRepInPayload } from "../general/payloads_tools.js";
  import { loadAndEnforceTransactionSettings } from "../../guards/company_processing_settings.js";
  import { loadAndEnforceReferenceSettings } from "../../guards/company_reference_settings.js";

  export function registerSalesCreditNoteAndRepTools(server: ServerType){
// Sales credit note tools ----------------------------------------------------

server.tool(
    "brc_create_sales_credit_note",
    `Creates a BRC sales credit note using structured MCP fields. Requires a reference when the company is configured for manual sales references; otherwise prefer brc_create_sales_credit_note_gen_ref. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION}`,
    {
      companyName: companyNameSchema,
      customerId: z.number().int().positive(),
      acCode: z.string(),
      note: z.string(),
      entryDate: z.string(),
      procDate: z.string(),
      bookTranTypeId: z.number().int().positive(),
      analysisCategoryId: z.number().int().positive(),
      accountCode: z.string().min(1),
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
      confirmCrAnalysisCategory: z
        .boolean()
        .optional()
        .describe(
          "Set true only after the user confirms a CR sales analysis account code is intentional for this product line."
        ),
    },
    async ({ companyName, confirmCrAnalysisCategory, ...args }) => {
      let payload: unknown;
      try {
        payload = buildSalesCreditNotePayload(args);
        enforceSalesProductLineAnalysisOrThrow(payload, "sales_credit_note", {
          confirmCrAnalysisCategory,
        });
        await loadAndEnforceTransactionSettings(
          String(companyName),
          "sales_credit_note",
          payload
        );
        const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
          String(companyName),
          "sales_credit_note",
          payload,
          "manual"
        );
        const createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesCreditNotes", payload);
        return jsonResponse({ message: "Sales credit note created using structured MCP fields.", companyName, payloadSent: payload, referenceWarnings: referenceWarnings.length > 0 ? referenceWarnings : undefined, createResponse });
      } catch (error) {
        return jsonResponse({ message: "Error creating sales credit note.", companyName, endpoint: "POST /v1/salesCreditNotes", inputArgs: args, payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );
  server.tool(
    "brc_create_sales_credit_note_gen_ref",
    `Creates a BRC sales credit note with an auto-generated reference using a raw BRC payload. Use when the company is configured for auto-generated sales references. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION}`,
    {
      companyName: companyNameSchema,
      payload: z.record(z.string(),z.unknown()),
      confirmCrAnalysisCategory: z
        .boolean()
        .optional()
        .describe(
          "Set true only after the user confirms a CR sales analysis account code is intentional for this product line."
        ),
    },
    async ({ companyName, payload, confirmCrAnalysisCategory }) => {
      const finalPayload = payload as Record<string, unknown>;
      requireSalesRepInPayload(finalPayload);
      enforceSalesProductLineAnalysisOrThrow(finalPayload, "sales_credit_note", {
        confirmCrAnalysisCategory,
      });
      await loadAndEnforceTransactionSettings(
        String(companyName),
        "sales_credit_note",
        finalPayload
      );
      const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
        String(companyName),
        "sales_credit_note",
        finalPayload,
        "generated"
      );
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
        referenceWarnings: referenceWarnings.length > 0 ? referenceWarnings : undefined,
        response,
      });
    }
  );
  
  
  server.tool(
    "brc_update_sales_credit_note",
    [
      "Updates an existing BRC sales credit note.",
      "Supports text/reference fields, transaction dates, customer/sales-rep fields, and complete product/monetary updates.",
      "Historical credit notes are not automatically blocked because they belong to an earlier financial year.",
      "The BRC API is the source of truth for whether the requested historical change is permitted.",
      "For monetary changes, provide productTrans, totalNet, totalVAT and total together.",
      "Do not manually change unpaid; Red preserves the existing BRC value.",
    ].join(" "),
    {
      companyName: companyNameSchema,
  
      id: z
        .union([z.string(), z.number()])
        .describe("Sales credit note id."),
  
      note: z.string().optional(),
      reference: z.string().optional(),
  
      ourReference: z.string().optional(),
      yourReference: z.string().optional(),
      details: z.string().optional(),
  
      entryDate: z
        .string()
        .optional()
        .describe(
          "Entry date. Historical dates may be attempted; BRC determines whether the update is permitted."
        ),
  
      procDate: z
        .string()
        .optional()
        .describe(
          "Processing date. Historical dates may be attempted; BRC determines whether the update is permitted."
        ),
  
      customerId: z.number().int().positive().optional(),
      saleRepId: z.number().int().positive().optional(),
      vatTypeId: z.number().int().positive().optional(),
  
      totalNet: z.number().optional(),
      totalVAT: z.number().optional(),
      total: z.number().optional(),
  
      productTrans: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          "Complete BRC productTrans collection. Preserve existing line ids and accounting/VAT data when modifying an existing credit note."
        ),
    },
  
    async ({
      companyName,
      id,
      note,
      reference,
      ourReference,
      yourReference,
      details,
      entryDate,
      procDate,
      customerId,
      saleRepId,
      vatTypeId,
      totalNet,
      totalVAT,
      total,
      productTrans,
    }) => {
      const endpoint =
        `/v1/salesCreditNotes/${encodeURIComponent(String(id))}`;
  
      const current = await brcFetch(companyName, endpoint);
  
      if (
        !current ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        throw new Error(
          `Could not read sales credit note ${id} before update.`
        );
      }
  
      const payload = cloneJson(current) as JsonRecord;
  
      if (note !== undefined) payload.note = note;
      if (reference !== undefined) payload.reference = reference;
      if (ourReference !== undefined) payload.ourReference = ourReference;
      if (yourReference !== undefined) payload.yourReference = yourReference;
      if (details !== undefined) payload.details = details;
  
      if (entryDate !== undefined) payload.entryDate = entryDate;
      if (procDate !== undefined) payload.procDate = procDate;
  
      if (customerId !== undefined) payload.customerId = customerId;
      if (saleRepId !== undefined) payload.saleRepId = saleRepId;
      if (vatTypeId !== undefined) payload.vatTypeId = vatTypeId;
  
      const monetaryEditRequested =
        totalNet !== undefined ||
        totalVAT !== undefined ||
        total !== undefined ||
        productTrans !== undefined;
  
      if (monetaryEditRequested) {
        if (
          totalNet === undefined ||
          totalVAT === undefined ||
          total === undefined ||
          productTrans === undefined
        ) {
          throw new Error(
            "Monetary sales credit note updates require productTrans, totalNet, totalVAT and total together."
          );
        }
  
        const calculatedNet = productTrans.reduce(
          (sum, line) =>
            sum +
            (typeof line.amountNet === "number"
              ? line.amountNet
              : 0),
          0
        );
  
        const calculatedVat = productTrans.reduce(
          (sum, line) =>
            sum +
            (typeof line.vat === "number"
              ? line.vat
              : 0),
          0
        );
  
        const calculatedTotal = productTrans.reduce(
          (sum, line) =>
            sum +
            (typeof line.amount === "number"
              ? line.amount
              : 0),
          0
        );
  
        const tolerance = 0.01;
  
        if (
          Math.abs(totalNet - calculatedNet) > tolerance
        ) {
          throw new Error(
            `totalNet ${totalNet} does not match productTrans net total ${calculatedNet}.`
          );
        }
  
        if (
          Math.abs(totalVAT - calculatedVat) > tolerance
        ) {
          throw new Error(
            `totalVAT ${totalVAT} does not match productTrans VAT total ${calculatedVat}.`
          );
        }
  
        if (
          Math.abs(total - calculatedTotal) > tolerance
        ) {
          throw new Error(
            `total ${total} does not match productTrans gross total ${calculatedTotal}.`
          );
        }
  
        payload.productTrans = productTrans;
        payload.totalNet = totalNet;
        payload.totalVAT = totalVAT;
        payload.total = total;
  
        // Preserve payload.unpaid from the existing record.
      }
  
      try {
        const updateResponse = await brcJsonRequest(
          companyName,
          "PUT",
          endpoint,
          payload
        );
  
        const verification = await brcFetch(
          companyName,
          endpoint
        );
  
        return jsonResponse({
          success: true,
          message: "Sales credit note updated.",
          companyName,
          id,
          endpoint: `PUT ${endpoint}`,
          monetaryEditAttempted: monetaryEditRequested,
          payloadSent: payload,
          updateResponse,
          verification,
        });
      } catch (error) {
        return jsonResponse({
          success: false,
          message:
            "BRC rejected the sales credit note update. Red attempted the requested change rather than automatically blocking it because of financial year.",
          companyName,
          id,
          endpoint: `PUT ${endpoint}`,
          transactionDate:
            procDate ??
            entryDate ??
            payload.procDate ??
            payload.entryDate,
          monetaryEditAttempted: monetaryEditRequested,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
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