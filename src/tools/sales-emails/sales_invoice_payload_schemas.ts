import { z } from "zod";

/**
 * Small currency rounding tolerance (1 cent) for reconciling line analysis
 * values, qty × unit price, and header totals on multi-line sales invoices.
 */
export const SALES_INVOICE_CURRENCY_TOLERANCE = 0.01;

export type SalesInvoicePayloadFieldError = {
  field: string;
  message: string;
};

function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= SALES_INVOICE_CURRENCY_TOLERANCE;
}

function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
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

export type SalesInvoiceAnalysisEntry = z.infer<
  typeof salesInvoiceAnalysisEntrySchema
>;

/**
 * One productTrans line on a sales invoice, including nested acEntries.
 * id is optional — the BRC createSaleInvoiceWithGeneratingReference Swagger
 * example omits id on productTrans lines.
 *
 * Quantities and amounts stay non-credit-note shaped: do not treat Swagger
 * samples that use negative values / bookTranTypeId 7 as permission to accept
 * negatives on normal sales invoices (those look like a shared credit-note model).
 */
export const salesInvoiceProductLineSchema = z
  .object({
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
    acEntries: z.array(salesInvoiceAnalysisEntrySchema).optional(),
  })
  .passthrough();

export type SalesInvoiceProductLine = z.infer<
  typeof salesInvoiceProductLineSchema
>;

/**
 * Structural BRC sales invoice payload for generated-reference creates.
 * Cross-field reconciliation is applied by generatedReferenceSalesInvoicePayloadSchema.
 *
 * id is optional — the Swagger create example omits header id.
 * unpaid is optional — the Swagger create example omits unpaid; when supplied it
 * must equal total (see superRefine).
 */
export const generatedReferenceSalesInvoicePayloadObjectSchema = z
  .object({
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
    productTrans: z.array(salesInvoiceProductLineSchema).optional(),
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
  })
  .passthrough();

export type GeneratedReferenceSalesInvoicePayload = z.infer<
  typeof generatedReferenceSalesInvoicePayloadObjectSchema
>;

function resolveLineTaxInclusive(
  line: SalesInvoiceProductLine,
  headerTaxInclusive: boolean | undefined
): boolean | undefined {
  if (typeof line.useTaxInclusiveUnitPrice === "boolean") {
    return line.useTaxInclusiveUnitPrice;
  }
  if (typeof headerTaxInclusive === "boolean") {
    return headerTaxInclusive;
  }
  return undefined;
}

function addIssue(
  ctx: z.RefinementCtx,
  field: string,
  message: string
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path: field.split(".").filter((part) => part !== ""),
  });
}

/**
 * Full generated-reference multi-line sales invoice payload schema, including
 * cross-field reconciliation. Prefer safeParse so all issues can be returned.
 */
export const generatedReferenceSalesInvoicePayloadSchema =
  generatedReferenceSalesInvoicePayloadObjectSchema.superRefine((payload, ctx) => {
    const productTrans = payload.productTrans;

    if (!Array.isArray(productTrans) || productTrans.length === 0) {
      addIssue(
        ctx,
        "productTrans",
        "productTrans must contain at least one product line."
      );
      return;
    }

    for (let lineIndex = 0; lineIndex < productTrans.length; lineIndex += 1) {
      const line = productTrans[lineIndex]!;
      const linePath = `productTrans[${lineIndex}]`;
      const acEntries = line.acEntries;

      if (!Array.isArray(acEntries) || acEntries.length === 0) {
        addIssue(
          ctx,
          `${linePath}.acEntries`,
          "Each productTrans line must contain at least one nested acEntries item."
        );
      } else {
        const analysisSum = sumNumbers(acEntries.map((entry) => entry.value));
        if (!amountsEqual(analysisSum, line.amountNet)) {
          addIssue(
            ctx,
            `${linePath}.acEntries`,
            `Sum of acEntries.value (${analysisSum}) must equal amountNet (${line.amountNet}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
          );
        }
      }

      const amountFromNetAndVat = line.amountNet + line.vat;
      if (!amountsEqual(line.amount, amountFromNetAndVat)) {
        addIssue(
          ctx,
          `${linePath}.amount`,
          `amount (${line.amount}) must equal amountNet + vat (${amountFromNetAndVat}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
        );
      }

      const taxInclusive = resolveLineTaxInclusive(
        line,
        payload.useTaxInclusiveUnitPrice
      );
      if (taxInclusive !== undefined) {
        const qtyTimesPrice = line.quantity * line.unitPrice;
        if (taxInclusive) {
          if (!amountsEqual(qtyTimesPrice, line.amount)) {
            addIssue(
              ctx,
              `${linePath}.unitPrice`,
              `When useTaxInclusiveUnitPrice is true, quantity × unitPrice (${qtyTimesPrice}) must equal amount (${line.amount}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
            );
          }
        } else if (!amountsEqual(qtyTimesPrice, line.amountNet)) {
          addIssue(
            ctx,
            `${linePath}.unitPrice`,
            `When useTaxInclusiveUnitPrice is false, quantity × unitPrice (${qtyTimesPrice}) must equal amountNet (${line.amountNet}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
          );
        }
      }
    }

    const sumAmountNet = sumNumbers(productTrans.map((line) => line.amountNet));
    const sumVat = sumNumbers(productTrans.map((line) => line.vat));
    const sumAmount = sumNumbers(productTrans.map((line) => line.amount));

    if (!amountsEqual(payload.totalNet, sumAmountNet)) {
      addIssue(
        ctx,
        "totalNet",
        `totalNet (${payload.totalNet}) must equal the sum of productTrans amountNet (${sumAmountNet}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
      );
    }

    if (!amountsEqual(payload.totalVAT, sumVat)) {
      addIssue(
        ctx,
        "totalVAT",
        `totalVAT (${payload.totalVAT}) must equal the sum of productTrans vat (${sumVat}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
      );
    }

    if (!amountsEqual(payload.total, sumAmount)) {
      addIssue(
        ctx,
        "total",
        `total (${payload.total}) must equal the sum of productTrans amount (${sumAmount}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
      );
    }

    const headerNetPlusVat = payload.totalNet + payload.totalVAT;
    if (!amountsEqual(payload.total, headerNetPlusVat)) {
      addIssue(
        ctx,
        "total",
        `total (${payload.total}) must equal totalNet + totalVAT (${headerNetPlusVat}) within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
      );
    }

    // Swagger create example omits unpaid; only reconcile when the caller supplies it.
    if (payload.unpaid !== undefined && !amountsEqual(payload.unpaid, payload.total)) {
      addIssue(
        ctx,
        "unpaid",
        `unpaid (${payload.unpaid}) must equal total (${payload.total}) for a newly created invoice within ${SALES_INVOICE_CURRENCY_TOLERANCE}.`
      );
    }
  });

/**
 * Formats Zod issues into stable { field, message } errors for tool responses.
 * Prefers the custom path from refinements; falls back to Zod's issue path.
 */
export function formatSalesInvoicePayloadValidationErrors(
  error: z.ZodError
): SalesInvoicePayloadFieldError[] {
  const seen = new Set<string>();
  const errors: SalesInvoicePayloadFieldError[] = [];

  for (const issue of error.issues) {
    const field =
      issue.path.length > 0
        ? issue.path
            .map((part) => (typeof part === "number" ? `[${part}]` : String(part)))
            .join(".")
            .replace(/\.\[/g, "[")
        : "(root)";
    const key = `${field}::${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    errors.push({ field, message: issue.message });
  }

  return errors;
}

export type ValidateGeneratedReferenceSalesInvoiceResult =
  | { valid: true; data: z.infer<typeof generatedReferenceSalesInvoicePayloadSchema> }
  | { valid: false; errors: SalesInvoicePayloadFieldError[] };

/**
 * Validates a generated-reference sales invoice payload after price-basis
 * normalisation. Returns every collected field error when invalid.
 */
export function validateGeneratedReferenceSalesInvoicePayload(
  payload: unknown
): ValidateGeneratedReferenceSalesInvoiceResult {
  const parsed = generatedReferenceSalesInvoicePayloadSchema.safeParse(payload);
  if (parsed.success) {
    return { valid: true, data: parsed.data };
  }
  return {
    valid: false,
    errors: formatSalesInvoicePayloadValidationErrors(parsed.error),
  };
}
