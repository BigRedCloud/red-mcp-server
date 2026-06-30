/**
 * Company reference settings mapper.
 *
 * Reads BRC reference auto-generation settings from company setup config and
 * enforces safe reference handling before write workflows post to BRC.
 */

import { brcFetch } from "../shared.js";

export type ReferenceWorkflow =
  | "sales_invoice"
  | "sales_credit_note"
  | "purchase"
  | "quote"
  | "debtors_journal"
  | "creditors_journal";

export type ReferenceEndpointKind = "manual" | "generated";

export interface CompanyReferenceSettings {
  raw: unknown;
  salesAutoGenerateReference?: boolean;
  purchasesAutoGenerateReference?: boolean;
  quotesAutoGenerateReference?: boolean;
  debtorsJournalAutoGenerateReference?: boolean;
  creditorsJournalAutoGenerateReference?: boolean;
}

export interface ReferencePreflightResult {
  warnings: string[];
}

export interface ReferencePreflightOptions {
  /** Required for generated-reference quote creates when Quotes reference setting is Unknown. */
  userConfirmedAutoGenerate?: boolean;
}

export const QUOTE_REFERENCE_UNKNOWN_MESSAGE =
  "Red could not confirm whether quote references are auto-generated or manual for this company. Please provide a quote reference, or confirm that quotes are auto-generated in Big Red Cloud before I prepare this quote for posting.";

const PLACEHOLDER_REFERENCES = new Set(
  ["MCP_TEST", "MCP_TEST_CN", "MCP_TEST_QUOTE", "MCP_TEST_PO", "MCP_TEST_DD"].map(
    (value) => value.toLowerCase()
  )
);

const REFERENCE_STOP_PREFIX =
  "Red stopped before posting because reference settings need attention.";

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

    if (["true", "yes", "y", "1", "enabled", "on", "auto"].includes(normalised)) {
      return true;
    }

    if (["false", "no", "n", "0", "disabled", "off", "manual"].includes(normalised)) {
      return false;
    }
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }

  return undefined;
}

function extractReferenceSettingsSection(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return undefined;
  }

  const direct = raw.referenceSettings;
  if (isRecord(direct)) {
    return direct;
  }

  return findValue(raw, ["referenceSettings"]);
}

/**
 * Reads one BRC referenceSettings checkbox from /v1/companySetupConfig.
 *
 * BRC returns checked auto-generate options as true booleans under
 * referenceSettings (sales, purchases, quotes, debtorsJournal, creditorsJournal).
 * Unchecked options are omitted from the JSON rather than sent as false.
 */
function readReferenceSettingFlag(
  referenceSettings: unknown,
  keys: string[]
): boolean | undefined {
  if (!isRecord(referenceSettings)) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(referenceSettings, key)) {
      return asBoolean(referenceSettings[key]);
    }
  }

  return false;
}

function preflightError(detail: string): Error {
  return new Error(`${REFERENCE_STOP_PREFIX}\n\n${detail}`);
}

function workflowLabel(workflow: ReferenceWorkflow): string {
  switch (workflow) {
    case "sales_invoice":
      return "sales";
    case "sales_credit_note":
      return "sales credit note";
    case "purchase":
      return "purchase";
    case "quote":
      return "quote";
    case "debtors_journal":
      return "debtors journal";
    case "creditors_journal":
      return "creditors journal";
    default:
      return workflow;
  }
}

function workflowManualReferenceLabel(workflow: ReferenceWorkflow): string {
  switch (workflow) {
    case "sales_invoice":
    case "sales_credit_note":
      return "sales";
    case "purchase":
      return "purchase";
    case "quote":
      return "quote";
    case "debtors_journal":
      return "debtors journal";
    case "creditors_journal":
      return "creditors journal";
    default:
      return workflow;
  }
}

function autoGenerateSettingForWorkflow(
  settings: CompanyReferenceSettings,
  workflow: ReferenceWorkflow
): boolean | undefined {
  switch (workflow) {
    case "sales_invoice":
    case "sales_credit_note":
      return settings.salesAutoGenerateReference;
    case "purchase":
      return settings.purchasesAutoGenerateReference;
    case "quote":
      return settings.quotesAutoGenerateReference;
    case "debtors_journal":
      return settings.debtorsJournalAutoGenerateReference;
    case "creditors_journal":
      return settings.creditorsJournalAutoGenerateReference;
    default:
      return undefined;
  }
}

function isPlaceholderReference(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  if (PLACEHOLDER_REFERENCES.has(normalised)) {
    return true;
  }

  return (
    normalised.startsWith("mcp_quote_") ||
    normalised.startsWith("mcp_po_") ||
    normalised.startsWith("mcp_dd_")
  );
}

function readPayloadReferenceValues(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const keys = [
    "reference",
    "ourReference",
    "yourReference",
    "poNumber",
    "ddNumber",
  ];
  const values: string[] = [];

  for (const key of keys) {
    const value = asString(payload[key]);
    if (value !== undefined && !isPlaceholderReference(value)) {
      values.push(value);
    }
  }

  return values;
}

export function formatReferenceMode(value: boolean | undefined): "Auto" | "Manual" | "Unknown" {
  if (value === true) return "Auto";
  if (value === false) return "Manual";
  return "Unknown";
}

export async function getCompanyReferenceSettings(
  companyName: string
): Promise<CompanyReferenceSettings> {
  const raw = await brcFetch(companyName, "/v1/companySetupConfig");
  const referenceSettings = extractReferenceSettingsSection(raw);

  return {
    raw,
    salesAutoGenerateReference: readReferenceSettingFlag(referenceSettings, [
      "sales",
      "autoGenerateSalesReference",
      "salesAutoGenerateReference",
    ]),
    purchasesAutoGenerateReference: readReferenceSettingFlag(referenceSettings, [
      "purchases",
      "autoGeneratePurchasesReference",
      "purchasesAutoGenerateReference",
    ]),
    quotesAutoGenerateReference: readReferenceSettingFlag(referenceSettings, [
      "quotes",
      "quote",
      "autoGenerateQuotesReference",
      "quotesAutoGenerateReference",
    ]),
    debtorsJournalAutoGenerateReference: readReferenceSettingFlag(referenceSettings, [
      "debtorsJournal",
      "debtorJournal",
      "autoGenerateDebtorsJournalReference",
      "debtorsJournalAutoGenerateReference",
    ]),
    creditorsJournalAutoGenerateReference: readReferenceSettingFlag(referenceSettings, [
      "creditorsJournal",
      "creditorJournal",
      "autoGenerateCreditorsJournalReference",
      "creditorsJournalAutoGenerateReference",
    ]),
  };
}

export function formatCompanyReferenceSettings(
  settings: CompanyReferenceSettings
): string {
  return [
    "Reference settings:",
    `- Sales: ${formatReferenceMode(settings.salesAutoGenerateReference)}`,
    `- Purchases: ${formatReferenceMode(settings.purchasesAutoGenerateReference)}`,
    `- Quotes: ${formatReferenceMode(settings.quotesAutoGenerateReference)}`,
    `- Debtors Journal: ${formatReferenceMode(settings.debtorsJournalAutoGenerateReference)}`,
    `- Creditors Journal: ${formatReferenceMode(settings.creditorsJournalAutoGenerateReference)}`,
  ].join("\n");
}

export function isQuoteReferenceSettingUnknown(
  settings: CompanyReferenceSettings
): boolean {
  return settings.quotesAutoGenerateReference === undefined;
}

export function enforceReferenceSettingsOrThrow(
  settings: CompanyReferenceSettings,
  workflow: ReferenceWorkflow,
  payload?: unknown,
  endpointKind: ReferenceEndpointKind = "manual",
  options?: ReferencePreflightOptions
): ReferencePreflightResult {
  const autoGenerate = autoGenerateSettingForWorkflow(settings, workflow);
  const manualReferences = readPayloadReferenceValues(payload);
  const hasManualReference = manualReferences.length > 0;
  const warnings: string[] = [];
  const label = workflowManualReferenceLabel(workflow);

  if (autoGenerate === undefined) {
    if (workflow === "quote") {
      if (endpointKind === "generated") {
        if (options?.userConfirmedAutoGenerate !== true) {
          throw preflightError(QUOTE_REFERENCE_UNKNOWN_MESSAGE);
        }

        return {
          warnings: [
            "Quote reference setting is unknown in company setup. Proceeding with the generated-reference workflow because auto-generate was confirmed for this company.",
          ],
        };
      }

      if (!hasManualReference) {
        throw preflightError(QUOTE_REFERENCE_UNKNOWN_MESSAGE);
      }

      return {
        warnings: [
          "Quote reference setting is unknown in company setup. Proceeding with the supplied manual quote reference only because you provided one.",
        ],
      };
    }

    throw preflightError(
      `Red could not confirm whether this company uses auto-generated or manual ${label} references. Please confirm whether you want to provide a manual reference or use an auto-generated reference before posting.`
    );
  }

  if (autoGenerate === true) {
    if (endpointKind === "manual") {
      warnings.push(
        `This company is configured to auto-generate ${workflowLabel(workflow)} references. Prefer the auto-generated reference workflow where available.`
      );
    }

    if (hasManualReference) {
      warnings.push(
        `This company is configured to auto-generate ${workflowLabel(workflow)} references in Big Red Cloud, but a manual reference was supplied. BRC may ignore or override the supplied reference.`
      );
    }

    return { warnings };
  }

  if (endpointKind === "generated") {
    throw preflightError(
      `Red stopped before posting because this company is configured for manual ${label} references. Please provide the reference number on the standard create workflow, or enable auto-generate references in Big Red Cloud.`
    );
  }

  if (!hasManualReference) {
    throw preflightError(
      `Red stopped before posting because this company is configured for manual ${label} references. Please provide the reference number, or enable auto-generate references in Big Red Cloud.`
    );
  }

  return { warnings };
}

export async function loadAndEnforceReferenceSettings(
  companyName: string,
  workflow: ReferenceWorkflow,
  payload?: unknown,
  endpointKind: ReferenceEndpointKind = "manual",
  options?: ReferencePreflightOptions
): Promise<{ settings: CompanyReferenceSettings; warnings: string[] }> {
  const settings = await getCompanyReferenceSettings(companyName);
  const { warnings } = enforceReferenceSettingsOrThrow(
    settings,
    workflow,
    payload,
    endpointKind,
    options
  );

  return { settings, warnings };
}
