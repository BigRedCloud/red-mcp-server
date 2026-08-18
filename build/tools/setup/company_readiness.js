/**
 * Company readiness / health-check evaluation for brc_company_readiness_check.
 *
 * Pure scoring lives in evaluateCompanyReadiness; network fetches are isolated
 * so one failed endpoint does not fail the whole report.
 */
import { buildConnectionExpiryMetadata, formatCredentialExpiryPhrase, } from "../../auth/connection_presentation.js";
import { getCompanyProcessingSettings, } from "../../guards/company_processing_settings.js";
import { formatReferenceMode, getCompanyReferenceSettings, } from "../../guards/company_reference_settings.js";
import { buildSalesVatCategoryContext } from "../../guards/sales_vat_category.js";
import { getCustomerDeploymentCapabilities } from "../../config/server_config.js";
import { brcFetch, extractListItems, getCompanyApiContexts, normaliseCompanyName, } from "../../shared.js";
const LIST_PAGE_SIZE = 5;
const LOOKUP_PAGE_SIZE = 50;
function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function pad2(value) {
    return String(value).padStart(2, "0");
}
function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function findNumberByKeys(obj, keys) {
    if (!obj || typeof obj !== "object")
        return null;
    for (const [key, value] of Object.entries(obj)) {
        if (keys.includes(key)) {
            const n = asNumber(value);
            if (n !== null)
                return n;
        }
        if (value && typeof value === "object") {
            const nested = findNumberByKeys(value, keys);
            if (nested !== null)
                return nested;
        }
    }
    return null;
}
function findDateByLikelyKeys(obj, keys) {
    if (!obj || typeof obj !== "object")
        return null;
    for (const [key, value] of Object.entries(obj)) {
        if (keys.includes(key) && (typeof value === "string" || typeof value === "number")) {
            const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
            if (match)
                return match[0];
        }
        if (value && typeof value === "object") {
            const nested = findDateByLikelyKeys(value, keys);
            if (nested)
                return nested;
        }
    }
    return null;
}
export function deriveFinancialYear(financialYearData, setupData) {
    const sources = [financialYearData, setupData];
    const explicitStart = findDateByLikelyKeys(sources, [
        "startDate",
        "financialYearStartDate",
        "financialYearStart",
        "fromDate",
        "periodStart",
    ]);
    const explicitEnd = findDateByLikelyKeys(sources, [
        "endDate",
        "financialYearEndDate",
        "financialYearEnd",
        "toDate",
        "periodEnd",
    ]);
    if (explicitStart) {
        return {
            start: explicitStart,
            end: explicitEnd,
            method: "explicit-date-fields",
        };
    }
    for (const source of sources) {
        const startMonth = findNumberByKeys(source, [
            "startMonth",
            "firstMonth",
            "financialYearStartMonth",
            "fYearStartMonth",
        ]);
        const startYear = findNumberByKeys(source, [
            "startYear",
            "financialYearStartYear",
            "fYearStartYear",
        ]);
        if (startMonth && startMonth >= 1 && startMonth <= 12 && startYear && startYear > 1900) {
            const start = `${startYear}-${pad2(startMonth)}-01`;
            const endMonth = startMonth === 1 ? 12 : startMonth - 1;
            const endYear = startMonth === 1 ? startYear : startYear + 1;
            const end = `${endYear}-${pad2(endMonth)}-${pad2(lastDayOfMonth(endYear, endMonth))}`;
            return {
                start,
                end,
                method: "start-year-start-month",
            };
        }
    }
    return {
        start: null,
        end: null,
        method: "not-detected",
    };
}
export function dateWithinRange(dateOnly, start, end) {
    if (!dateOnly || !start || !end)
        return null;
    return dateOnly >= start && dateOnly <= end;
}
export function transactionNeedsPreflightChecks(settings, referenceSettings) {
    if (referenceSettings) {
        const referenceModes = [
            referenceSettings.salesAutoGenerateReference,
            referenceSettings.purchasesAutoGenerateReference,
            referenceSettings.quotesAutoGenerateReference,
            referenceSettings.debtorsJournalAutoGenerateReference,
            referenceSettings.creditorsJournalAutoGenerateReference,
        ];
        if (referenceModes.some((mode) => mode === undefined)) {
            return true;
        }
    }
    if (settings.vatOnCashReceiptsEnabled === undefined) {
        return true;
    }
    if (settings.vatOnCashReceiptsEnabled === false) {
        return false;
    }
    return (settings.cashReceiptVatMode === "manual" ||
        settings.cashReceiptVatMode === "allocation" ||
        settings.cashReceiptVatMode === "unknown");
}
/**
 * Sales Analysis categories use SA account codes (for example SA01).
 * Customer (CR) categories are not treated as Sales Analysis.
 */
export function isSalesAnalysisCategory(item) {
    const code = String(item.accountCode ?? item.code ?? "")
        .trim()
        .toUpperCase();
    if (code.startsWith("SA")) {
        return true;
    }
    const description = String(item.description ?? item.name ?? "")
        .trim()
        .toLowerCase();
    if (!description) {
        return false;
    }
    if (code.startsWith("CR") || code.startsWith("PU") || code.startsWith("CP") || code.startsWith("BP")) {
        return false;
    }
    return description.includes("sales") && !description.includes("cash sales");
}
export function isActiveVatRate(rate) {
    if (rate.isActive === false || rate.active === false) {
        return false;
    }
    return true;
}
export function countActiveSalesVatRates(categories, rates) {
    const context = buildSalesVatCategoryContext(categories, rates);
    const rateItems = extractListItems(rates);
    let salesActiveCount = 0;
    for (const rate of rateItems) {
        const rateId = asNumber(rate.id ?? rate.vatRateId);
        if (rateId === null)
            continue;
        if (!context.salesVatRateIds.has(rateId))
            continue;
        if (!isActiveVatRate(rate))
            continue;
        salesActiveCount += 1;
    }
    return {
        salesActiveCount,
        totalRatesSampled: rateItems.length,
        hasSalesCategory: context.hasSalesCategory,
    };
}
export function countSalesAnalysisCategories(categories) {
    const items = extractListItems(categories);
    const salesAnalysisCount = items.filter(isSalesAnalysisCategory).length;
    return {
        salesAnalysisCount,
        totalCategoriesSampled: items.length,
    };
}
export function inspectCompanyConnection(companyName, nowMs = Date.now()) {
    const key = normaliseCompanyName(companyName);
    const context = getCompanyApiContexts().get(key);
    if (!context) {
        return {
            contextPresent: false,
            hasCredentialMaterial: false,
            connectionActive: false,
            credentialsValid: false,
        };
    }
    const hasCredentialMaterial = Boolean(context.apiKey);
    const notExpired = context.expiresAt >= nowMs;
    const active = hasCredentialMaterial && notExpired;
    return {
        contextPresent: true,
        hasCredentialMaterial,
        expiresAtMs: context.expiresAt,
        connectionActive: active,
        credentialsValid: active,
    };
}
function pushUnique(target, message) {
    if (!target.includes(message)) {
        target.push(message);
    }
}
function unknownCheck(message, details) {
    return { status: "unknown", message, details };
}
function buildConnectionCheck(connection, nowMs) {
    if (!connection.contextPresent) {
        return {
            status: "fail",
            message: "This company is not connected in the current session.",
            details: {
                contextPresent: false,
                credentialsValid: false,
                connectionActive: false,
            },
        };
    }
    if (!connection.hasCredentialMaterial) {
        return {
            status: "fail",
            message: "The company context is present, but stored credentials are missing or invalid.",
            details: {
                contextPresent: true,
                credentialsValid: false,
                connectionActive: false,
            },
        };
    }
    if (!connection.connectionActive) {
        return {
            status: "fail",
            message: "The company connection has expired. Reconnect to continue.",
            details: {
                contextPresent: true,
                credentialsValid: false,
                connectionActive: false,
                timeRemainingText: "expired",
            },
        };
    }
    const expiry = buildConnectionExpiryMetadata({
        earliestExpiresAtMs: connection.expiresAtMs,
        nowMs,
    });
    return {
        status: "pass",
        message: `Company connection is active ${formatCredentialExpiryPhrase(connection.expiresAtMs)}.`,
        details: {
            contextPresent: true,
            credentialsValid: true,
            connectionActive: true,
            timeRemainingText: expiry.timeRemainingText,
            expiryTimeWithTimezoneText: expiry.expiryTimeWithTimezoneText,
        },
    };
}
function buildFinancialYearCheck(financialYear, todayInFinancialYear) {
    const details = {
        startDate: financialYear.start,
        endDate: financialYear.end,
        todayInFinancialYear,
        method: financialYear.method,
    };
    if (!financialYear.start || !financialYear.end) {
        return {
            check: {
                status: "fail",
                message: "The current financial year could not be determined.",
                details,
            },
            blocker: "The current financial year is missing or could not be read.",
        };
    }
    if (todayInFinancialYear === false) {
        return {
            check: {
                status: "fail",
                message: `Today is outside the financial year (${financialYear.start} to ${financialYear.end}).`,
                details,
            },
            blocker: "Today is outside the company's current financial year, so transaction posting is not ready.",
        };
    }
    if (todayInFinancialYear === null) {
        return {
            check: {
                status: "unknown",
                message: "The financial year dates could not be fully checked.",
                details,
            },
        };
    }
    return {
        check: {
            status: "pass",
            message: `Today is inside the financial year (${financialYear.start} to ${financialYear.end}).`,
            details,
        },
    };
}
function buildListPresenceCheck(args) {
    if (!args.sample.ok) {
        return unknownCheck(`Could not check ${args.label}: ${args.sample.errorMessage ?? "lookup failed"}.`, { count: args.sample.count });
    }
    if (args.sample.count === 0) {
        return {
            status: args.emptyStatus ?? "warning",
            message: args.emptyMessage,
            details: { count: 0 },
        };
    }
    return {
        status: "pass",
        message: args.passMessage,
        details: { count: args.sample.count },
    };
}
function buildProcessingCheck(sample, warnings) {
    if (!sample.ok || !sample.value) {
        return unknownCheck(`Could not read processing settings: ${sample.errorMessage ?? "lookup failed"}.`);
    }
    const settings = sample.value;
    const details = {
        vatOnCashReceiptsEnabled: settings.vatOnCashReceiptsEnabled,
        cashReceiptVatMode: settings.cashReceiptVatMode,
    };
    if (settings.vatOnCashReceiptsEnabled === undefined) {
        pushUnique(warnings, "Could not confirm the VAT on Cash Receipts setting from company options.");
        return {
            status: "warning",
            message: "Processing settings were read, but VAT on Cash Receipts could not be confirmed.",
            details,
        };
    }
    if (settings.vatOnCashReceiptsEnabled === true) {
        if (settings.cashReceiptVatMode === "manual") {
            pushUnique(warnings, "VAT on Cash Receipts is enabled with manual VAT mode. Extra VAT details may be required before posting cash receipts.");
            return {
                status: "warning",
                message: "Processing settings need attention for cash-receipt VAT (manual mode).",
                details,
            };
        }
        if (settings.cashReceiptVatMode === "allocation") {
            pushUnique(warnings, "VAT on Cash Receipts is enabled with allocation mode. Allocation details may be required before posting cash receipts.");
            return {
                status: "warning",
                message: "Processing settings need attention for cash-receipt VAT (allocation mode).",
                details,
            };
        }
        if (settings.cashReceiptVatMode === "unknown") {
            pushUnique(warnings, "VAT on Cash Receipts is enabled, but the cash receipt VAT mode could not be determined.");
            return {
                status: "warning",
                message: "Processing settings were read, but cash-receipt VAT mode is unclear.",
                details,
            };
        }
    }
    return {
        status: "pass",
        message: settings.vatOnCashReceiptsEnabled === false
            ? "Processing settings were read. VAT on Cash Receipts is not enabled."
            : "Processing settings were read successfully.",
        details,
    };
}
function buildReferenceCheck(sample, warnings) {
    const formatted = {
        salesReferences: "Unknown",
        purchasesReferences: "Unknown",
        quotesReferences: "Unknown",
        debtorsJournalReferences: "Unknown",
        creditorsJournalReferences: "Unknown",
    };
    if (!sample.ok || !sample.value) {
        return {
            check: unknownCheck(`Could not read reference settings: ${sample.errorMessage ?? "lookup failed"}.`),
            formatted,
        };
    }
    const settings = sample.value;
    formatted.salesReferences = formatReferenceMode(settings.salesAutoGenerateReference);
    formatted.purchasesReferences = formatReferenceMode(settings.purchasesAutoGenerateReference);
    formatted.quotesReferences = formatReferenceMode(settings.quotesAutoGenerateReference);
    formatted.debtorsJournalReferences = formatReferenceMode(settings.debtorsJournalAutoGenerateReference);
    formatted.creditorsJournalReferences = formatReferenceMode(settings.creditorsJournalAutoGenerateReference);
    const details = { ...formatted };
    if (settings.salesAutoGenerateReference === undefined) {
        pushUnique(warnings, "Could not confirm whether sales references are auto-generated or manual.");
    }
    else if (settings.salesAutoGenerateReference === false) {
        pushUnique(warnings, "Sales references are manual. A reference will be required before posting sales invoices or credit notes.");
    }
    if (settings.purchasesAutoGenerateReference === undefined) {
        pushUnique(warnings, "Could not confirm whether purchase references are auto-generated or manual.");
    }
    else if (settings.purchasesAutoGenerateReference === false) {
        pushUnique(warnings, "Purchase references are manual. A reference will be required before posting purchases.");
    }
    if (settings.quotesAutoGenerateReference === undefined) {
        pushUnique(warnings, "Could not confirm whether quote references are auto-generated or manual. Ask for a quote reference before preparing a postable quote.");
    }
    else if (settings.quotesAutoGenerateReference === false) {
        pushUnique(warnings, "Quote references are manual. A reference will be required before posting quotes.");
    }
    if (settings.debtorsJournalAutoGenerateReference === undefined) {
        pushUnique(warnings, "Could not confirm whether debtors journal references are auto-generated or manual.");
    }
    if (settings.creditorsJournalAutoGenerateReference === undefined) {
        pushUnique(warnings, "Could not confirm whether creditors journal references are auto-generated or manual.");
    }
    const hasWarning = [
        settings.salesAutoGenerateReference,
        settings.purchasesAutoGenerateReference,
        settings.quotesAutoGenerateReference,
        settings.debtorsJournalAutoGenerateReference,
        settings.creditorsJournalAutoGenerateReference,
    ].some((mode) => mode === undefined || mode === false);
    return {
        check: {
            status: hasWarning ? "warning" : "pass",
            message: hasWarning
                ? "Reference settings were read; some workflows need a manual reference or confirmation."
                : "Reference numbers are set to auto-generate for the checked workflows.",
            details,
        },
        formatted,
    };
}
export function evaluateCompanyReadiness(input) {
    const warnings = [];
    const blockers = [];
    const recommendedActions = [];
    const todayInFinancialYear = dateWithinRange(input.today, input.financialYear.start, input.financialYear.end);
    const connectionCheck = buildConnectionCheck(input.connection, input.nowMs);
    const connectionProblem = connectionCheck.status === "fail";
    if (connectionProblem) {
        pushUnique(blockers, connectionCheck.message);
        if (!input.connection.contextPresent) {
            pushUnique(recommendedActions, "Connect this company using the secure Red connection page, then run the readiness check again.");
        }
        else {
            pushUnique(recommendedActions, "Reconnect this company using the secure Red connection page.");
        }
    }
    const fy = connectionProblem
        ? {
            check: unknownCheck("Skipped financial year check because the company connection is not active."),
            blocker: undefined,
        }
        : buildFinancialYearCheck(input.financialYear, todayInFinancialYear);
    if (fy.blocker) {
        pushUnique(blockers, fy.blocker);
        pushUnique(recommendedActions, "Check the company's configured financial year. For historical transactions, do not automatically refuse the request: after explicit confirmation, use the appropriate transaction tool and let the BRC endpoint determine whether the requested operation is supported.");
    }
    const customers = connectionProblem
        ? unknownCheck("Skipped customer check because the company connection is not active.")
        : buildListPresenceCheck({
            label: "customers",
            sample: input.customers,
            emptyMessage: "No customers were found on the first page. Customer workflows may need setup data.",
            passMessage: "Customers are available.",
        });
    if (customers.status === "warning") {
        pushUnique(warnings, customers.message);
        pushUnique(recommendedActions, "Add at least one customer in Big Red Cloud before customer sales work.");
    }
    else if (customers.status === "unknown") {
        pushUnique(warnings, customers.message);
    }
    const products = connectionProblem
        ? unknownCheck("Skipped product check because the company connection is not active.")
        : buildListPresenceCheck({
            label: "products",
            sample: input.products,
            emptyMessage: "No products were found on the first page. Product-based invoices and quotes are limited; non-product transactions may still be possible.",
            passMessage: "Products are available.",
        });
    if (products.status === "warning") {
        pushUnique(warnings, products.message);
        pushUnique(recommendedActions, "Add products in Big Red Cloud if you need product lines on invoices or quotes.");
    }
    else if (products.status === "unknown") {
        pushUnique(warnings, products.message);
    }
    const suppliers = connectionProblem
        ? unknownCheck("Skipped supplier check because the company connection is not active.")
        : buildListPresenceCheck({
            label: "suppliers",
            sample: input.suppliers,
            emptyMessage: "No suppliers were found on the first page. Purchase workflows may need setup data. This does not block sales invoices.",
            passMessage: "Suppliers are available.",
        });
    if (suppliers.status === "warning") {
        pushUnique(warnings, suppliers.message);
    }
    else if (suppliers.status === "unknown") {
        pushUnique(warnings, suppliers.message);
    }
    const salesReps = connectionProblem
        ? unknownCheck("Skipped sales representative check because the company connection is not active.")
        : buildListPresenceCheck({
            label: "sales representatives",
            sample: input.salesReps,
            emptyMessage: "No sales representatives were found on the first page. Some sales documents may need a sales rep before posting.",
            passMessage: "Sales representatives are available.",
        });
    if (salesReps.status === "warning") {
        pushUnique(warnings, salesReps.message);
        pushUnique(recommendedActions, "Add a sales representative in Big Red Cloud if invoices require one.");
    }
    else if (salesReps.status === "unknown") {
        pushUnique(warnings, salesReps.message);
    }
    let salesVatRates;
    if (connectionProblem) {
        salesVatRates = unknownCheck("Skipped Sales VAT check because the company connection is not active.");
    }
    else if (!input.salesVatRates.ok) {
        salesVatRates = unknownCheck(`Could not check Sales VAT rates: ${input.salesVatRates.errorMessage ?? "lookup failed"}.`, {
            salesActiveCount: input.salesVatRates.salesActiveCount,
            totalRatesSampled: input.salesVatRates.totalRatesSampled,
        });
        pushUnique(warnings, salesVatRates.message);
    }
    else if (input.salesVatRates.salesActiveCount > 0) {
        salesVatRates = {
            status: "pass",
            message: "At least one active Sales VAT rate is available.",
            details: {
                salesActiveCount: input.salesVatRates.salesActiveCount,
                totalRatesSampled: input.salesVatRates.totalRatesSampled,
                hasSalesCategory: input.salesVatRates.hasSalesCategory,
            },
        };
    }
    else {
        salesVatRates = {
            status: "fail",
            message: "No active Sales VAT rates were found.",
            details: {
                salesActiveCount: 0,
                totalRatesSampled: input.salesVatRates.totalRatesSampled,
                hasSalesCategory: input.salesVatRates.hasSalesCategory,
            },
        };
        pushUnique(blockers, "No active Sales VAT rates are available for sales documents.");
        pushUnique(recommendedActions, "Add or activate a Sales VAT rate in Big Red Cloud before posting sales invoices.");
    }
    let salesAnalysisCategories;
    if (connectionProblem) {
        salesAnalysisCategories = unknownCheck("Skipped Sales Analysis check because the company connection is not active.");
    }
    else if (!input.salesAnalysisCategories.ok) {
        salesAnalysisCategories = unknownCheck(`Could not check Sales Analysis categories: ${input.salesAnalysisCategories.errorMessage ?? "lookup failed"}.`, {
            salesAnalysisCount: input.salesAnalysisCategories.salesAnalysisCount,
            totalCategoriesSampled: input.salesAnalysisCategories.totalCategoriesSampled,
        });
        pushUnique(warnings, salesAnalysisCategories.message);
    }
    else if (input.salesAnalysisCategories.salesAnalysisCount > 0) {
        salesAnalysisCategories = {
            status: "pass",
            message: "At least one Sales Analysis category is available.",
            details: {
                salesAnalysisCount: input.salesAnalysisCategories.salesAnalysisCount,
                totalCategoriesSampled: input.salesAnalysisCategories.totalCategoriesSampled,
            },
        };
    }
    else {
        salesAnalysisCategories = {
            status: "fail",
            message: "No Sales Analysis categories were found.",
            details: {
                salesAnalysisCount: 0,
                totalCategoriesSampled: input.salesAnalysisCategories.totalCategoriesSampled,
            },
        };
        pushUnique(blockers, "No Sales Analysis categories are available for sales document lines.");
        pushUnique(recommendedActions, "Add Sales Analysis categories (for example SA codes) in Big Red Cloud.");
    }
    let processingSettings;
    if (connectionProblem) {
        processingSettings = unknownCheck("Skipped processing settings check because the company connection is not active.");
    }
    else {
        processingSettings = buildProcessingCheck(input.processingSettings, warnings);
        if (processingSettings.status === "unknown") {
            pushUnique(warnings, processingSettings.message);
        }
    }
    let referenceFormatted = {
        salesReferences: "Unknown",
        purchasesReferences: "Unknown",
        quotesReferences: "Unknown",
        debtorsJournalReferences: "Unknown",
        creditorsJournalReferences: "Unknown",
    };
    let referenceSettings;
    if (connectionProblem) {
        referenceSettings = unknownCheck("Skipped reference settings check because the company connection is not active.");
    }
    else {
        const built = buildReferenceCheck(input.referenceSettings, warnings);
        referenceSettings = built.check;
        referenceFormatted = built.formatted;
        if (referenceSettings.status === "unknown") {
            pushUnique(warnings, referenceSettings.message);
        }
    }
    const processingValue = input.processingSettings.value;
    const referenceValue = input.referenceSettings.value;
    const needsPreflight = processingValue && referenceValue
        ? transactionNeedsPreflightChecks(processingValue, referenceValue)
        : true;
    if (needsPreflight && !connectionProblem && blockers.length === 0) {
        pushUnique(warnings, "Some transaction workflows may need extra VAT, allocation, or reference details before posting.");
    }
    const checks = {
        connection: connectionCheck,
        financialYear: fy.check,
        customers,
        products,
        suppliers,
        salesReps,
        salesVatRates,
        salesAnalysisCategories,
        processingSettings,
        referenceSettings,
    };
    // Connection problems take precedence for overall status.
    let overallStatus;
    if (connectionProblem) {
        overallStatus = "connection_problem";
    }
    else if (fy.check.status === "fail" ||
        salesVatRates.status === "fail" ||
        salesAnalysisCategories.status === "fail" ||
        blockers.length > 0) {
        overallStatus = "not_ready";
    }
    else {
        const hasWarningOrUnknown = Object.values(checks).some((check) => check.status === "warning" || check.status === "unknown");
        overallStatus = hasWarningOrUnknown || warnings.length > 0 ? "ready_with_warnings" : "ready";
    }
    const transactionReadyBase = !connectionProblem &&
        Boolean(input.financialYear.start) &&
        todayInFinancialYear !== false &&
        salesVatRates.status === "pass" &&
        salesAnalysisCategories.status === "pass";
    const readiness = {
        readOnlyReady: !connectionProblem,
        createCustomerSupplierProductReady: !connectionProblem,
        transactionReady: transactionReadyBase,
        transactionReadyStatus: !transactionReadyBase
            ? "Not ready"
            : needsPreflight
                ? "Ready with preflight checks"
                : "Ready",
        generatedDocumentReady: !connectionProblem && todayInFinancialYear !== false,
    };
    const readinessNote = transactionReadyBase && needsPreflight
        ? "Some transaction workflows may be blocked until required VAT/allocation details or reference numbers are supplied."
        : undefined;
    const summary = buildSummary({
        overallStatus,
        companyName: input.companyName,
        blockers,
        warnings,
        readiness,
    });
    if (overallStatus === "ready" && recommendedActions.length === 0) {
        // keep empty
    }
    return {
        companyName: input.companyName,
        connectedContextFound: input.connection.contextPresent,
        today: input.today,
        financialYear: input.financialYear,
        todayInFinancialYear,
        vatOnCashReceiptsEnabled: processingValue?.vatOnCashReceiptsEnabled,
        cashReceiptVatMode: processingValue?.cashReceiptVatMode,
        referenceSettings: referenceFormatted,
        referenceDataSampleCounts: {
            customersOnFirstPage: input.customers.ok ? input.customers.count : 0,
            productsOnFirstPage: input.products.ok ? input.products.count : 0,
            suppliersOnFirstPage: input.suppliers.ok ? input.suppliers.count : 0,
            vatRatesOnFirstPage: input.salesVatRates.ok
                ? input.salesVatRates.totalRatesSampled
                : 0,
            salesRepsOnFirstPage: input.salesReps.ok ? input.salesReps.count : 0,
            salesVatRatesOnFirstPage: input.salesVatRates.ok
                ? input.salesVatRates.salesActiveCount
                : 0,
            salesAnalysisCategoriesOnFirstPage: input.salesAnalysisCategories.ok
                ? input.salesAnalysisCategories.salesAnalysisCount
                : 0,
        },
        readiness,
        readinessNote,
        overallStatus,
        checks,
        summary,
        warnings,
        blockers,
        recommendedActions,
        recommendedNextPrompts: [
            "Show me my customers.",
            "Check whether a transaction date is valid.",
            "Show me my Sales VAT rates.",
            "Show me recent sales invoices.",
            "Prepare a quote preview before posting, but do not create it yet.",
        ],
        deploymentCapabilities: getCustomerDeploymentCapabilities(),
    };
}
function buildSummary(args) {
    const name = args.companyName;
    switch (args.overallStatus) {
        case "ready":
            return `${name} looks ready for read-only work and transaction workflows.`;
        case "ready_with_warnings":
            return `${name} can be used, but ${args.warnings.length} warning${args.warnings.length === 1 ? "" : "s"} should be reviewed before posting.`;
        case "not_ready":
            return `${name} is not ready for transactions yet (${args.blockers.length} blocker${args.blockers.length === 1 ? "" : "s"}).`;
        case "connection_problem":
            return `${name} is not connected with a valid active session. Connect or reconnect before checking company data.`;
        default:
            return `${name} readiness could not be fully determined.`;
    }
}
async function safeListSample(companyName, path) {
    try {
        const data = await brcFetch(companyName, path);
        return { ok: true, count: extractListItems(data).length };
    }
    catch (error) {
        return {
            ok: false,
            count: 0,
            errorMessage: error instanceof Error ? error.message : "lookup failed",
        };
    }
}
async function safeSalesVatSample(companyName) {
    try {
        const [categories, rates] = await Promise.all([
            brcFetch(companyName, "/v1/vatCategories"),
            brcFetch(companyName, `/v1/vatRates?page=1&pageSize=${LOOKUP_PAGE_SIZE}`),
        ]);
        const counted = countActiveSalesVatRates(categories, rates);
        return { ok: true, ...counted };
    }
    catch (error) {
        return {
            ok: false,
            salesActiveCount: 0,
            totalRatesSampled: 0,
            hasSalesCategory: false,
            errorMessage: error instanceof Error ? error.message : "lookup failed",
        };
    }
}
async function safeSalesAnalysisSample(companyName) {
    try {
        const data = await brcFetch(companyName, `/v1/analysisCategories?page=1&pageSize=${LOOKUP_PAGE_SIZE}`);
        const counted = countSalesAnalysisCategories(data);
        return { ok: true, ...counted };
    }
    catch (error) {
        return {
            ok: false,
            salesAnalysisCount: 0,
            totalCategoriesSampled: 0,
            errorMessage: error instanceof Error ? error.message : "lookup failed",
        };
    }
}
async function safeSettingsSample(loader) {
    try {
        const value = await loader();
        return { ok: true, value };
    }
    catch (error) {
        return {
            ok: false,
            errorMessage: error instanceof Error ? error.message : "lookup failed",
        };
    }
}
/**
 * Fetches company data with per-check isolation and returns a readiness report.
 */
export async function runCompanyReadinessCheck(companyName, options = {}) {
    const nowMs = options.nowMs ?? Date.now();
    const today = options.today ?? new Date(nowMs).toISOString().slice(0, 10);
    const connection = options.connection ?? inspectCompanyConnection(companyName, nowMs);
    if (!connection.connectionActive) {
        return evaluateCompanyReadiness({
            companyName,
            today,
            nowMs,
            connection,
            financialYear: { start: null, end: null, method: "not-checked" },
            customers: { ok: false, count: 0, errorMessage: "not connected" },
            products: { ok: false, count: 0, errorMessage: "not connected" },
            suppliers: { ok: false, count: 0, errorMessage: "not connected" },
            salesReps: { ok: false, count: 0, errorMessage: "not connected" },
            salesVatRates: {
                ok: false,
                salesActiveCount: 0,
                totalRatesSampled: 0,
                hasSalesCategory: false,
                errorMessage: "not connected",
            },
            salesAnalysisCategories: {
                ok: false,
                salesAnalysisCount: 0,
                totalCategoriesSampled: 0,
                errorMessage: "not connected",
            },
            processingSettings: { ok: false, errorMessage: "not connected" },
            referenceSettings: { ok: false, errorMessage: "not connected" },
        });
    }
    const listPath = (resource) => `/v1/${resource}?page=1&pageSize=${LIST_PAGE_SIZE}`;
    const [financialYearData, setupData, customers, products, suppliers, salesReps, salesVatRates, salesAnalysisCategories, processingSettings, referenceSettings,] = await Promise.all([
        safeSettingsSample(() => brcFetch(companyName, "/v1/companySetupConfig/getFinancialYear")),
        safeSettingsSample(() => brcFetch(companyName, "/v1/companySetupConfig")),
        safeListSample(companyName, listPath("customers")),
        safeListSample(companyName, listPath("products")),
        safeListSample(companyName, listPath("suppliers")),
        safeListSample(companyName, listPath("salesReps")),
        safeSalesVatSample(companyName),
        safeSalesAnalysisSample(companyName),
        safeSettingsSample(() => getCompanyProcessingSettings(companyName)),
        safeSettingsSample(() => getCompanyReferenceSettings(companyName)),
    ]);
    const financialYear = financialYearData.ok || setupData.ok
        ? deriveFinancialYear(financialYearData.value, setupData.value)
        : { start: null, end: null, method: "not-detected" };
    // If FY endpoints failed entirely, surface unknown via empty FY (fail).
    // Prefer explicit failure message when both setup fetches failed.
    const fyInput = !financialYearData.ok && !setupData.ok
        ? { start: null, end: null, method: "lookup-failed" }
        : financialYear;
    return evaluateCompanyReadiness({
        companyName,
        today,
        nowMs,
        connection,
        financialYear: fyInput,
        customers,
        products,
        suppliers,
        salesReps,
        salesVatRates,
        salesAnalysisCategories,
        processingSettings,
        referenceSettings,
    });
}
