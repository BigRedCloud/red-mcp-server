import assert from "node:assert/strict";
import test from "node:test";

import {
  detectHelpProceduralIntent,
  expandHelpSearchQueries,
  scoreProceduralTitleMatch,
  stripHelpProductNoise,
} from "./help-query-expansion.js";

test("expandHelpSearchQueries adds customer creation synonyms", () => {
  const queries = expandHelpSearchQueries(
    "How do I add a customer in Big Red Cloud?",
  );

  assert.ok(queries.some((query) => /add a Customer/i.test(query)));
  assert.ok(queries.some((query) => /create customer/i.test(query)));
  assert.ok(queries.some((query) => !/Big Red Cloud/i.test(query)));
  assert.equal(detectHelpProceduralIntent(queries[0] ?? ""), "add_customer");
});

test("expandHelpSearchQueries adds bank reconciliation synonyms", () => {
  const queries = expandHelpSearchQueries(
    "How do I reconcile my bank in Big Red Cloud?",
  );

  assert.ok(queries.some((query) => /bank reconciliation/i.test(query)));
  assert.ok(queries.some((query) => /bank rec/i.test(query)));
  assert.equal(
    detectHelpProceduralIntent("reconcile my bank"),
    "bank_reconciliation",
  );
});

test("stripHelpProductNoise removes Big Red Cloud phrasing", () => {
  assert.equal(
    stripHelpProductNoise("How do I add a customer in Big Red Cloud?"),
    "How do I add a customer?",
  );
});

test("scoreProceduralTitleMatch boosts Add Customer and demotes login", () => {
  const question = "How do I add a customer in Big Red Cloud?";
  assert.ok(
    scoreProceduralTitleMatch(question, "How do I add a Customer?") >= 700,
  );
  assert.ok(
    scoreProceduralTitleMatch(question, "How do I log in to Big Red Cloud?") < 0,
  );
});
