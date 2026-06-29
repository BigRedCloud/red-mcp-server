

import type { ServerType } from "../../server.js";
import { registerRawBatchTool } from "./crud_tools.js";
import {
  SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION,
  SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION,
  SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION,
} from "./payloads_tools.js";

export function registerBatchTools(server: ServerType) {
  registerRawBatchTool(server, "brc_batch_purchases", "Processes a batch of purchases.", "/v1/purchases");
  registerRawBatchTool(server, "brc_batch_quotes", "Processes a batch of quotes.", "/v1/quotes");
  registerRawBatchTool(server, "brc_batch_sales_credit_notes", `Processes a batch of sales credit notes. ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION}`, "/v1/salesCreditNotes");
  registerRawBatchTool(server, "brc_batch_sales_entries", "Processes a batch of sales entries.", "/v1/salesEntries");
  registerRawBatchTool(server, "brc_batch_sales_invoices", `Processes a batch of sales invoices. ${SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`, "/v1/salesInvoices");
  registerRawBatchTool(server, "brc_batch_sales_reps", "Processes a batch of sales reps.", "/v1/salesReps");
  registerRawBatchTool(server, "brc_batch_suppliers", "Processes a batch of suppliers.", "/v1/suppliers");
  registerRawBatchTool(server, "brc_batch_customers", "Processes a batch of customers.", "/v1/customers");
  registerRawBatchTool(server, "brc_batch_products", "Processes a batch of products.", "/v1/products");
}

