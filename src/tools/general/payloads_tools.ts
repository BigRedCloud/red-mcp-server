import {
    round2,
    type JsonRecord
  
  } from "../../shared.js";


export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function unwrapPayload<T extends Record<string, unknown>>(
  args: T
): Record<string, unknown> {
  const { payload, ...rest } = args;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...rest,
      ...(payload as Record<string, unknown>),
    };
  }

  return { ...rest };
}

function asString(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function requireQuoteCompanyId(companyId: number | undefined): number {
  if (companyId === undefined || !Number.isFinite(companyId) || companyId <= 0) {
    throw new Error(
      "Quote payload requires companyId. Provide the connected company's id from existing records such as customers, products, or sales reps."
    );
  }
  return companyId;
}

export const SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION =
  "Requires saleRepId and saleRepCode. Do not use default or demo sales rep values. If missing, list sales reps or ask the user to choose one before creating.";

export const SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION =
  "Requires analysisCategoryId and accountCode from a Sales Analysis category on each product line. Do not default to CR01/Customer or the first listed category. Set confirmCrAnalysisCategory=true only after the user confirms a CR account code is intentional.";

export const SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION =
  'When Gross Price Entry is enabled for sales invoicing, this tool requires priceBasis. Use priceBasis "gross" when unit prices are VAT-inclusive/gross, or priceBasis "net" when unit prices are VAT-exclusive/net. Do not tell the user to disable Gross Price Entry if they have provided priceBasis.';

export const SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION =
  "Required when Gross Price Entry is enabled. Use `gross` when unit prices are VAT-inclusive/gross. Use `net` when unit prices are VAT-exclusive/net.";

export const SALES_DOCUMENT_NOTE_DESCRIPTION =
  'Optional. BRC "Note" field on the sales document (JSON field `note`). Leave blank to default it to the customer name (BRC customer "Name" / JSON `name`). Do not use the product name as the note. Only set this when the user explicitly provides a note.';

export const SALES_DOCUMENT_CUSTOMER_NAME_DESCRIPTION =
  'Optional. The selected customer\'s name (BRC customer "Name" / JSON `name`). Used as the default sales document note (BRC "Note" / JSON `note`) when no explicit note is given.';

export const SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION =
  'Optional. BRC "Delivery To" address (JSON field `deliveryTo`). Leave blank unless the user explicitly provides a delivery address. Do not invent or default a delivery address (for example "MCP Test").';

export const SALES_DOCUMENT_REFERENCE_DESCRIPTION =
  'Optional. BRC "Reference" field (JSON field `reference`). BRC "Our Ref" (JSON `ourReference`) and BRC "Your Ref" (JSON `yourReference`) default to this value when not supplied separately.';

export const SALES_DOCUMENT_PRODUCT_LINE_DESCRIPTION_DESCRIPTION =
  'Product line description shown on the document line (BRC product line description / JSON `tranNotes`, also used on the line\'s analysis entry description). This is the line narrative, not the BRC "Note" field.';

export const SALES_DOCUMENT_PRODUCT_FIELDS_DESCRIPTION =
  'productCode is the BRC product "Code" (JSON `productCode`); productId is the BRC product "Id" (JSON `productId`) from brc_list_products. The product name is not a payload field — do not place it in the BRC "Note" field (JSON `note`).';

/**
 * Resolves the BRC sales document "Note" field (JSON `note`).
 *
 * Priority: an explicit user note, then the customer name (BRC customer "Name" /
 * JSON `name`), otherwise undefined so the caller omits `note` entirely. The
 * product name is never used as a default note.
 */
export function resolveSalesDocumentNote(
  note?: unknown,
  customerName?: unknown
): string | undefined {
  const explicit = typeof note === "string" ? note.trim() : "";
  if (explicit !== "") {
    return explicit;
  }

  const fromCustomer = typeof customerName === "string" ? customerName.trim() : "";
  if (fromCustomer !== "") {
    return fromCustomer;
  }

  return undefined;
}

/**
 * Normalises a BRC "Delivery To" value (JSON `deliveryTo`) into a non-empty
 * string array, or undefined when no real delivery address was provided. Never
 * invents a default delivery address.
 */
export function normaliseDeliveryTo(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const raw = Array.isArray(value) ? value : [value];
  const cleaned = raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry).trim()))
    .filter((entry) => entry !== "");

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Applies an explicit top-level price basis to a raw sales document payload.
 *
 * When priceBasis is "gross" or "net", sets useTaxInclusiveUnitPrice on the
 * payload and on every productTrans line. When priceBasis is omitted, the
 * payload is returned unchanged so the Gross Price Entry guard can still block
 * a raw payload that carries no price-basis signal.
 */
export function applySalesPriceBasisToRawPayload(
  payload: Record<string, unknown>,
  priceBasis?: "net" | "gross"
): Record<string, unknown> {
  if (priceBasis !== "net" && priceBasis !== "gross") {
    return payload;
  }

  const useTaxInclusiveUnitPrice = priceBasis === "gross";
  const next: Record<string, unknown> = {
    ...payload,
    useTaxInclusiveUnitPrice,
  };

  if (Array.isArray(next.productTrans)) {
    next.productTrans = next.productTrans.map((line) =>
      isRecord(line) ? { ...line, useTaxInclusiveUnitPrice } : line
    );
  }

  return next;
}

export type SalesDocumentAnalysisWorkflow =
  | "sales_invoice"
  | "sales_credit_note"
  | "quote";

export interface SalesAnalysisPreflightOptions {
  confirmCrAnalysisCategory?: boolean;
}

const SALES_ANALYSIS_STOP_PREFIX =
  "Red stopped before posting because sales analysis details need attention.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function salesAnalysisPreflightError(detail: string): Error {
  return new Error(`${SALES_ANALYSIS_STOP_PREFIX}\n\n${detail}`);
}

function normaliseAnalysisAccountCode(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed !== "" ? trimmed : undefined;
}

function isValidAnalysisCategoryId(value: unknown): boolean {
  const id = Number(value);
  return Number.isFinite(id) && id > 0;
}

function salesDocumentLabel(workflow: SalesDocumentAnalysisWorkflow): string {
  switch (workflow) {
    case "sales_invoice":
      return "sales invoice";
    case "sales_credit_note":
      return "sales credit note";
    case "quote":
      return "quote";
    default:
      return workflow;
  }
}

function collectProductLineAnalysis(
  payload: unknown
): Array<{ accountCode?: string; analysisCategoryId?: unknown }> {
  if (!isRecord(payload)) {
    return [];
  }

  const fromProductTrans: Array<{
    accountCode?: string;
    analysisCategoryId?: unknown;
  }> = [];

  if (Array.isArray(payload.productTrans)) {
    for (const productTran of payload.productTrans) {
      if (!isRecord(productTran) || !Array.isArray(productTran.acEntries)) {
        continue;
      }

      for (const acEntry of productTran.acEntries) {
        if (!isRecord(acEntry)) {
          continue;
        }

        fromProductTrans.push({
          accountCode: normaliseAnalysisAccountCode(acEntry.accountCode),
          analysisCategoryId: acEntry.analysisCategoryId,
        });
      }
    }
  }

  if (fromProductTrans.length > 0) {
    return fromProductTrans;
  }

  if (
    payload.analysisCategoryId !== undefined ||
    payload.accountCode !== undefined
  ) {
    return [
      {
        accountCode: normaliseAnalysisAccountCode(payload.accountCode),
        analysisCategoryId: payload.analysisCategoryId,
      },
    ];
  }

  return [];
}

export function enforceSalesProductLineAnalysisOrThrow(
  payload: unknown,
  workflow: SalesDocumentAnalysisWorkflow,
  options?: SalesAnalysisPreflightOptions
): void {
  const documentLabel = salesDocumentLabel(workflow);
  const lines = collectProductLineAnalysis(payload);

  if (lines.length === 0) {
    throw salesAnalysisPreflightError(
      `Red needs a Sales Analysis category for this ${documentLabel} product line. Provide analysisCategoryId and accountCode from the Sales book. Do not use Customer (CR) categories unless the user confirms that choice.`
    );
  }

  for (const line of lines) {
    if (!isValidAnalysisCategoryId(line.analysisCategoryId) || !line.accountCode) {
      throw salesAnalysisPreflightError(
        `Red needs a Sales Analysis category for this ${documentLabel} product line. Provide analysisCategoryId and accountCode from the Sales book. Do not default to CR01, Customer, or the first listed analysis category.`
      );
    }

    if (
      line.accountCode.toUpperCase().startsWith("CR") &&
      options?.confirmCrAnalysisCategory !== true
    ) {
      throw salesAnalysisPreflightError(
        `The sales analysis account code "${line.accountCode}" looks like a Customer (CR) category on this ${documentLabel} product line. Red blocked posting because CR categories are unusual here. Ask the user in plain English, for example: "This analysis category appears to be a customer/CR category rather than a Sales category. Do you want to use it anyway, or should I choose a Sales analysis category?" Only retry with confirmCrAnalysisCategory=true after the user confirms that category is intentional.`
      );
    }
  }
}

/**
 * Placeholder product IDs that BRC rejects with a 500 error when posted on a
 * sales document product line. These are commonly emitted by models as filler
 * values instead of a real product from brc_list_products.
 */
export const PLACEHOLDER_PRODUCT_IDS = new Set<number>([0, 1]);

export const SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION =
  "Do not invent productId values and do not use productId 0 or 1 as placeholders. productId 0 and 1 are treated as placeholders and are blocked at runtime before the draft preview and before posting. If a product line is needed, first call brc_list_products and use a real product from the connected company. If no suitable product exists, ask the user whether to create/select a product, or use a service/non-product line only if the endpoint supports it.";

export const SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION =
  "Sales invoices must use Sales VAT rates. Purchase/non-Sales VAT rates are blocked before draft and before posting, even if the VAT percentage matches.";

export const SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION =
  "Batch sales invoices apply the same safety checks as single sales invoices: productId 0/1 placeholder blocking before draft and posting; Sales VAT category validation before draft and posting; Gross Price Entry priceBasis handling; CR analysis category confirmation; and counterparty confirmation covering all listed customers. If the batch includes multiple customers, confirming means confirming all listed customers, not just one. Set confirmCrAnalysisCategory=true at batch level only after the user confirms CR sales analysis account codes are intentional. Per item, the BRC \"Note\" field (JSON `note`) defaults to the customer name when omitted (never the product name), and the BRC \"Delivery To\" address (JSON `deliveryTo`) is only included when explicitly provided.";

function readLineProductId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const id = Number(value);
  return Number.isFinite(id) ? id : undefined;
}

/**
 * Collects the productId from each sales document product line where a productId
 * is actually present. Prefers a productTrans array, otherwise falls back to a
 * flat/top-level product line shape (used by structured args and batch items).
 */
function collectSalesProductLineProductIds(payload: unknown): number[] {
  if (!isRecord(payload)) {
    return [];
  }

  const ids: number[] = [];

  if (Array.isArray(payload.productTrans) && payload.productTrans.length > 0) {
    for (const line of payload.productTrans) {
      if (!isRecord(line)) {
        continue;
      }
      const id = readLineProductId(line.productId);
      if (id !== undefined) {
        ids.push(id);
      }
    }
    return ids;
  }

  if (payload.productId !== undefined) {
    const id = readLineProductId(payload.productId);
    if (id !== undefined) {
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Blocks sales document posting when a product line carries a placeholder
 * productId (0 or 1). Only blocks when productId is actually present, so
 * service/non-product lines that omit productId are unaffected.
 */
export function enforceSalesProductLineProductIdOrThrow(payload: unknown): void {
  for (const productId of collectSalesProductLineProductIds(payload)) {
    if (PLACEHOLDER_PRODUCT_IDS.has(productId)) {
      throw new Error(
        `Red stopped before posting because a product line uses placeholder productId ${productId}. Select a real product from brc_list_products before posting, or omit productId only if the BRC endpoint supports non-product service lines. Do not use placeholder productId values such as 0 or 1.`
      );
    }
  }
}

export function requireSalesRepFields(
  saleRepId: number | undefined,
  saleRepCode: string | undefined
): { saleRepId: number; saleRepCode: string } {
  if (
    saleRepId === undefined ||
    !Number.isFinite(saleRepId) ||
    saleRepId <= 0 ||
    saleRepCode === undefined ||
    saleRepCode === ""
  ) {
    throw new Error(
      "Sales document payload requires saleRepId and saleRepCode. Choose a sales rep from brc_list_sales_reps."
    );
  }
  return { saleRepId, saleRepCode };
}

export function requireSalesRepInPayload(payload: Record<string, unknown>): void {
  requireSalesRepFields(
    payload.saleRepId !== undefined ? asNumber(payload.saleRepId) : undefined,
    payload.saleRepCode !== undefined ? asString(payload.saleRepCode) : undefined
  );
}

function requireVatRateId(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      "Product payload requires vatRateId. Choose a VAT rate from brc_list_vat_rates for the connected company."
    );
  }

  const vatRateId = Number(value);
  if (!Number.isFinite(vatRateId) || vatRateId <= 0) {
    throw new Error(
      "Product payload requires a valid vatRateId. Choose a VAT rate from brc_list_vat_rates for the connected company."
    );
  }

  return vatRateId;
}

export function buildProductPayload(args: Record<string, unknown>) {
  const code = asString(args.stockCode ?? args.code);
  const details = Array.isArray(args.details) ? asStringArray(args.details) : asStringArray(args.details ?? args.description ?? args.name);
  return {
    id: asNumber(args.id, 0),
    stockCode: code,
    unitPrice: asNumber(args.unitPrice ?? args.price, 0),
    grossUnitPrice: Boolean(args.grossUnitPrice ?? false),
    hasDefaultVatRate: args.hasDefaultVatRate !== undefined ? Boolean(args.hasDefaultVatRate) : Boolean(args.useDefaultVatRate ?? true),
    vatRateId: requireVatRateId(args.vatRateId),
    details: details.length ? details : [code],
    vatAnalysisTypeId: asNumber(args.vatAnalysisTypeId, 1),
    productTypeId: asNumber(args.productTypeId, 4),
  };
}

export function buildCustomerLikePayload(args: Record<string, unknown>, ownerTypeId: 1 | 3) {
  const code = asString(args.code ?? args.acCode);
  return {
    ...(args.id !== undefined ? { id: asNumber(args.id) } : {}),
    ownerTypeId,
    code,
    name: asString(args.name, code),
    contact: asString(args.contact ?? args.contactName),
    email: asString(args.email),
    phone: asString(args.phone),
    mobile: asString(args.mobile),
    fax: asString(args.fax),
    vatReg: asString(args.vatReg),
    address: asStringArray(args.address ?? args.address1),
    additionalEmails: Array.isArray(args.additionalEmails) ? args.additionalEmails : [],
    vatAnalysisTypeId: asNumber(args.vatAnalysisTypeId, 0),
    vatType: typeof args.vatType === "number" ? args.vatType : 1,
    businessIdentifierCode: asString(args.businessIdentifierCode),
    internationalBankAccountNumber: asString(args.internationalBankAccountNumber),
  };
}

function sanitizeCashReceiptInput(
  args: Record<string, unknown>,
  vatOnCashEnabled: boolean
): Record<string, unknown> {
  if (vatOnCashEnabled) return args;

  const next: Record<string, unknown> = { ...args };

  delete next.vatRateId;
  delete next.vatPercentage;
  delete next.percentage;
  delete next.vatTypeId;
  delete next.totalNet;
  delete next.totalVat;
  delete next.totalVAT;
  delete next.vatEntries;

  if (Array.isArray(next.acEntries) && next.acEntries.length > 0) {
    next.acEntries = [];
  }

  const total = round2(asNumber(next.total));
  if (total > 0) {
    if (next.customerId !== undefined || next.acCode !== undefined) {
      const ledger = asNumber(next.ledger);
      next.ledger = round2(ledger > 0 ? ledger : total);
      next.unallocated = round2(asNumber(next.unallocated));
    }
  }

  return next;
}

export function buildCashReceiptPayload(
  args: Record<string, unknown>,
  options?: { vatOnCashEnabled?: boolean }
) {
  const argsForBuild = sanitizeCashReceiptInput(
    args,
    options?.vatOnCashEnabled ?? true
  );

  const total = round2(asNumber(argsForBuild.total));
  const entryDate = asString(argsForBuild.entryDate, todayIsoDate());
  const procDate = asString(argsForBuild.procDate, entryDate);

  const note = asString(
    argsForBuild.note ?? argsForBuild.details ?? argsForBuild.description,
    "Cash receipt"
  );

  const reference = asString(argsForBuild.reference);
  const discount = round2(asNumber(argsForBuild.discount, 0));

  const rawAcEntries = Array.isArray(argsForBuild.acEntries)
    ? (argsForBuild.acEntries as unknown[])
    : [];

  const rawVatEntries = Array.isArray(argsForBuild.vatEntries)
    ? (argsForBuild.vatEntries as unknown[])
    : [];

  const hasRawVatSplit = rawAcEntries.length > 0 && rawVatEntries.length > 0;

  // If a raw VAT-split payload was supplied, preserve it.
  // This is needed for stricter/paid BRC companies that reject simple ledger-only receipts.
  if (hasRawVatSplit) {
    const { payload: _payload, ...cleanArgs } = argsForBuild;
    const payload: Record<string, unknown> = {
      ...cleanArgs,
      id: asNumber(argsForBuild.id, 0),
      bookTranTypeId: asNumber(argsForBuild.bookTranTypeId, 1),
      note,
      entryDate,
      procDate,
      total,
      reference,
      discount,
      customFields: Array.isArray(argsForBuild.customFields) ? argsForBuild.customFields : [],
      detailCollection: Array.isArray(argsForBuild.detailCollection)
        ? argsForBuild.detailCollection
        : [note],
      acEntries: rawAcEntries,
      vatEntries: rawVatEntries,
    };

    if (argsForBuild.unallocated !== undefined) {
      payload.unallocated = round2(asNumber(argsForBuild.unallocated, 0));
    } else {
      payload.unallocated = 0;
    }

    if (argsForBuild.ledger !== undefined) {
      payload.ledger = round2(asNumber(argsForBuild.ledger, 0));
    } else {
      payload.ledger = 0;
    }

    if (argsForBuild.vatTypeId !== undefined) {
      payload.vatTypeId = asNumber(argsForBuild.vatTypeId, 1);
    }

    if (argsForBuild.totalNet !== undefined) {
      payload.totalNet = round2(asNumber(argsForBuild.totalNet));
    }

    if (argsForBuild.totalVat !== undefined) {
      payload.totalVat = round2(asNumber(argsForBuild.totalVat));
    }

    if (argsForBuild.totalVAT !== undefined) {
      payload.totalVAT = round2(asNumber(argsForBuild.totalVAT));
    }

    return applyCashReceiptConcurrencyFields(payload, argsForBuild);
  }

  const analysisCategoryId =
    argsForBuild.analysisCategoryId !== undefined
      ? asNumber(argsForBuild.analysisCategoryId)
      : undefined;

  const accountCode =
    argsForBuild.accountCode !== undefined ? asString(argsForBuild.accountCode) : undefined;

  const description = asString(
    argsForBuild.description ?? argsForBuild.details ?? argsForBuild.note,
    "Cash receipt"
  );

  const vatRateId =
    argsForBuild.vatRateId !== undefined ? asNumber(argsForBuild.vatRateId) : undefined;

  const vatPercentage =
    argsForBuild.vatPercentage !== undefined
      ? asNumber(argsForBuild.vatPercentage)
      : argsForBuild.percentage !== undefined
        ? asNumber(argsForBuild.percentage)
        : undefined;

  const hasFlatVatSplit =
    analysisCategoryId !== undefined &&
    accountCode !== undefined &&
    vatRateId !== undefined &&
    vatPercentage !== undefined;

  const net = hasFlatVatSplit
    ? round2(total / (1 + vatPercentage / 100))
    : total;

  const vat = hasFlatVatSplit ? round2(total - net) : 0;

  const ledger = hasFlatVatSplit
    ? 0
    : round2(
        asNumber(
          argsForBuild.ledger,
          argsForBuild.customerId !== undefined || argsForBuild.acCode !== undefined ? total : 0
        )
      );

  const payload: Record<string, unknown> = {
    id: asNumber(argsForBuild.id, 0),
    bookTranTypeId: asNumber(argsForBuild.bookTranTypeId, 1),
    note,
    entryDate,
    procDate,
    total,
    reference,
    customFields: [],
    discount,
    unallocated: hasFlatVatSplit ? 0 : ledger > 0 ? total : 0,
    ledger,
    detailCollection: [description],
    acEntries: [],
    vatEntries: [],
  };

  if (!hasFlatVatSplit) {
    if (argsForBuild.customerId !== undefined) {
      payload.customerId = asNumber(argsForBuild.customerId);
    }

    if (argsForBuild.acCode !== undefined) {
      payload.acCode = asString(argsForBuild.acCode);
    }
  }

  if (hasFlatVatSplit) {
    payload.acEntries = [
      {
        id: 0,
        accountCode,
        analysisCategoryId,
        description,
        value: total,
      },
    ];

    payload.vatEntries = [
      {
        id: 0,
        vatRateId,
        percentage: vatPercentage,
        amount: net,
      },
    ];

    payload.vatTypeId = asNumber(argsForBuild.vatTypeId, 1);
    payload.totalNet = net;
    payload.totalVAT = vat;
  }

  return applyCashReceiptConcurrencyFields(payload, argsForBuild);
}

/** Re-applies BRC GET fields that buildCashReceiptPayload drops — required for PUT concurrency. */
export function mergeCashReceiptUpdateFromCurrent(
  built: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, unknown> {
  const id = asNumber(current.id, 0);
  if (id <= 0) return built;

  const merged: Record<string, unknown> = { ...built };

  if (typeof current.timestamp === "string" && current.timestamp) {
    merged.timestamp = current.timestamp;
  }

  for (const key of [
    "reference",
    "plaidTransactionId",
    "vatTypeId",
    "ledger",
    "unallocated",
    "totalNet",
    "totalVat",
    "totalVAT",
  ]) {
    if (key in current) merged[key] = current[key];
  }

  if (Array.isArray(current.customFields)) {
    merged.customFields = current.customFields;
  }

  if (Array.isArray(current.detailCollection) && current.detailCollection.length > 0) {
    merged.detailCollection = current.detailCollection;
  }

  if (Array.isArray(current.acEntries)) {
    merged.acEntries = current.acEntries;
  }

  if (Array.isArray(current.vatEntries)) {
    merged.vatEntries = current.vatEntries;
  }

  return merged;
}

function applyCashReceiptConcurrencyFields(
  payload: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (typeof args.timestamp === "string" && args.timestamp) {
    return { ...payload, timestamp: args.timestamp };
  }
  return payload;
}

export function normalizeBatchItems(
  path: string,
  items: Record<string, unknown>[],
  options?: { vatOnCashReceiptEnabled?: boolean }
) {
  return items.map((entry) => {
    const opCode = entry.opCode ?? entry.OpCode ?? 1;
    const raw = (entry.item ?? entry.Item ?? entry) as Record<string, unknown>;
    let item = raw;

    if (path === "/v1/products") item = buildProductPayload(raw);
    if (path === "/v1/customers") item = buildCustomerLikePayload(raw, 1);
    if (path === "/v1/suppliers") item = buildCustomerLikePayload(raw, 3);
    if (path === "/v1/bankAccounts") item = buildBankAccountPayload(raw);
    if (path === "/v1/cashReceipts") {
      item = buildCashReceiptPayload(raw, {
        vatOnCashEnabled: options?.vatOnCashReceiptEnabled ?? true,
      });
    }
    if (path === "/v1/payments") item = buildPaymentPayload({ ...(raw as any), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), entryDate: asString(raw.entryDate, todayIsoDate()), note: asString(raw.note ?? raw.description, "Batch payment"), bookTranTypeId: asNumber(raw.bookTranTypeId, 3) } as any);
    if (path === "/v1/cashPayments") item = buildCashPaymentPayload({ ...(raw as any), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), entryDate: asString(raw.entryDate, todayIsoDate()), note: asString(raw.note ?? raw.details ?? raw.description, "Batch cash payment"), bookTranTypeId: asNumber(raw.bookTranTypeId, 2) } as any);
    if (path === "/v1/purchases") item = buildPurchasePayload({ ...(raw as any), supplierId: asString(raw.supplierId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch purchase"), bookTranTypeId: asNumber(raw.bookTranTypeId, 4), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch purchase"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23) } as any);
    if (path === "/v1/salesEntries") item = buildSimpleSalesEntryPayload({ ...(raw as any), ownerId: asNumber(raw.customerId), ownerField: "customerId", acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch sales entry"), bookTranTypeId: asNumber(raw.bookTranTypeId, 5), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch sales entry"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23) } as any);
    if (path === "/v1/salesInvoices") item = buildSalesInvoicePayload({ ...(raw as any), customerId: asNumber(raw.customerId), customerName: raw.customerName !== undefined ? asString(raw.customerName) : (raw.name !== undefined ? asString(raw.name) : undefined), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: raw.note !== undefined ? asString(raw.note) : undefined, deliveryTo: raw.deliveryTo as any, bookTranTypeId: asNumber(raw.bookTranTypeId, 6), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch invoice"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined } as any);
    if (path === "/v1/salesCreditNotes") item = buildSalesCreditNotePayload({ ...(raw as any), customerId: asNumber(raw.customerId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch credit note"), bookTranTypeId: asNumber(raw.bookTranTypeId, 7), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch credit note"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined } as any);
    if (path === "/v1/quotes") {
      if (Array.isArray(raw.productTrans) && raw.productTrans.length > 0) {
        item = raw;
      } else {
        item = buildQuotePayload({ ...(raw as any), customerOwnerId: asNumber(raw.customerOwnerId), acCode: asString(raw.acCode), customerOwnerName: asString(raw.customerOwnerName ?? raw.note, "Batch customer"), comments: asString(raw.comments ?? raw.note, "Batch quote"), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), vatTypeId: asNumber(raw.vatTypeId, 1), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, 10)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), tranNote: asString(raw.tranNote ?? raw.description, "Batch quote"), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: raw.accountCode !== undefined ? asString(raw.accountCode) : undefined } as any);
      }
    }

    return { opCode, item };
  });
}

export function buildPurchasePayload(args: {
    supplierId: string;
    acCode: string;
    note: string;
    entryDate: string;
    procDate: string;
    bookTranTypeId: number;
    analysisCategoryId: number;
    accountCode: string;
    description: string;
    netAmount: number;
    vatRateId: number;
    vatPercentage: number;
  }) {
    const net = round2(args.netAmount);
    const vat = round2(net * (args.vatPercentage / 100));
    const total = round2(net + vat);
  
    return {
      supplierId: Number(args.supplierId),
      unallocated: total,
      unpaid: total,
      detailCollection: [],
      acEntries: [
        {
          id: 0,
          accountCode: args.accountCode,
          analysisCategoryId: args.analysisCategoryId,
          description: args.description,
          value: net,
        },
      ],
      vatEntries: [
        {
          id: 0,
          vatRateId: args.vatRateId,
          percentage: args.vatPercentage,
          amount: net,
        },
      ],
      postponedAccounting: false,
      isDiscrepancyAccepted: false,
      netGoods: 0,
      netServices: 0,
      vatTypeId: 1,
      totalNet: net,
      totalVAT: vat,
      id: 0,
      bookTranTypeId: args.bookTranTypeId,
      acCode: args.acCode,
      note: args.note,
      entryDate: args.entryDate,
      procDate: args.procDate,
      total,
      customFields: [],
    };
  }
  
  /**
   * Resolves the sales invoice document VAT type (`vatTypeId`) from the selected
   * customer's VAT type. Returns the customer's VAT type when present and valid,
   * otherwise Domestic (1). This sets the VAT *type* only and does not affect VAT
   * rate / VAT percentage selection.
   */
  export function resolveSalesInvoiceVatTypeId(customerVatType?: unknown): number {
    const n = Number(customerVatType);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  export function buildSalesInvoicePayload(args: {
    priceBasis?: "net" | "gross";
    customerId: number;
    customerName?: string;
    acCode: string;
    note?: string;
    deliveryTo?: string | string[];
    entryDate: string;
    procDate: string;
    bookTranTypeId: number;
    analysisCategoryId: number;
    accountCode: string;
    description: string;
    netAmount: number;
    vatRateId: number;
    vatPercentage: number;
    /**
     * Selected customer's VAT type (BRC customer `vatType`). When provided, the
     * sales invoice document VAT type (`vatTypeId`) defaults from it, mirroring
     * BRC manual invoice entry. Falls back to Domestic (1) only when missing.
     */
    customerVatType?: number;
    productId: number;
    productCode: string;
    quantity: number;
    unitPrice: number;
    saleRepId: number;
    saleRepCode: string;
    reference?: string;
    yourReference?: string;
    ourReference?: string;
  }) {

    const priceBasis = args.priceBasis ?? "net";
    const isGross = priceBasis === "gross";

    let calculatedNet: number;
    let vat: number;
    let total: number;

    if (isGross) {
      total = round2(args.quantity * args.unitPrice);
      calculatedNet = round2(total / (1 + args.vatPercentage / 100));
      vat = round2(total - calculatedNet);
    } else {
      calculatedNet = round2(args.quantity * args.unitPrice);

      if (round2(args.netAmount) !== calculatedNet) {
        throw new Error(
          `Invoice net amount must equal quantity * unit price. Received netAmount: ${args.netAmount}, calculated netAmount: ${calculatedNet}, quantity: ${args.quantity}, unitPrice: ${args.unitPrice}.`
        );
      }

      vat = round2(calculatedNet * (args.vatPercentage / 100));
      total = round2(calculatedNet + vat);
    }

    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
  
    const resolvedReference =
      args.reference ?? args.ourReference ?? args.yourReference;

    const resolvedNote = resolveSalesDocumentNote(args.note, args.customerName);
    const deliveryTo = normaliseDeliveryTo(args.deliveryTo);

    const payload: Record<string, unknown> = {
      productTrans: [
        {
          id: 0,
          amount: total,
          amountNet: calculatedNet,
          percentage: args.vatPercentage,
          productId: args.productId,
          productCode: args.productCode,
          quantity: args.quantity,
          unitPrice: args.unitPrice,
          vat,
          vatRateId: args.vatRateId,
          vatAnalysisTypeId: 1,
          useTaxInclusiveUnitPrice: isGross,
          tranNotes: [args.description],
          acEntries: [
            {
              id: 0,
              accountCode: args.accountCode,
              analysisCategoryId: args.analysisCategoryId,
              description: args.description,
              value: calculatedNet,
            },
          ],
        },
      ],
      quoteId: 0,
      saleRepId,
      saleRepCode,
      useTaxInclusiveUnitPrice: isGross,
      customerId: args.customerId,
      details: null,
      unpaid: total,
      netGoods: 0,
      netServices: 0,
      // Default the invoice VAT type from the selected customer (BRC manual
      // entry behaviour); fall back to Domestic (1) only when it is missing.
      // NOTE: this only sets the document VAT type. It deliberately does NOT
      // change VAT rate / VAT percentage selection. TODO: VAT-rate calculation
      // driven by VAT type should wait for Khoa's extracted BRC logic.
      vatTypeId: resolveSalesInvoiceVatTypeId(args.customerVatType),
      totalNet: calculatedNet,
      totalVAT: vat,
      id: 0,
      bookTranTypeId: args.bookTranTypeId,
      acCode: args.acCode,
      entryDate: args.entryDate,
      procDate: args.procDate,
      total,
      customFields: [],
    };

    if (resolvedNote !== undefined) {
      payload.note = resolvedNote;
    }

    if (deliveryTo !== undefined) {
      payload.deliveryTo = deliveryTo;
    }

    if (resolvedReference !== undefined) {
      payload.reference = resolvedReference;
      payload.ourReference = args.ourReference ?? resolvedReference;
      payload.yourReference = args.yourReference ?? resolvedReference;
    }

    return payload;
  }
  


export function buildSalesCreditNotePayload(args: {
  customerId: number;
  customerName?: string;
  acCode: string;
  note?: string;
  deliveryTo?: string | string[];
  entryDate: string;
  procDate: string;
  bookTranTypeId: number;
  analysisCategoryId: number;
  accountCode: string;
  description: string;
  netAmount: number;
  vatRateId: number;
  vatPercentage: number;
  productId: number;
  productCode: string;
  quantity: number;
  unitPrice: number;
  saleRepId: number;
  saleRepCode: string;
  reference?: string;
}) {
  const base = buildSalesInvoicePayload({ ...args, quantity: Math.abs(args.quantity), netAmount: Math.abs(args.netAmount) }) as Record<string, unknown>;
  const net = -round2(Math.abs(args.netAmount));
  const vat = -round2(Math.abs(args.netAmount) * (args.vatPercentage / 100));
  const total = round2(net + vat);
  base.totalNet = net;
  base.totalVAT = vat;
  base.total = total;
  base.unpaid = total;
  base.bookTranTypeId = args.bookTranTypeId;
  if (args.reference !== undefined) {
    base.reference = args.reference;
    base.ourReference = args.reference;
    base.yourReference = args.reference;
  } else {
    delete base.reference;
    delete base.ourReference;
    delete base.yourReference;
  }
  base.loType = "1";
  const pts = Array.isArray(base.productTrans) ? base.productTrans as Record<string, unknown>[] : [];
  if (pts[0]) {
    pts[0].quantity = -Math.abs(args.quantity);
    pts[0].amount = total;
    pts[0].amountNet = net;
    pts[0].vat = vat;
    pts[0].vatAmount = vat;
    const entries = Array.isArray(pts[0].acEntries) ? pts[0].acEntries as Record<string, unknown>[] : [];
    if (entries[0]) entries[0].value = net;
  }
  return base;
}

  export function buildSimpleSalesEntryPayload(args: {
    ownerId: number;
    ownerField: "customerId" | "supplierId";
    acCode: string;
    note: string;
    entryDate: string;
    procDate: string;
    bookTranTypeId: number;
    analysisCategoryId: number;
    accountCode: string;
    description: string;
    netAmount: number;
    vatRateId: number;
    vatPercentage: number;
  }) {
    const net = round2(args.netAmount);
    const vat = round2(net * (args.vatPercentage / 100));
    const total = round2(net + vat);
  
    return {
      [args.ownerField]: args.ownerId,
      unallocated: total,
      unpaid: total,
      detailCollection: [],
      acEntries: [
        {
          id: 0,
          accountCode: args.accountCode,
          analysisCategoryId: args.analysisCategoryId,
          description: args.description,
          value: net,
        },
      ],
      vatEntries: [
        {
          id: 0,
          vatRateId: args.vatRateId,
          percentage: args.vatPercentage,
          amount: net,
        },
      ],
      postponedAccounting: false,
      isDiscrepancyAccepted: false,
      netGoods: 0,
      netServices: 0,
      vatTypeId: 1,
      totalNet: net,
      totalVAT: vat,
      id: 0,
      bookTranTypeId: args.bookTranTypeId,
      acCode: args.acCode,
      note: args.note,
      entryDate: args.entryDate,
      procDate: args.procDate,
      total,
      customFields: [],
    };
  }
  
  export function buildQuotePayload(args: {
    companyId?: number;
    customerOwnerId: number;
    acCode: string;
    customerOwnerName: string;
    comments: string;
    entryDate: string;
    procDate: string;
    vatTypeId?: number;
    saleRepId: number;
    saleRepCode: string;
    reference?: string;
    poNumber?: string;
    ddNumber?: string;
    deliveryTo?: string | string[];
    layoutType?: number;
    productId: number;
    productCode: string;
    quantity: number;
    unitPrice: number;
    vatRateId: number;
    vatPercentage: number;
    tranNote: string;
    analysisCategoryId: number;
    accountCode: string;
  }) {
    const net = round2(args.quantity * args.unitPrice);
    const vat = round2(net * (args.vatPercentage / 100));
    const total = round2(net + vat);
    const companyId = requireQuoteCompanyId(args.companyId);
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
    const deliveryTo = normaliseDeliveryTo(args.deliveryTo);

    const payload: Record<string, unknown> = {
      companyId,
      customerOwnerId: args.customerOwnerId,
      vatTypeId: args.vatTypeId ?? 1,
      saleRepId,
      saleRepCode,
      saleInvoiceId: null,
      entryDate: args.entryDate,
      procDate: args.procDate,
      closedDate: null,
      customerOwnerName: args.customerOwnerName,
      comments: args.comments,
      layoutType: args.layoutType ?? 1,
      total,
      totalVat: vat,
      totalNet: net,
      note: args.customerOwnerName,
      acCode: args.acCode,
      productTrans: [
        {
          id: 0,
          companyId,
          percentage: args.vatPercentage,
          vatRateId: args.vatRateId,
          productId: args.productId,
          productCode: args.productCode,
          quantity: args.quantity,
          unitPrice: args.unitPrice,
          amount: total,
          vatAmount: vat,
          tranNotes: [args.tranNote],
          acEntries: [
            {
              id: 0,
              companyId,
              accountCode: args.accountCode,
              analysisCategoryId: args.analysisCategoryId,
              quoteProductTranId: 0,
              value: net,
            },
          ],
          vatAnalysisTypeId: 0,
        },
      ],
      customFields: [],
    };

    if (deliveryTo !== undefined) {
      payload.deliveryTo = deliveryTo;
      payload.deliveryList = deliveryTo.map((entry) => `"${entry}"`).join(",");
    }

    if (args.reference !== undefined) {
      payload.reference = args.reference;
    }
    if (args.poNumber !== undefined) {
      payload.poNumber = args.poNumber;
    }
    if (args.ddNumber !== undefined) {
      payload.ddNumber = args.ddNumber;
    }

    return payload;
  }
  
  export function buildBankAccountPayload(args: Record<string, unknown>) {
    const acCode = asString(args.acCode ?? args.code);
    const details = asString(args.details ?? args.name ?? args.accountName);
    const nominalAcCode = asString(
      args.nominalAcCode ?? args.accountCode ?? args.accountAcCode
    );
    const lastChq = asString(args.lastChq);
    const categoryId = asNumber(args.categoryId);
    const balance = asNumber(args.balance ?? args.oBalance, 0);
  
    if (!acCode || !details || !nominalAcCode || !lastChq) {
      throw new Error(
        "Bank account create requires acCode, details, nominalAcCode and lastChq. " +
          "The nominalAcCode must be an existing nominal account code in Big Red Cloud."
      );
    }
  
    return {
      id: asNumber(args.id, 0),
      acCode,
      details,
      lastChq,
      isDefaultBank: Boolean(args.isDefaultBank ?? false),
      balance,
      oBalance: balance,
      ...(categoryId ? { categoryId } : {}),
  
      // BRC bank account API requires an Account object.
      // Swagger confirms this works as: account: { acCode: "8101" }
      account: {
        acCode: nominalAcCode,
      },
  
      address: asStringArray(args.address),
      accountName: asString(args.accountName, details),
      businessIdentifierCode: asString(
        args.businessIdentifierCode ?? args.businessIdentifierCodes
      ),
      businessIdentifierCodes: asString(
        args.businessIdentifierCodes ?? args.businessIdentifierCode
      ),
      internationalBankAccountNumber: asString(args.internationalBankAccountNumber),
      creditorScheme: asString(args.creditorScheme),
      sortCode: asString(args.sortCode),
      accountNumber: asString(args.accountNumber),
      bankFeedsSource: asNumber(args.bankFeedsSource ?? args.bankFeedSource, 0),
      bankFeedSource: asNumber(args.bankFeedSource ?? args.bankFeedsSource, 0),
    };
  }

  export function buildPaymentPayload(args: {
    note: string;
    entryDate: string;
    procDate: string;
    bookTranTypeId: number;
    total: number;
    bankAccountId: number;
    bankAccountCode: string;
    supplierId?: number;
    acCode?: string;
    analysisCategoryId?: number;
    accountCode?: string;
    description?: string;
    reference?: string;
    discount?: number;
  }) {
    const total = round2(args.total);
    const discount = round2(args.discount ?? 0);

    if (args.supplierId !== undefined) {
      return {
        bankAccountId: args.bankAccountId,
        bankAccountCode: args.bankAccountCode,
        reference: args.reference ?? "",
        supplierId: args.supplierId,
        discount,
        unallocated: total,
        detailCollection: [],
        acEntries: [],
        id: 0,
        bookTranTypeId: args.bookTranTypeId,
        acCode: args.acCode,
        note: args.note,
        entryDate: args.entryDate,
        procDate: args.procDate,
        total,
        customFields: [],
      };
    }

    if (
      args.analysisCategoryId === undefined ||
      args.accountCode === undefined ||
      args.description === undefined
    ) {
      throw new Error(
        "Analysed payments require analysisCategoryId, accountCode, and description, or provide supplierId for a supplier payment."
      );
    }

    return {
      bankAccountId: args.bankAccountId,
      bankAccountCode: args.bankAccountCode,
      reference: args.reference ?? "",
      discount,
      unallocated: 0,
      detailCollection: [],
      acEntries: [
        {
          id: 0,
          accountCode: args.accountCode,
          analysisCategoryId: args.analysisCategoryId,
          description: args.description,
          value: total,
        },
      ],
      id: 0,
      bookTranTypeId: args.bookTranTypeId,
      note: args.note,
      entryDate: args.entryDate,
      procDate: args.procDate,
      total,
      customFields: [],
    };
  }

  export function buildCashPaymentPayload(args: {
    note: string;
    entryDate: string;
    procDate: string;
    bookTranTypeId: number;
    total: number;
    supplierId?: number;
    acCode?: string;
    ledger?: number;
    discount?: number;
    bankAccountId?: number;
    bankAccountCode?: string;
    lodgement?: number;
    analysisCategoryId?: number;
    accountCode?: string;
    description?: string;
  }) {
    const total = round2(args.total);
    const discount = round2(args.discount ?? 0);
    const lodgement = round2(args.lodgement ?? 0);
    const ledger = round2(args.ledger ?? 0);

    if (args.supplierId !== undefined) {
      if (ledger !== total) {
        throw new Error(
          `Supplier cash payments require ledger to equal total. Received ledger: ${ledger}, total: ${total}.`
        );
      }

      return {
        discount,
        bankAccountCode: args.bankAccountCode ?? undefined,
        bankAccountId: args.bankAccountId ?? undefined,
        supplierId: args.supplierId,
        lodgement: 0,
        ledger,
        detailCollection: [],
        acEntries: [],
        id: 0,
        bookTranTypeId: args.bookTranTypeId,
        acCode: args.acCode,
        note: args.note,
        entryDate: args.entryDate,
        procDate: args.procDate,
        total,
        customFields: [],
      };
    }

    if (lodgement > 0) {
      if (args.bankAccountId === undefined || args.bankAccountCode === undefined) {
        throw new Error("Lodgement cash payments require bankAccountId and bankAccountCode.");
      }

      if (lodgement !== total) {
        throw new Error(
          `Lodgement cash payments require lodgement to equal total. Received lodgement: ${lodgement}, total: ${total}.`
        );
      }

      return {
        discount,
        bankAccountCode: args.bankAccountCode,
        bankAccountId: args.bankAccountId,
        lodgement,
        ledger: 0,
        detailCollection: [],
        acEntries: [],
        id: 0,
        bookTranTypeId: args.bookTranTypeId,
        note: args.note,
        entryDate: args.entryDate,
        procDate: args.procDate,
        total,
        customFields: [],
      };
    }

    if (
      args.analysisCategoryId === undefined ||
      args.accountCode === undefined ||
      args.description === undefined
    ) {
      throw new Error(
        "Analysis cash payments require analysisCategoryId, accountCode, and description, or provide supplierId / lodgement details."
      );
    }

    return {
      discount,
      lodgement: 0,
      ledger: 0,
      detailCollection: [],
      acEntries: [
        {
          id: 0,
          accountCode: args.accountCode,
          analysisCategoryId: args.analysisCategoryId,
          description: args.description,
          value: total,
        },
      ],
      id: 0,
      bookTranTypeId: args.bookTranTypeId,
      note: args.note,
      entryDate: args.entryDate,
      procDate: args.procDate,
      total,
      customFields: [],
    };
  }
