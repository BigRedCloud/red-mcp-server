/**
 * Customer VAT type resolution.
 *
 * BRC customers carry a VAT classification (Domestic, Other EU, Foreign – Non
 * EU, VAT Exempt) as a numeric `vatType`. A sales document's `vatTypeId` uses
 * the same enumeration, so when Red creates a sales invoice it should default
 * the document VAT type from the selected customer instead of always posting
 * Domestic. These helpers read the customer's VAT type without ever inventing a
 * Domestic default: an unknown customer VAT type resolves to undefined.
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
 * Extracts the BRC customer VAT type (JSON `vatType`) from a customer record.
 * Falls back across the casings BRC uses. Returns undefined when no usable VAT
 * type is present so callers never silently treat a missing value as Domestic.
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
 * Resolves the selected customer's VAT type for defaulting a sales document.
 *
 * Reads the BRC customer record and returns its numeric `vatType`. Never
 * invents a Domestic default: returns undefined when the customer cannot be
 * read or carries no VAT type, so the caller can omit the field (and warn)
 * rather than silently posting Domestic.
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
