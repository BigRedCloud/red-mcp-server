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
  import{buildSalesInvoicePayload, buildSimpleSalesEntryPayload, resolveSalesInvoiceVatTypeId, SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION, SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION, SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION, SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION, SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION, SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION, SALES_DOCUMENT_NOTE_DESCRIPTION, SALES_DOCUMENT_CUSTOMER_NAME_DESCRIPTION, SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION, SALES_DOCUMENT_REFERENCE_DESCRIPTION, SALES_DOCUMENT_PRODUCT_LINE_DESCRIPTION_DESCRIPTION, SALES_DOCUMENT_PRODUCT_FIELDS_DESCRIPTION, applySalesPriceBasisToRawPayload, enforceSalesProductLineAnalysisOrThrow, enforceSalesProductLineProductIdOrThrow, requireSalesRepInPayload} from "../general/payloads_tools.js";

  import {
    getTransactionSafetyWarnings,
    loadAndEnforceTransactionSettings,
  } from "../../guards/company_processing_settings.js";
  import { loadAndEnforceReferenceSettings } from "../../guards/company_reference_settings.js";
  import { enforceSalesVatCategoryOrThrow } from "../../guards/sales_vat_category.js";
  import { resolveCustomerVatType } from "../../guards/customer_vat_type.js";

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
      note: z.string().optional().describe(SALES_DOCUMENT_NOTE_DESCRIPTION),
      reference: z.string().optional().describe(SALES_DOCUMENT_REFERENCE_DESCRIPTION),
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
    `Creates a BRC sales invoice using structured MCP fields. Requires a reference when the company is configured for manual sales references; otherwise prefer brc_create_sales_invoice_gen_ref. Draft previews include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. ${SALES_DOCUMENT_NOTE_DESCRIPTION} ${SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION} ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION} ${SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`,
    {
      companyName: companyNameSchema,
      customerId: z.number().int().positive(),
      customerName: z.string().optional().describe(SALES_DOCUMENT_CUSTOMER_NAME_DESCRIPTION),
      acCode: z.string(),
      note: z.string().optional().describe(SALES_DOCUMENT_NOTE_DESCRIPTION),
      deliveryTo: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION),
      entryDate: z.string(),
      procDate: z.string(),
      bookTranTypeId: z.number().int().positive(),
      analysisCategoryId: z.number().int().positive(),
      accountCode: z.string().min(1),
      description: z.string().describe(SALES_DOCUMENT_PRODUCT_LINE_DESCRIPTION_DESCRIPTION),
      netAmount: z.number().positive(),
      vatRateId: z.number().int().positive(),
      vatPercentage: z.number(),
      productId: z.number().int().positive().describe(SALES_DOCUMENT_PRODUCT_FIELDS_DESCRIPTION),
      productCode: z.string().describe(SALES_DOCUMENT_PRODUCT_FIELDS_DESCRIPTION),
      quantity: z.number().int().positive(),
      unitPrice: z.number().positive(),
      saleRepId: z.number().int().positive().describe("Sales rep id from brc_list_sales_reps."),
      saleRepCode: z.string().min(1).describe("Sales rep code from brc_list_sales_reps."),
      reference: z.string().optional().describe(SALES_DOCUMENT_REFERENCE_DESCRIPTION),
      priceBasis: z
        .enum(["net", "gross"])
        .optional()
        .describe(SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION),
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
        // Default the invoice VAT type from the selected customer (BRC manual
        // entry behaviour). VAT rate / percentage selection is unchanged.
        const customerVatType = await resolveCustomerVatType(
          String(companyName),
          args.customerId
        );
        payload = buildSalesInvoicePayload({ ...args, customerVatType });
        enforceSalesProductLineProductIdOrThrow(payload);
        await enforceSalesVatCategoryOrThrow(String(companyName), payload);
        enforceSalesProductLineAnalysisOrThrow(payload, "sales_invoice", {
          confirmCrAnalysisCategory,
        });
        const processingSettings = await loadAndEnforceTransactionSettings(
          String(companyName),
          "sales_invoice",
          payload,
          { priceBasis: args.priceBasis }
        );
        const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
          String(companyName),
          "sales_invoice",
          payload,
          "manual"
        );
    
        const settingsWarnings = [
          ...getTransactionSafetyWarnings(processingSettings, "sales_invoice"),
          ...referenceWarnings,
        ];
    
        const createResponse = await brcJsonRequest(
          companyName,
          "POST",
          "/v1/salesInvoices",
          payload
        );
    
        return jsonResponse({
          message: "Sales invoice created using structured MCP fields.",
          companyName,
          payloadSent: payload,
          settingsWarnings:
            settingsWarnings.length > 0 ? settingsWarnings : undefined,
          createResponse,
        });
      } catch (error) {
        return jsonResponse({
          message: "Error creating sales invoice.",
          companyName,
          endpoint: "POST /v1/salesInvoices",
          inputArgs: args,
          payloadSent: payload ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );
  server.tool(
    "brc_create_sales_invoice_gen_ref",
    `Creates a BRC sales invoice with an auto-generated reference using a raw BRC payload. Use when the company is configured for auto-generated sales references. Draft previews include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. In the raw payload, the BRC "Note" field (JSON \`note\`) defaults to the customer name (BRC customer "Name" / JSON \`name\`) when omitted and must never be set to the product name; the BRC "Delivery To" address (JSON \`deliveryTo\`) is only included when explicitly provided. ${SALES_DOCUMENT_NOTE_DESCRIPTION} ${SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION} ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION} ${SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`,
    {
      companyName: companyNameSchema,
      payload: z.record(z.string(),z.unknown()),
      priceBasis: z
        .enum(["net", "gross"])
        .optional()
        .describe(SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION),
      confirmCrAnalysisCategory: z
        .boolean()
        .optional()
        .describe(
          "Set true only after the user confirms a CR sales analysis account code is intentional for this product line."
        ),
    },
    async ({ companyName, payload, priceBasis, confirmCrAnalysisCategory }) => {
      const finalPayload = applySalesPriceBasisToRawPayload(
        payload as Record<string, unknown>,
        priceBasis
      );

      // Default the invoice VAT type from the selected customer (BRC manual
      // entry behaviour) only when the raw payload did not already supply a
      // valid vatTypeId. An explicit vatTypeId in the payload is respected. VAT
      // rate / percentage selection is unchanged.
      const existingVatTypeId = Number(finalPayload.vatTypeId);
      if (!(Number.isFinite(existingVatTypeId) && existingVatTypeId > 0)) {
        const customerVatType = await resolveCustomerVatType(
          String(companyName),
          finalPayload.customerId as number | string | undefined
        );
        finalPayload.vatTypeId = resolveSalesInvoiceVatTypeId(customerVatType);
      }

      requireSalesRepInPayload(finalPayload);
      enforceSalesProductLineProductIdOrThrow(finalPayload);
      await enforceSalesVatCategoryOrThrow(String(companyName), finalPayload);
      enforceSalesProductLineAnalysisOrThrow(finalPayload, "sales_invoice", {
        confirmCrAnalysisCategory,
      });

      const processingSettings = await loadAndEnforceTransactionSettings(
        String(companyName),
        "sales_invoice",
        finalPayload,
        { priceBasis }
      );
      const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
        String(companyName),
        "sales_invoice",
        finalPayload,
        "generated"
      );
    
      const settingsWarnings = [
        ...getTransactionSafetyWarnings(processingSettings, "sales_invoice"),
        ...referenceWarnings,
      ];
    
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
        settingsWarnings:
          settingsWarnings.length > 0 ? settingsWarnings : undefined,
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
      note: z.string().optional().describe(SALES_DOCUMENT_NOTE_DESCRIPTION),
      reference: z.string().optional().describe(SALES_DOCUMENT_REFERENCE_DESCRIPTION),
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