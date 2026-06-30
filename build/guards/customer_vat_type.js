/**
 * Customer VAT type lookup for sales invoice creation.
 *
 * BRC customers carry a VAT classification (Domestic, Other EU, Foreign – Non
 * EU, VAT Exempt) as a numeric `vatType`. The sales invoice document uses the
 * same enumeration as `vatTypeId`, and BRC's manual invoice entry defaults the
 * invoice VAT type from the selected customer. These helpers read that value so
 * sales invoice creation can mirror that default.
 *
 * This module is read-only and is intentionally only used by sales invoice
 * creation. It does NOT change VAT rate / VAT percentage selection.
 */
import { brcFetch } from "../shared.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readVatTypeNumber(value) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
/**
 * Extracts the BRC customer VAT type (JSON `vatType`) from a customer record,
 * falling back across the casings BRC uses. Returns undefined when no usable
 * VAT type is present so callers can treat it as "missing" rather than Domestic.
 */
export function extractCustomerVatType(record) {
    if (!isRecord(record)) {
        return undefined;
    }
    return readVatTypeNumber(record.vatType ??
        record.VatType ??
        record.vatTypeId ??
        record.VatTypeId);
}
function defaultCustomerVatTypeLoader(companyName, customerId) {
    return brcFetch(companyName, `/v1/customers/${encodeURIComponent(String(customerId))}`);
}
let activeCustomerLoader = defaultCustomerVatTypeLoader;
/**
 * Test seam: override how the customer record is loaded so VAT type defaulting
 * can be exercised without a live BRC connection. Pass undefined to restore the
 * default network loader.
 */
export function setCustomerVatTypeLoaderForTests(loader) {
    activeCustomerLoader = loader ?? defaultCustomerVatTypeLoader;
}
/**
 * Resolves the selected customer's VAT type for a sales invoice.
 *
 * Returns the numeric `vatType` from the BRC customer record, or undefined when
 * the customer cannot be read or carries no VAT type. Callers decide the
 * fallback (Domestic) — this helper never invents one.
 */
export async function resolveCustomerVatType(companyName, customerId) {
    if (customerId === undefined || customerId === null || customerId === "") {
        return undefined;
    }
    try {
        const record = await activeCustomerLoader(companyName, customerId);
        return extractCustomerVatType(record);
    }
    catch {
        return undefined;
    }
}
