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
  import{
    assertQuoteManualReferenceLengthOrThrow,
    buildQuoteCreatePayloadFromToolArgs,
    QUOTE_MANUAL_REFERENCE_DESCRIPTION,
    QUOTE_MANUAL_REFERENCE_MAX_LENGTH,
    QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE,
    SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION,
    SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION,
    enforceSalesProductLineAnalysisOrThrow,
  } from "../general/payloads_tools.js";
  import { loadAndEnforceReferenceSettings } from "../../guards/company_reference_settings.js";

  /** Shared Zod schema for manual Quote references (create/update). */
  export const quoteManualReferenceSchema = z
    .string()
    .max(QUOTE_MANUAL_REFERENCE_MAX_LENGTH, {
      message: QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE,
    });

  export const quoteManualReferenceFieldSchema =
    quoteManualReferenceSchema
      .optional()
      .describe(QUOTE_MANUAL_REFERENCE_DESCRIPTION);

  /**
   * Builds the PUT body for brc_update_quote: clone the current Quote from GET,
   * then apply only an explicit manual reference change. Quote.note is not
   * persisted by PUT /v1/quotes/{id}; do not advertise or patch note here.
   */
  export function buildQuoteReferenceUpdatePayload(
    current: JsonRecord,
    reference: string | undefined
  ): JsonRecord {
    assertQuoteManualReferenceLengthOrThrow(reference);
    const payload = cloneJson(current) as JsonRecord;
    if (reference !== undefined) {
      payload.reference = reference;
    }
    return payload;
  }

  /**
   * BRC body for POST /v1/quotes/generateSaleInvoice.
   * Only quoteId plus optional entryDate/procDate from the tool contract.
   * Do not add speculative date aliases (invoiceDate/transactionDate/date).
   */
  export function buildGenerateSalesInvoiceFromQuotePayload(args: {
    quoteId: number;
    entryDate?: string;
    procDate?: string;
  }): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      quoteId: args.quoteId,
    };

    if (args.entryDate) {
      payload.entryDate = args.entryDate;
      payload.procDate = args.procDate || args.entryDate;
    } else if (args.procDate) {
      payload.procDate = args.procDate;
    }

    return payload;
  }

  const SENSITIVE_QUOTE_PREVIEW_KEYS = new Set([
    "companyName",
    "routeToken",
    "connectionRef",
    "apiKey",
    "api_key",
    "credentials",
    "credential",
    "password",
    "authorization",
    "Authorization",
    "auth",
    "session",
    "sessionId",
    "mcpSessionId",
    "mcp_session_id",
  ]);

  function quoteRecordValue(
    quote: JsonRecord,
    ...keys: string[]
  ): unknown {
    for (const key of keys) {
      if (quote[key] !== undefined) {
        return quote[key];
      }
    }
    return undefined;
  }

  function isQuoteClosed(closedDate: unknown): boolean {
    if (closedDate === undefined || closedDate === null) {
      return false;
    }
    if (typeof closedDate === "string" && closedDate.trim() === "") {
      return false;
    }
    return true;
  }

  /**
   * Non-technical Quote delete preview built from the record already fetched
   * to obtain the delete timestamp. Does not copy auth/routing/session fields.
   */
  export function buildQuoteDeletePreview(
    quote: JsonRecord,
    timestamp: string
  ): Record<string, unknown> {
    const closedDate = quoteRecordValue(quote, "closedDate", "ClosedDate") ?? null;
    const preview: Record<string, unknown> = {
      id: quoteRecordValue(quote, "id", "Id") ?? null,
      reference: quoteRecordValue(quote, "reference", "Reference") ?? null,
      customer:
        quoteRecordValue(quote, "customerOwnerName", "CustomerOwnerName", "customer") ??
        null,
      customerOwnerName:
        quoteRecordValue(quote, "customerOwnerName", "CustomerOwnerName") ?? null,
      total: quoteRecordValue(quote, "total", "Total") ?? null,
      closedDate,
      state: isQuoteClosed(closedDate) ? "closed" : "open",
      saleInvoiceId: quoteRecordValue(quote, "saleInvoiceId", "SaleInvoiceId") ?? null,
      timestamp,
    };

    for (const key of SENSITIVE_QUOTE_PREVIEW_KEYS) {
      delete preview[key];
    }

    return preview;
  }

  /**
   * Surfaces a created Quote id only when BRC returned one directly.
   * Does not infer from references, payload fields, or HTTP status.
   */
  export function extractCreatedQuoteId(
    response: unknown
  ): number | string | undefined {
    if (typeof response === "number" && Number.isInteger(response) && response > 0) {
      return response;
    }

    if (!response || typeof response !== "object" || Array.isArray(response)) {
      return undefined;
    }

    const record = response as JsonRecord;
    const id = record.id ?? record.Id;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) {
      return id;
    }
    if (typeof id === "string") {
      const trimmed = id.trim();
      if (/^\d+$/.test(trimmed)) {
        const parsed = Number(trimmed);
        if (Number.isInteger(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  function quoteCreateStatus(response: unknown): unknown {
    if (response && typeof response === "object" && !Array.isArray(response)) {
      const record = response as JsonRecord;
      if (typeof record.statusCode === "number") {
        return record.statusCode;
      }
      if (typeof record.status === "number" || typeof record.status === "string") {
        return record.status;
      }
    }
    return "created";
  }

  export function buildQuoteCreateSuccessBody(args: {
    message: string;
    companyName: string;
    endpoint: string;
    payloadSent: unknown;
    response: unknown;
    referenceWarnings?: string[];
  }): Record<string, unknown> {
    const createdQuoteId = extractCreatedQuoteId(args.response);
    const body: Record<string, unknown> = {
      message: args.message,
      companyName: args.companyName,
      endpoint: args.endpoint,
      payloadSent: args.payloadSent,
      response: args.response,
      status: quoteCreateStatus(args.response),
    };

    if (createdQuoteId !== undefined) {
      body.createdQuoteId = createdQuoteId;
    }

    if (args.referenceWarnings && args.referenceWarnings.length > 0) {
      body.referenceWarnings = args.referenceWarnings;
    }

    return body;
  }

  export function describeQuotePostDeleteVerification(args: {
    deleteSucceeded: boolean;
    lookupOutcome:
      | "not_attempted"
      | "not_found"
      | "unexpected_error"
      | "still_present";
  }): string {
    if (!args.deleteSucceeded) {
      return "The quote was not deleted.";
    }

    switch (args.lookupOutcome) {
      case "not_found":
        return "The quote was deleted successfully and no longer appears when looked up by quote id.";
      case "still_present":
        return "The quote delete succeeded, but the quote still appears when looked up by quote id. Check the quote list by quote id.";
      case "unexpected_error":
        return "The quote was deleted successfully. A follow-up lookup returned an unexpected error, so that check is inconclusive. Confirm by listing quotes and looking for this quote id. Do not use the quote reference alone, because references are not necessarily unique.";
      case "not_attempted":
      default:
        return "The quote was deleted successfully. If you need to double-check, look for this quote id in the quote list. A later lookup error is not proof that deletion failed. Do not use the quote reference alone, because references are not necessarily unique.";
    }
  }

  const QUOTE_DELETE_PREVIEW_MESSAGE = [
    "Red stopped before deleting this quote because explicit confirmation is required.",
    "",
    "This is a preview only. Nothing has been deleted.",
    "",
    "Show the user the quote details from the preview: id, reference, customer, total, whether it is open or closed, any linked sales invoice, and timestamp.",
    "Do not look the quote up again just to describe it — these details already come from the quote loaded for deletion.",
    "",
    "Only call this tool again with confirmWrite: true after the user explicitly confirms, for example: \"yes, delete it\".",
  ].join("\n");

  function isQuoteDeleteConfirmed(args: {
    confirmDelete?: boolean;
    confirmWrite?: boolean;
  }): boolean {
    return args.confirmDelete === true || args.confirmWrite === true;
  }

  export function registerQuoteTools(server:ServerType){

// Quote tools ----------------------------------------------------------------

const quoteSchemaBase = {
    companyName: companyNameSchema,
    companyId: z
      .number()
      .int()
      .positive()
      .describe(
        "Required BRC company id for the quote payload. Use the connected company's id from existing records such as customers, products, or sales reps. Do not omit this field."
      ),
    customerOwnerId: z.number().int().positive(),
    acCode: z.string(),
    customerOwnerName: z.string(),
    comments: z.string(),
    entryDate: z.string(),
    procDate: z.string(),
    vatTypeId: z.number().int().positive().optional(),
    saleRepId: z.number().int().positive().describe("Sales rep id from brc_list_sales_reps."),
    saleRepCode: z.string().min(1).describe("Sales rep code from brc_list_sales_reps."),
    reference: quoteManualReferenceFieldSchema,
    poNumber: z.string().optional(),
    ddNumber: z.string().optional(),
    confirmQuotesAutoGenerateInBrc: z
      .boolean()
      .optional()
      .describe(
        "Set true only after the user confirms quotes are auto-generated in Big Red Cloud. Required for brc_create_quote_gen_ref when Quotes reference setting is Unknown."
      ),
    layoutType: z.number().int().positive().optional(),
    productId: z.number().int().positive(),
    productCode: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    vatRateId: z.number().int().positive(),
    vatPercentage: z.number(),
    tranNote: z.string(),
    analysisCategoryId: z.number().int().positive(),
    accountCode: z.string().min(1).describe("Sales Analysis account code for the quote product line, for example SA01."),
    confirmCrAnalysisCategory: z
      .boolean()
      .optional()
      .describe(
        "Set true only after the user confirms a CR sales analysis account code is intentional for this product line."
      ),
  };
  
  server.tool(
    "brc_create_quote",
    `Creates a BRC quote using structured MCP fields. Requires a quote reference when quote references are manual or unknown. Do not use when Quotes reference setting is Unknown unless the user has provided a quote reference. Previews before posting include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. Nothing is written to Big Red Cloud until you confirm. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION}`,
    quoteSchemaBase,
    async ({ companyName, confirmQuotesAutoGenerateInBrc: _confirmQuotesAutoGenerateInBrc, confirmCrAnalysisCategory, ...args }) => {
      let payload: unknown;
      try {
        const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
          String(companyName),
          "quote",
          {
            reference: args.reference,
            poNumber: args.poNumber,
            ddNumber: args.ddNumber,
          },
          "manual"
        );
        payload = buildQuoteCreatePayloadFromToolArgs(args as Record<string, unknown>);
        enforceSalesProductLineAnalysisOrThrow(payload, "quote", {
          confirmCrAnalysisCategory,
        });
        const createResponse = await brcJsonRequest(companyName, "POST", "/v1/quotes", payload);
        return jsonResponse(
          buildQuoteCreateSuccessBody({
            message: "Quote created using structured MCP fields.",
            companyName,
            endpoint: "POST /v1/quotes",
            payloadSent: payload,
            response: createResponse,
            referenceWarnings,
          })
        );
      } catch (error) {
        return jsonResponse({ message: "Error creating quote.", companyName, endpoint: "POST /v1/quotes", payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );
  
  server.tool(
    "brc_create_quote_gen_ref",
    `Creates a BRC quote with a generated reference using structured MCP fields. Use only when quote references are auto-generated in Big Red Cloud, or when the user has confirmed auto-generate after Quotes reference setting was Unknown. Previews before posting include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. Nothing is written to Big Red Cloud until you confirm. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION}`,
    quoteSchemaBase,
    async ({ companyName, confirmQuotesAutoGenerateInBrc, confirmCrAnalysisCategory, ...args }) => {
      let payload: unknown;
      try {
        const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(
          String(companyName),
          "quote",
          {
            reference: args.reference,
            poNumber: args.poNumber,
            ddNumber: args.ddNumber,
          },
          "generated",
          { userConfirmedAutoGenerate: confirmQuotesAutoGenerateInBrc }
        );
        payload = buildQuoteCreatePayloadFromToolArgs(args as Record<string, unknown>);
        enforceSalesProductLineAnalysisOrThrow(payload, "quote", {
          confirmCrAnalysisCategory,
        });
        const createResponse = await brcJsonRequest(companyName, "POST", "/v1/quotes/createQuoteWithGeneratingReference", payload);
        return jsonResponse(
          buildQuoteCreateSuccessBody({
            message: "Quote created with a generated reference using structured MCP fields.",
            companyName,
            endpoint: "POST /v1/quotes/createQuoteWithGeneratingReference",
            payloadSent: payload,
            response: createResponse,
            referenceWarnings,
          })
        );
      } catch (error) {
        return jsonResponse({ message: "Error creating quote with a generated reference.", companyName, endpoint: "POST /v1/quotes/createQuoteWithGeneratingReference", payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );
  
  server.tool(
    "brc_update_quote",
    "Updates a BRC quote's manual reference only. Quote.note is not persisted by this update and is not accepted here. Loads the current quote, preserves all other fields (including timestamp, product lines, analysis entries, totals, customer, sales rep, dates, comments, and closed state), applies the new reference, then PUTs the full record. Manual quote references must be 6 characters or fewer because Big Red Cloud truncates longer references.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Quote id."),
      reference: quoteManualReferenceFieldSchema,
    },
    async ({ companyName, id, reference }) => {
      const current = await brcFetch(companyName, `/v1/quotes/${encodeURIComponent(id)}`);
      if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error(`Could not read quote ${id} before update.`);
      const payload = buildQuoteReferenceUpdatePayload(current as JsonRecord, reference);
      const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/quotes/${encodeURIComponent(id)}`, payload);
      const verification = await brcFetch(companyName, `/v1/quotes/${encodeURIComponent(id)}`);
      return jsonResponse({ message: "Quote reference updated using structured MCP fields.", companyName, payloadSent: payload, updateResponse, verification });
    }
  );
  
  server.tool(
    "brc_close_quote",
    "Closes a BRC quote.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Quote id."),
    },
    async ({ companyName, id }) => {
      const data = await brcJsonRequest(companyName, "PUT", `/v1/quotes/close/${encodeURIComponent(id)}`);
      return jsonResponse(data);
    }
  );
  
  server.tool(
    "brc_reopen_quote",
    "Reopens a BRC quote.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Quote id."),
    },
    async ({ companyName, id }) => {
      const data = await brcJsonRequest(companyName, "PUT", `/v1/quotes/reopen/${encodeURIComponent(id)}`);
      return jsonResponse(data);
    }
  );
  
  server.tool(
    "brc_delete_quote",
    "Deletes a BRC quote by id using timestamp confirmation. Loads the quote once to obtain its timestamp and to preview id, reference, customer, total, open or closed state, any linked sales invoice, and timestamp before asking for confirmation. A successful delete is the result; if a later lookup by quote id returns an unexpected error, treat that check as inconclusive rather than as a failed delete. Confirm remaining quotes from the quote list by quote id — quote references are not necessarily unique.",
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe("Quote id."),
      confirmDelete: z.boolean().default(false),
    },
    async ({ companyName, id, confirmDelete, ...rest }) => {
      const quote = await brcFetch(companyName, `/v1/quotes/${encodeURIComponent(id)}`);
      if (!quote || typeof quote !== "object" || Array.isArray(quote)) throw new Error(`Could not read quote ${id} before deletion.`);
      const timestamp = getTimestampFromRecord(quote as JsonRecord, `quote ${id}`);
      const payloadPreview = buildQuoteDeletePreview(quote as JsonRecord, timestamp);

      if (
        !isQuoteDeleteConfirmed({
          confirmDelete,
          confirmWrite: (rest as { confirmWrite?: boolean }).confirmWrite,
        })
      ) {
        return jsonResponse({
          status: "confirmation_required",
          confirmationRequired: true,
          message: QUOTE_DELETE_PREVIEW_MESSAGE,
          toolName: "brc_delete_quote",
          companyName,
          proposedAction: "deleting this record",
          draftFieldsToShow: [
            "company",
            "quote id",
            "reference",
            "customer",
            "total",
            "open or closed",
            "linked sales invoice if any",
            "timestamp",
          ],
          endpoint: `DELETE /v1/quotes/${id}`,
          payloadPreview,
          confirmationField: "confirmWrite",
          preflightPassedIsNotConfirmation: true,
        });
      }

      const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/quotes/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
      return jsonResponse({
        deleted: true,
        companyName,
        id,
        timestampUsed: timestamp,
        deleteResponse,
        message: describeQuotePostDeleteVerification({
          deleteSucceeded: true,
          lookupOutcome: "not_attempted",
        }),
      });
    }
  );
  server.tool(
    "brc_generate_sales_invoice_from_quote",
    "Generates a sales invoice from a BRC quote. Preview-before-posting shows the exact POST /v1/quotes/generateSaleInvoice body (quoteId and optional entryDate/procDate only). Nothing is written until you confirm.",
    {
      companyName: companyNameSchema,
      quoteId: z.number().int().positive().describe("Quote id."),
      entryDate: z.string().optional().describe("Optional invoice entry date in ISO format."),
      procDate: z.string().optional().describe("Optional invoice processing date in ISO format."),
    },
    async ({ companyName, quoteId, entryDate, procDate }) => {
      const payload = buildGenerateSalesInvoiceFromQuotePayload({
        quoteId,
        entryDate,
        procDate,
      });

      const response = await brcJsonRequest(
        companyName,
        "POST",
        "/v1/quotes/generateSaleInvoice",
        payload
      );

      return jsonResponse({
        message: "Generate sales invoice from quote request sent.",
        companyName,
        endpoint: "POST /v1/quotes/generateSaleInvoice",
        payloadSent: payload,
        response,
      });
    }
  );
}