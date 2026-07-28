import assert from "node:assert/strict";
import test from "node:test";
import { countActiveSalesVatRates, countSalesAnalysisCategories, evaluateCompanyReadiness, isSalesAnalysisCategory, } from "./company_readiness.js";
const TODAY = "2026-06-15";
const NOW_MS = Date.parse("2026-06-15T12:00:00.000Z");
function activeConnection() {
    return {
        contextPresent: true,
        hasCredentialMaterial: true,
        expiresAtMs: NOW_MS + 4 * 60 * 60 * 1000,
        connectionActive: true,
        credentialsValid: true,
    };
}
function processing(overrides = {}) {
    return {
        raw: {},
        vatOnCashReceiptsEnabled: false,
        cashReceiptVatMode: "not_enabled",
        ...overrides,
    };
}
function references(overrides = {}) {
    return {
        raw: {},
        salesAutoGenerateReference: true,
        purchasesAutoGenerateReference: true,
        quotesAutoGenerateReference: true,
        debtorsJournalAutoGenerateReference: true,
        creditorsJournalAutoGenerateReference: true,
        ...overrides,
    };
}
function baseInput(overrides = {}) {
    return {
        companyName: "Demo Co",
        today: TODAY,
        nowMs: NOW_MS,
        connection: activeConnection(),
        financialYear: {
            start: "2026-01-01",
            end: "2026-12-31",
            method: "explicit-date-fields",
        },
        customers: { ok: true, count: 3 },
        products: { ok: true, count: 2 },
        suppliers: { ok: true, count: 2 },
        salesReps: { ok: true, count: 1 },
        salesVatRates: {
            ok: true,
            salesActiveCount: 2,
            totalRatesSampled: 4,
            hasSalesCategory: true,
        },
        salesAnalysisCategories: {
            ok: true,
            salesAnalysisCount: 3,
            totalCategoriesSampled: 20,
        },
        processingSettings: { ok: true, value: processing() },
        referenceSettings: { ok: true, value: references() },
        ...overrides,
    };
}
const COMPAT_KEYS = [
    "companyName",
    "connectedContextFound",
    "today",
    "financialYear",
    "todayInFinancialYear",
    "vatOnCashReceiptsEnabled",
    "cashReceiptVatMode",
    "referenceSettings",
    "referenceDataSampleCounts",
    "readiness",
    "warnings",
    "deploymentCapabilities",
    "recommendedNextPrompts",
];
test("fully ready company", () => {
    const report = evaluateCompanyReadiness(baseInput());
    assert.equal(report.overallStatus, "ready");
    assert.equal(report.blockers.length, 0);
    assert.equal(report.warnings.length, 0);
    assert.equal(report.checks.connection.status, "pass");
    assert.equal(report.checks.financialYear.status, "pass");
    assert.equal(report.checks.salesVatRates.status, "pass");
    assert.equal(report.checks.salesAnalysisCategories.status, "pass");
    assert.equal(report.readiness.transactionReady, true);
    assert.equal(report.readiness.transactionReadyStatus, "Ready");
    assert.match(report.summary, /looks ready/i);
});
test("ready with warnings when products are missing", () => {
    const report = evaluateCompanyReadiness(baseInput({ products: { ok: true, count: 0 } }));
    assert.equal(report.overallStatus, "ready_with_warnings");
    assert.equal(report.checks.products.status, "warning");
    assert.equal(report.blockers.length, 0);
    assert.ok(report.warnings.some((w) => /product/i.test(w)));
    assert.match(report.checks.products.message, /non-product/i);
});
test("no financial year is not_ready", () => {
    const report = evaluateCompanyReadiness(baseInput({
        financialYear: { start: null, end: null, method: "not-detected" },
    }));
    assert.equal(report.overallStatus, "not_ready");
    assert.equal(report.checks.financialYear.status, "fail");
    assert.ok(report.blockers.length > 0);
    assert.equal(report.readiness.transactionReady, false);
});
test("today outside financial year is not_ready", () => {
    const report = evaluateCompanyReadiness(baseInput({
        today: "2027-02-01",
        financialYear: {
            start: "2026-01-01",
            end: "2026-12-31",
            method: "explicit-date-fields",
        },
    }));
    assert.equal(report.overallStatus, "not_ready");
    assert.equal(report.checks.financialYear.status, "fail");
    assert.equal(report.todayInFinancialYear, false);
    assert.ok(report.blockers.some((b) => /outside the company's current financial year/i.test(b)));
});
test("no Sales VAT rates is not_ready", () => {
    const report = evaluateCompanyReadiness(baseInput({
        salesVatRates: {
            ok: true,
            salesActiveCount: 0,
            totalRatesSampled: 5,
            hasSalesCategory: true,
        },
    }));
    assert.equal(report.overallStatus, "not_ready");
    assert.equal(report.checks.salesVatRates.status, "fail");
    assert.ok(report.blockers.some((b) => /Sales VAT/i.test(b)));
});
test("no products is a warning, not a blocker", () => {
    const report = evaluateCompanyReadiness(baseInput({ products: { ok: true, count: 0 } }));
    assert.notEqual(report.overallStatus, "not_ready");
    assert.equal(report.checks.products.status, "warning");
    assert.equal(report.blockers.length, 0);
});
test("no sales representatives is a warning", () => {
    const report = evaluateCompanyReadiness(baseInput({ salesReps: { ok: true, count: 0 } }));
    assert.equal(report.overallStatus, "ready_with_warnings");
    assert.equal(report.checks.salesReps.status, "warning");
    assert.equal(report.blockers.length, 0);
});
test("no Sales Analysis categories is not_ready", () => {
    const report = evaluateCompanyReadiness(baseInput({
        salesAnalysisCategories: {
            ok: true,
            salesAnalysisCount: 0,
            totalCategoriesSampled: 12,
        },
    }));
    assert.equal(report.overallStatus, "not_ready");
    assert.equal(report.checks.salesAnalysisCategories.status, "fail");
    assert.ok(report.blockers.some((b) => /Sales Analysis/i.test(b)));
});
test("invalid credential is connection_problem", () => {
    const report = evaluateCompanyReadiness(baseInput({
        connection: {
            contextPresent: true,
            hasCredentialMaterial: true,
            expiresAtMs: NOW_MS - 1,
            connectionActive: false,
            credentialsValid: false,
        },
    }));
    assert.equal(report.overallStatus, "connection_problem");
    assert.equal(report.checks.connection.status, "fail");
    assert.match(report.checks.connection.message, /expired/i);
    assert.equal(report.readiness.readOnlyReady, false);
});
test("missing company context is connection_problem", () => {
    const report = evaluateCompanyReadiness(baseInput({
        connection: {
            contextPresent: false,
            hasCredentialMaterial: false,
            connectionActive: false,
            credentialsValid: false,
        },
    }));
    assert.equal(report.overallStatus, "connection_problem");
    assert.equal(report.connectedContextFound, false);
    assert.match(report.summary, /not connected/i);
    assert.equal(report.checks.customers.status, "unknown");
    assert.equal(report.checks.financialYear.status, "unknown");
});
test("one dependency failure still returns a report with unknown check", () => {
    const report = evaluateCompanyReadiness(baseInput({
        customers: { ok: false, count: 0, errorMessage: "network timeout" },
    }));
    assert.equal(report.checks.customers.status, "unknown");
    assert.match(report.checks.customers.message, /network timeout|Could not check/i);
    assert.equal(report.overallStatus, "ready_with_warnings");
    assert.ok(report.summary.length > 0);
    assert.equal(typeof report.readiness.transactionReady, "boolean");
});
test("unknown check results in ready_with_warnings", () => {
    const report = evaluateCompanyReadiness(baseInput({
        salesVatRates: {
            ok: false,
            salesActiveCount: 0,
            totalRatesSampled: 0,
            hasSalesCategory: false,
            errorMessage: "VAT categories unavailable",
        },
    }));
    assert.equal(report.checks.salesVatRates.status, "unknown");
    assert.equal(report.overallStatus, "ready_with_warnings");
    assert.equal(report.blockers.length, 0);
});
test("sensitive connection data is not returned", () => {
    const report = evaluateCompanyReadiness(baseInput());
    const blob = JSON.stringify(report);
    assert.equal(/"apiKey"\s*:/.test(blob), false);
    assert.equal(/"connectionRef"\s*:/.test(blob), false);
    assert.equal(/redconn_/i.test(blob), false);
    assert.equal(/"sessionId"\s*:/.test(blob), false);
    assert.equal(/"accessToken"\s*:/.test(blob), false);
    assert.equal(report.checks.connection.details?.contextPresent, true);
    assert.equal(report.checks.connection.details?.credentialsValid, true);
});
test("existing compatibility fields remain present", () => {
    const report = evaluateCompanyReadiness(baseInput());
    for (const key of COMPAT_KEYS) {
        assert.ok(key in report, `missing compatibility field: ${key}`);
    }
    assert.ok("overallStatus" in report);
    assert.ok("checks" in report);
    assert.ok("summary" in report);
    assert.ok("blockers" in report);
    assert.ok("recommendedActions" in report);
    assert.equal(typeof report.readiness.readOnlyReady, "boolean");
    assert.equal(typeof report.readiness.transactionReady, "boolean");
    assert.ok(report.referenceDataSampleCounts.customersOnFirstPage >= 0);
});
test("absence of suppliers is not a sales-invoice blocker", () => {
    const report = evaluateCompanyReadiness(baseInput({ suppliers: { ok: true, count: 0 } }));
    assert.equal(report.checks.suppliers.status, "warning");
    assert.ok(report.checks.suppliers.message.toLowerCase().includes("does not block sales"));
    assert.equal(report.overallStatus, "ready_with_warnings");
    assert.equal(report.blockers.length, 0);
    assert.equal(report.readiness.transactionReady, true);
});
test("isSalesAnalysisCategory recognises SA codes and rejects CR", () => {
    assert.equal(isSalesAnalysisCategory({ accountCode: "SA01", description: "Product Sales" }), true);
    assert.equal(isSalesAnalysisCategory({ accountCode: "CR01", description: "Customer" }), false);
    assert.equal(isSalesAnalysisCategory({ accountCode: "CR02", description: "Cash Sales" }), false);
    assert.equal(isSalesAnalysisCategory({ accountCode: "PU01", description: "Stock" }), false);
});
test("countActiveSalesVatRates counts only active Sales rates", () => {
    const counted = countActiveSalesVatRates({
        items: [
            { id: 1, name: "Sales" },
            { id: 2, name: "Purchases for Resale" },
        ],
    }, {
        items: [
            { id: 10, percentage: 23, vatCategoryId: 1, isActive: true },
            { id: 11, percentage: 0, vatCategoryId: 1, isActive: false },
            { id: 20, percentage: 23, vatCategoryId: 2, isActive: true },
        ],
    });
    assert.equal(counted.salesActiveCount, 1);
    assert.equal(counted.hasSalesCategory, true);
    assert.equal(counted.totalRatesSampled, 3);
});
test("countSalesAnalysisCategories counts SA codes only", () => {
    const counted = countSalesAnalysisCategories({
        items: [
            { id: 1, accountCode: "CR01", description: "Customer" },
            { id: 2, accountCode: "SA01", description: "Product Sales" },
            { id: 3, accountCode: "SA02", description: "Service Sales" },
            { id: 4, accountCode: "PU01", description: "Purchases" },
        ],
    });
    assert.equal(counted.salesAnalysisCount, 2);
    assert.equal(counted.totalCategoriesSampled, 4);
});
test("manual references produce ready_with_warnings and preflight status", () => {
    const report = evaluateCompanyReadiness(baseInput({
        referenceSettings: {
            ok: true,
            value: references({ salesAutoGenerateReference: false }),
        },
        processingSettings: {
            ok: true,
            value: processing({
                vatOnCashReceiptsEnabled: true,
                cashReceiptVatMode: "manual",
            }),
        },
    }));
    assert.equal(report.overallStatus, "ready_with_warnings");
    assert.equal(report.checks.referenceSettings.status, "warning");
    assert.equal(report.referenceSettings.salesReferences, "Manual");
    assert.equal(report.readiness.transactionReadyStatus, "Ready with preflight checks");
    assert.ok(report.readinessNote);
});
