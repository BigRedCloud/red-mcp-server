/**
 * Sales VAT category guard.
 *
 * BRC VAT rates each belong to a VAT category (for example "Sales",
 * "Purchases for Resale", "Purchases not for Resale"). A sales invoice line
 * must use a VAT rate from the Sales VAT category, even when a purchase VAT rate
 * happens to have the same percentage.
 *
 * This guard maps each VAT rate id to its VAT category, then blocks a sales
 * invoice when any product line uses a VAT rate that does not belong to the
 * Sales VAT category. The pure helpers are unit-tested without any network.
 */

import { brcFetch, extractListItems, type JsonRecord } from "../shared.js";

export type VatCategoryClass = "sales" | "purchase" | "other";

export interface SalesVatCategoryContext {
  /** VAT rate ids known to belong to a Sales VAT category. */
  salesVatRateIds: Set<number>;
  /** VAT rate id -> resolved category classification and label. */
  vatRateCategory: Map<number, { categoryClass: VatCategoryClass; categoryLabel: string }>;
  /** True when at least one Sales VAT category was identified for the company. */
  hasSalesCategory: boolean;
}

export const SALES_VAT_CATEGORY_STOP_MESSAGE =
  "Red stopped before creating this sales invoice because the selected VAT rate belongs to a purchase VAT category. Sales invoices must use a Sales VAT rate. Please choose the correct Sales VAT rate and try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readCategoryName(record: JsonRecord): string {
  const candidate =
    record.name ??
    record.description ??
    record.categoryName ??
    record.vatCategoryName ??
    record.label ??
    record.title;
  return typeof candidate === "string" ? candidate : "";
}

/**
 * Classifies a VAT category by its name.
 *
 * Purchase keywords are checked first so a name like "Purchases for Resale" is
 * never mistaken for a Sales category just because "Resale" contains "sale".
 */
export function classifyVatCategoryName(name: unknown): VatCategoryClass {
  const text = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (text === "") {
    return "other";
  }

  if (text.includes("purchase") || text.includes("resale")) {
    return "purchase";
  }

  if (text.includes("sale")) {
    return "sales";
  }

  return "other";
}

function readCategoryId(record: JsonRecord): number | undefined {
  return readNumber(record.id ?? record.vatCategoryId ?? record.categoryId);
}

/**
 * Builds a lookup of VAT rate id -> VAT category classification from raw BRC
 * VAT categories and VAT rates list responses.
 */
export function buildSalesVatCategoryContext(
  categories: unknown,
  rates: unknown
): SalesVatCategoryContext {
  const categoryClassById = new Map<
    number,
    { categoryClass: VatCategoryClass; categoryLabel: string }
  >();

  for (const category of extractListItems(categories)) {
    if (!isRecord(category)) continue;
    const id = readCategoryId(category);
    if (id === undefined) continue;
    const label = readCategoryName(category) || `VAT category ${id}`;
    categoryClassById.set(id, {
      categoryClass: classifyVatCategoryName(label),
      categoryLabel: label,
    });
  }

  const salesVatRateIds = new Set<number>();
  const vatRateCategory = new Map<
    number,
    { categoryClass: VatCategoryClass; categoryLabel: string }
  >();

  for (const rate of extractListItems(rates)) {
    if (!isRecord(rate)) continue;
    const rateId = readNumber(rate.id ?? rate.vatRateId);
    const categoryId = readNumber(rate.vatCategoryId ?? rate.categoryId);
    if (rateId === undefined || categoryId === undefined) continue;

    const category = categoryClassById.get(categoryId);
    if (!category) continue;

    vatRateCategory.set(rateId, category);
    if (category.categoryClass === "sales") {
      salesVatRateIds.add(rateId);
    }
  }

  const hasSalesCategory = Array.from(categoryClassById.values()).some(
    (entry) => entry.categoryClass === "sales"
  );

  return { salesVatRateIds, vatRateCategory, hasSalesCategory };
}

/**
 * Collects the vatRateId from each sales document product line. Prefers a
 * productTrans array, otherwise falls back to a flat/top-level shape used by
 * structured args and batch items.
 */
export function collectSalesLineVatRateIds(payload: unknown): number[] {
  if (!isRecord(payload)) {
    return [];
  }

  const ids: number[] = [];

  if (Array.isArray(payload.productTrans) && payload.productTrans.length > 0) {
    for (const line of payload.productTrans) {
      if (!isRecord(line)) continue;
      const id = readNumber(line.vatRateId);
      if (id !== undefined) ids.push(id);
    }
    return ids;
  }

  const flat = readNumber(payload.vatRateId);
  if (flat !== undefined) ids.push(flat);

  return ids;
}

/**
 * Throws a customer-facing error when any sales invoice product line uses a VAT
 * rate that does not belong to the Sales VAT category.
 *
 * When the company's Sales VAT category could not be identified, or a line VAT
 * rate is not present in the rate list, the line is left alone so valid invoices
 * are never blocked by missing/unknown reference data.
 */
export function assertSalesVatRatesOrThrow(
  payload: unknown,
  context: SalesVatCategoryContext
): void {
  if (!context.hasSalesCategory) {
    return;
  }

  for (const rateId of collectSalesLineVatRateIds(payload)) {
    const category = context.vatRateCategory.get(rateId);
    if (!category || category.categoryClass === "sales") {
      continue;
    }

    const isPurchase = category.categoryClass === "purchase";
    if (isPurchase) {
      throw new Error(SALES_VAT_CATEGORY_STOP_MESSAGE);
    }

    throw new Error(
      `Red stopped before creating this sales invoice because the selected VAT rate belongs to a non-Sales VAT category ("${category.categoryLabel}"). Sales invoices must use a Sales VAT rate. Please choose the correct Sales VAT rate and try again.`
    );
  }
}

/**
 * Loads the company's VAT categories and rates, then validates that every sales
 * invoice product line uses a Sales VAT rate.
 */
export async function enforceSalesVatCategoryOrThrow(
  companyName: string,
  payload: unknown
): Promise<void> {
  const context = await loadSalesVatCategoryContext(companyName);
  assertSalesVatRatesOrThrow(payload, context);
}

async function defaultLoadSalesVatCategoryContext(
  companyName: string
): Promise<SalesVatCategoryContext> {
  const [categories, rates] = await Promise.all([
    brcFetch(companyName, "/v1/vatCategories"),
    brcFetch(companyName, "/v1/vatRates?page=1&pageSize=500"),
  ]);

  return buildSalesVatCategoryContext(categories, rates);
}

type SalesVatCategoryContextLoader = (
  companyName: string
) => Promise<SalesVatCategoryContext>;

let activeContextLoader: SalesVatCategoryContextLoader =
  defaultLoadSalesVatCategoryContext;

export function loadSalesVatCategoryContext(
  companyName: string
): Promise<SalesVatCategoryContext> {
  return activeContextLoader(companyName);
}

/**
 * Test seam: override how the VAT category context is loaded so guards can be
 * exercised without a live BRC connection. Pass undefined to restore the
 * default network loader.
 */
export function setSalesVatCategoryContextLoaderForTests(
  loader?: SalesVatCategoryContextLoader
): void {
  activeContextLoader = loader ?? defaultLoadSalesVatCategoryContext;
}
