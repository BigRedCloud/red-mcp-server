import { z } from "zod";
/**
 * Small currency rounding tolerance (1 cent) for reconciling line analysis
 * values, qty × unit price, and header totals on multi-line sales invoices.
 */
export const SALES_INVOICE_CURRENCY_TOLERANCE = 0.01;
function amountsEqual(a, b) {
    return Math.abs(a - b) <= SALES_INVOICE_CURRENCY_TOLERANCE;
}
function sumNumbers(values) {
    return values.reduce((total, value) => total + value, 0);
}
/**
 * Formats a Zod issue path as `productTrans.1.acEntries` (dot + numeric index).
 */
export function formatZodIssueFieldPath(path) {
    if (path.length === 0) {
        return "(root)";
    }
    let field = "";
    for (const part of path) {
        if (typeof part === "number") {
            field += `.${part}`;
            continue;
        }
        const text = String(part);
        if (text === "") {
            continue;
        }
        if (/^\d+$/.test(text)) {
            field += `.${text}`;
            continue;
        }
        // Support legacy single-segment paths such as "productTrans[1]".
        const bracketMatch = /^([^[\]]+)\[(\d+)\]$/.exec(text);
        if (bracketMatch) {
            field += field.length === 0 ? bracketMatch[1] : `.${bracketMatch[1]}`;
            field += `.${bracketMatch[2]}`;
            continue;
        }
        field += field.length === 0 ? text : `.${text}`;
    }
    return field.replace(/^\./, "") || "(root)";
}
/**
 * Nested analysis entry on a sales invoice productTrans line.
 * Matches the shape produced by buildSalesInvoicePayload (no top-level acEntries).
 */
export const salesInvoiceAnalysisEntrySchema = z
    .object({
    // Optional — Swagger createSaleInvoiceWithGeneratingReference omits id on acEntries.
    id: z.number().optional(),
    accountCode: z.string().min(1),
    analysisCategoryId: z.number(),
    description: z.string().optional(),
    value: z.number(),
})
    .passthrough();
const productLineBaseFields = {
    id: z.number().optional(),
    amount: z.number(),
    amountNet: z.number(),
    percentage: z.number(),
    productId: z.number().optional(),
    productCode: z.string().min(1),
    quantity: z.number(),
    unitPrice: z.number(),
    vat: z.number(),
    vatRateId: z.number(),
    vatAnalysisTypeId: z.number(),
    // Optional on the structural schema: applySalesPriceBasisToRawPayload may
    // set this from priceBasis before full in-handler reconciliation.
    useTaxInclusiveUnitPrice: z.boolean().optional(),
    tranNotes: z.array(z.string()),
};
/**
 * MCP-facing product line: acEntries is optional here so missing/empty/null
 * values reach the handler and return a structured valid:false response
 * instead of failing as a raw MCP Zod protocol error (which Cursor can surface
 * as "The connector's server isn't responding").
 */
export const salesInvoiceProductLineInputSchema = z
    .object({
    ...productLineBaseFields,
    acEntries: z.preprocess((value) => (value === null ? undefined : value), z.array(salesInvoiceAnalysisEntrySchema).optional()),
})
    .passthrough();
/**
 * Strict productTrans line used for in-handler safeParse.
 * acEntries is required and must contain at least one nested analysis entry.
 *
 * id is optional — the BRC createSaleInvoiceWithGeneratingReference Swagger
 * example omits id on productTrans lines.
 *
 * Quantities and amounts stay non-credit-note shaped: do not treat Swagger
 * samples that use negative values / bookTranTypeId 7 as permission to accept
 * negatives on normal sales invoices (those look like a shared credit-note model).
 */
export const salesInvoiceProductLineSchema = z
    .object({
    ...productLineBaseFields,
    acEntries: z.array(salesInvoiceAnalysisEntrySchema).min(1),
})
    .passthrough();
const salesInvoiceHeaderFields = {
    customerId: z.number(),
    acCode: z.string().min(1),
    entryDate: z.string().min(1),
    procDate: z.string().min(1),
    saleRepId: z.number(),
    // Required here and by requireSalesRepInPayload / existing tests even though
    // the Swagger createSaleInvoiceWithGeneratingReference example omits
    // saleRepCode. Confirm with BRC whether the API accepts saleRepId alone
    // before relaxing this — do not remove the runtime requirement yet.
    saleRepCode: z.string().min(1),
    bookTranTypeId: z.number(),
    totalNet: z.number(),
    totalVAT: z.number(),
    total: z.number(),
    unpaid: z.number().optional(),
    note: z.string().optional(),
    deliveryTo: z.union([z.string(), z.array(z.string())]).optional(),
    vatTypeId: z.number().optional(),
    // Optional: applySalesPriceBasisToRawPayload can add this before full validation.
    useTaxInclusiveUnitPrice: z.boolean().optional(),
    customFields: z.array(z.unknown()).optional(),
    id: z.number().optional(),
    quoteId: z.number().optional(),
    netGoods: z.number().optional(),
    netServices: z.number().optional(),
};
/**
 * Structural BRC sales invoice payload for generated-reference creates (MCP tool
 * input). Cross-field reconciliation and required acEntries.min(1) are applied by
 * generatedReferenceSalesInvoicePayloadSchema in-handler.
 *
 * id is optional — the Swagger create example omits header id.
 * unpaid is optional — the Swagger create example omits unpaid; when supplied it
 * must equal total (see superRefine).
 */
export const generatedReferenceSalesInvoicePayloadObjectSchema = z
    .object({
    ...salesInvoiceHeaderFields,
    productTrans: z.array(salesInvoiceProductLineInputSchema).optional(),
})
    .passthrough();
/** Strict object shape used by safeParse after price-basis normalisation. */
const generatedReferenceSalesInvoicePayloadValidationObjectSchema = z
    .object({
    ...salesInvoiceHeaderFields,
    productTrans: z.array(salesInvoiceProductLineSchema).min(1),
})
    .passthrough();
function resolveLineTaxInclusive(line, headerTaxInclusive) {
    if (typeof line.useTaxInclusiveUnitPrice === "boolean") {
        return line.useTaxInclusiveUnitPrice;
    }
    if (typeof headerTaxInclusive === "boolean") {
        return headerTaxInclusive;
    }
    return undefined;
}
function addIssue(ctx, path, message) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path,
    });
}
/**
 * Full generated-reference multi-line sales invoice payload schema, including
 * required nested acEntries.min(1) and cross-field reconciliation.
 * Prefer safeParse so all issues can be returned together.
 */
export const generatedReferenceSalesInvoicePayloadSchema = generatedReferenceSalesInvoicePayloadValidationObjectSchema.superRefine((payload, ctx) => {
    const productTrans = payload.productTrans;
    if (!Array.isArray(productTrans) || productTrans.length === 0) {
        addIssue(ctx, ["productTrans"], "productTrans must contain at least one product line.");
        return;
    }
    for (let lineIndex = 0; lineIndex < productTrans.length; lineIndex += 1) {
        const line = productTrans[lineIndex];
        const acEntries = line.acEntries;
        // Belt-and-braces: schema already requires min(1); keep a clear message.
        if (!Array.isArray(acEntries) || acEntries.length === 0) {
            addIssue(ctx, ["productTrans", lineIndex, "acEntries"], "Each productTrans line must contain at least one nested acEntries item.");
        }
        else {
            const analysisSum = sumNumbers(acEntries.map((entry) => entry.value));
            if (!amountsEqual(analysisSum, line.amountNet)) {
                addIssue(ctx, ["productTrans", lineIndex, "acEntries"], `Sum of acEntries.value (${analysisSum}) must equal amountNet (${line.amountNet}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
            }
        }
        const amountFromNetAndVat = line.amountNet + line.vat;
        if (!amountsEqual(line.amount, amountFromNetAndVat)) {
            addIssue(ctx, ["productTrans", lineIndex, "amount"], `amount (${line.amount}) must equal amountNet + vat (${amountFromNetAndVat}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
        }
        const taxInclusive = resolveLineTaxInclusive(line, payload.useTaxInclusiveUnitPrice);
        if (taxInclusive !== undefined) {
            const qtyTimesPrice = line.quantity * line.unitPrice;
            if (taxInclusive) {
                if (!amountsEqual(qtyTimesPrice, line.amount)) {
                    addIssue(ctx, ["productTrans", lineIndex, "unitPrice"], `When useTaxInclusiveUnitPrice is true, quantity × unitPrice (${qtyTimesPrice}) must equal amount (${line.amount}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
                }
            }
            else if (!amountsEqual(qtyTimesPrice, line.amountNet)) {
                addIssue(ctx, ["productTrans", lineIndex, "unitPrice"], `When useTaxInclusiveUnitPrice is false, quantity × unitPrice (${qtyTimesPrice}) must equal amountNet (${line.amountNet}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
            }
        }
    }
    const sumAmountNet = sumNumbers(productTrans.map((line) => line.amountNet));
    const sumVat = sumNumbers(productTrans.map((line) => line.vat));
    const sumAmount = sumNumbers(productTrans.map((line) => line.amount));
    if (!amountsEqual(payload.totalNet, sumAmountNet)) {
        addIssue(ctx, ["totalNet"], `totalNet (${payload.totalNet}) must equal the sum of productTrans amountNet (${sumAmountNet}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
    }
    if (!amountsEqual(payload.totalVAT, sumVat)) {
        addIssue(ctx, ["totalVAT"], `totalVAT (${payload.totalVAT}) must equal the sum of productTrans vat (${sumVat}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
    }
    if (!amountsEqual(payload.total, sumAmount)) {
        addIssue(ctx, ["total"], `total (${payload.total}) must equal the sum of productTrans amount (${sumAmount}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
    }
    const headerNetPlusVat = payload.totalNet + payload.totalVAT;
    if (!amountsEqual(payload.total, headerNetPlusVat)) {
        addIssue(ctx, ["total"], `total (${payload.total}) must equal totalNet + totalVAT (${headerNetPlusVat}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
    }
    // Swagger create example omits unpaid; only reconcile when the caller supplies it.
    if (payload.unpaid !== undefined &&
        !amountsEqual(payload.unpaid, payload.total)) {
        addIssue(ctx, ["unpaid"], `unpaid (${payload.unpaid}) must equal total (${payload.total}) for a newly created invoice within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`);
    }
});
/**
 * Formats Zod issues into stable { field, message } errors for tool responses.
 * Field paths use dot-index form, e.g. productTrans.1.acEntries.
 */
export function formatSalesInvoicePayloadValidationErrors(error) {
    const seen = new Set();
    const errors = [];
    for (const issue of error.issues) {
        const field = formatZodIssueFieldPath(issue.path);
        const key = `${field}::${issue.message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        errors.push({ field, message: issue.message });
    }
    return errors;
}
/**
 * Validates a generated-reference sales invoice payload after price-basis
 * normalisation. Returns every collected field error when invalid.
 * Never throws — callers can safely map failures to MCP jsonResponse bodies.
 */
export function validateGeneratedReferenceSalesInvoicePayload(payload) {
    try {
        const parsed = generatedReferenceSalesInvoicePayloadSchema.safeParse(payload);
        if (parsed.success) {
            return { valid: true, data: parsed.data };
        }
        return {
            valid: false,
            errors: formatSalesInvoicePayloadValidationErrors(parsed.error),
        };
    }
    catch (error) {
        return {
            valid: false,
            errors: [
                {
                    field: "(root)",
                    message: error instanceof Error
                        ? error.message
                        : "Unexpected sales invoice payload validation failure.",
                },
            ],
        };
    }
}
/**
 * Builds the MCP tool jsonResponse body for a failed gen-ref payload validation.
 */
export function buildSalesInvoiceGenRefValidationFailureBody(companyName, errors) {
    return {
        message: "Sales invoice payload validation failed. Fix the reported fields before posting.",
        companyName,
        valid: false,
        errors,
    };
}
