import assert from "node:assert/strict";
import test from "node:test";

import { buildSalesDatePeriodSummary } from "./sales_date_period.js";
import { SALES_ENTRY_DATE_PERIOD_INSTRUCTION } from "../../shared.js";

test("requested 30/06/2026 with stored entryDate 01/06/2026 gives neutral period wording", () => {
  const summary = buildSalesDatePeriodSummary({
    requestedProcDate: "2026-06-30",
    returnedProcDate: "2026-06-30",
    returnedEntryDate: "2026-06-01",
  });

  assert.equal(summary.processingDate, "Processing date: 30/06/2026");
  assert.equal(summary.periodEntered, "Period entered: June 2026");
  assert.equal(summary.processingDateMismatch, false);
  assert.equal(summary.warning, undefined);
});

test("no 'worth checking' / 'but BRC stored' / 'recorded the entry date' wording on the normal case", () => {
  const summary = buildSalesDatePeriodSummary({
    requestedProcDate: "2026-06-30",
    returnedProcDate: "2026-06-30",
    returnedEntryDate: "2026-06-01",
  });

  const serialized = JSON.stringify(summary).toLowerCase();
  assert.equal(serialized.includes("worth checking"), false);
  assert.equal(serialized.includes("but brc stored"), false);
  assert.equal(serialized.includes("recorded the entry date"), false);
});

test("a first-of-month entryDate is treated as the period even without a returned procDate", () => {
  const summary = buildSalesDatePeriodSummary({
    requestedProcDate: "2026-06-30",
    returnedEntryDate: "2026-06-01",
  });

  assert.equal(summary.processingDate, "Processing date: 30/06/2026");
  assert.equal(summary.periodEntered, "Period entered: June 2026");
  assert.equal(summary.processingDateMismatch, false);
  assert.equal(summary.warning, undefined);
});

test("an actual processing date mismatch still produces a warning", () => {
  const summary = buildSalesDatePeriodSummary({
    requestedProcDate: "2026-06-30",
    returnedProcDate: "2026-07-02",
    returnedEntryDate: "2026-07-01",
  });

  assert.equal(summary.processingDateMismatch, true);
  assert.ok(summary.warning);
  assert.match(summary.warning ?? "", /30\/06\/2026/);
  assert.match(summary.warning ?? "", /02\/07\/2026/);
});

test("the entry-date/period instruction uses neutral period wording and forbids false warnings", () => {
  assert.match(SALES_ENTRY_DATE_PERIOD_INSTRUCTION, /Period entered/);
  assert.match(SALES_ENTRY_DATE_PERIOD_INSTRUCTION, /accounting period/);
  assert.match(SALES_ENTRY_DATE_PERIOD_INSTRUCTION, /Only warn/);
  assert.match(
    SALES_ENTRY_DATE_PERIOD_INSTRUCTION,
    /but BRC stored|recorded the entry date|worth checking/
  );
});
