import { round2 } from "../../shared.js";
export function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}
export function unwrapPayload(args) {
    const { payload, ...rest } = args;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return {
            ...rest,
            ...payload,
        };
    }
    return { ...rest };
}
function asString(value, fallback = "") {
    if (value === undefined || value === null)
        return fallback;
    return String(value);
}
function asNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function asStringArray(value) {
    if (Array.isArray(value))
        return value.map(v => String(v));
    if (value === undefined || value === null || value === "")
        return [];
    return [String(value)];
}
function requireQuoteCompanyId(companyId) {
    if (companyId === undefined || !Number.isFinite(companyId) || companyId <= 0) {
        throw new Error("Quote payload requires companyId. Provide the connected company's id from existing records such as customers, products, or sales reps.");
    }
    return companyId;
}
export const SALES_DOCUMENT_SALES_REP_REQUIRED_DESCRIPTION = "Requires saleRepId and saleRepCode. Do not use default or demo sales rep values. If missing, list sales reps or ask the user to choose one before creating.";
export const SALES_DOCUMENT_ANALYSIS_CATEGORY_DESCRIPTION = "Requires analysisCategoryId and accountCode from a Sales Analysis category on each product line. Do not default to CR01/Customer or the first listed category. Set confirmCrAnalysisCategory=true only after the user confirms a CR account code is intentional.";
const SALES_ANALYSIS_STOP_PREFIX = "Red stopped before posting because sales analysis details need attention.";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function salesAnalysisPreflightError(detail) {
    return new Error(`${SALES_ANALYSIS_STOP_PREFIX}\n\n${detail}`);
}
function normaliseAnalysisAccountCode(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed !== "" ? trimmed : undefined;
}
function isValidAnalysisCategoryId(value) {
    const id = Number(value);
    return Number.isFinite(id) && id > 0;
}
function salesDocumentLabel(workflow) {
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
function collectProductLineAnalysis(payload) {
    if (!isRecord(payload)) {
        return [];
    }
    const fromProductTrans = [];
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
    if (payload.analysisCategoryId !== undefined ||
        payload.accountCode !== undefined) {
        return [
            {
                accountCode: normaliseAnalysisAccountCode(payload.accountCode),
                analysisCategoryId: payload.analysisCategoryId,
            },
        ];
    }
    return [];
}
export function enforceSalesProductLineAnalysisOrThrow(payload, workflow, options) {
    const documentLabel = salesDocumentLabel(workflow);
    const lines = collectProductLineAnalysis(payload);
    if (lines.length === 0) {
        throw salesAnalysisPreflightError(`Red needs a Sales Analysis category for this ${documentLabel} product line. Provide analysisCategoryId and accountCode from the Sales book. Do not use Customer (CR) categories unless the user confirms that choice.`);
    }
    for (const line of lines) {
        if (!isValidAnalysisCategoryId(line.analysisCategoryId) || !line.accountCode) {
            throw salesAnalysisPreflightError(`Red needs a Sales Analysis category for this ${documentLabel} product line. Provide analysisCategoryId and accountCode from the Sales book. Do not default to CR01, Customer, or the first listed analysis category.`);
        }
        if (line.accountCode.toUpperCase().startsWith("CR") &&
            options?.confirmCrAnalysisCategory !== true) {
            throw salesAnalysisPreflightError(`The sales analysis account code "${line.accountCode}" looks like a Customer (CR) category on this ${documentLabel} product line. Red blocked posting because CR categories are unusual here. Ask the user to confirm that category is intentional, then retry with confirmCrAnalysisCategory=true.`);
        }
    }
}
export function requireSalesRepFields(saleRepId, saleRepCode) {
    if (saleRepId === undefined ||
        !Number.isFinite(saleRepId) ||
        saleRepId <= 0 ||
        saleRepCode === undefined ||
        saleRepCode === "") {
        throw new Error("Sales document payload requires saleRepId and saleRepCode. Choose a sales rep from brc_list_sales_reps.");
    }
    return { saleRepId, saleRepCode };
}
export function requireSalesRepInPayload(payload) {
    requireSalesRepFields(payload.saleRepId !== undefined ? asNumber(payload.saleRepId) : undefined, payload.saleRepCode !== undefined ? asString(payload.saleRepCode) : undefined);
}
function requireVatRateId(value) {
    if (value === undefined || value === null || value === "") {
        throw new Error("Product payload requires vatRateId. Choose a VAT rate from brc_list_vat_rates for the connected company.");
    }
    const vatRateId = Number(value);
    if (!Number.isFinite(vatRateId) || vatRateId <= 0) {
        throw new Error("Product payload requires a valid vatRateId. Choose a VAT rate from brc_list_vat_rates for the connected company.");
    }
    return vatRateId;
}
export function buildProductPayload(args) {
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
export function buildCustomerLikePayload(args, ownerTypeId) {
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
function sanitizeCashReceiptInput(args, vatOnCashEnabled) {
    if (vatOnCashEnabled)
        return args;
    const next = { ...args };
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
export function buildCashReceiptPayload(args, options) {
    const argsForBuild = sanitizeCashReceiptInput(args, options?.vatOnCashEnabled ?? true);
    const total = round2(asNumber(argsForBuild.total));
    const entryDate = asString(argsForBuild.entryDate, todayIsoDate());
    const procDate = asString(argsForBuild.procDate, entryDate);
    const note = asString(argsForBuild.note ?? argsForBuild.details ?? argsForBuild.description, "Cash receipt");
    const reference = asString(argsForBuild.reference);
    const discount = round2(asNumber(argsForBuild.discount, 0));
    const rawAcEntries = Array.isArray(argsForBuild.acEntries)
        ? argsForBuild.acEntries
        : [];
    const rawVatEntries = Array.isArray(argsForBuild.vatEntries)
        ? argsForBuild.vatEntries
        : [];
    const hasRawVatSplit = rawAcEntries.length > 0 && rawVatEntries.length > 0;
    // If a raw VAT-split payload was supplied, preserve it.
    // This is needed for stricter/paid BRC companies that reject simple ledger-only receipts.
    if (hasRawVatSplit) {
        const { payload: _payload, ...cleanArgs } = argsForBuild;
        const payload = {
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
        }
        else {
            payload.unallocated = 0;
        }
        if (argsForBuild.ledger !== undefined) {
            payload.ledger = round2(asNumber(argsForBuild.ledger, 0));
        }
        else {
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
    const analysisCategoryId = argsForBuild.analysisCategoryId !== undefined
        ? asNumber(argsForBuild.analysisCategoryId)
        : undefined;
    const accountCode = argsForBuild.accountCode !== undefined ? asString(argsForBuild.accountCode) : undefined;
    const description = asString(argsForBuild.description ?? argsForBuild.details ?? argsForBuild.note, "Cash receipt");
    const vatRateId = argsForBuild.vatRateId !== undefined ? asNumber(argsForBuild.vatRateId) : undefined;
    const vatPercentage = argsForBuild.vatPercentage !== undefined
        ? asNumber(argsForBuild.vatPercentage)
        : argsForBuild.percentage !== undefined
            ? asNumber(argsForBuild.percentage)
            : undefined;
    const hasFlatVatSplit = analysisCategoryId !== undefined &&
        accountCode !== undefined &&
        vatRateId !== undefined &&
        vatPercentage !== undefined;
    const net = hasFlatVatSplit
        ? round2(total / (1 + vatPercentage / 100))
        : total;
    const vat = hasFlatVatSplit ? round2(total - net) : 0;
    const ledger = hasFlatVatSplit
        ? 0
        : round2(asNumber(argsForBuild.ledger, argsForBuild.customerId !== undefined || argsForBuild.acCode !== undefined ? total : 0));
    const payload = {
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
export function mergeCashReceiptUpdateFromCurrent(built, current) {
    const id = asNumber(current.id, 0);
    if (id <= 0)
        return built;
    const merged = { ...built };
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
        if (key in current)
            merged[key] = current[key];
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
function applyCashReceiptConcurrencyFields(payload, args) {
    if (typeof args.timestamp === "string" && args.timestamp) {
        return { ...payload, timestamp: args.timestamp };
    }
    return payload;
}
export function normalizeBatchItems(path, items, options) {
    return items.map((entry) => {
        const opCode = entry.opCode ?? entry.OpCode ?? 1;
        const raw = (entry.item ?? entry.Item ?? entry);
        let item = raw;
        if (path === "/v1/products")
            item = buildProductPayload(raw);
        if (path === "/v1/customers")
            item = buildCustomerLikePayload(raw, 1);
        if (path === "/v1/suppliers")
            item = buildCustomerLikePayload(raw, 3);
        if (path === "/v1/bankAccounts")
            item = buildBankAccountPayload(raw);
        if (path === "/v1/cashReceipts") {
            item = buildCashReceiptPayload(raw, {
                vatOnCashEnabled: options?.vatOnCashReceiptEnabled ?? true,
            });
        }
        if (path === "/v1/payments")
            item = buildPaymentPayload({ ...raw, procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), entryDate: asString(raw.entryDate, todayIsoDate()), note: asString(raw.note ?? raw.description, "Batch payment"), bookTranTypeId: asNumber(raw.bookTranTypeId, 3) });
        if (path === "/v1/cashPayments")
            item = buildCashPaymentPayload({ ...raw, procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), entryDate: asString(raw.entryDate, todayIsoDate()), note: asString(raw.note ?? raw.details ?? raw.description, "Batch cash payment"), bookTranTypeId: asNumber(raw.bookTranTypeId, 2) });
        if (path === "/v1/purchases")
            item = buildPurchasePayload({ ...raw, supplierId: asString(raw.supplierId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch purchase"), bookTranTypeId: asNumber(raw.bookTranTypeId, 4), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch purchase"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23) });
        if (path === "/v1/salesEntries")
            item = buildSimpleSalesEntryPayload({ ...raw, ownerId: asNumber(raw.customerId), ownerField: "customerId", acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch sales entry"), bookTranTypeId: asNumber(raw.bookTranTypeId, 5), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch sales entry"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23) });
        if (path === "/v1/salesInvoices")
            item = buildSalesInvoicePayload({ ...raw, customerId: asNumber(raw.customerId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch invoice"), bookTranTypeId: asNumber(raw.bookTranTypeId, 6), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch invoice"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined });
        if (path === "/v1/salesCreditNotes")
            item = buildSalesCreditNotePayload({ ...raw, customerId: asNumber(raw.customerId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch credit note"), bookTranTypeId: asNumber(raw.bookTranTypeId, 7), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch credit note"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined });
        if (path === "/v1/quotes") {
            if (Array.isArray(raw.productTrans) && raw.productTrans.length > 0) {
                item = raw;
            }
            else {
                item = buildQuotePayload({ ...raw, customerOwnerId: asNumber(raw.customerOwnerId), acCode: asString(raw.acCode), customerOwnerName: asString(raw.customerOwnerName ?? raw.note, "Batch customer"), comments: asString(raw.comments ?? raw.note, "Batch quote"), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), vatTypeId: asNumber(raw.vatTypeId, 1), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, 10)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), tranNote: asString(raw.tranNote ?? raw.description, "Batch quote"), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: raw.accountCode !== undefined ? asString(raw.accountCode) : undefined });
            }
        }
        return { opCode, item };
    });
}
export function buildPurchasePayload(args) {
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
export function buildSalesInvoicePayload(args) {
    const calculatedNet = round2(args.quantity * args.unitPrice);
    if (round2(args.netAmount) !== calculatedNet) {
        throw new Error(`Invoice net amount must equal quantity * unit price. Received netAmount: ${args.netAmount}, calculated netAmount: ${calculatedNet}, quantity: ${args.quantity}, unitPrice: ${args.unitPrice}.`);
    }
    const vat = round2(calculatedNet * (args.vatPercentage / 100));
    const total = round2(calculatedNet + vat);
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
    const resolvedReference = args.reference ?? args.ourReference ?? args.yourReference;
    const payload = {
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
    if (resolvedReference !== undefined) {
        payload.reference = resolvedReference;
        payload.ourReference = args.ourReference ?? resolvedReference;
        payload.yourReference = args.yourReference ?? resolvedReference;
    }
    return payload;
}
export function buildSalesCreditNotePayload(args) {
    const base = buildSalesInvoicePayload({ ...args, quantity: Math.abs(args.quantity), netAmount: Math.abs(args.netAmount) });
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
    }
    else {
        delete base.reference;
        delete base.ourReference;
        delete base.yourReference;
    }
    base.loType = "1";
    const pts = Array.isArray(base.productTrans) ? base.productTrans : [];
    if (pts[0]) {
        pts[0].quantity = -Math.abs(args.quantity);
        pts[0].amount = total;
        pts[0].amountNet = net;
        pts[0].vat = vat;
        pts[0].vatAmount = vat;
        const entries = Array.isArray(pts[0].acEntries) ? pts[0].acEntries : [];
        if (entries[0])
            entries[0].value = net;
    }
    return base;
}
export function buildSimpleSalesEntryPayload(args) {
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
export function buildQuotePayload(args) {
    const net = round2(args.quantity * args.unitPrice);
    const vat = round2(net * (args.vatPercentage / 100));
    const total = round2(net + vat);
    const companyId = requireQuoteCompanyId(args.companyId);
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
    const payload = {
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
                        accountCode: args.accountCode,
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
export function buildBankAccountPayload(args) {
    const acCode = asString(args.acCode ?? args.code);
    const details = asString(args.details ?? args.name ?? args.accountName);
    const nominalAcCode = asString(args.nominalAcCode ?? args.accountCode ?? args.accountAcCode);
    const lastChq = asString(args.lastChq);
    const categoryId = asNumber(args.categoryId);
    const balance = asNumber(args.balance ?? args.oBalance, 0);
    if (!acCode || !details || !nominalAcCode || !lastChq) {
        throw new Error("Bank account create requires acCode, details, nominalAcCode and lastChq. " +
            "The nominalAcCode must be an existing nominal account code in Big Red Cloud.");
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
        businessIdentifierCode: asString(args.businessIdentifierCode ?? args.businessIdentifierCodes),
        businessIdentifierCodes: asString(args.businessIdentifierCodes ?? args.businessIdentifierCode),
        internationalBankAccountNumber: asString(args.internationalBankAccountNumber),
        creditorScheme: asString(args.creditorScheme),
        sortCode: asString(args.sortCode),
        accountNumber: asString(args.accountNumber),
        bankFeedsSource: asNumber(args.bankFeedsSource ?? args.bankFeedSource, 0),
        bankFeedSource: asNumber(args.bankFeedSource ?? args.bankFeedsSource, 0),
    };
}
export function buildPaymentPayload(args) {
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
    if (args.analysisCategoryId === undefined ||
        args.accountCode === undefined ||
        args.description === undefined) {
        throw new Error("Analysed payments require analysisCategoryId, accountCode, and description, or provide supplierId for a supplier payment.");
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
export function buildCashPaymentPayload(args) {
    const total = round2(args.total);
    const discount = round2(args.discount ?? 0);
    const lodgement = round2(args.lodgement ?? 0);
    const ledger = round2(args.ledger ?? 0);
    if (args.supplierId !== undefined) {
        if (ledger !== total) {
            throw new Error(`Supplier cash payments require ledger to equal total. Received ledger: ${ledger}, total: ${total}.`);
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
            throw new Error(`Lodgement cash payments require lodgement to equal total. Received lodgement: ${lodgement}, total: ${total}.`);
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
    if (args.analysisCategoryId === undefined ||
        args.accountCode === undefined ||
        args.description === undefined) {
        throw new Error("Analysis cash payments require analysisCategoryId, accountCode, and description, or provide supplierId / lodgement details.");
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
