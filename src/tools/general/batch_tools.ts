

import { z } from "zod";
import type { ServerType } from "../../server.js";
import { registerRawBatchTool } from "./crud_tools.js";
import { generatedReferenceSalesInvoicePayloadObjectSchema } from "../sales-emails/sales_invoice_payload_schemas.js";
import {
  roundQuoteMoney2,
  SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION,
  SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION,
  SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION,
} from "./payloads_tools.js";

const requiredText = (description: string) => z.string().min(1).describe(description);
const positiveId = (description: string) => z.number().int().positive().describe(description);
const productId = positiveId("BRC product id; placeholder ids 0 and 1 are prohibited.").refine(
  (value) => value !== 1,
  "Product id 1 is a prohibited placeholder.",
);
const opCodeOne = z.literal(1).describe("BRC batch create operation code. Must be 1.");
const quoteReference = z.string().max(6).optional().describe("Optional manual quote reference, maximum six characters.");

export const salesEntryBatchPayloadSchema = z.strictObject({
  customerId: positiveId("BRC customer id."),
  acCode: requiredText("Customer account code."),
  note: requiredText("Sales Entry note."),
  entryDate: requiredText("Entry date in ISO format."),
  procDate: requiredText("Processing date in ISO format."),
  bookTranTypeId: positiveId("Sales Entry book transaction type id; use 5."),
  analysisCategoryId: positiveId("Sales analysis category id."),
  accountCode: requiredText("Sales analysis account code."),
  description: requiredText("Analysis-line description."),
  netAmount: z.number().positive().describe("Positive net amount before VAT."),
  vatRateId: positiveId("BRC VAT rate id."),
  vatPercentage: z.number().describe("VAT percentage."),
});

export const salesEntryBatchItemSchema = z.strictObject({
  opCode: opCodeOne,
  item: salesEntryBatchPayloadSchema,
});

export const flatQuoteBatchPayloadSchema = z.strictObject({
  companyId: positiveId("BRC company id."),
  customerOwnerId: positiveId("BRC customer owner id."),
  acCode: requiredText("Customer account code."),
  customerOwnerName: requiredText("Customer name."),
  comments: requiredText("Quote comments."),
  entryDate: requiredText("Entry date in ISO format."),
  procDate: requiredText("Processing date in ISO format."),
  vatTypeId: positiveId("BRC VAT type id.").optional(),
  saleRepId: positiveId("BRC sales representative id."),
  saleRepCode: requiredText("BRC sales representative code."),
  reference: quoteReference,
  poNumber: z.string().optional(),
  ddNumber: z.string().optional(),
  deliveryTo: z.union([z.string(), z.array(z.string())]).optional(),
  layoutType: positiveId("Quote layout type id.").optional(),
  productId,
  productCode: requiredText("BRC product code."),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  vatRateId: positiveId("BRC VAT rate id."),
  vatPercentage: z.number(),
  tranNote: requiredText("Quote product-line note."),
  analysisCategoryId: positiveId("Sales analysis category id."),
  accountCode: requiredText("Sales analysis account code."),
});

const quoteAnalysisEntrySchema = z.strictObject({
  id: z.number().int().nonnegative().optional(),
  companyId: positiveId("BRC company id."),
  accountCode: requiredText("Sales analysis account code."),
  analysisCategoryId: positiveId("Sales analysis category id."),
  quoteProductTranId: z.number().int().nonnegative().optional(),
  value: z.number().positive(),
});

const quoteProductLineSchema = z.strictObject({
  id: z.number().int().nonnegative().optional(),
  companyId: positiveId("BRC company id."),
  percentage: z.number(),
  vatRateId: positiveId("BRC VAT rate id."),
  productId,
  productCode: requiredText("BRC product code."),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  amount: z.number().positive(),
  vatAmount: z.number().nonnegative(),
  tranNotes: z.array(z.string()).min(1),
  acEntries: z.array(quoteAnalysisEntrySchema).min(1),
  vatAnalysisTypeId: z.number().int(),
});

export const nestedQuoteBatchPayloadSchema = z
  .strictObject({
    companyId: positiveId("BRC company id."),
    customerOwnerId: positiveId("BRC customer owner id."),
    vatTypeId: positiveId("BRC VAT type id."),
    saleRepId: positiveId("BRC sales representative id."),
    saleRepCode: requiredText("BRC sales representative code."),
    saleInvoiceId: z.number().int().positive().nullable().optional(),
    entryDate: requiredText("Entry date in ISO format."),
    procDate: requiredText("Processing date in ISO format."),
    closedDate: z.string().nullable().optional(),
    reference: quoteReference,
    poNumber: z.string().optional(),
    ddNumber: z.string().optional(),
    customerOwnerName: requiredText("Customer name."),
    deliveryList: z.string().optional(),
    deliveryTo: z.array(z.string()).optional(),
    comments: requiredText("Quote comments."),
    layoutType: positiveId("Quote layout type id."),
    total: z.number().positive(),
    totalVat: z.number().nonnegative(),
    totalNet: z.number().positive(),
    note: z.string(),
    acCode: requiredText("Customer account code."),
    productTrans: z.array(quoteProductLineSchema).min(1),
    customFields: z.array(z.unknown()),
  })
  .superRefine((payload, ctx) => {
    const totalNet = roundQuoteMoney2(payload.productTrans.reduce(
      (sum, line) => sum + line.acEntries.reduce((entrySum, entry) => entrySum + entry.value, 0),
      0,
    ));
    const totalVat = roundQuoteMoney2(payload.productTrans.reduce((sum, line) => sum + line.vatAmount, 0));
    const total = roundQuoteMoney2(payload.productTrans.reduce((sum, line) => sum + line.amount, 0));
    if (payload.totalNet !== totalNet) ctx.addIssue({ code: "custom", path: ["totalNet"], message: "totalNet must equal nested analysis values." });
    if (payload.totalVat !== totalVat) ctx.addIssue({ code: "custom", path: ["totalVat"], message: "totalVat must equal product-line VAT." });
    if (payload.total !== total) ctx.addIssue({ code: "custom", path: ["total"], message: "total must equal product-line amounts." });
    payload.productTrans.forEach((line, index) => {
      if (roundQuoteMoney2(line.amount) !== roundQuoteMoney2(line.acEntries.reduce((sum, entry) => sum + entry.value, 0) + line.vatAmount)) {
        ctx.addIssue({ code: "custom", path: ["productTrans", index, "amount"], message: "Line amount must equal analysis value plus VAT." });
      }
    });
  });

export const quoteBatchItemSchema = z.strictObject({
  opCode: opCodeOne,
  item: z.xor([flatQuoteBatchPayloadSchema, nestedQuoteBatchPayloadSchema]),
});

export const flatSalesCreditNoteBatchPayloadSchema = z.strictObject({
  customerId: positiveId("BRC customer id."),
  acCode: requiredText("Customer account code."),
  note: requiredText("Sales credit note."),
  entryDate: requiredText("Entry date in ISO format."),
  procDate: requiredText("Processing date in ISO format."),
  bookTranTypeId: positiveId("Sales Credit Note book transaction type id; use 7."),
  analysisCategoryId: positiveId("Sales analysis category id."),
  accountCode: requiredText("Sales analysis account code."),
  description: requiredText("Product-line analysis description."),
  netAmount: z.number().positive(),
  vatRateId: positiveId("BRC VAT rate id."),
  vatPercentage: z.number(),
  productId,
  productCode: requiredText("BRC product code."),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  saleRepId: positiveId("BRC sales representative id."),
  saleRepCode: requiredText("BRC sales representative code."),
  reference: z.string().optional(),
});

const creditNoteAnalysisEntrySchema = z.strictObject({
  id: z.number().int().nonnegative().optional(),
  accountCode: requiredText("Sales analysis account code."),
  analysisCategoryId: positiveId("Sales analysis category id."),
  description: z.string().optional(),
  value: z.number().negative(),
});

const creditNoteProductLineSchema = z.strictObject({
  id: z.number().int().nonnegative().optional(),
  amount: z.number().negative(),
  amountNet: z.number().negative(),
  percentage: z.number(),
  productId,
  productCode: requiredText("BRC product code."),
  quantity: z.number().negative(),
  unitPrice: z.number().positive(),
  vat: z.number().negative(),
  vatAmount: z.number().negative().optional(),
  vatRateId: positiveId("BRC VAT rate id."),
  vatAnalysisTypeId: z.number().int(),
  useTaxInclusiveUnitPrice: z.boolean().optional(),
  tranNotes: z.array(z.string()).min(1),
  acEntries: z.array(creditNoteAnalysisEntrySchema).min(1),
});

export const nestedSalesCreditNoteBatchPayloadSchema = z
  .strictObject({
    productTrans: z.array(creditNoteProductLineSchema).min(1),
    quoteId: z.number().int().nonnegative().optional(),
    saleRepId: positiveId("BRC sales representative id."),
    saleRepCode: requiredText("BRC sales representative code."),
    useTaxInclusiveUnitPrice: z.boolean().optional(),
    customerId: positiveId("BRC customer id."),
    details: z.unknown().nullable().optional(),
    unpaid: z.number().negative(),
    netGoods: z.number().optional(),
    netServices: z.number().optional(),
    vatTypeId: positiveId("BRC VAT type id."),
    totalNet: z.number().negative(),
    totalVAT: z.number().negative(),
    id: z.number().int().nonnegative().optional(),
    bookTranTypeId: z.literal(7),
    acCode: requiredText("Customer account code."),
    entryDate: requiredText("Entry date in ISO format."),
    procDate: requiredText("Processing date in ISO format."),
    total: z.number().negative(),
    customFields: z.array(z.unknown()),
    note: z.string().optional(),
    deliveryTo: z.union([z.string(), z.array(z.string())]).optional(),
    reference: z.string().optional(),
    ourReference: z.string().optional(),
    yourReference: z.string().optional(),
    loType: z.string().optional(),
  })
  .superRefine((payload, ctx) => {
    const totalNet = payload.productTrans.reduce((sum, line) => sum + line.amountNet, 0);
    const totalVAT = payload.productTrans.reduce((sum, line) => sum + line.vat, 0);
    const total = payload.productTrans.reduce((sum, line) => sum + line.amount, 0);
    if (Math.abs(payload.totalNet - totalNet) > 0.005) ctx.addIssue({ code: "custom", path: ["totalNet"], message: "totalNet must reconcile to product lines." });
    if (Math.abs(payload.totalVAT - totalVAT) > 0.005) ctx.addIssue({ code: "custom", path: ["totalVAT"], message: "totalVAT must reconcile to product lines." });
    if (Math.abs(payload.total - total) > 0.005) ctx.addIssue({ code: "custom", path: ["total"], message: "total must reconcile to product lines." });
    if (Math.abs(payload.unpaid - payload.total) > 0.005) ctx.addIssue({ code: "custom", path: ["unpaid"], message: "unpaid must equal total." });
    payload.productTrans.forEach((line, index) => {
      const analysisTotal = line.acEntries.reduce((sum, entry) => sum + entry.value, 0);
      if (Math.abs(line.amountNet - analysisTotal) > 0.005) ctx.addIssue({ code: "custom", path: ["productTrans", index, "acEntries"], message: "Analysis values must equal line amountNet." });
      if (Math.abs(line.amount - (line.amountNet + line.vat)) > 0.005) ctx.addIssue({ code: "custom", path: ["productTrans", index, "amount"], message: "Line amount must equal amountNet plus VAT." });
    });
  });

export const salesCreditNoteBatchItemSchema = z.strictObject({
  opCode: opCodeOne,
  item: z.xor([
    flatSalesCreditNoteBatchPayloadSchema,
    nestedSalesCreditNoteBatchPayloadSchema,
  ]),
});

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

const canonicalMasterDataWrapper = <T extends z.ZodRawShape>(item: z.ZodObject<T>) =>
  z.strictObject({
    opCode: opCodeOne,
    item,
  });

const optionalContactText = (description: string) =>
  z.string().optional().describe(`${description} Blank values are accepted and omitted by the existing builder.`);

export const productBatchPayloadSchema = z.strictObject({
  stockCode: z.string().trim().min(1).describe(
    "BRC product code. BRC may enforce additional server-side code limits.",
  ),
  details: z.array(z.string().trim().min(1)).min(1).describe(
    "One or more non-empty product description lines.",
  ),
  productTypeId: positiveId("BRC product type id. Select the intended product type explicitly."),
  vatRateId: positiveId("BRC VAT rate id. Select the intended VAT rate explicitly."),
  vatAnalysisTypeId: z.number().int().nonnegative().describe(
    "BRC product VAT analysis type id.",
  ),
  unitPrice: z.number().finite().nonnegative().describe(
    "Product unit price. Zero is valid for products whose price is supplied at transaction time.",
  ),
  grossUnitPrice: z.boolean().describe("Whether unitPrice is VAT-inclusive."),
  hasDefaultVatRate: z.boolean().describe("Whether the product uses its selected default VAT rate."),
});

export const productBatchItemSchema = canonicalMasterDataWrapper(productBatchPayloadSchema);

const customerLikeCanonicalFields = {
  code: z.string().trim().min(1).max(8).describe("BRC account code, maximum eight characters."),
  name: z.string().trim().min(1).describe("Customer or supplier name."),
  vatType: z.number().int().positive().describe(
    "BRC VAT type integer. Resolve the intended value from the connected company's VAT reference data.",
  ),
  vatAnalysisTypeId: z.number().int().nonnegative().describe("BRC VAT analysis type id."),
  contact: optionalContactText("Optional contact name."),
  email: optionalContactText("Optional email address."),
  phone: optionalContactText("Optional phone number."),
  mobile: optionalContactText("Optional mobile number."),
  fax: optionalContactText("Optional fax number."),
  vatReg: optionalContactText("Optional VAT registration number."),
  address: z.array(z.string()).optional().describe("Optional address lines."),
  additionalEmails: z.array(z.string()).optional().describe("Optional additional email addresses."),
  businessIdentifierCode: optionalContactText("Optional BIC."),
  internationalBankAccountNumber: optionalContactText("Optional IBAN."),
  creditTerms: z.number().int().nonnegative().optional().describe("Optional credit terms in days."),
  vatRegistered: z.boolean().optional().describe("Whether the owner is VAT registered."),
} as const;

export const customerBatchPayloadSchema = z.strictObject({
  ...customerLikeCanonicalFields,
});

export const customerBatchItemSchema = canonicalMasterDataWrapper(customerBatchPayloadSchema);

export const supplierBatchPayloadSchema = z.strictObject({
  ...customerLikeCanonicalFields,
});

export const supplierBatchItemSchema = canonicalMasterDataWrapper(supplierBatchPayloadSchema);

export const salesRepBatchPayloadSchema = z.strictObject({
  code: z.string().trim().min(1).describe(
    "BRC sales representative code. BRC may enforce additional server-side code limits.",
  ),
  name: z.string().trim().min(1).describe("Sales representative name."),
});

export const salesRepBatchItemSchema = canonicalMasterDataWrapper(salesRepBatchPayloadSchema);

const MASTER_DATA_BATCH_SCHEMA_OPTIONS = {
  exposePriceBasis: false,
  exposeConfirmCrAnalysisCategory: false,
} as const;

export function registerBatchTools(server: ServerType) {
  registerRawBatchTool(
    server,
    "brc_batch_purchases",
    "Processes a batch of purchases using the same structured fields as brc_create_purchase_gen_ref.",
    "/v1/purchases",
    purchaseBatchItemSchema,
  );
  registerRawBatchTool(server, "brc_batch_quotes", "Processes a batch of quotes using either verified flat creator fields or a complete nested BRC Quote payload.", "/v1/quotes", quoteBatchItemSchema, { exposePriceBasis: false });
  registerRawBatchTool(server, "brc_batch_sales_credit_notes", `Processes a batch of sales credit notes using either positive flat creator fields or complete negative nested BRC credit-note payloads. ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION}`, "/v1/salesCreditNotes", salesCreditNoteBatchItemSchema);
  registerRawBatchTool(server, "brc_batch_sales_entries", "Processes a batch of sales entries using verified structured creator fields.", "/v1/salesEntries", salesEntryBatchItemSchema, { exposePriceBasis: false });
  registerRawBatchTool(
    server,
    "brc_batch_sales_invoices",
    `Processes a batch of sales invoices. Each batch may partially succeed; inspect every returned item and failedItems before reporting success. ${SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION} ${SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION} ${SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION}`,
    "/v1/salesInvoices",
    salesInvoiceBatchItemSchema,
  );
  registerRawBatchTool(server, "brc_batch_sales_reps", "Processes a batch of sales representatives using explicit code and name fields.", "/v1/salesReps", salesRepBatchItemSchema, MASTER_DATA_BATCH_SCHEMA_OPTIONS);
  registerRawBatchTool(server, "brc_batch_suppliers", "Processes a batch of suppliers using explicit identity, VAT classification, and optional contact fields.", "/v1/suppliers", supplierBatchItemSchema, MASTER_DATA_BATCH_SCHEMA_OPTIONS);
  registerRawBatchTool(server, "brc_batch_customers", "Processes a batch of customers using explicit identity, VAT classification, and optional contact fields.", "/v1/customers", customerBatchItemSchema, MASTER_DATA_BATCH_SCHEMA_OPTIONS);
  registerRawBatchTool(server, "brc_batch_products", "Processes a batch of products using explicit product type, VAT classification, price, and description fields.", "/v1/products", productBatchItemSchema, MASTER_DATA_BATCH_SCHEMA_OPTIONS);
}

