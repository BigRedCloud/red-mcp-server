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
export const SALES_DOCUMENT_GROSS_PRICE_ENTRY_DESCRIPTION = 'When Gross Price Entry is enabled for sales invoicing, this tool requires priceBasis. Use priceBasis "gross" when unit prices are VAT-inclusive/gross, or priceBasis "net" when unit prices are VAT-exclusive/net. Do not tell the user to disable Gross Price Entry if they have provided priceBasis.';
export const SALES_DOCUMENT_PRICE_BASIS_DESCRIPTION = "Required when Gross Price Entry is enabled. Use `gross` when unit prices are VAT-inclusive/gross. Use `net` when unit prices are VAT-exclusive/net.";
export const SALES_DOCUMENT_NOTE_DESCRIPTION = 'Optional. BRC "Note" field on the sales document (JSON field `note`). Leave blank to default it to the customer name (BRC customer "Name" / JSON `name`). Do not use the product name as the note. Only set this when the user explicitly provides a note.';
export const SALES_DOCUMENT_CUSTOMER_NAME_DESCRIPTION = 'Optional. The selected customer\'s name (BRC customer "Name" / JSON `name`). Used as the default sales document note (BRC "Note" / JSON `note`) when no explicit note is given.';
export const SALES_DOCUMENT_DELIVERY_TO_DESCRIPTION = 'Optional. BRC "Delivery To" address (JSON field `deliveryTo`). Leave blank unless the user explicitly provides a delivery address. Do not invent or default a delivery address (for example "MCP Test").';
export const SALES_DOCUMENT_REFERENCE_DESCRIPTION = 'Optional. BRC "Reference" field (JSON field `reference`). BRC "Our Ref" (JSON `ourReference`) and BRC "Your Ref" (JSON `yourReference`) default to this value when not supplied separately.';
export const SALES_DOCUMENT_PRODUCT_LINE_DESCRIPTION_DESCRIPTION = 'Product line description shown on the document line (BRC product line description / JSON `tranNotes`, also used on the line\'s analysis entry description). This is the line narrative, not the BRC "Note" field.';
export const SALES_DOCUMENT_PRODUCT_FIELDS_DESCRIPTION = 'productCode is the BRC product "Code" (JSON `productCode`); productId is the BRC product "Id" (JSON `productId`) from brc_list_products. The product name is not a payload field — do not place it in the BRC "Note" field (JSON `note`).';
/**
 * Resolves the BRC sales document "Note" field (JSON `note`).
 *
 * Priority: an explicit user note, then the customer name (BRC customer "Name" /
 * JSON `name`), otherwise undefined so the caller omits `note` entirely. The
 * product name is never used as a default note.
 */
export function resolveSalesDocumentNote(note, customerName) {
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
export function normaliseDeliveryTo(value) {
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
export function applySalesPriceBasisToRawPayload(payload, priceBasis) {
    if (priceBasis !== "net" && priceBasis !== "gross") {
        return payload;
    }
    const useTaxInclusiveUnitPrice = priceBasis === "gross";
    const next = {
        ...payload,
        useTaxInclusiveUnitPrice,
    };
    if (Array.isArray(next.productTrans)) {
        next.productTrans = next.productTrans.map((line) => isRecord(line) ? { ...line, useTaxInclusiveUnitPrice } : line);
    }
    return next;
}
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
            throw salesAnalysisPreflightError(`The sales analysis account code "${line.accountCode}" looks like a Customer (CR) category on this ${documentLabel} product line. Red blocked posting because CR categories are unusual here. Ask the user in plain English, for example: "This analysis category appears to be a customer/CR category rather than a Sales category. Do you want to use it anyway, or should I choose a Sales analysis category?" Only retry with confirmCrAnalysisCategory=true after the user confirms that category is intentional.`);
        }
    }
}
/**
 * Placeholder product IDs that BRC rejects with a 500 error when posted on a
 * sales document product line. These are commonly emitted by models as filler
 * values instead of a real product from brc_list_products.
 */
export const PLACEHOLDER_PRODUCT_IDS = new Set([0, 1]);
export const SALES_DOCUMENT_PRODUCT_ID_DESCRIPTION = "Do not invent productId values and do not use productId 0 or 1 as placeholders. productId 0 and 1 are treated as placeholders and are blocked at runtime before preview-before-posting and before posting. If a product line is needed, first call brc_list_products and use a real product from the connected company. If no suitable product exists, ask the user whether to create/select a product, or use a service/non-product line only if the endpoint supports it.";
export const SALES_DOCUMENT_SALES_VAT_CATEGORY_DESCRIPTION = "Sales invoices must use Sales VAT rates. Purchase/non-Sales VAT rates are blocked before preview-before-posting and before posting, even if the VAT percentage matches.";
export const SALES_DOCUMENT_BATCH_SAFETY_DESCRIPTION = "Batch sales invoices apply the same safety checks as single sales invoices: productId 0/1 placeholder blocking before preview-before-posting and posting; Sales VAT category validation before preview-before-posting and posting; Gross Price Entry priceBasis handling; CR analysis category confirmation; and counterparty confirmation covering all listed customers. If the batch includes multiple customers, confirming means confirming all listed customers, not just one. Set confirmCrAnalysisCategory=true at batch level only after the user confirms CR sales analysis account codes are intentional. Per item, the BRC \"Note\" field (JSON `note`) defaults to the customer name when omitted (never the product name), and the BRC \"Delivery To\" address (JSON `deliveryTo`) is only included when explicitly provided.";
export const SALES_DOCUMENT_RAW_PAYLOAD_STRUCTURE_DESCRIPTION = "Raw BRC payloads for multi-line sales invoices must use `productTrans[]` (one object per product line). Each product line must include its own nested `acEntries[]` for Sales analysis posting — do not send a top-level `acEntries` array on the invoice. Required header fields include customerId, acCode, entryDate, procDate, saleRepId, saleRepCode, bookTranTypeId, totalNet, totalVAT, total, and unpaid. Red validates line amounts, nested analysis values, qty × unit price (using useTaxInclusiveUnitPrice), and header totals before posting, and returns all validation issues together when the payload does not reconcile. Preview-before-posting still shows what Red will post and waits for confirmation before anything is written to Big Red Cloud.";
export const NOMINAL_MONTHLY_MOVEMENTS_DESCRIPTION = "Month 1–Month 12 nominal figures are period movements for each financial month, not balances. Running balance = opening balance + cumulative monthly movements. Do not describe individual monthly movement values as monthly balances. If the user asks for balances over time, calculate them from opening balance plus cumulative movements, or explain that only movements are available.";
function readLineProductId(value) {
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
function collectSalesProductLineProductIds(payload) {
    if (!isRecord(payload)) {
        return [];
    }
    const ids = [];
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
export function enforceSalesProductLineProductIdOrThrow(payload) {
    for (const productId of collectSalesProductLineProductIds(payload)) {
        if (PLACEHOLDER_PRODUCT_IDS.has(productId)) {
            throw new Error(`Red stopped before posting because a product line uses placeholder productId ${productId}. Select a real product from brc_list_products before posting, or omit productId only if the BRC endpoint supports non-product service lines. Do not use placeholder productId values such as 0 or 1.`);
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
export const CUSTOMER_LIKE_REQUIRED_FIELDS = ["code", "name"];
/**
 * Required create fields for customers/suppliers. Optional fields (address,
 * contact, credit terms, VAT registration, etc.) must be omitted when the user
 * did not provide them — Red must not invent values.
 */
export function collectMissingCustomerLikeFields(args) {
    const missing = [];
    const code = asString(args.code ?? args.acCode).trim();
    const name = asString(args.name).trim();
    if (!code) {
        missing.push("code");
    }
    if (!name) {
        missing.push("name");
    }
    return missing;
}
export function buildMissingCustomerLikeInformationResponse(missingFields, ownerTypeId) {
    const entity = ownerTypeId === 1 ? "customer" : "supplier";
    return {
        error: "missing_information",
        entity,
        missingFields,
        message: [
            `Required ${entity} details are missing: ${missingFields.join(", ")}.`,
            `Ask the user for the missing values before calling the create tool again.`,
            `Omit optional fields the user did not provide (for example address, credit terms, VAT registration).`,
            `Do not invent placeholder values such as Test Address, Dublin, or default credit terms.`,
        ].join(" "),
    };
}
function optionalTrimmedString(value) {
    const text = asString(value).trim();
    return text ? text : undefined;
}
function optionalStringArray(value) {
    const items = asStringArray(value)
        .map((entry) => entry.trim())
        .filter(Boolean);
    return items.length > 0 ? items : undefined;
}
export function buildCustomerLikePayload(args, ownerTypeId) {
    const code = asString(args.code ?? args.acCode).trim();
    const name = asString(args.name).trim() || code;
    const payload = {
        ownerTypeId,
        code,
        name,
        vatAnalysisTypeId: asNumber(args.vatAnalysisTypeId, 0),
        vatType: typeof args.vatType === "number" ? args.vatType : 1,
    };
    if (args.id !== undefined) {
        payload.id = asNumber(args.id);
    }
    const contact = optionalTrimmedString(args.contact ?? args.contactName);
    if (contact) {
        payload.contact = contact;
    }
    const email = optionalTrimmedString(args.email);
    if (email) {
        payload.email = email;
    }
    const phone = optionalTrimmedString(args.phone);
    if (phone) {
        payload.phone = phone;
    }
    const mobile = optionalTrimmedString(args.mobile);
    if (mobile) {
        payload.mobile = mobile;
    }
    const fax = optionalTrimmedString(args.fax);
    if (fax) {
        payload.fax = fax;
    }
    const vatReg = optionalTrimmedString(args.vatReg);
    if (vatReg) {
        payload.vatReg = vatReg;
    }
    const address = optionalStringArray(args.address ?? args.address1);
    if (address) {
        payload.address = address;
    }
    if (Array.isArray(args.additionalEmails) && args.additionalEmails.length > 0) {
        payload.additionalEmails = args.additionalEmails;
    }
    const bic = optionalTrimmedString(args.businessIdentifierCode);
    if (bic) {
        payload.businessIdentifierCode = bic;
    }
    const iban = optionalTrimmedString(args.internationalBankAccountNumber);
    if (iban) {
        payload.internationalBankAccountNumber = iban;
    }
    // Only pass through credit/VAT flags when the caller explicitly supplied them.
    if (args.creditTerms !== undefined && args.creditTerms !== null && args.creditTerms !== "") {
        payload.creditTerms = args.creditTerms;
    }
    if (typeof args.vatRegistered === "boolean") {
        payload.vatRegistered = args.vatRegistered;
    }
    return payload;
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
/**
 * Cash Receipt acEntries use accountCode / analysisCategoryId / description /
 * value only — never Sales Invoice-style netAmount / vatAmount / vatRateId /
 * vatPercentage.
 */
function normalizeCashReceiptAcEntry(entry, fallbackDescription) {
    const source = isRecord(entry) ? entry : {};
    const value = source.value !== undefined
        ? round2(asNumber(source.value))
        : source.netAmount !== undefined
            ? round2(asNumber(source.netAmount))
            : 0;
    const normalized = {
        accountCode: asString(source.accountCode),
        analysisCategoryId: asNumber(source.analysisCategoryId),
        description: asString(source.description, fallbackDescription),
        value,
    };
    if (source.id !== undefined) {
        normalized.id = asNumber(source.id, 0);
    }
    return normalized;
}
/**
 * Cash Receipt vatEntries use vatRateId / percentage / amount only.
 * `amount` is the portion of the receipt TOTAL allocated to that VAT rate
 * (not net, and not a separate vatAmount field).
 */
function normalizeCashReceiptVatEntry(entry) {
    const source = isRecord(entry) ? entry : {};
    const amount = source.amount !== undefined
        ? round2(asNumber(source.amount))
        : 0;
    const normalized = {
        vatRateId: asNumber(source.vatRateId),
        percentage: asNumber(source.percentage ?? source.vatPercentage),
        amount,
    };
    if (source.id !== undefined) {
        normalized.id = asNumber(source.id, 0);
    }
    return normalized;
}
function applyExplicitCashReceiptOptionalTotals(payload, args) {
    if (args.vatTypeId !== undefined) {
        payload.vatTypeId = asNumber(args.vatTypeId);
    }
    if (args.totalNet !== undefined) {
        payload.totalNet = round2(asNumber(args.totalNet));
    }
    if (args.totalVat !== undefined) {
        payload.totalVat = round2(asNumber(args.totalVat));
    }
    if (args.totalVAT !== undefined) {
        payload.totalVAT = round2(asNumber(args.totalVAT));
    }
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
    // If a raw VAT-split payload was supplied, normalise it to the Cash Receipt
    // contract. This is needed for stricter/paid BRC companies that reject
    // simple ledger-only receipts.
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
            acEntries: rawAcEntries.map((entry) => normalizeCashReceiptAcEntry(entry, note)),
            vatEntries: rawVatEntries.map((entry) => normalizeCashReceiptVatEntry(entry)),
        };
        // Do not invent Sales Invoice-style header totals on Cash Receipts.
        delete payload.totalNet;
        delete payload.totalVat;
        delete payload.totalVAT;
        delete payload.vatTypeId;
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
        applyExplicitCashReceiptOptionalTotals(payload, argsForBuild);
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
    // Preserve explicitly supplied customer-ledger fields; never invent them for
    // analysed cash receipts.
    if (argsForBuild.customerId !== undefined) {
        payload.customerId = asNumber(argsForBuild.customerId);
    }
    if (argsForBuild.acCode !== undefined) {
        payload.acCode = asString(argsForBuild.acCode);
    }
    if (hasFlatVatSplit) {
        payload.acEntries = [
            {
                accountCode,
                analysisCategoryId,
                description,
                value: total,
            },
        ];
        // Cash Receipt vatEntries[].amount is the portion of the receipt TOTAL
        // allocated to this VAT rate (with one rate, that is the full total).
        payload.vatEntries = [
            {
                vatRateId,
                percentage: vatPercentage,
                amount: total,
            },
        ];
        applyExplicitCashReceiptOptionalTotals(payload, argsForBuild);
    }
    return applyCashReceiptConcurrencyFields(payload, argsForBuild);
}
/**
 * Builds the Cash Receipt PUT body as:
 *   current BRC record + only explicitly requested update fields.
 *
 * `buildCashReceiptPayload` may default ledger/unallocated/etc. for CREATE; those
 * defaults must not wipe existing values on note-only (or other partial) updates.
 * Builder-normalized values are used for keys that were explicitly requested.
 */
export function mergeCashReceiptUpdateFromCurrent(built, current, requestedUpdates) {
    const id = asNumber(current.id, 0);
    if (id <= 0) {
        return built;
    }
    const merged = { ...current, id };
    if (typeof current.timestamp === "string" && current.timestamp) {
        merged.timestamp = current.timestamp;
    }
    for (const key of Object.keys(requestedUpdates)) {
        if (key === "payload" || key === "id" || key === "timestamp") {
            continue;
        }
        // Treat undefined as "not supplied" so optional schema keys cannot wipe
        // existing monetary/allocation fields.
        if (requestedUpdates[key] === undefined) {
            continue;
        }
        if (key in built) {
            merged[key] = built[key];
        }
        else {
            merged[key] = requestedUpdates[key];
        }
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
            item = buildSalesInvoicePayload({ ...raw, customerId: asNumber(raw.customerId), customerName: raw.customerName !== undefined ? asString(raw.customerName) : (raw.name !== undefined ? asString(raw.name) : undefined), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: raw.note !== undefined ? asString(raw.note) : undefined, deliveryTo: raw.deliveryTo, bookTranTypeId: asNumber(raw.bookTranTypeId, 6), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch invoice"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined });
        if (path === "/v1/salesCreditNotes")
            item = buildSalesCreditNotePayload({ ...raw, customerId: asNumber(raw.customerId), acCode: asString(raw.acCode), entryDate: asString(raw.entryDate, todayIsoDate()), procDate: asString(raw.procDate, asString(raw.entryDate, todayIsoDate())), note: asString(raw.note, "Batch credit note"), bookTranTypeId: asNumber(raw.bookTranTypeId, 7), analysisCategoryId: asNumber(raw.analysisCategoryId), accountCode: asString(raw.accountCode), description: asString(raw.description, "Batch credit note"), netAmount: asNumber(raw.netAmount, asNumber(raw.total, 0)), vatRateId: asNumber(raw.vatRateId), vatPercentage: asNumber(raw.vatPercentage, 23), productId: asNumber(raw.productId), productCode: asString(raw.productCode), quantity: asNumber(raw.quantity, 1), unitPrice: asNumber(raw.unitPrice, asNumber(raw.netAmount, asNumber(raw.total, 0))), saleRepId: raw.saleRepId !== undefined ? asNumber(raw.saleRepId) : undefined, saleRepCode: raw.saleRepCode !== undefined ? asString(raw.saleRepCode) : undefined, reference: raw.reference !== undefined ? asString(raw.reference) : undefined });
        if (path === "/v1/quotes") {
            assertQuoteManualReferenceLengthOrThrow(raw.reference);
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
/**
 * Resolves the sales invoice document VAT type (`vatTypeId`) from the selected
 * customer's VAT type. Returns the customer's VAT type when present and valid,
 * otherwise Domestic (1). This sets the VAT *type* only and does not affect VAT
 * rate / VAT percentage selection.
 */
export function resolveSalesInvoiceVatTypeId(customerVatType) {
    const n = Number(customerVatType);
    return Number.isFinite(n) && n > 0 ? n : 1;
}
export function buildSalesInvoicePayload(args) {
    const priceBasis = args.priceBasis ?? "net";
    const isGross = priceBasis === "gross";
    let calculatedNet;
    let vat;
    let total;
    if (isGross) {
        total = round2(args.quantity * args.unitPrice);
        calculatedNet = round2(total / (1 + args.vatPercentage / 100));
        vat = round2(total - calculatedNet);
    }
    else {
        calculatedNet = round2(args.quantity * args.unitPrice);
        if (round2(args.netAmount) !== calculatedNet) {
            throw new Error(`Invoice net amount must equal quantity * unit price. Received netAmount: ${args.netAmount}, calculated netAmount: ${calculatedNet}, quantity: ${args.quantity}, unitPrice: ${args.unitPrice}.`);
        }
        vat = round2(calculatedNet * (args.vatPercentage / 100));
        total = round2(calculatedNet + vat);
    }
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
    const resolvedReference = args.reference ?? args.ourReference ?? args.yourReference;
    const resolvedNote = resolveSalesDocumentNote(args.note, args.customerName);
    const deliveryTo = normaliseDeliveryTo(args.deliveryTo);
    const payload = {
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
/**
 * BRC Quote manual references are stored in a 6-character field.
 * Evidence: official Quote sample uses "000032"; live Company C POST of a longer
 * reference was accepted then returned truncated to 6 characters on GET; existing
 * Company C quote references fit within 6 characters. Red rejects longer values
 * rather than silently truncating.
 */
export const QUOTE_MANUAL_REFERENCE_MAX_LENGTH = 6;
export const QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE = "Quote reference must be 6 characters or fewer because Big Red Cloud truncates longer references.";
export const QUOTE_MANUAL_REFERENCE_DESCRIPTION = `Optional manual quote reference, max ${QUOTE_MANUAL_REFERENCE_MAX_LENGTH} characters. Required when quote references are manual, or when the quote reference setting is unknown. ${QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE}`;
export function assertQuoteManualReferenceLengthOrThrow(reference) {
    if (reference === undefined || reference === null) {
        return;
    }
    const value = String(reference);
    if (value.length > QUOTE_MANUAL_REFERENCE_MAX_LENGTH) {
        throw new Error(QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
    }
}
/**
 * Quote-specific 2-decimal money rounding.
 *
 * Big Red Cloud Quote validation rejects half-up VAT rounding for observed
 * midpoint values (for example 7.50 @ 23%: 1.73 rejected, 1.72 accepted). Quote
 * calculations therefore use a Quote-specific rounding rule. Do not apply this
 * globally; Sales Invoice accepts the half-up result.
 *
 * For the confirmed midpoint 1.725, this helper returns 1.72. The deterministic
 * rule used here is round-half-to-even at two decimal places (via integer
 * thousandths), which matches that observed Quote API case. This is not a claim
 * that BRC uses banker's rounding for every document type.
 */
export function roundQuoteMoney2(value) {
    if (!Number.isFinite(value)) {
        return value;
    }
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    // Scale to thousandths so .xx5 midpoints are exact integers (e.g. 1.725 → 1725).
    const thousandths = Math.round(abs * 1000);
    const remainder = thousandths % 10;
    const centsTrunc = Math.trunc(thousandths / 10);
    let cents;
    if (remainder < 5) {
        cents = centsTrunc;
    }
    else if (remainder > 5) {
        cents = centsTrunc + 1;
    }
    else if (centsTrunc % 2 === 0) {
        cents = centsTrunc;
    }
    else {
        cents = centsTrunc + 1;
    }
    return (sign * cents) / 100;
}
export function buildQuotePayload(args) {
    assertQuoteManualReferenceLengthOrThrow(args.reference);
    const net = roundQuoteMoney2(args.quantity * args.unitPrice);
    const vat = roundQuoteMoney2(net * (args.vatPercentage / 100));
    const total = roundQuoteMoney2(net + vat);
    const companyId = requireQuoteCompanyId(args.companyId);
    const { saleRepId, saleRepCode } = requireSalesRepFields(args.saleRepId, args.saleRepCode);
    const deliveryTo = normaliseDeliveryTo(args.deliveryTo);
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
/**
 * Builds the nested BRC Quote POST body from flat MCP create-quote tool args.
 * Shared by confirmation preview and confirmed POST so both use the same path.
 */
export function buildQuoteCreatePayloadFromToolArgs(args) {
    const companyIdRaw = args.companyId;
    const companyId = typeof companyIdRaw === "number"
        ? companyIdRaw
        : companyIdRaw !== undefined && companyIdRaw !== null && String(companyIdRaw).trim() !== ""
            ? Number(companyIdRaw)
            : undefined;
    return buildQuotePayload({
        companyId: Number.isFinite(companyId) ? companyId : undefined,
        customerOwnerId: Number(args.customerOwnerId),
        acCode: String(args.acCode ?? ""),
        customerOwnerName: String(args.customerOwnerName ?? ""),
        comments: String(args.comments ?? ""),
        entryDate: String(args.entryDate ?? ""),
        procDate: String(args.procDate ?? ""),
        vatTypeId: args.vatTypeId !== undefined && args.vatTypeId !== null
            ? Number(args.vatTypeId)
            : undefined,
        saleRepId: Number(args.saleRepId),
        saleRepCode: String(args.saleRepCode ?? ""),
        reference: args.reference !== undefined && args.reference !== null
            ? String(args.reference)
            : undefined,
        poNumber: args.poNumber !== undefined && args.poNumber !== null
            ? String(args.poNumber)
            : undefined,
        ddNumber: args.ddNumber !== undefined && args.ddNumber !== null
            ? String(args.ddNumber)
            : undefined,
        deliveryTo: args.deliveryTo,
        layoutType: args.layoutType !== undefined && args.layoutType !== null
            ? Number(args.layoutType)
            : undefined,
        productId: Number(args.productId),
        productCode: String(args.productCode ?? ""),
        quantity: Number(args.quantity),
        unitPrice: Number(args.unitPrice),
        vatRateId: Number(args.vatRateId),
        vatPercentage: Number(args.vatPercentage),
        tranNote: String(args.tranNote ?? ""),
        analysisCategoryId: Number(args.analysisCategoryId),
        accountCode: String(args.accountCode ?? ""),
    });
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
