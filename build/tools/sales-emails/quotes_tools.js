import { z } from "zod";
import { brcFetch, brcJsonRequest, cloneJson, companyNameSchema, getTimestampFromRecord, jsonResponse, } from "../../shared.js";
import { assertQuoteManualReferenceLengthOrThrow, buildQuoteCreatePayloadFromToolArgs, QUOTE_MANUAL_REFERENCE_DESCRIPTION, QUOTE_MANUAL_REFERENCE_MAX_LENGTH, QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE, SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION, SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION, enforceSalesProductLineAnalysisOrThrow, } from "../general/payloads_tools.js";
import { loadAndEnforceReferenceSettings } from "../../guards/company_reference_settings.js";
/** Shared Zod schema for manual Quote references (create/update). */
export const quoteManualReferenceSchema = z
    .string()
    .max(QUOTE_MANUAL_REFERENCE_MAX_LENGTH, {
    message: QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE,
});
export const quoteManualReferenceFieldSchema = quoteManualReferenceSchema
    .optional()
    .describe(QUOTE_MANUAL_REFERENCE_DESCRIPTION);
/**
 * Builds the PUT body for brc_update_quote: clone the current Quote from GET,
 * then apply only an explicit manual reference change. Staging proved Quote.note
 * is not persisted by PUT /v1/quotes/{id}; do not advertise or patch note here.
 */
export function buildQuoteReferenceUpdatePayload(current, reference) {
    assertQuoteManualReferenceLengthOrThrow(reference);
    const payload = cloneJson(current);
    if (reference !== undefined) {
        payload.reference = reference;
    }
    return payload;
}
export function registerQuoteTools(server) {
    // Quote tools ----------------------------------------------------------------
    const quoteSchemaBase = {
        companyName: companyNameSchema,
        companyId: z
            .number()
            .int()
            .positive()
            .describe("Required BRC company id for the quote payload. Use the connected company's id from existing records such as customers, products, or sales reps. Do not omit this field."),
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
            .describe("Set true only after the user confirms quotes are auto-generated in Big Red Cloud. Required for brc_create_quote_gen_ref when Quotes reference setting is Unknown."),
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
            .describe("Set true only after the user confirms a CR sales analysis account code is intentional for this product line."),
    };
    server.tool("brc_create_quote", `Creates a BRC quote using structured MCP fields. Requires a quote reference when quote references are manual or unknown. Do not use when Quotes reference setting is Unknown unless the user has provided a quote reference. Previews before posting include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. Nothing is written to Big Red Cloud until you confirm. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION}`, quoteSchemaBase, async ({ companyName, confirmQuotesAutoGenerateInBrc: _confirmQuotesAutoGenerateInBrc, confirmCrAnalysisCategory, ...args }) => {
        let payload;
        try {
            const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(String(companyName), "quote", {
                reference: args.reference,
                poNumber: args.poNumber,
                ddNumber: args.ddNumber,
            }, "manual");
            payload = buildQuoteCreatePayloadFromToolArgs(args);
            enforceSalesProductLineAnalysisOrThrow(payload, "quote", {
                confirmCrAnalysisCategory,
            });
            const createResponse = await brcJsonRequest(companyName, "POST", "/v1/quotes", payload);
            return jsonResponse({ message: "Quote created using structured MCP fields.", companyName, payloadSent: payload, referenceWarnings: referenceWarnings.length > 0 ? referenceWarnings : undefined, createResponse });
        }
        catch (error) {
            return jsonResponse({ message: "Error creating quote.", companyName, endpoint: "POST /v1/quotes", payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
        }
    });
    server.tool("brc_create_quote_gen_ref", `Creates a BRC quote with a generated reference using structured MCP fields. Use only when quote references are auto-generated in Big Red Cloud, or when the user has confirmed auto-generate after Quotes reference setting was Unknown. Previews before posting include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. Nothing is written to Big Red Cloud until you confirm. ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION}`, quoteSchemaBase, async ({ companyName, confirmQuotesAutoGenerateInBrc, confirmCrAnalysisCategory, ...args }) => {
        let payload;
        try {
            const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(String(companyName), "quote", {
                reference: args.reference,
                poNumber: args.poNumber,
                ddNumber: args.ddNumber,
            }, "generated", { userConfirmedAutoGenerate: confirmQuotesAutoGenerateInBrc });
            payload = buildQuoteCreatePayloadFromToolArgs(args);
            enforceSalesProductLineAnalysisOrThrow(payload, "quote", {
                confirmCrAnalysisCategory,
            });
            const createResponse = await brcJsonRequest(companyName, "POST", "/v1/quotes/createQuoteWithGeneratingReference", payload);
            return jsonResponse({ message: "Quote created with a generated reference using structured MCP fields.", companyName, payloadSent: payload, referenceWarnings: referenceWarnings.length > 0 ? referenceWarnings : undefined, createResponse });
        }
        catch (error) {
            return jsonResponse({ message: "Error creating quote with a generated reference.", companyName, endpoint: "POST /v1/quotes/createQuoteWithGeneratingReference", payloadSent: payload ?? null, error: error instanceof Error ? error.message : String(error) });
        }
    });
    server.tool("brc_update_quote", "Updates a BRC quote's manual reference only. Staging has proven Quote.reference is writable via PUT /v1/quotes/{id}; Quote.note is not persisted by this endpoint and is not accepted here. Loads the current quote, preserves all other fields (including timestamp, product lines, analysis entries, totals, customer, sales rep, dates, comments, and closed state), applies the new reference, then PUTs the full record. Manual quote references must be 6 characters or fewer because Big Red Cloud truncates longer references.", {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe("Quote id."),
        reference: quoteManualReferenceFieldSchema,
    }, async ({ companyName, id, reference }) => {
        const current = await brcFetch(companyName, `/v1/quotes/${encodeURIComponent(id)}`);
        if (!current || typeof current !== "object" || Array.isArray(current))
            throw new Error(`Could not read quote ${id} before update.`);
        const payload = buildQuoteReferenceUpdatePayload(current, reference);
        const updateResponse = await brcJsonRequest(companyName, "PUT", `/v1/quotes/${encodeURIComponent(id)}`, payload);
        const verification = await brcFetch(companyName, `/v1/quotes/${encodeURIComponent(id)}`);
        return jsonResponse({ message: "Quote reference updated using structured MCP fields.", companyName, payloadSent: payload, updateResponse, verification });
    });
    server.tool("brc_close_quote", "Closes a BRC quote.", {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe("Quote id."),
    }, async ({ companyName, id }) => {
        const data = await brcJsonRequest(companyName, "PUT", `/v1/quotes/close/${encodeURIComponent(id)}`);
        return jsonResponse(data);
    });
    server.tool("brc_reopen_quote", "Reopens a BRC quote.", {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe("Quote id."),
    }, async ({ companyName, id }) => {
        const data = await brcJsonRequest(companyName, "PUT", `/v1/quotes/reopen/${encodeURIComponent(id)}`);
        return jsonResponse(data);
    });
    server.tool("brc_delete_quote", "Deletes a BRC quote by id using timestamp confirmation.", {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe("Quote id."),
        confirmDelete: z.boolean().default(false),
    }, async ({ companyName, id, confirmDelete }) => {
        if (!confirmDelete)
            throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
        const quote = await brcFetch(companyName, `/v1/quotes/${encodeURIComponent(id)}`);
        if (!quote || typeof quote !== "object" || Array.isArray(quote))
            throw new Error(`Could not read quote ${id} before deletion.`);
        const timestamp = getTimestampFromRecord(quote, `quote ${id}`);
        const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/quotes/${encodeURIComponent(id)}?timestamp=${encodeURIComponent(timestamp)}`);
        return jsonResponse({ deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
    });
    server.tool("brc_generate_sales_invoice_from_quote", "Generates a sales invoice from a BRC quote.", {
        companyName: companyNameSchema,
        quoteId: z.number().int().positive().describe("Quote id."),
        entryDate: z.string().optional().describe("Optional invoice entry date in ISO format."),
        procDate: z.string().optional().describe("Optional invoice processing date in ISO format."),
    }, async ({ companyName, quoteId, entryDate, procDate }) => {
        const payload = { quoteId };
        if (entryDate) {
            payload.entryDate = entryDate;
            payload.procDate = procDate || entryDate;
            // Extra date aliases in case BRC expects a different generated-invoice date field.
            payload.invoiceDate = entryDate;
            payload.transactionDate = entryDate;
            payload.date = entryDate;
        }
        else if (procDate) {
            payload.procDate = procDate;
            payload.invoiceDate = procDate;
            payload.transactionDate = procDate;
            payload.date = procDate;
        }
        const response = await brcJsonRequest(companyName, "POST", "/v1/quotes/generateSaleInvoice", payload);
        return jsonResponse({
            message: "Generate sales invoice from quote request sent.",
            companyName,
            payloadSent: payload,
            response,
        });
    });
}
