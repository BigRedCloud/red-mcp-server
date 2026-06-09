import {
  brcFetch,
  extractListItems,
  normaliseCompanyName,
  round2,
  toNumber,
  type JsonRecord,
} from "./shared.js";

const vatOnCashCache = new Map<string, boolean>();

/** VOCR: VAT on Cash Receipt — `vocrSettingValue` on company setup / getCompanyOptions. */
const VOCR_OPTION_KEY = "vocrSettingValue";

/** VOC: VAT on Cash — legacy/XML names (cash payments; kept for settings XML scans). */
const EXPLICIT_KEY_PATTERN =
  /^(vocrSettingValue|vatOnCashReceipts?|useVatOnCashReceipts?|enableVatOnCashReceipts?|vatOnCash)$/i;

const XML_TAG_PATTERNS = [
  /<VatOnCashReceipts>\s*(true|false|1|0)\s*<\/VatOnCashReceipts>/i,
  /<VatOnCashReceipt>\s*(true|false|1|0)\s*<\/VatOnCashReceipt>/i,
  /<VatOnCash>\s*(true|false|1|0)\s*<\/VatOnCash>/i,
  /<VocrSettingValue>\s*(true|false|1|0)\s*<\/VocrSettingValue>/i,
];

function parseBooleanSetting(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function findExplicitVatOnCashSetting(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    for (const pattern of XML_TAG_PATTERNS) {
      const match = value.match(pattern);
      if (match) return parseBooleanSetting(match[1]);
    }

    const jsonMatch = value.match(/"vatOnCash(?:Receipts?)?"\s*:\s*(true|false)/i);
    if (jsonMatch) return parseBooleanSetting(jsonMatch[1]);
  }

  if (typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findExplicitVatOnCashSetting(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    if (EXPLICIT_KEY_PATTERN.test(key)) {
      const parsed = parseBooleanSetting(nested);
      if (parsed !== undefined) return parsed;
    }

    const found = findExplicitVatOnCashSetting(nested);
    if (found !== undefined) return found;
  }

  return undefined;
}

function optionsRoot(source: unknown): JsonRecord | undefined {
  if (!source || typeof source !== "object") return undefined;
  const record = source as JsonRecord;
  if (record.options && typeof record.options === "object") {
    return record.options as JsonRecord;
  }
  return record;
}

/** Reads VOCR from `/v1/companySetupConfig/getCompanyOptions` and nested `options`. */
function findVocrSettingValue(...sources: unknown[]): boolean | undefined {
  for (const source of sources) {
    const options = optionsRoot(source);
    if (!options || !(VOCR_OPTION_KEY in options)) continue;
    const parsed = parseBooleanSetting(options[VOCR_OPTION_KEY]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function findVocrFromCompanySettingsXml(
  companySettings: unknown,
  regionDescription?: string
): boolean | undefined {
  const regionHint = regionDescription?.trim().toLowerCase();

  for (const item of extractListItems(companySettings)) {
    const raw = item.value ?? item;
    if (typeof raw !== "string") continue;

    const blocks = raw.matchAll(/<VOCRSetting>([\s\S]*?)<\/VOCRSetting>/gi);
    for (const block of blocks) {
      const inner = block[1];
      const region = inner.match(/<Region>\s*([^<]+)\s*<\/Region>/i)?.[1]?.trim().toLowerCase();
      const value = inner.match(/<Value>\s*(true|false|1|0)\s*<\/Value>/i)?.[1];
      const parsed = parseBooleanSetting(value);
      if (parsed === undefined) continue;

      if (regionHint && region && !region.includes(regionHint) && !regionHint.includes(region)) {
        continue;
      }

      return parsed;
    }
  }

  return undefined;
}

async function loadVatOnCashReceiptEnabled(companyName: string): Promise<boolean> {
  const [setupConfig, companyOptions, companySettings] = await Promise.all([
    brcFetch(companyName, "/v1/companySetupConfig").catch(() => null),
    brcFetch(companyName, "/v1/companySetupConfig/getCompanyOptions").catch(() => null),
    brcFetch(companyName, "/v1/companySettings?page=1&pageSize=20").catch(() => null),
  ]);

  const setup = setupConfig as JsonRecord | null;
  const regionDescription =
    typeof setup?.generalDetails === "object" && setup.generalDetails !== null
      ? String((setup.generalDetails as JsonRecord).regionDescription || "")
      : undefined;

  const vocrFromOptions = findVocrSettingValue(companyOptions, setup, setup?.options);
  if (vocrFromOptions !== undefined) return vocrFromOptions;

  const vocrFromXml = findVocrFromCompanySettingsXml(companySettings, regionDescription);
  if (vocrFromXml !== undefined) return vocrFromXml;

  for (const source of [setup, companyOptions, setup?.options]) {
    const found = findExplicitVatOnCashSetting(source);
    if (found !== undefined) return found;
  }

  for (const item of extractListItems(companySettings)) {
    const found = findExplicitVatOnCashSetting(item.value ?? item);
    if (found !== undefined) return found;
  }

  // When VOCR is absent from API/XML, default off (ledger-only receipts).
  return false;
}

/** Clears per-company VOCR cache (e.g. after tests). */
export function clearVatOnCashReceiptCache(companyName?: string): void {
  if (companyName) {
    vatOnCashCache.delete(normaliseCompanyName(companyName));
    return;
  }
  vatOnCashCache.clear();
}

export async function isVatOnCashReceiptEnabled(companyName: string): Promise<boolean> {
  const key = normaliseCompanyName(companyName);
  if (vatOnCashCache.has(key)) {
    return vatOnCashCache.get(key)!;
  }

  const enabled = await loadVatOnCashReceiptEnabled(companyName);
  vatOnCashCache.set(key, enabled);
  return enabled;
}

export function sanitizeCashReceiptInput(
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

  const total = round2(toNumber(next.total));
  if (total > 0) {
    if (next.customerId !== undefined || next.acCode !== undefined) {
      const ledger = toNumber(next.ledger);
      next.ledger = round2(ledger > 0 ? ledger : total);
      next.unallocated = round2(toNumber(next.unallocated));
    }
  }

  return next;
}
