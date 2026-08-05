import crypto from "node:crypto";
import { ensureConnectionStoreInitialized, getConnectionStore, } from "./connection_store.js";
/** Short-lived opaque success-page sessions — confirmation codes stay off the URL. */
export const CONNECTION_SUCCESS_PAGE_TTL_MS = 30 * 60 * 1000;
export function buildConnectionSuccessPath(successId) {
    return `/connect/success/${encodeURIComponent(successId)}`;
}
export function successUrlContainsConfirmationCode(url, confirmationCode) {
    if (!confirmationCode) {
        return false;
    }
    try {
        const parsed = new URL(url, "http://red.local");
        const haystack = `${parsed.pathname}?${parsed.search}#${parsed.hash}`;
        return haystack.includes(confirmationCode);
    }
    catch {
        return url.includes(confirmationCode);
    }
}
export async function createConnectionSuccessPage(args) {
    await ensureConnectionStoreInitialized();
    let successId = crypto.randomBytes(16).toString("hex");
    // Opaque id must never equal the confirmation code (same length/format possible).
    while (successId === args.confirmationCode) {
        successId = crypto.randomBytes(16).toString("hex");
    }
    const now = Date.now();
    await getConnectionStore().saveConnectionSuccessPage({
        successId,
        confirmationCode: args.confirmationCode,
        connectedNames: args.connectedNames,
        failedCompanies: args.failedCompanies ?? [],
        createdAt: now,
        expiresAt: now + CONNECTION_SUCCESS_PAGE_TTL_MS,
    });
    return { successId, path: buildConnectionSuccessPath(successId) };
}
export async function getConnectionSuccessPage(successId) {
    await ensureConnectionStoreInitialized();
    const trimmed = successId.trim();
    if (!trimmed) {
        return null;
    }
    return getConnectionStore().getConnectionSuccessPage(trimmed);
}
