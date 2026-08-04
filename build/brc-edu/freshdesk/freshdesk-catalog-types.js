export const DEFAULT_BRC_FRESHDESK_OVERRIDES_BLOB = "brc-edu/freshdesk/article-overrides.json";
export const DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB = "brc-edu/freshdesk/effective-article-catalog.json";
export const DEFAULT_BRC_FRESHDESK_SYNC_STATUS_BLOB = "brc-edu/freshdesk/sync-status.json";
export function freshdeskArticleIdFromNumber(id) {
    return String(id);
}
/** Normalise article ids so "1001" and 1001 compare equal. */
export function normalizeFreshdeskArticleId(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
export function freshdeskArticleIdsMatch(left, right) {
    const a = normalizeFreshdeskArticleId(left);
    const b = normalizeFreshdeskArticleId(right);
    return Boolean(a) && a === b;
}
