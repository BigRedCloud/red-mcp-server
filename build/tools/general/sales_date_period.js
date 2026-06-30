/**
 * Sales document date / period wording.
 *
 * In BRC a sales document has a processing date (the document/invoice date the
 * user asked for) and a stored `entryDate` that reflects the accounting
 * period/month the document was entered into. BRC routinely stores `entryDate`
 * as the first day of that month, so it must be presented as the period, not
 * flagged as a possible problem with the invoice date.
 *
 * These helpers produce neutral wording ("Processing date: 30/06/2026",
 * "Period entered: June 2026") and only raise a warning when the actual
 * processing date differs from the requested invoice/processing date.
 */
const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
function parseIsoDateParts(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
        return undefined;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31) {
        return undefined;
    }
    return { year, month, day };
}
function formatDayMonthYear(parts) {
    const dd = String(parts.day).padStart(2, "0");
    const mm = String(parts.month).padStart(2, "0");
    return `${dd}/${mm}/${parts.year}`;
}
function formatMonthYear(parts) {
    return `${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}
/**
 * Builds neutral processing-date / period wording for a created sales document.
 *
 * - `processingDate` reflects the processing date BRC stored (falling back to
 *   the requested date), shown as dd/mm/yyyy.
 * - `periodEntered` reflects the accounting month from the stored `entryDate`.
 *   A first-of-month `entryDate` is normal and is NEVER treated as a mismatch.
 * - A warning is produced only when the stored processing date differs from the
 *   requested invoice/processing date.
 */
export function buildSalesDatePeriodSummary(args) {
    const requested = parseIsoDateParts(args.requestedProcDate);
    const returnedProc = parseIsoDateParts(args.returnedProcDate);
    const entry = parseIsoDateParts(args.returnedEntryDate);
    const effectiveProc = returnedProc ?? requested;
    const processingDate = effectiveProc
        ? `Processing date: ${formatDayMonthYear(effectiveProc)}`
        : undefined;
    const periodEntered = entry
        ? `Period entered: ${formatMonthYear(entry)}`
        : undefined;
    // A genuine mismatch only exists when both processing dates are known and the
    // actual stored processing date differs from the requested one. The stored
    // entryDate (period indicator) is never compared against the processing date.
    const processingDateMismatch = Boolean(requested &&
        returnedProc &&
        (requested.year !== returnedProc.year ||
            requested.month !== returnedProc.month ||
            requested.day !== returnedProc.day));
    const summary = {
        processingDate,
        periodEntered,
        processingDateMismatch,
    };
    if (processingDateMismatch && requested && returnedProc) {
        summary.warning = `The processing date was requested as ${formatDayMonthYear(requested)} but Big Red Cloud recorded ${formatDayMonthYear(returnedProc)}. This is worth checking.`;
    }
    return summary;
}
