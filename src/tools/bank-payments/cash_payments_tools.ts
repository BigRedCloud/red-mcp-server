import { z } from "zod";
import { loadAndEnforceTransactionSettings } from "../../guards/company_processing_settings.js";
import type { ServerType } from "../../server.js";
import { brcJsonRequest, companyNameSchema, jsonResponse } from "../../shared.js";
import { registerListTool, registerGetTool } from "../../tools/general/list_tools.js";
import {
  registerRawCreateTool,
  registerRawUpdateTool,
  registerRawDeleteTool,
  registerRawBatchTool,
} from "../../tools/general/crud_tools.js";
import {
  buildBankAccountPayload,
  buildCashPaymentPayload,
  buildCashReceiptPayload,
  buildPaymentPayload,
  todayIsoDate,
  unwrapPayload,
} from "../../tools/general/payloads_tools.js";

export function registerCashPaymentTools(server: ServerType) {

  // Cash Payments
  registerListTool(server, "brc_list_cash_payments", "Lists BRC cash payments.", "/v1/cashPayments");
  registerGetTool(server, "brc_get_cash_payment", "Gets one BRC cash payment by id.", "/v1/cashPayments", "Cash payment");
  server.tool(
    "brc_create_cash_payment",
    "Creates a BRC cash payment. Use supplierId + ledger for supplier payments, bankAccountId + lodgement for bank lodgements, or analysisCategoryId + accountCode for analysed expenses. Analysis categories must be from the Cash Payments book (CP01-CP03) and accountCode must match the category.",
    {
      companyName: companyNameSchema,
      note: z.string(),
      entryDate: z.string().optional().describe("Entry date in ISO format. Defaults to today."),
      procDate: z.string().optional().describe("Processing date in ISO format. Defaults to entryDate."),
      bookTranTypeId: z.number().int().default(2).describe("Cash Payment book transaction type id."),
      total: z.number().positive(),
      supplierId: z.number().int().positive().optional().describe("Supplier id for ledger payments."),
      acCode: z.string().optional().describe("Supplier account code for ledger payments."),
      ledger: z.number().optional().describe("Ledger amount; must equal total for supplier payments."),
      discount: z.number().optional(),
      bankAccountId: z.number().int().positive().optional().describe("Bank account id for lodgements."),
      bankAccountCode: z.string().optional().describe("Bank account code for lodgements."),
      lodgement: z.number().optional().describe("Lodgement amount; must equal total when lodging to bank."),
      analysisCategoryId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Cash Payments analysis category id (categoryTypeId 1391170)."),
      accountCode: z
        .string()
        .optional()
        .describe("Analysis account code matching analysisCategoryId, for example CP01."),
      description: z.string().optional().describe("Analysis line description."),
    },
    async ({ companyName, ...args }) => {
      const entryDate = args.entryDate ?? todayIsoDate();
      const procDate = args.procDate ?? entryDate;
      const payload = buildCashPaymentPayload({ ...args, entryDate, procDate } as any);
      const response = await brcJsonRequest(companyName, "POST", "/v1/cashPayments", payload);

      return jsonResponse({
        message: "Cash payment created using structured MCP fields.",
        companyName,
        endpoint: "POST /v1/cashPayments",
        payloadSent: payload,
        response,
      });
    }
  );
  registerRawUpdateTool(server, "brc_update_cash_payment", "Updates a BRC cash payment using merged fields.", "/v1/cashPayments", "Cash payment");
  registerRawDeleteTool(server, "brc_delete_cash_payment", "Deletes a BRC cash payment by id.", "/v1/cashPayments", "cash payment");
  registerRawBatchTool(server, "brc_batch_cash_payments", "Processes a batch of BRC cash payments.", "/v1/cashPayments");

  // Cash Receipts
registerListTool(
  server,
  "brc_list_cash_receipts",
  "Lists BRC cash receipts.",
  "/v1/cashReceipts"
);

registerGetTool(
  server,
  "brc_get_cash_receipt",
  "Gets one BRC cash receipt by id.",
  "/v1/cashReceipts",
  "Cash receipt"
);

server.tool(
  "brc_create_cash_receipt",
  "Creates a BRC cash receipt. Accepts either a raw payload object or common flat fields. entryDate/procDate default to today. VAT rate fields are only sent when the company's VAT on Cash Receipt setting is enabled.",
  {
    companyName: companyNameSchema,

    // Raw BRC payload support
    payload: z.record(z.string(), z.unknown()).optional(),

    // Common flat fields
    note: z.string().optional(),
    reference: z.string().optional(),
    details: z.string().optional(),
    entryDate: z.string().optional(),
    procDate: z.string().optional(),
    bookTranTypeId: z.number().int().optional(),
    total: z.number().optional(),

    customerId: z.number().int().positive().optional(),
    acCode: z.string().optional(),
    ledger: z.number().optional(),

    analysisCategoryId: z.number().int().positive().optional(),
    accountCode: z.string().optional(),
    description: z.string().optional(),
    discount: z.number().optional(),

    // VAT split support for stricter companies
    vatRateId: z.number().int().positive().optional(),
    vatPercentage: z.number().optional(),
    percentage: z.number().optional(),
    vatTypeId: z.number().int().optional(),
    totalNet: z.number().optional(),
    totalVat: z.number().optional(),
    totalVAT: z.number().optional(),
    unallocated: z.number().optional(),

    acEntries: z.array(z.record(z.string(), z.unknown())).optional(),
    vatEntries: z.array(z.record(z.string(), z.unknown())).optional(),
    customFields: z.array(z.unknown()).optional(),
    detailCollection: z.array(z.unknown()).optional(),
  },
  async ({ companyName, ...args }) => {
    const merged = unwrapPayload(args as Record<string, unknown>);
    const processingSettings = await loadAndEnforceTransactionSettings(
      companyName,
      "cash_receipt",
      merged
    );
    const vatOnCashEnabled = processingSettings.vatOnCashReceiptsEnabled === true;
    const payload = buildCashReceiptPayload(merged, { vatOnCashEnabled });

    const response = await brcJsonRequest(
      companyName,
      "POST",
      "/v1/cashReceipts",
      payload
    );

    return jsonResponse({
      message: "Cash receipt create request sent to BRC.",
      companyName,
      endpoint: "POST /v1/cashReceipts",
      payloadSent: payload,
      response,
    });
  }
);

registerRawUpdateTool(
  server,
  "brc_update_cash_receipt",
  "Updates a BRC cash receipt using merged fields.",
  "/v1/cashReceipts",
  "Cash receipt"
);

registerRawDeleteTool(
  server,
  "brc_delete_cash_receipt",
  "Deletes a BRC cash receipt by id.",
  "/v1/cashReceipts",
  "cash receipt"
);

registerRawBatchTool(
  server,
  "brc_batch_cash_receipts",
  "Processes a batch of BRC cash receipts.",
  "/v1/cashReceipts"
);

  // Payments
  registerListTool(server, "brc_list_payments", "Lists BRC payments.", "/v1/payments");
  registerGetTool(server, "brc_get_payment", "Gets one BRC payment by id.", "/v1/payments", "Payment");
  server.tool(
    "brc_create_payment",
    "Creates a BRC payment from the Payments book. Use supplierId for supplier payments, or analysisCategoryId + accountCode for analysed bank payments. Analysis categories must be from the bank's Payments book (BP01-BP06) and accountCode must match the category.",
    {
      companyName: companyNameSchema,
      note: z.string(),
      entryDate: z.string().optional().describe("Entry date in ISO format. Defaults to today."),
      procDate: z.string().optional().describe("Processing date in ISO format. Defaults to entryDate."),
      bookTranTypeId: z.number().int().default(3).describe("Cheques Entry / Payments book transaction type id."),
      total: z.number().positive(),
      bankAccountId: z.number().int().positive(),
      bankAccountCode: z.string(),
      supplierId: z.number().int().positive().optional().describe("Supplier id for supplier payments."),
      acCode: z.string().optional().describe("Supplier account code for supplier payments."),
      analysisCategoryId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Payments book analysis category id for the selected bank."),
      accountCode: z
        .string()
        .optional()
        .describe("Analysis account code matching analysisCategoryId, for example BP01."),
      description: z.string().optional().describe("Analysis line description."),
      reference: z.string().optional(),
      discount: z.number().optional(),
    },
    async ({ companyName, ...args }) => {
      const entryDate = args.entryDate ?? todayIsoDate();
      const procDate = args.procDate ?? entryDate;
      const payload = buildPaymentPayload({ ...args, entryDate, procDate } as any);
      const response = await brcJsonRequest(companyName, "POST", "/v1/payments", payload);

      return jsonResponse({
        message: "Payment created using structured MCP fields.",
        companyName,
        endpoint: "POST /v1/payments",
        payloadSent: payload,
        response,
      });
    }
  );
  registerRawUpdateTool(server, "brc_update_payment", "Updates a BRC payment using merged fields.", "/v1/payments", "Payment");
  registerRawDeleteTool(server, "brc_delete_payment", "Deletes a BRC payment by id.", "/v1/payments", "payment");
  registerRawBatchTool(server, "brc_batch_payments", "Processes a batch of BRC payments.", "/v1/payments");
}
