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
import { brcFetch, extractListItems } from "../shared.js";
export const SALES_VAT_CATEGORY_STOP_MESSAGE = "Red stopped before creating this sales invoice because the selected VAT rate belongs to a purchase VAT category. Sales invoices must use a Sales VAT rate. Please choose the correct Sales VAT rate and try again.";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readNumber(value) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function readCategoryName(record) {
    const candidate = record.name ??
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
export function classifyVatCategoryName(name) {
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
function readCategoryId(record) {
    return readNumber(record.id ?? record.vatCategoryId ?? record.categoryId);
}
/**
 * Builds a lookup of VAT rate id -> VAT category classification from raw BRC
 * VAT categories and VAT rates list responses.
 */
export function buildSalesVatCategoryContext(categories, rates) {
    const categoryClassById = new Map();
    for (const category of extractListItems(categories)) {
        if (!isRecord(category))
            continue;
        const id = readCategoryId(category);
        if (id === undefined)
            continue;
        const label = readCategoryName(category) || `VAT category ${id}`;
        categoryClassById.set(id, {
            categoryClass: classifyVatCategoryName(label),
            categoryLabel: label,
        });
    }
    const salesVatRateIds = new Set();
    const vatRateCategory = new Map();
    for (const rate of extractListItems(rates)) {
        if (!isRecord(rate))
            continue;
        const rateId = readNumber(rate.id ?? rate.vatRateId);
        const categoryId = readNumber(rate.vatCategoryId ?? rate.categoryId);
        if (rateId === undefined || categoryId === undefined)
            continue;
        const category = categoryClassById.get(categoryId);
        if (!category)
            continue;
        vatRateCategory.set(rateId, category);
        if (category.categoryClass === "sales") {
            salesVatRateIds.add(rateId);
        }
    }
    const hasSalesCategory = Array.from(categoryClassById.values()).some((entry) => entry.categoryClass === "sales");
    return { salesVatRateIds, vatRateCategory, hasSalesCategory };
}
/**
 * Collects the vatRateId from each sales document product line. Prefers a
 * productTrans array, otherwise falls back to a flat/top-level shape used by
 * structured args and batch items.
 */
export function collectSalesLineVatRateIds(payload) {
    if (!isRecord(payload)) {
        return [];
    }
    const ids = [];
    if (Array.isArray(payload.productTrans) && payload.productTrans.length > 0) {
        for (const line of payload.productTrans) {
            if (!isRecord(line))
                continue;
            const id = readNumber(line.vatRateId);
            if (id !== undefined)
                ids.push(id);
        }
        return ids;
    }
    const flat = readNumber(payload.vatRateId);
    if (flat !== undefined)
        ids.push(flat);
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
export function assertSalesVatRatesOrThrow(payload, context) {
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
        throw new Error(`Red stopped before creating this sales invoice because the selected VAT rate belongs to a non-Sales VAT category ("${category.categoryLabel}"). Sales invoices must use a Sales VAT rate. Please choose the correct Sales VAT rate and try again.`);
    }
}
/**
 * Loads the company's VAT categories and rates, then validates that every sales
 * invoice product line uses a Sales VAT rate.
 */
export async function enforceSalesVatCategoryOrThrow(companyName, payload) {
    const context = await loadSalesVatCategoryContext(companyName);
    assertSalesVatRatesOrThrow(payload, context);
}
async function defaultLoadSalesVatCategoryContext(companyName) {
    const [categories, rates] = await Promise.all([
        brcFetch(companyName, "/v1/vatCategories"),
        brcFetch(companyName, "/v1/vatRates?page=1&pageSize=500"),
    ]);
    return buildSalesVatCategoryContext(categories, rates);
}
let activeContextLoader = defaultLoadSalesVatCategoryContext;
export function loadSalesVatCategoryContext(companyName) {
    return activeContextLoader(companyName);
}
/**
 * Test seam: override how the VAT category context is loaded so guards can be
 * exercised without a live BRC connection. Pass undefined to restore the
 * default network loader.
 */
export function setSalesVatCategoryContextLoaderForTests(loader) {
    activeContextLoader = loader ?? defaultLoadSalesVatCategoryContext;
}
