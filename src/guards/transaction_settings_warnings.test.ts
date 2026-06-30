import assert from "node:assert/strict";
import test from "node:test";

import {
  formatVatDiscrepancyTolerance,
  getTransactionSafetyWarnings,
  type CompanyProcessingSettings,
} from "./company_processing_settings.js";

function settings(
  overrides: Partial<CompanyProcessingSettings>
): CompanyProcessingSettings {
  return {
    raw: {},
    cashReceiptVatMode: "not_enabled",
    ...overrides,
  };
}

test("VAT discrepancy tolerance is formatted with a currency unit", () => {
  const text = formatVatDiscrepancyTolerance(1);
  assert.match(text, /1\.00 EUR/);
  assert.equal(text.trim().length > 0, true);
});

test("gross price entry warning explains the gross/net action in plain English", () => {
  const warnings = getTransactionSafetyWarnings(
    settings({ grossPriceSalesInvoicingEnabled: true }),
    "sales_invoice"
  );
  const grossWarning = warnings.find((w) => w.includes("Gross Price Entry is enabled"));
  assert.ok(grossWarning, "expected a gross price entry warning");
  assert.match(grossWarning!, /VAT-inclusive\/gross or VAT-exclusive\/net/);
  assert.match(grossWarning!, /Say 'gross' if the prices include VAT, or 'net' if the prices exclude VAT/);
});

test("VAT discrepancy warning includes a unit, not a bare number", () => {
  const warnings = getTransactionSafetyWarnings(
    settings({ vatDiscrepancyAllowed: 1 }),
    "sales_invoice"
  );
  const discrepancyWarning = warnings.find((w) => w.includes("VAT discrepancy tolerance"));
  assert.ok(discrepancyWarning, "expected a VAT discrepancy warning");
  assert.match(discrepancyWarning!, /EUR/);
  assert.equal(/tolerance is 1\.\s/.test(discrepancyWarning!), false);
});

test("reverse charge warning includes a clear next action about EU/reverse-charge VAT", () => {
  const warnings = getTransactionSafetyWarnings(
    settings({ reverseChargeCreditInputEnabled: true }),
    "sales_invoice"
  );
  const reverseChargeWarning = warnings.find((w) =>
    w.includes("Credit Input for Reverse Charge VAT is enabled")
  );
  assert.ok(reverseChargeWarning, "expected a reverse charge warning");
  assert.match(reverseChargeWarning!, /EU or reverse-charge VAT applies/);
  assert.match(reverseChargeWarning!, /Before posting/);
});
