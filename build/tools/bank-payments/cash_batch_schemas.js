import { z } from "zod";
const text = (description) => z.string().min(1).describe(description);
const id = (description) => z.number().int().positive().describe(description);
const amount = (description) => z.number().positive().describe(description);
const opCode = z.literal(1).describe("BRC batch create operation code. Must be 1.");
const cashReceiptBase = {
    total: amount("Positive Cash Receipt total."),
    note: text("Cash Receipt note."),
    entryDate: text("Entry date in ISO format."),
    procDate: text("Processing date in ISO format."),
    bookTranTypeId: z.literal(1).describe("Cash Receipt book transaction type id. Must be 1."),
    reference: z.string().optional(),
    discount: z.number().optional(),
};
export const cashReceiptAnalysisEntrySchema = z.strictObject({
    id: z.number().int().nonnegative().optional(),
    accountCode: text("Cash Receipts analysis account code."),
    analysisCategoryId: id("Cash Receipts analysis category id."),
    description: text("Analysis-line description."),
    value: amount("Positive portion of the receipt total assigned to this analysis entry."),
});
export const cashReceiptVatEntrySchema = z.strictObject({
    id: z.number().int().nonnegative().optional(),
    vatRateId: id("BRC VAT rate id."),
    percentage: z.number().describe("VAT percentage."),
    amount: amount("Positive portion of the receipt total assigned to this VAT rate; this is not the VAT amount."),
});
export const structuredAnalysedCashReceiptSchema = z
    .strictObject({
    ...cashReceiptBase,
    acEntries: z.array(cashReceiptAnalysisEntrySchema).min(1),
    vatEntries: z.array(cashReceiptVatEntrySchema).min(1).optional().describe("Optional manual VAT split. Removed before transmission when Enable VAT on Cash Receipts is disabled."),
})
    .superRefine((value, ctx) => {
    const analysisTotal = value.acEntries.reduce((sum, entry) => sum + entry.value, 0);
    if (Math.abs(analysisTotal - value.total) > 0.005) {
        ctx.addIssue({ code: "custom", path: ["acEntries"], message: "Analysis entry values must equal total." });
    }
    if (value.vatEntries) {
        const vatAllocatedTotal = value.vatEntries.reduce((sum, entry) => sum + entry.amount, 0);
        if (Math.abs(vatAllocatedTotal - value.total) > 0.005) {
            ctx.addIssue({ code: "custom", path: ["vatEntries"], message: "VAT entry amounts must equal total." });
        }
    }
});
const flatCashReceiptBase = {
    ...cashReceiptBase,
    analysisCategoryId: id("Cash Receipts analysis category id."),
    accountCode: text("Cash Receipts analysis account code."),
    description: text("Analysis-line description."),
};
export const flatAnalysedCashReceiptWithoutVatSchema = z.strictObject(flatCashReceiptBase);
export const flatAnalysedCashReceiptWithVatSchema = z.strictObject({
    ...flatCashReceiptBase,
    vatRateId: id("BRC VAT rate id."),
    vatPercentage: z.number().describe("VAT percentage. Must be supplied with vatRateId."),
});
export const flatAnalysedCashReceiptSchema = z.xor([
    flatAnalysedCashReceiptWithoutVatSchema,
    flatAnalysedCashReceiptWithVatSchema,
]);
export const customerLedgerCashReceiptSchema = z
    .strictObject({
    ...cashReceiptBase,
    customerId: id("BRC customer id."),
    acCode: text("Customer account code."),
    ledger: amount("Customer-ledger amount; must equal total."),
})
    .superRefine((value, ctx) => {
    if (Math.abs(value.ledger - value.total) > 0.005) {
        ctx.addIssue({ code: "custom", path: ["ledger"], message: "ledger must equal total." });
    }
});
export const cashReceiptBatchItemSchema = z.strictObject({
    opCode,
    item: z.xor([
        structuredAnalysedCashReceiptSchema,
        flatAnalysedCashReceiptSchema,
        customerLedgerCashReceiptSchema,
    ]),
});
const cashPaymentBase = {
    total: amount("Positive Cash Payment total."),
    note: text("Cash Payment note."),
    entryDate: text("Entry date in ISO format."),
    procDate: text("Processing date in ISO format."),
    bookTranTypeId: z.literal(2).describe("Cash Payment book transaction type id. Must be 2."),
    discount: z.number().optional(),
};
export const supplierCashPaymentSchema = z
    .strictObject({
    ...cashPaymentBase,
    supplierId: id("BRC supplier id."),
    acCode: text("Supplier account code."),
    ledger: amount("Supplier-ledger amount; must equal total."),
})
    .superRefine((value, ctx) => {
    if (Math.abs(value.ledger - value.total) > 0.005) {
        ctx.addIssue({ code: "custom", path: ["ledger"], message: "ledger must equal total." });
    }
});
export const bankLodgementCashPaymentSchema = z
    .strictObject({
    ...cashPaymentBase,
    bankAccountId: id("BRC bank account id receiving the lodgement."),
    bankAccountCode: text("BRC bank account code receiving the lodgement."),
    lodgement: amount("Bank lodgement amount; must equal total."),
})
    .superRefine((value, ctx) => {
    if (Math.abs(value.lodgement - value.total) > 0.005) {
        ctx.addIssue({ code: "custom", path: ["lodgement"], message: "lodgement must equal total." });
    }
});
export const analysedCashPaymentSchema = z.strictObject({
    ...cashPaymentBase,
    analysisCategoryId: id("Cash Payments analysis category id."),
    accountCode: text("Cash Payments analysis account code."),
    description: text("Analysis-line description."),
});
export const cashPaymentBatchItemSchema = z.strictObject({
    opCode,
    item: z.xor([
        supplierCashPaymentSchema,
        bankLodgementCashPaymentSchema,
        analysedCashPaymentSchema,
    ]),
});
const paymentBase = {
    total: amount("Positive Payment total."),
    note: text("Payment note."),
    entryDate: text("Entry date in ISO format."),
    procDate: text("Processing date in ISO format."),
    bookTranTypeId: z.literal(3).describe("Payments book transaction type id. Must be 3."),
    bankAccountId: id("BRC bank account id."),
    bankAccountCode: text("BRC bank account code."),
    reference: z.string().optional(),
    discount: z.number().optional(),
};
export const supplierBankPaymentSchema = z.strictObject({
    ...paymentBase,
    supplierId: id("BRC supplier id."),
    acCode: text("Supplier account code."),
});
export const analysedBankPaymentSchema = z.strictObject({
    ...paymentBase,
    analysisCategoryId: id("Payments-book analysis category id for the non-supplier payment."),
    accountCode: text("Payments-book analysis account code for the non-supplier payment."),
    description: text("Description for the payment analysis line."),
});
export const paymentBatchItemSchema = z.strictObject({
    opCode,
    item: z.xor([supplierBankPaymentSchema, analysedBankPaymentSchema]),
});
