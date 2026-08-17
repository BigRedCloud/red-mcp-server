import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET =
  process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET ||
  "test-route-token-signing-secret-correction";

import { classifyRequestIntent } from "./intent-classifier.js";
import { routeRequest } from "./route-request.js";
import { isAffirmativeConfirmation } from "./pending-action.js";
import {
  CORRECTION_CUSTOMER_LANGUAGE_RULES,
  correctionGuidanceContainsJargon,
  correctionGuidanceMakesUnverifiedAccountingEffectClaim,
  correctionGuidanceProposesUnverifiedOpposite,
  explainDeletedRecordUndo,
  explainFinancialReverse,
  explainLinkedQuoteInvoice,
  explainQuoteReferenceUndo,
  isCorrectionIntent,
} from "./correction-intent.js";

function assertCorrectionPlan(message: string): void {
  const classified = classifyRequestIntent(message);
  assert.equal(classified.mode, "correction", message);
  assert.equal(classified.blockTransactionalTools, true, message);
  assert.equal(classified.reason, "correction_request", message);
  assert.ok(classified.preferredTools.includes("brc_list_audit_log"), message);
}

test("1. undo that quote reference change is correction planning, not a write", async () => {
  const message = "Undo that quote reference change";
  assert.equal(isCorrectionIntent(message), true);
  assertCorrectionPlan(message);

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.equal(routed.blockTransactionalTools, true);
  assert.equal(routed.confirmationContinuation, undefined);
  assert.match(routed.guidance, /not write confirmation/i);
  assert.match(routed.guidance, /ask permission/i);

  const explanation = explainQuoteReferenceUndo({
    fromReference: "QT0001",
    toReference: "QT0002",
  });
  assert.match(explanation, /change that back/i);
  assert.match(explanation, /QT0001/);
  assert.match(explanation, /QT0002/);
  assert.match(explanation, /leave the rest of the quote unchanged/i);
  assert.match(explanation, /Would you like me to do that/);
  assert.equal(correctionGuidanceContainsJargon(explanation), false);
});

test("2. undo that deleted quote does not claim a simple restore", () => {
  const message = "Undo that deleted quote";
  assertCorrectionPlan(message);

  const explanation = explainDeletedRecordUndo("quote");
  assert.match(explanation, /can't simply switch the deletion off/i);
  assert.match(explanation, /check whether we still have enough information to recreate/i);
  assert.match(explanation, /show you what would be recreated/i);
  assert.match(explanation, /Would you like me to check/);
  assert.equal(/simply (be )?restored|switch the deletion off and it will reappear/i.test(explanation), false);
  assert.equal(correctionGuidanceContainsJargon(explanation), false);
});

test("3. reverse that cash payment does not automatically delete it", async () => {
  const message = "Reverse that cash payment";
  assert.equal(isCorrectionIntent(message), true);
  assertCorrectionPlan(message);

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.equal(routed.blockTransactionalTools, true);
  assert.match(routed.guidance, /Do not automatically delete a financial record/i);
  assert.match(
    routed.guidance,
    /Never propose a specific accounting transaction type as a reversal/i,
  );
  assert.equal(/\bequal-and-opposite\b/i.test(routed.guidance), false);
  assert.equal(/\boffsetting\b/i.test(routed.guidance), false);

  const explanation = explainFinancialReverse("cash payment");
  assert.match(explanation, /will not automatically remove/i);
  assert.match(explanation, /can mean different things/i);
  assert.match(explanation, /One supported action available to Red is removing/i);
  assert.match(
    explanation,
    /whether that is the correct accounting treatment depends/i,
  );
  assert.match(explanation, /have not verified/i);
  assert.match(explanation, /will not assume the downstream effect/i);
  assert.match(explanation, /will not create an opposite transaction/i);
  assert.match(explanation, /Would you like me to check/);
  assert.equal(/\bdelete\s+it\s+now\b/i.test(explanation), false);
  assert.equal(/\bsafest (?:concrete )?option\b/i.test(explanation), false);
  assert.equal(correctionGuidanceContainsJargon(explanation), false);
  assert.equal(correctionGuidanceProposesUnverifiedOpposite(explanation), false);
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(explanation),
    false,
  );
});

test("reverse Cash Payment does not suggest creating a Cash Receipt", async () => {
  const message = "Reverse Cash Payment id 581729508";
  assertCorrectionPlan(message);

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.equal(routed.blockTransactionalTools, true);

  const explanation = explainFinancialReverse("cash payment");
  assert.equal(/\bcash receipt\b/i.test(explanation), false);
  assert.equal(/\bsales credit note\b/i.test(explanation), false);
  assert.equal(correctionGuidanceProposesUnverifiedOpposite(explanation), false);
  assert.equal(
    correctionGuidanceProposesUnverifiedOpposite(CORRECTION_CUSTOMER_LANGUAGE_RULES),
    false,
  );
  assert.match(
    routed.guidance,
    /Do not assume Cash Payment is reversed with a Cash Receipt/i,
  );
  assert.match(
    routed.guidance,
    /Do not invent negative or opposite transactions/i,
  );
});

test("reverse Cash Payment does not claim unverified accounting effects", async () => {
  const routed = await routeRequest("Reverse Cash Payment id 581729508");
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.match(
    routed.guidance,
    /Do not claim what the resulting customer or supplier outstanding balance/i,
  );
  assert.match(
    routed.guidance,
    /Do not say deletion makes a transaction look like it never existed/i,
  );
  assert.match(
    routed.guidance,
    /Deleting is not automatically the safest or correct accounting treatment/i,
  );

  const explanation = explainFinancialReverse("cash payment");
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(explanation),
    false,
  );
  assert.equal(/\bstill owed\b/i.test(explanation), false);
  assert.equal(/\bnever existed\b/i.test(explanation), false);
  assert.equal(/\bputs?\b.{0,80}\boutstanding\b/i.test(explanation), false);
  assert.equal(/\ballocation\b/i.test(explanation), false);
  assert.equal(/\bledger\b/i.test(explanation), false);
  assert.equal(/\bVAT\b/.test(explanation), false);
  assert.equal(/\baudit history\b/i.test(explanation), false);
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      CORRECTION_CUSTOMER_LANGUAGE_RULES,
    ),
    false,
  );

  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      "Deleting the payment puts €12.30 back as outstanding on the supplier's account.",
    ),
    true,
  );
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      "After deletion, the supplier will show €12.30 as still owed.",
    ),
    true,
  );
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      "It'll just look like the payment never existed.",
    ),
    true,
  );
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      "The safest concrete option I can actually execute is delete.",
    ),
    true,
  );
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      "Deletion will restore the supplier allocation and ledger balance.",
    ),
    true,
  );
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      "Removing it will clear the VAT position.",
    ),
    true,
  );
});

test("4. change the quote reference to QT0003 remains a normal quote update", async () => {
  const message = "Change the quote reference to QT0003";
  assert.equal(isCorrectionIntent(message), false);

  const classified = classifyRequestIntent(message);
  assert.equal(classified.mode, "action");
  assert.equal(classified.workflow?.name, "update_quote");
  assert.ok(classified.preferredTools.includes("brc_update_quote"));

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "action");
  assert.ok(routed.routeToken);
  assert.equal(routed.workflow, "update_quote");
});

test("5. correct invoice 123 amount to €20 remains a normal explicit update", async () => {
  const message = "Correct invoice 123 amount to €20";
  assert.equal(isCorrectionIntent(message), false);

  const classified = classifyRequestIntent(message);
  assert.equal(classified.mode, "action");
  assert.equal(classified.workflow?.name, "update_sales_invoice");
  assert.ok(classified.preferredTools.includes("brc_update_sales_invoice"));

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "action");
  assert.ok(routed.routeToken);
  assert.equal(routed.workflow, "update_sales_invoice");
});

test("6. put it back how it was is reversal/correction intent", async () => {
  const message = "Put it back how it was";
  assert.equal(isCorrectionIntent(message), true);
  assertCorrectionPlan(message);

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
});

test("7. previous value unknown — Red does not invent it", () => {
  const explanation = explainQuoteReferenceUndo({});
  assert.match(explanation, /will not guess/i);
  assert.match(explanation, /Would you like me to check/);
  assert.equal(/QT0001|QT0002|QT0003/.test(explanation), false);
  assert.equal(correctionGuidanceContainsJargon(explanation), false);
});

test("8. quote generated sales invoice explains linked records", () => {
  const explanation = explainLinkedQuoteInvoice();
  assert.match(explanation, /linked/i);
  assert.match(explanation, /does not automatically remove the invoice/i);
  assert.equal(/one-click undo|I'll undo the generated invoice/i.test(explanation), false);
  assert.match(explanation, /Would you like me to check/);
  assert.equal(correctionGuidanceContainsJargon(explanation), false);
});

test("9. reversal language is not write confirmation and cannot bypass confirmWrite", () => {
  assert.equal(isAffirmativeConfirmation("undo that"), false);
  assert.equal(isAffirmativeConfirmation("undo that quote reference change"), false);
  assert.equal(isAffirmativeConfirmation("reverse that"), false);
  assert.equal(isAffirmativeConfirmation("put it back"), false);
  assert.equal(isAffirmativeConfirmation("change it back"), false);
  assert.equal(isAffirmativeConfirmation("cancel what you just did"), false);
});

test("10. customer-facing reversal guidance contains no API/HTTP/tool jargon", () => {
  const samples = [
    CORRECTION_CUSTOMER_LANGUAGE_RULES,
    explainQuoteReferenceUndo({ fromReference: "QT0001", toReference: "QT0002" }),
    explainDeletedRecordUndo("quote"),
    explainFinancialReverse("cash payment"),
    explainLinkedQuoteInvoice(),
    explainQuoteReferenceUndo({}),
  ];

  for (const sample of samples) {
    assert.equal(correctionGuidanceContainsJargon(sample), false, sample);
    assert.equal(
      correctionGuidanceProposesUnverifiedOpposite(sample),
      false,
      sample,
    );
    assert.equal(
      correctionGuidanceMakesUnverifiedAccountingEffectClaim(sample),
      false,
      sample,
    );
  }
});

test("explicit cash payment delete and update remain normal action workflows", async () => {
  const deleted = classifyRequestIntent("Delete cash payment 581729508");
  assert.equal(deleted.mode, "action");
  assert.equal(deleted.workflow?.name, "delete_cash_payment");
  assert.ok(deleted.preferredTools.includes("brc_delete_cash_payment"));

  const deletedRoute = await routeRequest("Delete cash payment 581729508");
  assert.equal(deletedRoute.mode, "action");
  assert.ok(deletedRoute.routeToken);
  assert.equal(deletedRoute.workflow, "delete_cash_payment");

  const updated = classifyRequestIntent("Update cash payment 581729508");
  assert.equal(updated.mode, "action");
  assert.equal(updated.workflow?.name, "update_cash_payment");
  assert.ok(updated.preferredTools.includes("brc_update_cash_payment"));

  const updatedRoute = await routeRequest("Update cash payment 581729508");
  assert.equal(updatedRoute.mode, "action");
  assert.ok(updatedRoute.routeToken);
  assert.equal(updatedRoute.workflow, "update_cash_payment");
});

test("other reversal phrases classify as correction", () => {
  for (const message of [
    "undo the last change",
    "restore that",
    "cancel what you just did",
    "I made a mistake",
    "correct the last transaction",
    "change it back",
  ]) {
    assert.equal(isCorrectionIntent(message), true, message);
    assertCorrectionPlan(message);
  }
});
