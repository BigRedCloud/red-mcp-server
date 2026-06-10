import { sanitizeCashReceiptInput } from "../../cash_receipt_settings.js";
import {z} from "zod";
import type {ServerType} from "../../server.js"
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
    if (path === "/v1/salesInvoices") item = buildSalesInvoicePayload({ ...(raw as any), customerId: asNumber(raw.customerId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch invoice"), bookTranTypeId: asNumber(raw.bookTranTypeId, 6), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch invoice"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined } as any);
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
  
  export function buildSalesInvoicePayload(args: {
    customerId: number;
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
    const calculatedNet = round2(args.quantity * args.unitPrice);
  
    if (round2(args.netAmount) !== calculatedNet) {
      throw new Error(
        `Invoice net amount must equal quantity * unit price. Received netAmount: ${args.netAmount}, calculated netAmount: ${calculatedNet}, quantity: ${args.quantity}, unitPrice: ${args.unitPrice}.`
      );
    }
  
    const vat = round2(calculatedNet * (args.vatPercentage / 100));
    const total = round2(calculatedNet + vat);
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
  
    return {
      ourReference: args.ourReference ?? args.reference ?? "MCP_TEST",
      yourReference: args.yourReference ?? args.reference ?? "MCP_TEST",
      deliveryTo: ["MCP Test"],
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
          useTaxInclusiveUnitPrice: false,
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
      useTaxInclusiveUnitPrice: false,
      customerId: args.customerId,
      reference: args.reference ?? "MCP_TEST",
      details: null,
      unpaid: total,
      netGoods: 0,
      netServices: 0,
      vatTypeId: 1,
      totalNet: calculatedNet,
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
  


export function buildSalesCreditNotePayload(args: {
  customerId: number;
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
  base.reference = args.reference ?? "MCP_TEST_CN";
  base.ourReference = args.reference ?? "MCP_TEST_CN";
  base.yourReference = args.reference ?? "MCP_TEST_CN";
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
    layoutType?: number;
    productId: number;
    productCode: string;
    quantity: number;
    unitPrice: number;
    vatRateId: number;
    vatPercentage: number;
    tranNote: string;
    analysisCategoryId: number;
    accountCode?: string;
  }) {
    const net = round2(args.quantity * args.unitPrice);
    const vat = round2(net * (args.vatPercentage / 100));
    const total = round2(net + vat);
    const companyId = requireQuoteCompanyId(args.companyId);
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
  
    return {
      companyId,
      customerOwnerId: args.customerOwnerId,
      vatTypeId: args.vatTypeId ?? 1,
      saleRepId,
      saleRepCode,
      saleInvoiceId: null,
      entryDate: args.entryDate,
      procDate: args.procDate,
      closedDate: null,
      reference: args.reference ?? args.poNumber ?? args.ddNumber ?? `MCP_QUOTE_${Date.now()}`,
      poNumber: args.poNumber ?? args.reference ?? `MCP_PO_${Date.now()}`,
      ddNumber: args.ddNumber ?? args.reference ?? `MCP_DD_${Date.now()}`,
      customerOwnerName: args.customerOwnerName,
      deliveryList: "\"MCP Test\"",
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
              accountCode: args.accountCode ?? null,
              analysisCategoryId: args.analysisCategoryId,
              quoteProductTranId: 0,
              value: net,
            },
          ],
          vatAnalysisTypeId: 0,
        },
      ],
      deliveryTo: ["MCP Test"],
      customFields: [],
    };
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
