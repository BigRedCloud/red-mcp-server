import assert from "node:assert/strict";
import test from "node:test";

import { buildTransactionDateValidation } from "./deployment_tools.js";

const START = "2026-01-01";
const END = "2026-12-31";

test("a date within the financial year returns a clear success message", () => {
  const result = buildTransactionDateValidation("2026-06-15", START, END);
  assert.equal(result.inFinancialYear, true);
  assert.equal(result.position, "within");
  assert.equal(result.message, "This transaction date is within the current financial year.");
});

test("a date before the financial year is flagged as before with corrective wording", () => {
  const result = buildTransactionDateValidation("2025-12-31", START, END);
  assert.equal(result.inFinancialYear, false);
  assert.equal(result.position, "before");
  assert.match(result.message, /outside the company's current financial year/);
  assert.match(result.message, /before the current financial year starts/);
  assert.match(result.message, /choose a date within the current financial year/);
  assert.equal(/create\/generate requests/.test(result.message), false);
});

test("a date after the financial year is flagged as after with corrective wording", () => {
  const result = buildTransactionDateValidation("2027-01-01", START, END);
  assert.equal(result.inFinancialYear, false);
  assert.equal(result.position, "after");
  assert.match(result.message, /after the current financial year ends/);
});

test("an undetermined financial year returns an unknown-position message", () => {
  const result = buildTransactionDateValidation("2026-06-15", null, null);
  assert.equal(result.inFinancialYear, null);
  assert.equal(result.position, "unknown");
  assert.match(result.message, /could not determine the company's current financial year/);
});
