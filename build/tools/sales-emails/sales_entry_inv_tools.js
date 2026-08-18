import { z } from "zod";
import { brcFetch, brcJsonRequest, cloneJson, companyNameSchema, getTimestampFromRecord, jsonResponse, round2, } from "../../shared.js";
import { buildSalesInvoicePayload, buildSimpleSalesEntryPayload, resolveSalesInvoiceVatTypeId, SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION, SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION, SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION, SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION, SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION, SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION, SALES_DOCUMENT_NOTE_DESCRIPTION, SALES_DOCUMENT_CUSTOMER_NAME_DESCRIPTION, SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION, SALES_DOCUMENT_REFERENCE_DESCRIPTION, SALES_DOCUMENT_PRODUCT_LINE_DESCRIPTION_DESCRIPTION, SALES_DOCUMENT_PRODUCT_FIELDS_DESCRIPTION, SALES_DOCUMENT_RAW_PAYLOAD_STRUCTURE_DESCRIPTION, applySalesPriceBasisToRawPayload, enforceSalesProductLineAnalysisOrThrow, enforceSalesProductLineProductIdOrThrow, requireSalesRepInPayload } from "../general/payloads_tools.js";
import { buildSalesInvoiceGenRefValidationFailureBody, generatedReferenceSalesInvoicePayloadObjectSchema, validateGeneratedReferenceSalesInvoicePayload, } from "./sales_invoice_payload_schemas.js";
import { getTransactionSafetyWarnings, loadAndEnforceTransactionSettings, } from "../../guards/company_processing_settings.js";
import { loadAndEnforceReferenceSettings } from "../../guards/company_reference_settings.js";
import { enforceSalesVatCategoryOrThrow } from "../../guards/sales_vat_category.js";
import { resolveCustomerVatType } from "../../guards/customer_vat_type.js";
import { runWithActiveConnectionRef } from "../../shared.js";
import { extractConnectionRefFromToolArgs } from "../../auth/connection_ref.js";
const defaultCreateSalesInvoiceGenRefDeps = {
    brcJsonRequest,
    resolveCustomerVatType,
    loadAndEnforceTransactionSettings,
    loadAndEnforceReferenceSettings,
    enforceSalesVatCategoryOrThrow,
};
/**
 * Core handler for brc_create_sales_invoice_gen_ref. Exported for unit tests
 * so brcJsonRequest can be stubbed when payload validation fails.
 *
 * Never throws for payload validation failures — returns an MCP jsonResponse
 * with valid:false and field errors so the connector does not surface a
 * generic "server isn't responding" failure.
 */
export async function createSalesInvoiceWithGeneratingReference(args, deps = defaultCreateSalesInvoiceGenRefDeps) {
    const { companyName, payload, priceBasis, confirmCrAnalysisCategory } = args;
    const connectionRef = args.connectionRef?.trim() || undefined;
    const run = async () => {
        try {
            const finalPayload = applySalesPriceBasisToRawPayload(payload, priceBasis);
            const validation = validateGeneratedReferenceSalesInvoicePayload(finalPayload);
            if (!validation.valid) {
                return jsonResponse(buildSalesInvoiceGenRefValidationFailureBody(companyName, validation.errors));
            }
            // Default the invoice VAT type from the selected customer (BRC manual
            // entry behaviour) only when the raw payload did not already supply a
            // valid vatTypeId. An explicit vatTypeId in the payload is respected. VAT
            // rate / percentage selection is unchanged.
            const existingVatTypeId = Number(finalPayload.vatTypeId);
            if (!(Number.isFinite(existingVatTypeId) && existingVatTypeId > 0)) {
                const customerVatType = await deps.resolveCustomerVatType(String(companyName), finalPayload.customerId);
                finalPayload.vatTypeId = resolveSalesInvoiceVatTypeId(customerVatType);
            }
            requireSalesRepInPayload(finalPayload);
            enforceSalesProductLineProductIdOrThrow(finalPayload);
            await deps.enforceSalesVatCategoryOrThrow(String(companyName), finalPayload);
            enforceSalesProductLineAnalysisOrThrow(finalPayload, "sales_invoice", {
                confirmCrAnalysisCategory,
            });
            const processingSettings = await deps.loadAndEnforceTransactionSettings(String(companyName), "sales_invoice", finalPayload, { priceBasis });
            const { warnings: referenceWarnings } = await deps.loadAndEnforceReferenceSettings(String(companyName), "sales_invoice", finalPayload, "generated");
            const settingsWarnings = [
                ...getTransactionSafetyWarnings(processingSettings, "sales_invoice"),
                ...referenceWarnings,
            ];
            const response = await deps.brcJsonRequest(companyName, "POST", "/v1/salesInvoices/createSaleInvoiceWithGeneratingReference", finalPayload);
            return jsonResponse({
                message: "Sales invoice created with generated reference.",
                companyName,
                payloadSent: finalPayload,
                settingsWarnings: settingsWarnings.length > 0 ? settingsWarnings : undefined,
                response,
            });
        }
        catch (error) {
            return jsonResponse({
                message: "Error creating sales invoice with generated reference.",
                companyName,
                valid: false,
                errors: [
                    {
                        field: "(root)",
                        message: error instanceof Error ? error.message : String(error),
                    },
                ],
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };
    if (connectionRef) {
        return runWithActiveConnectionRef(connectionRef, run);
    }
    return run();
}
export function registerSalesEntryInvoiceTools(server) {
    // Sales entry tools ----------------------------------------------------------
    server.tool("brc_create_sales_entry", "Creates a BRC sales entry using structured MCP fields.", {
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
    }, async ({ companyName, customerId, acCode, note, entryDate, procDate, bookTranTypeId, analysisCategoryId, accountCode, description, netAmount, vatRateId, vatPercentage }) => {
        const payload = buildSimpleSalesEntryPayload({ ownerId: customerId, ownerField: "customerId", acCode, note, entryDate, procDate, bookTranTypeId, analysisCategoryId, accountCode, description, netAmount, vatRateId, vatPercentage });
        let createResponse;
        try {
            createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesEntries", payload);
        }
        catch (error) {
            return jsonResponse({
                success: false,
                message: "Error creating sales entry using structured MCP fields.",
                companyName,
                valid: false,
                errors: [
                    {
                        field: "(root)",
                        message: error instanceof Error ? error.message : String(error),
                    },
                ],
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return jsonResponse({ message: "Sales entry created using structured MCP fields.", companyName, payloadSent: payload, createResponse });
    });
    server.tool("brc_update_sales_entry", [
        "Updates an existing BRC Sales Entry.",
        "Supports text/reference changes, transaction dates, customer/account fields, and complete monetary/accounting update attempts.",
        "Historical Sales Entries are not automatically blocked because they belong to an earlier financial year.",
        "The BRC API is the source of truth for whether a requested historical change is permitted.",
        "A note/reference-only update may be performed without supplying monetary fields.",
        "For monetary changes, provide totalNet, totalVAT, total, acEntries and vatEntries together so Red can validate the accounting values before sending the update.",
        "Do not manually change unpaid; Red preserves the existing BRC value.",
    ].join(" "), {
        companyName: companyNameSchema,
        id: z
            .union([z.string(), z.number()])
            .describe("Sales Entry id, normally the bookTranId returned by customer account transactions."),
        note: z
            .string()
            .optional()
            .describe(SALES_DOCUMENT_NOTE_DESCRIPTION),
        reference: z
            .string()
            .optional()
            .describe(SALES_DOCUMENT_REFERENCE_DESCRIPTION),
        details: z
            .string()
            .optional()
            .describe("Sales Entry details/description field."),
        entryDate: z
            .string()
            .optional()
            .describe("Entry date in ISO format. Historical dates may be attempted; BRC determines whether the change is permitted."),
        procDate: z
            .string()
            .optional()
            .describe("Processing date in ISO format. Historical dates may be attempted; BRC determines whether the change is permitted."),
        customerId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Customer id."),
        acCode: z
            .string()
            .optional()
            .describe("Customer account code."),
        bookTranTypeId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Book transaction type id. Sales Entries normally use the existing record's transaction type."),
        vatTypeId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("VAT type id."),
        totalNet: z
            .number()
            .optional()
            .describe("New total net value. For monetary edits this must be supplied together with totalVAT, total, acEntries and vatEntries."),
        totalVAT: z
            .number()
            .optional()
            .describe("New total VAT value. For monetary edits this must be supplied together with totalNet, total, acEntries and vatEntries."),
        total: z
            .number()
            .optional()
            .describe("New gross total. For monetary edits this must equal totalNet + totalVAT."),
        acEntries: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe("Complete BRC accounting-entry collection. For monetary edits, the sum of each entry's value must equal totalNet."),
        vatEntries: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe("Complete BRC VAT-entry collection. Each entry should contain the BRC vatRateId, percentage and net amount used to calculate VAT."),
    }, async ({ companyName, id, note, reference, details, entryDate, procDate, customerId, acCode, bookTranTypeId, vatTypeId, totalNet, totalVAT, total, acEntries, vatEntries, }) => {
        const endpoint = `/v1/salesEntries/${encodeURIComponent(String(id))}`;
        const current = await brcFetch(companyName, endpoint);
        if (!current ||
            typeof current !== "object" ||
            Array.isArray(current)) {
            throw new Error(`Could not read sales entry ${id} before update.`);
        }
        const payload = cloneJson(current);
        // Non-monetary/text fields.
        if (note !== undefined) {
            payload.note = note;
        }
        if (reference !== undefined) {
            payload.reference = reference;
        }
        if (details !== undefined) {
            payload.details = details;
        }
        if (entryDate !== undefined) {
            payload.entryDate = entryDate;
        }
        if (procDate !== undefined) {
            payload.procDate = procDate;
        }
        if (customerId !== undefined) {
            payload.customerId = customerId;
        }
        if (acCode !== undefined) {
            payload.acCode = acCode;
        }
        if (bookTranTypeId !== undefined) {
            payload.bookTranTypeId = bookTranTypeId;
        }
        if (vatTypeId !== undefined) {
            payload.vatTypeId = vatTypeId;
        }
        const monetaryEditRequested = totalNet !== undefined ||
            totalVAT !== undefined ||
            total !== undefined ||
            acEntries !== undefined ||
            vatEntries !== undefined;
        if (monetaryEditRequested) {
            if (totalNet === undefined ||
                totalVAT === undefined ||
                total === undefined ||
                acEntries === undefined ||
                vatEntries === undefined) {
                throw new Error("Monetary Sales Entry updates require totalNet, totalVAT, total, acEntries and vatEntries together so Red does not send an incomplete accounting payload to BRC.");
            }
            const expectedTotal = round2(totalNet + totalVAT);
            if (Math.abs(round2(total) - expectedTotal) > 0.01) {
                throw new Error(`Sales Entry total ${total} does not equal totalNet ${totalNet} + totalVAT ${totalVAT} (${expectedTotal}).`);
            }
            const calculatedAcTotal = round2(acEntries.reduce((sum, entry) => {
                const value = entry.value;
                if (typeof value !== "number") {
                    throw new Error("Each acEntries item must contain a numeric value.");
                }
                return sum + value;
            }, 0));
            if (Math.abs(calculatedAcTotal - round2(totalNet)) > 0.01) {
                throw new Error(`acEntries total ${calculatedAcTotal} does not equal totalNet ${totalNet}.`);
            }
            const calculatedVatTotal = round2(vatEntries.reduce((sum, entry) => {
                const amount = entry.amount;
                const percentage = entry.percentage;
                if (typeof amount !== "number" ||
                    typeof percentage !== "number") {
                    throw new Error("Each vatEntries item must contain numeric amount and percentage values.");
                }
                return sum + round2(amount * (percentage / 100));
            }, 0));
            if (Math.abs(calculatedVatTotal - round2(totalVAT)) > 0.01) {
                throw new Error(`VAT entries calculate to ${calculatedVatTotal}, which does not equal totalVAT ${totalVAT}.`);
            }
            payload.totalNet = round2(totalNet);
            payload.totalVAT = round2(totalVAT);
            payload.total = round2(total);
            payload.acEntries = acEntries;
            payload.vatEntries = vatEntries;
            // Do not manually modify payload.unpaid.
            // Its existing value from BRC is preserved.
        }
        try {
            const updateResponse = await brcJsonRequest(companyName, "PUT", endpoint, payload);
            const verification = await brcFetch(companyName, endpoint);
            return jsonResponse({
                success: true,
                message: "Sales Entry updated using structured MCP fields.",
                companyName,
                id,
                endpoint: `PUT ${endpoint}`,
                historicalDateAttempt: entryDate !== undefined ||
                    procDate !== undefined
                    ? {
                        entryDate: payload.entryDate,
                        procDate: payload.procDate,
                    }
                    : undefined,
                monetaryEditAttempted: monetaryEditRequested,
                payloadSent: payload,
                updateResponse,
                verification,
            });
        }
        catch (error) {
            return jsonResponse({
                success: false,
                message: "BRC rejected the Sales Entry update. Red attempted the requested change and this response came from the BRC endpoint.",
                companyName,
                id,
                endpoint: `PUT ${endpoint}`,
                requestedEntryDate: entryDate ?? undefined,
                requestedProcDate: procDate ?? undefined,
                monetaryEditAttempted: monetaryEditRequested,
                error: error instanceof Error
                    ? error.message
                    : String(error),
            });
        }
    });
    server.tool("brc_delete_sales_entry", "Deletes a BRC sales entry by id using timestamp confirmation.", {
        companyName: companyNameSchema,
        id: z.number().int().positive().describe("Sales entry id."),
        confirmDelete: z.boolean().default(false),
    }, async ({ companyName, id, confirmDelete }) => {
        if (!confirmDelete)
            throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
        const salesEntry = await brcFetch(companyName, `/v1/salesEntries/${encodeURIComponent(id)}`);
        if (!salesEntry || typeof salesEntry !== "object" || Array.isArray(salesEntry))
            throw new Error(`Could not read sales entry ${id} before deletion.`);
        const timestamp = getTimestampFromRecord(salesEntry, `sales entry ${id}`);
        try {
            const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/salesEntries/${encodeURIComponent(String(id))}?timestamp=${encodeURIComponent(timestamp)}`);
            return jsonResponse({
                success: true,
                deleted: true,
                companyName,
                id,
                timestampUsed: timestamp,
                deleteResponse,
            });
        }
        catch (error) {
            return jsonResponse({
                success: false,
                deleted: false,
                companyName,
                id,
                endpoint: `DELETE /v1/salesEntries/${id}`,
                error: error instanceof Error
                    ? error.message
                    : String(error),
            });
        }
    });
    // Sales invoice tools --------------------------------------------------------
    server.tool("brc_create_sales_invoice", `Creates a BRC sales invoice using structured MCP fields. Requires a reference when the company is configured for manual sales references; otherwise prefer brc_create_sales_invoice_gen_ref. Previews before posting include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. Nothing is written to Big Red Cloud until you confirm. ${SALES_DOCUMENT_NOTE_DESCRIPTION} ${SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION} ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION} ${SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`, {
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
            .describe("Set true only after the user confirms a CR sales analysis account code is intentional for this product line."),
    }, async ({ companyName, confirmCrAnalysisCategory, ...args }) => {
        let payload;
        try {
            // Default the invoice VAT type from the selected customer (BRC manual
            // entry behaviour). VAT rate / percentage selection is unchanged.
            const customerVatType = await resolveCustomerVatType(String(companyName), args.customerId);
            payload = buildSalesInvoicePayload({ ...args, customerVatType });
            enforceSalesProductLineProductIdOrThrow(payload);
            await enforceSalesVatCategoryOrThrow(String(companyName), payload);
            enforceSalesProductLineAnalysisOrThrow(payload, "sales_invoice", {
                confirmCrAnalysisCategory,
            });
            const processingSettings = await loadAndEnforceTransactionSettings(String(companyName), "sales_invoice", payload, { priceBasis: args.priceBasis });
            const { warnings: referenceWarnings } = await loadAndEnforceReferenceSettings(String(companyName), "sales_invoice", payload, "manual");
            const settingsWarnings = [
                ...getTransactionSafetyWarnings(processingSettings, "sales_invoice"),
                ...referenceWarnings,
            ];
            const createResponse = await brcJsonRequest(companyName, "POST", "/v1/salesInvoices", payload);
            return jsonResponse({
                message: "Sales invoice created using structured MCP fields.",
                companyName,
                payloadSent: payload,
                settingsWarnings: settingsWarnings.length > 0 ? settingsWarnings : undefined,
                createResponse,
            });
        }
        catch (error) {
            return jsonResponse({
                message: "Error creating sales invoice.",
                companyName,
                endpoint: "POST /v1/salesInvoices",
                inputArgs: args,
                payloadSent: payload ?? null,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    server.tool("brc_create_sales_invoice_gen_ref", `Creates a BRC sales invoice with an auto-generated reference using a raw BRC payload. Use when the company is configured for auto-generated sales references. Previews before posting include a Missing or not provided section for blank customer phone or email only — warnings only, do not invent values. Nothing is written to Big Red Cloud until you confirm. In the raw payload, the BRC "Note" field (JSON \`note\`) defaults to the customer name (BRC customer "Name" / JSON \`name\`) when omitted and must never be set to the product name; the BRC "Delivery To" address (JSON \`deliveryTo\`) is only included when explicitly provided. ${SALES_DOCUMENT_RAW_PAYLOAD_STRUCTURE_DESCRIPTION} ${SALES_DOCUMENT_NOTE_DESCRIPTION} ${SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION} ${SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION} ${SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION} ${SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`, {
        companyName: companyNameSchema,
        // Structural schema documents BRC fields for the model. Cross-field
        // reconciliation runs via safeParse after applySalesPriceBasisToRawPayload
        // so priceBasis can set useTaxInclusiveUnitPrice before those checks, and
        // so validation failures return a structured valid:false response.
        payload: generatedReferenceSalesInvoicePayloadObjectSchema.describe(SALES_DOCUMENT_RAW_PAYLOAD_STRUCTURE_DESCRIPTION),
        priceBasis: z
            .enum(["net", "gross"])
            .optional()
            .describe(SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION),
        confirmCrAnalysisCategory: z
            .boolean()
            .optional()
            .describe("Set true only after the user confirms a CR sales analysis account code is intentional for this product line."),
    }, async (args) => createSalesInvoiceWithGeneratingReference({
        companyName: String(args.companyName),
        payload: args.payload,
        priceBasis: args.priceBasis,
        confirmCrAnalysisCategory: args.confirmCrAnalysisCategory,
        connectionRef: extractConnectionRefFromToolArgs(args),
    }));
    server.tool("brc_update_sales_invoice", [
        "Updates an existing BRC sales invoice.",
        "Can update text/reference fields, transaction dates, customer/sales-rep fields, and the full productTrans line collection.",
        "Historical invoices are not automatically blocked because they fall outside the current financial year.",
        "The BRC API is the source of truth for whether a historical invoice can be changed.",
        "When changing monetary values, provide a complete internally consistent productTrans collection and matching totalNet, totalVAT and total.",
        "Do not guess monetary fields.",
    ].join(" "), {
        companyName: companyNameSchema,
        id: z
            .union([z.string(), z.number()])
            .describe("Sales invoice id."),
        note: z
            .string()
            .optional()
            .describe(SALES_DOCUMENT_NOTE_DESCRIPTION),
        reference: z
            .string()
            .optional()
            .describe(SALES_DOCUMENT_REFERENCE_DESCRIPTION),
        ourReference: z.string().optional(),
        yourReference: z.string().optional(),
        details: z.string().optional(),
        entryDate: z
            .string()
            .optional()
            .describe("Entry date. Historical dates are permitted as an attempted update; BRC may accept or reject them."),
        procDate: z
            .string()
            .optional()
            .describe("Processing date. Historical dates are permitted as an attempted update; BRC may accept or reject them."),
        customerId: z.number().int().optional(),
        saleRepId: z.number().int().optional(),
        vatTypeId: z.number().int().optional(),
        bookTranTypeId: z.number().int().optional(),
        totalNet: z.number().optional(),
        totalVAT: z.number().optional(),
        total: z.number().optional(),
        productTrans: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe("Complete BRC productTrans collection. Use this when changing invoice lines, quantities, unit prices, VAT or line amounts."),
    }, async ({ companyName, id, note, reference, ourReference, yourReference, details, entryDate, procDate, customerId, saleRepId, vatTypeId, bookTranTypeId, totalNet, totalVAT, total, productTrans, }) => {
        const endpoint = `/v1/salesInvoices/${encodeURIComponent(String(id))}`;
        const current = await brcFetch(companyName, endpoint);
        if (!current ||
            typeof current !== "object" ||
            Array.isArray(current)) {
            throw new Error(`Could not read sales invoice ${id} before update.`);
        }
        const payload = cloneJson(current);
        if (note !== undefined)
            payload.note = note;
        if (reference !== undefined)
            payload.reference = reference;
        if (ourReference !== undefined)
            payload.ourReference = ourReference;
        if (yourReference !== undefined)
            payload.yourReference = yourReference;
        if (details !== undefined)
            payload.details = details;
        if (entryDate !== undefined)
            payload.entryDate = entryDate;
        if (procDate !== undefined)
            payload.procDate = procDate;
        if (customerId !== undefined)
            payload.customerId = customerId;
        if (saleRepId !== undefined)
            payload.saleRepId = saleRepId;
        if (vatTypeId !== undefined)
            payload.vatTypeId = vatTypeId;
        if (bookTranTypeId !== undefined) {
            payload.bookTranTypeId = bookTranTypeId;
        }
        if (productTrans !== undefined) {
            payload.productTrans = productTrans;
        }
        if (totalNet !== undefined)
            payload.totalNet = totalNet;
        if (totalVAT !== undefined)
            payload.totalVAT = totalVAT;
        if (total !== undefined)
            payload.total = total;
        const monetaryEditRequested = totalNet !== undefined ||
            totalVAT !== undefined ||
            total !== undefined ||
            productTrans !== undefined;
        if (monetaryEditRequested) {
            if (productTrans === undefined ||
                totalNet === undefined ||
                totalVAT === undefined ||
                total === undefined) {
                throw new Error("Monetary invoice updates require productTrans, totalNet, totalVAT and total together so Red does not send an inconsistent invoice to BRC.");
            }
        }
        // Basic reconciliation before sending monetary changes.
        if (productTrans !== undefined) {
            const lines = productTrans;
            const calculatedNet = lines.reduce((sum, line) => sum +
                (typeof line.amountNet === "number"
                    ? line.amountNet
                    : 0), 0);
            const calculatedVat = lines.reduce((sum, line) => sum +
                (typeof line.vat === "number"
                    ? line.vat
                    : 0), 0);
            const calculatedTotal = lines.reduce((sum, line) => sum +
                (typeof line.amount === "number"
                    ? line.amount
                    : 0), 0);
            const tolerance = 0.01;
            if (totalNet !== undefined &&
                Math.abs(totalNet - calculatedNet) > tolerance) {
                throw new Error(`totalNet ${totalNet} does not match productTrans amountNet total ${calculatedNet}.`);
            }
            if (totalVAT !== undefined &&
                Math.abs(totalVAT - calculatedVat) > tolerance) {
                throw new Error(`totalVAT ${totalVAT} does not match productTrans VAT total ${calculatedVat}.`);
            }
            if (total !== undefined &&
                Math.abs(total - calculatedTotal) > tolerance) {
                throw new Error(`total ${total} does not match productTrans amount total ${calculatedTotal}.`);
            }
        }
        try {
            const updateResponse = await brcJsonRequest(companyName, "PUT", endpoint, payload);
            const verification = await brcFetch(companyName, endpoint);
            return jsonResponse({
                message: "Sales invoice updated.",
                companyName,
                historicalDateAttempt: entryDate !== undefined || procDate !== undefined
                    ? {
                        entryDate: payload.entryDate,
                        procDate: payload.procDate,
                    }
                    : undefined,
                payloadSent: payload,
                updateResponse,
                verification,
            });
        }
        catch (error) {
            return jsonResponse({
                message: "BRC rejected the sales invoice update. The requested update was attempted rather than automatically blocked because of its financial year.",
                companyName,
                id,
                endpoint: `PUT ${endpoint}`,
                requestedEntryDate: entryDate,
                requestedProcDate: procDate,
                error: error instanceof Error
                    ? error.message
                    : String(error),
            });
        }
    });
    server.tool("brc_delete_sales_invoice", "Deletes a BRC sales invoice by id using timestamp confirmation.", {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe("Sales invoice id."),
        confirmDelete: z.boolean().default(false),
    }, async ({ companyName, id, confirmDelete }) => {
        if (!confirmDelete)
            throw new Error("Deletion not confirmed. Re-run with confirmDelete=true.");
        const invoice = await brcFetch(companyName, `/v1/salesInvoices/${encodeURIComponent(id)}`);
        if (!invoice || typeof invoice !== "object" || Array.isArray(invoice))
            throw new Error(`Could not read sales invoice ${id} before deletion.`);
        const timestamp = getTimestampFromRecord(invoice, `sales invoice ${id}`);
        try {
            const deleteResponse = await brcJsonRequest(companyName, "DELETE", `/v1/salesInvoices/${encodeURIComponent(String(id))}?timestamp=${encodeURIComponent(timestamp)}`);
            return jsonResponse({ success: true, deleted: true, companyName, id, timestampUsed: timestamp, deleteResponse });
        }
        catch (error) {
            return jsonResponse({ success: false, deleted: false, companyName, id, endpoint: `DELETE /v1/salesInvoices/${id}`, error: error instanceof Error ? error.message : String(error) });
        }
    });
}
