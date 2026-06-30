/**
 * Company processing settings mapper.
 *
 * This file reads BRC company setup/options data and converts the raw API
 * fields into safer, more meaningful settings used by Red.
 *
 * These settings matter because they affect how transactions should be created
 * or checked, especially VAT-sensitive workflows such as sales invoices,
 * purchases, cash receipts, statements, gross/net pricing, margin VAT, reverse
 * charge VAT, and VAT discrepancy tolerance.
 *
 * Important VOCR / VAT on Cash Receipts note:
 *
 * The BRC UI has a visible checkbox called "Enable VAT on Cash Receipts".
 * A before/after UI test showed that this checkbox maps to the API field:
 *
 *   enableVOCRReporting
 *
 * The API field:
 *
 *   vocrSettingValue
 *
 * did NOT change when the checkbox was toggled, so it must not be treated as
 * the visible checkbox. Red keeps vocrSettingValue as a separate
 * displayed field for transparency, but uses enableVOCRReporting to determine
 * vatOnCashReceiptsEnabled and cashReceiptVatMode.
 */

import { brcFetch } from "../shared.js";

export type CashReceiptVatMode =
  | "manual"
  | "allocation"
  | "not_enabled"
  | "unknown";

export type TransactionWorkflow =
  | "sales_invoice"
  | "sales_credit_note"
  | "purchase"
  | "cash_receipt"
  | "statement";

export interface CompanyProcessingSettings {
  raw: unknown;

  nominalLedgerEnabled?: boolean;
  autogenerateNominalCodes?: boolean;

  vatDiscrepancyAllowed?: number;
  grossPriceSalesInvoicingEnabled?: boolean;
  marginVatSchemeEnabled?: boolean;
  reverseChargeCreditInputEnabled?: boolean;

  /**
   * Actual visible BRC checkbox:
   * "Enable VAT on Cash Receipts".
   *
   * This is mapped from enableVOCRReporting, not vocrSettingValue.
   */
  vatOnCashReceiptsEnabled?: boolean;

  /**
   * Kept separately because it is returned by the API, but it does not match
   * the visible checkbox based on the before/after UI test.
   */
  vocrSettingValue?: boolean;

  /**
   * Raw API flag that matched the visible VAT on Cash Receipts checkbox.
   */
  enableVocrReporting?: boolean;

  useAllocations?: boolean;
  cashReceiptVatMode: CashReceiptVatMode;

  salesVatAnalysisType?: number;
  purchasesVatAnalysisType?: number;

  creditNoteJournalAgeingValue?: number;
  creditNoteJournalAgeingName?: string;

  printOsItemsOnly?: boolean;

  customerPaymentTermsEnabled?: boolean;
  customerPaymentTermsBasis?: string;
  customerPaymentTermsDays?: number;

  supplierPaymentTermsEnabled?: boolean;
  supplierPaymentTermsBasis?: string;
  supplierPaymentTermsDays?: number;

  defaultDebtorStatementMinimumBalance?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findValue(source: unknown, keys: string[]): unknown {
  if (!isRecord(source)) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }

  for (const value of Object.values(source)) {
    if (isRecord(value)) {
      const nestedValue = findValue(value, keys);
      if (nestedValue !== undefined) {
        return nestedValue;
      }
    }
  }

  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();

    if (["true", "yes", "y", "1", "enabled", "on"].includes(normalised)) {
      return true;
    }

    if (["false", "no", "n", "0", "disabled", "off"].includes(normalised)) {
      return false;
    }
  }

  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  return undefined;
}

function yesNoUnknown(value: boolean | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function numberOrUnknown(value: number | undefined): string {
  return value === undefined ? "Unknown" : String(value);
}

/**
 * Formats the VAT discrepancy tolerance with a currency unit so warnings never
 * read like a bare "VAT discrepancy tolerance is 1" with no unit.
 */
export function formatVatDiscrepancyTolerance(value: number): string {
  return `${value.toFixed(2)} EUR (the maximum rounding difference allowed between supplied and calculated VAT)`;
}

function textOrUnknown(value: string | undefined): string {
  return value === undefined ? "Unknown" : value;
}

function deriveCashReceiptVatMode(
  vatOnCashReceiptsEnabled: boolean | undefined,
  useAllocations: boolean | undefined
): CashReceiptVatMode {
  if (vatOnCashReceiptsEnabled === false) {
    return "not_enabled";
  }

  if (vatOnCashReceiptsEnabled === true && useAllocations === true) {
    return "allocation";
  }

  if (vatOnCashReceiptsEnabled === true && useAllocations === false) {
    return "manual";
  }

  return "unknown";
}

function describeCashReceiptVatMode(mode: CashReceiptVatMode): string {
  switch (mode) {
    case "manual":
      return "manual";
    case "allocation":
      return "allocation";
    case "not_enabled":
      return "not_enabled";
    case "unknown":
    default:
      return "unknown";
  }
}

export async function getCompanyProcessingSettings(
  companyName: string
): Promise<CompanyProcessingSettings> {
  const raw = await brcFetch(
    companyName,
    "/v1/companySetupConfig/getCompanyOptions"
  );

  const enableVocrReporting = asBoolean(
    findValue(raw, ["enableVOCRReporting"])
  );

  const vatOnCashReceiptsEnabled = enableVocrReporting;

  const vocrSettingValue = asBoolean(findValue(raw, ["vocrSettingValue"]));

  const useAllocations = asBoolean(findValue(raw, ["useAllocations"]));

  const cashReceiptVatMode = deriveCashReceiptVatMode(
    vatOnCashReceiptsEnabled,
    useAllocations
  );

  return {
    raw,

    nominalLedgerEnabled: asBoolean(findValue(raw, ["useNominal"])),
    autogenerateNominalCodes: asBoolean(findValue(raw, ["useNominalCode"])),

    vatDiscrepancyAllowed: asNumber(findValue(raw, ["discrepancyAllowed"])),
    grossPriceSalesInvoicingEnabled: asBoolean(
      findValue(raw, ["allowEntryOfGrossPriceInInvoicing"])
    ),
    marginVatSchemeEnabled: asBoolean(findValue(raw, ["marginVatScheme"])),
    reverseChargeCreditInputEnabled: asBoolean(
      findValue(raw, ["creditInputForReverseChargeVAT"])
    ),

    vatOnCashReceiptsEnabled,
    vocrSettingValue,
    enableVocrReporting,
    useAllocations,
    cashReceiptVatMode,

    salesVatAnalysisType: asNumber(findValue(raw, ["salesVatAnalysisType"])),
    purchasesVatAnalysisType: asNumber(
      findValue(raw, ["purchasesVatAnalysisType"])
    ),

    creditNoteJournalAgeingValue: asNumber(
      findValue(raw, ["creditNoteJournalAgeingValue"])
    ),
    creditNoteJournalAgeingName: asString(
      findValue(raw, ["creditNoteJournalAgeingName"])
    ),

    printOsItemsOnly: asBoolean(findValue(raw, ["printOSItemsOnly"])),

    /**
     * These are included in the model for future use, but the current
     * companyOptions endpoint may not expose them for all companies.
     */
    customerPaymentTermsEnabled: asBoolean(
      findValue(raw, ["customerPaymentTermsEnabled"])
    ),
    customerPaymentTermsBasis: asString(
      findValue(raw, ["customerPaymentTermsBasis"])
    ),
    customerPaymentTermsDays: asNumber(
      findValue(raw, ["customerPaymentTermsDays"])
    ),

    supplierPaymentTermsEnabled: asBoolean(
      findValue(raw, ["supplierPaymentTermsEnabled"])
    ),
    supplierPaymentTermsBasis: asString(
      findValue(raw, ["supplierPaymentTermsBasis"])
    ),
    supplierPaymentTermsDays: asNumber(
      findValue(raw, ["supplierPaymentTermsDays"])
    ),

    defaultDebtorStatementMinimumBalance: asNumber(
      findValue(raw, [
        "defaultDebtorStatementMinimumBalance",
        "debtorStatementMinimumBalance",
        "statementMinimumBalance",
        "minBalance",
      ])
    ),
  };
}

export function formatCompanyProcessingSettings(
  settings: CompanyProcessingSettings
): string {
  return [
    "Company processing settings",
    "",
    `Nominal Ledger: ${yesNoUnknown(settings.nominalLedgerEnabled)}`,
    `Autogenerate nominal codes: ${yesNoUnknown(
      settings.autogenerateNominalCodes
    )}`,
    "",
    "VAT settings:",
    `- VAT on Cash Receipts: ${yesNoUnknown(
      settings.vatOnCashReceiptsEnabled
    )}`,
    `- Cash Receipt VAT mode: ${describeCashReceiptVatMode(
      settings.cashReceiptVatMode
    )}`,
    `- VOCR setting value: ${yesNoUnknown(settings.vocrSettingValue)}`,
    `- VOCR reporting: ${yesNoUnknown(settings.enableVocrReporting)}`,
    `- Use allocations: ${yesNoUnknown(settings.useAllocations)}`,
    `- Margin VAT Scheme: ${yesNoUnknown(settings.marginVatSchemeEnabled)}`,
    `- Credit Input for Reverse Charge VAT: ${yesNoUnknown(
      settings.reverseChargeCreditInputEnabled
    )}`,
    `- Sales VAT analysis type: ${numberOrUnknown(
      settings.salesVatAnalysisType
    )}`,
    `- Purchases VAT analysis type: ${numberOrUnknown(
      settings.purchasesVatAnalysisType
    )}`,
    "",
    "Transaction settings:",
    `- Gross Price Entry: ${yesNoUnknown(
      settings.grossPriceSalesInvoicingEnabled
    )}`,
    `- VAT discrepancy allowed: ${numberOrUnknown(
      settings.vatDiscrepancyAllowed
    )}`,
    `- Credit Note / Journal Ageing: ${textOrUnknown(
      settings.creditNoteJournalAgeingName
    )} (${numberOrUnknown(settings.creditNoteJournalAgeingValue)})`,
    `- Print OS Items Only: ${yesNoUnknown(settings.printOsItemsOnly)}`,
    "",
    "Payment terms:",
    `- Customer payment terms enabled: ${yesNoUnknown(
      settings.customerPaymentTermsEnabled
    )}`,
    `- Customer payment terms basis: ${textOrUnknown(
      settings.customerPaymentTermsBasis
    )}`,
    `- Customer payment terms days: ${numberOrUnknown(
      settings.customerPaymentTermsDays
    )}`,
    `- Supplier payment terms enabled: ${yesNoUnknown(
      settings.supplierPaymentTermsEnabled
    )}`,
    `- Supplier payment terms basis: ${textOrUnknown(
      settings.supplierPaymentTermsBasis
    )}`,
    `- Supplier payment terms days: ${numberOrUnknown(
      settings.supplierPaymentTermsDays
    )}`,
    "",
    "Statement settings:",
    `- Default debtor statement minimum balance: ${numberOrUnknown(
      settings.defaultDebtorStatementMinimumBalance
    )}`,
  ].join("\n");
}

export function getTransactionSafetyWarnings(
  settings: CompanyProcessingSettings,
  workflow: TransactionWorkflow
): string[] {
  const warnings: string[] = [];

  if (
    workflow === "sales_invoice" ||
    workflow === "sales_credit_note" ||
    workflow === "purchase" ||
    workflow === "cash_receipt"
  ) {
    if (settings.marginVatSchemeEnabled === true) {
      warnings.push(
        "Margin VAT Scheme is enabled. Red should not create margin-scheme VAT transactions unless that workflow is explicitly supported."
      );
    }

    if (settings.vatDiscrepancyAllowed !== undefined) {
      warnings.push(
        `VAT discrepancy tolerance is ${formatVatDiscrepancyTolerance(settings.vatDiscrepancyAllowed)}. Check supplied VAT amounts against this tolerance where VAT is manually provided.`
      );
    }
  }

  if (workflow === "sales_invoice" || workflow === "sales_credit_note") {
    if (settings.grossPriceSalesInvoicingEnabled === true) {
      warnings.push(
        "Gross Price Entry is enabled for sales invoicing. Before creating the invoice, confirm whether the prices entered are VAT-inclusive/gross or VAT-exclusive/net. Say 'gross' if the prices include VAT, or 'net' if the prices exclude VAT."
      );
    }

    if (settings.grossPriceSalesInvoicingEnabled === false) {
      warnings.push(
        "Gross Price Entry is not enabled for sales invoicing. Treat line prices as net (VAT-exclusive) prices unless the user explicitly asks for VAT-inclusive calculation."
      );
    }

    if (settings.reverseChargeCreditInputEnabled === true) {
      warnings.push(
        "Credit Input for Reverse Charge VAT is enabled. Before posting, check whether EU or reverse-charge VAT applies to this sale; if it does, confirm the correct VAT treatment with the user rather than assuming standard domestic VAT."
      );
    }
  }

  if (workflow === "purchase") {
    if (settings.reverseChargeCreditInputEnabled === true) {
      warnings.push(
        "Credit Input for Reverse Charge VAT is enabled. Before posting, check whether EU or reverse-charge VAT applies to this purchase; if it does, confirm the correct VAT treatment with the user rather than assuming standard domestic VAT."
      );
    }
  }

  if (workflow === "cash_receipt") {
    if (settings.vatOnCashReceiptsEnabled === true) {
      if (settings.cashReceiptVatMode === "manual") {
        warnings.push(
          "VAT on Cash Receipts is enabled and cash receipt VAT mode is manual. Confirm VAT entry requirements in Big Red Cloud before creating VAT-sensitive cash receipts."
        );
      }

      if (settings.cashReceiptVatMode === "unknown") {
        warnings.push(
          "VAT on Cash Receipts is enabled, but Red could not determine the cash receipt VAT mode. Verify cash receipt VAT handling in Big Red Cloud before creating VAT-sensitive cash receipts."
        );
      }
    }

    if (settings.vatOnCashReceiptsEnabled === false) {
      warnings.push(
        "VAT on Cash Receipts is not enabled. Cash receipt VAT should not be treated as receipt-basis VAT unless the user confirms otherwise."
      );
    }

    if (settings.vatOnCashReceiptsEnabled === undefined) {
      warnings.push(
        "Red could not determine whether VAT on Cash Receipts is enabled. Verify the setting in Big Red Cloud before creating VAT-sensitive cash receipts."
      );
    }

    if (
      settings.vocrSettingValue === true &&
      settings.vatOnCashReceiptsEnabled !== true
    ) {
      warnings.push(
        "The API returned vocrSettingValue as true, but this does not confirm the visible VAT on Cash Receipts checkbox. Red uses enableVOCRReporting for the checkbox state."
      );
    }
  }

  if (workflow === "statement") {
    if (settings.defaultDebtorStatementMinimumBalance === undefined) {
      warnings.push(
        "Default debtor statement minimum balance is not exposed by the current company options endpoint. Do not assume a minimum balance unless the user provides one."
      );
    }
  }

  return warnings;
}

const PREFLIGHT_STOP_PREFIX =
  "Red stopped before posting because the company processing settings need attention.";

function preflightError(detail: string): Error {
  return new Error(`${PREFLIGHT_STOP_PREFIX}\n\n${detail}`);
}

function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  return payload;
}

function readPayloadValue(
  payload: unknown,
  keys: string[]
): unknown {
  const record = payloadRecord(payload);
  if (!record) {
    return undefined;
  }

  return findValue(record, keys);
}

/** True when any productTrans line carries an explicit useTaxInclusiveUnitPrice boolean. */
function productTransStatesPriceBasis(payload: unknown): boolean {
  const record = payloadRecord(payload);
  if (!record || !Array.isArray(record.productTrans)) {
    return false;
  }

  for (const line of record.productTrans) {
    if (isRecord(line) && typeof line.useTaxInclusiveUnitPrice === "boolean") {
      return true;
    }
  }

  return false;
}

function payloadClearlyStatesGrossOrNetPrice(payload: unknown): boolean {
  const taxInclusiveValue = readPayloadValue(payload, [
    "useTaxInclusiveUnitPrice",
    "taxInclusiveUnitPrice",
    "useGrossUnitPrice",
  ]);

  if (typeof taxInclusiveValue === "boolean") {
    return true;
  }

  if (productTransStatesPriceBasis(payload)) {
    return true;
  }

  const grossIndicators = [
    "linePricesAreGross",
    "pricesAreGross",
    "priceEntryIsGross",
    "grossPriceEntry",
    "unitPricesAreGross",
    "pricesAreVatInclusive",
    "pricesAreVATInclusive",
  ];

  const netIndicators = [
    "linePricesAreNet",
    "pricesAreNet",
    "priceEntryIsNet",
    "unitPricesAreNet",
  ];

  const basisIndicators = ["priceBasis", "priceEntryMode", "linePriceBasis"];

  for (const key of grossIndicators) {
    const value = readPayloadValue(payload, [key]);
    if (asBoolean(value) === true) {
      return true;
    }

    const text = asString(value)?.toLowerCase();
    if (text === "gross" || text === "vat-inclusive" || text === "vatinclusive") {
      return true;
    }
  }

  for (const key of netIndicators) {
    const value = readPayloadValue(payload, [key]);
    if (asBoolean(value) === true) {
      return true;
    }

    const text = asString(value)?.toLowerCase();
    if (text === "net" || text === "vat-exclusive" || text === "vatexclusive") {
      return true;
    }
  }

  for (const key of basisIndicators) {
    const text = asString(readPayloadValue(payload, [key]))?.toLowerCase();
    if (text === "gross" || text === "net") {
      return true;
    }
  }

  return false;
}

function hasManualCashReceiptVatDetails(payload: unknown): boolean {
  const record = payloadRecord(payload);
  if (!record) {
    return false;
  }

  const vatEntries = record.vatEntries;
  if (Array.isArray(vatEntries) && vatEntries.length > 0) {
    return true;
  }

  const totalVat = readPayloadValue(payload, ["totalVat", "totalVAT"]);
  if (asNumber(totalVat) !== undefined) {
    return true;
  }

  const vatRateId = asNumber(readPayloadValue(payload, ["vatRateId"]));
  const vatPercentage = readPayloadValue(payload, ["vatPercentage", "percentage"]);
  if (
    vatRateId !== undefined &&
    (asNumber(vatPercentage) !== undefined || asString(vatPercentage) !== undefined)
  ) {
    return true;
  }

  const acEntries = record.acEntries;
  if (Array.isArray(acEntries) && acEntries.length > 0 && Array.isArray(vatEntries) && vatEntries.length > 0) {
    return true;
  }

  return false;
}

function hasCashReceiptAllocationDetails(payload: unknown): boolean {
  const record = payloadRecord(payload);
  if (!record) {
    return false;
  }

  if (readPayloadValue(payload, ["unallocated"]) !== undefined) {
    return true;
  }

  const detailCollection = record.detailCollection;
  if (Array.isArray(detailCollection) && detailCollection.length > 0) {
    return true;
  }

  const acEntries = record.acEntries;
  if (Array.isArray(acEntries) && acEntries.length > 1) {
    return true;
  }

  if (
    readPayloadValue(payload, [
      "allocations",
      "allocationDetails",
      "allocationCollection",
      "allocatedAmount",
    ]) !== undefined
  ) {
    return true;
  }

  return false;
}

function readStatementMinBalance(payload: unknown): number | undefined {
  return asNumber(
    readPayloadValue(payload, [
      "minBalance",
      "minimumBalance",
      "statementMinimumBalance",
      "defaultDebtorStatementMinimumBalance",
    ])
  );
}

/**
 * Explicit price-basis signal supplied as a top-level tool argument.
 *
 * This is separate from the payload so the structured sales invoice tool can
 * tell the guard exactly what the user/model confirmed, even though the built
 * payload always carries a useTaxInclusiveUnitPrice flag.
 */
export interface SalesPriceBasisOptions {
  priceBasis?: "net" | "gross";
}

/**
 * True when there is any explicit signal of whether unit prices are gross or
 * net: a top-level priceBasis argument, a payload-level price basis, a
 * useTaxInclusiveUnitPrice boolean, or a productTrans line carrying that flag.
 */
function hasExplicitSalesPriceBasis(
  payload: unknown,
  options?: SalesPriceBasisOptions
): boolean {
  if (options?.priceBasis === "gross" || options?.priceBasis === "net") {
    return true;
  }

  return payloadClearlyStatesGrossOrNetPrice(payload);
}

function enforceSalesDocumentSettings(
  settings: CompanyProcessingSettings,
  payload: unknown,
  documentLabel: string,
  options?: SalesPriceBasisOptions
): void {
  if (settings.marginVatSchemeEnabled === true) {
    throw preflightError(
      `Margin VAT Scheme is enabled in Big Red Cloud. Red does not currently support creating margin-scheme VAT ${documentLabel}. Please disable Margin VAT Scheme in Big Red Cloud or create this ${documentLabel} manually in BRC.`
    );
  }

  if (
    settings.grossPriceSalesInvoicingEnabled === true &&
    !hasExplicitSalesPriceBasis(payload, options)
  ) {
    throw preflightError(
      `Gross Price Entry is enabled in Big Red Cloud. Red stopped before posting because it is unclear whether the prices entered are VAT-inclusive/gross or VAT-exclusive/net. Say 'gross' if the prices include VAT, or 'net' if the prices exclude VAT, then retry with priceBasis: "gross" for VAT-inclusive unit prices, or priceBasis: "net" for VAT-exclusive unit prices. Do not disable Gross Price Entry — provide priceBasis instead.`
    );
  }
}

function enforceCashReceiptSettings(
  settings: CompanyProcessingSettings,
  payload: unknown
): void {
  if (settings.vatOnCashReceiptsEnabled === false) {
    return;
  }

  if (
    settings.vatOnCashReceiptsEnabled === undefined ||
    settings.cashReceiptVatMode === "unknown"
  ) {
    throw preflightError(
      "Red could not confirm the Enable VAT on Cash Receipts setting from the company options API. Please verify this setting in Big Red Cloud before posting cash receipts."
    );
  }

  if (settings.cashReceiptVatMode === "manual") {
    if (!hasManualCashReceiptVatDetails(payload)) {
      throw preflightError(
        "VAT on Cash Receipts is enabled and cash receipt VAT mode is manual. Red needs the VAT amount/details before posting this cash receipt. Please provide the VAT details or update the setting in Big Red Cloud."
      );
    }
    return;
  }

  if (settings.cashReceiptVatMode === "allocation") {
    if (!hasCashReceiptAllocationDetails(payload)) {
      throw preflightError(
        "VAT on Cash Receipts is enabled and allocation mode is active. Please provide allocation details before posting this cash receipt, or update the setting in Big Red Cloud."
      );
    }
  }
}

export function enforceTransactionSettingsOrThrow(
  settings: CompanyProcessingSettings,
  workflow: TransactionWorkflow,
  payload?: unknown,
  options?: SalesPriceBasisOptions
): void {
  if (workflow === "sales_invoice") {
    enforceSalesDocumentSettings(settings, payload, "sales invoice", options);
    return;
  }

  if (workflow === "sales_credit_note") {
    enforceSalesDocumentSettings(settings, payload, "sales credit note", options);
    return;
  }

  if (workflow === "purchase") {
    if (settings.marginVatSchemeEnabled === true) {
      throw preflightError(
        "Margin VAT Scheme is enabled in Big Red Cloud. Red does not currently support creating margin-scheme VAT purchases. Please disable Margin VAT Scheme in Big Red Cloud or create this purchase manually in BRC."
      );
    }
    return;
  }

  if (workflow === "cash_receipt") {
    enforceCashReceiptSettings(settings, payload);
    return;
  }

  if (workflow === "statement") {
    if (settings.defaultDebtorStatementMinimumBalance !== undefined) {
      return;
    }

    if (readStatementMinBalance(payload) !== undefined) {
      return;
    }

    throw preflightError(
      "Red could not determine the default debtor statement minimum balance from company settings. Please provide a minimum balance for this statement, or confirm you want no minimum balance before sending."
    );
  }
}

export async function loadAndEnforceTransactionSettings(
  companyName: string,
  workflow: TransactionWorkflow,
  payload?: unknown,
  options?: SalesPriceBasisOptions
): Promise<CompanyProcessingSettings> {
  const settings = await getCompanyProcessingSettings(companyName);
  enforceTransactionSettingsOrThrow(settings, workflow, payload, options);
  return settings;
}