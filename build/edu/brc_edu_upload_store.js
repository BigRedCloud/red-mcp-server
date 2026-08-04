import { timingSafeEqual } from "node:crypto";
/**
 * Shared BRC Edu storage and admin-secret helpers.
 * File upload / workbook blob naming was removed; YouTube catalogues use the same storage settings.
 */
export const BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY = "secret";
export function getBrcEduAdminUploadSecret() {
    const secret = process.env.BRC_EDU_ADMIN_UPLOAD_SECRET?.trim();
    return secret || null;
}
export function getBrcEduUploadStorageConnectionString() {
    const connectionString = process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING?.trim();
    return connectionString || null;
}
export function getBrcEduUploadContainer() {
    const container = process.env.BRC_EDU_UPLOAD_CONTAINER?.trim();
    return container || null;
}
function secretsMatch(expected, provided) {
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (expectedBuffer.length !== providedBuffer.length) {
        return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
}
export function validateBrcEduAdminUploadSecret(providedSecret) {
    const configuredSecret = getBrcEduAdminUploadSecret();
    if (!configuredSecret) {
        return {
            ok: false,
            status: 503,
            error: "BRC Edu admin is not configured.",
        };
    }
    const normalizedSecret = providedSecret?.trim() ?? "";
    if (!normalizedSecret || !secretsMatch(configuredSecret, normalizedSecret)) {
        return {
            ok: false,
            status: 401,
            error: "Unauthorized.",
        };
    }
    return { ok: true };
}
