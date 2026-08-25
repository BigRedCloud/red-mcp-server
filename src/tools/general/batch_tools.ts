

import { z } from "zod";
import type { ServerType } from "../../server.js";
import { registerRawBatchTool } from "./crud_tools.js";
import { generatedReferenceSalesInvoicePayloadObjectSchema } from "../sales-emails/sales_invoice_payload_schemas.js";
import {
  SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION,
  SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION,
  SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION,
} from "./payloads_tools.js";

export const salesInvoiceBatchItemSchema = z
  .object({
    opCode: z
      .number()
      .int()
      .default(1)
      .describe("BRC batch operation code. Use 1 to create a sales invoice."),
    item: generatedReferenceSalesInvoicePayloadObjectSchema.describe(
      "Complete BRC sales-invoice payload. Use nested productTrans lines with nested acEntries, matching brc_create_sales_invoice_gen_ref.",
    ),
  })
  .passthrough();

const describedString = (description: string) => z.string().describe(description);

export const purchaseBatchPayloadSchema = z.object({
  supplierId: z.number().int().positive().describe("BRC supplier id."),
  acCode: describedString("Supplier account code."),
  bookTranTypeId: z.number().int().positive().describe("Purchase book transaction type id; use 4."),
  entryDate: describedString("Purchase entry date in ISO format."),
  procDate: describedString("Purchase processing date in ISO format."),
  description: describedString("Purchase analysis-line description."),
  note: describedString("Purchase note."),
  accountCode: describedString("Nominal account code for the analysis entry."),
  analysisCategoryId: z.number().int().positive().describe("Purchases analysis category id."),
  netAmount: z.number().positive().describe("Net amount before VAT."),
  vatPercentage: z.number().describe("VAT percentage."),
  vatRateId: z.number().int().positive().describe("BRC VAT rate id."),
  totalNet: z.number().optional().describe("Optional caller-calculated net total; RED recalculates it from netAmount."),
  totalVAT: z.number().optional().describe("Optional caller-calculated VAT total; RED recalculates it from netAmount and vatPercentage."),
  total: z.number().optional().describe("Optional caller-calculated gross total; RED recalculates it."),
  unpaid: z.number().optional().describe("Optional caller-calculated unpaid amount; RED recalculates it."),
  vatTypeId: z.number().int().positive().optional().describe("Optional purchase VAT type; the current builder emits Domestic VAT type 1."),
});

export const purchaseBatchItemSchema = z.object({
  opCode: z.literal(1).default(1).describe("BRC batch operation code. Use 1 to create a purchase."),
  item: purchaseBatchPayloadSchema.describe(
    "Structured purchase input matching brc_create_purchase_gen_ref and the batch purchase builder.",
  ),
});

export function registerBatchTools(server: ServerType) {
  registerRawBatchTool(
    server,
    "brc_batch_purchases",
    "Processes a batch of purchases using the same structured fields as brc_create_purchase_gen_ref.",
    "/v1/purchases",
    purchaseBatchItemSchema,
  );
  registerRawBatchTool(server, "brc_batch_quotes", "Processes a batch of quotes.", "/v1/quotes");
  registerRawBatchTool(server, "brc_batch_sales_credit_notes", `Processes a batch of sales credit notes. ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION}`, "/v1/salesCreditNotes");
  registerRawBatchTool(server, "brc_batch_sales_entries", "Processes a batch of sales entries.", "/v1/salesEntries");
  registerRawBatchTool(
    server,
    "brc_batch_sales_invoices",
    `Processes a batch of sales invoices. Each batch may partially succeed; inspect every returned item and failedItems before reporting success. ${SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`,
    "/v1/salesInvoices",
    salesInvoiceBatchItemSchema,
  );
  registerRawBatchTool(server, "brc_batch_sales_reps", "Processes a batch of sales reps.", "/v1/salesReps");
  registerRawBatchTool(server, "brc_batch_suppliers", "Processes a batch of suppliers.", "/v1/suppliers");
  registerRawBatchTool(server, "brc_batch_customers", "Processes a batch of customers.", "/v1/customers");
  registerRawBatchTool(server, "brc_batch_products", "Processes a batch of products.", "/v1/products");
}

