import assert from "node:assert/strict";
import test from "node:test";

process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET =
  process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET ||
  "test-route-token-signing-secret-correction";

import { getBrcMcpServerInstructions } from "../config/mcp_config.js";
import { ROUTE_REQUEST_TOOL_DESCRIPTION } from "../tools/routing/route_request_tools.js";
import { classifyRequestIntent } from "./intent-classifier.js";
import { routeRequest } from "./route-request.js";
import { isAffirmativeConfirmation } from "./pending-action.js";
import {
  CORRECTION_ASSISTANT_GUIDANCE,
  CORRECTION_CUSTOMER_LANGUAGE_RULES,
  correctionGuidanceClaimsDeleteIsOnlyCorrection,
  correctionGuidanceContainsJargon,
  correctionGuidanceMakesUnverifiedAccountingEffectClaim,
  correctionGuidanceProposesUnverifiedOpposite,
  customerFacingReversalContainsInventedMethod,
  explainDeletedRecordUndo,
  explainFinancialReverse,
  explainLinkedQuoteInvoice,
  explainQuoteReferenceUndo,
  isCorrectionIntent,
} from "./correction-intent.js";

const STAGING_FAILURE_REVERSAL_WORDING = [
  "Delete it outright — removes the payment from the books completely, as if it never happened.",
  "Create an offsetting entry — leave the original payment in place, and add a new record for the same supplier and amount that cancels it out.",
  "Most businesses that need an audit trail prefer option 2.",
].join(" ");

function assertSafeCustomerFacingReversal(text: string): void {
  assert.equal(customerFacingReversalContainsInventedMethod(text), false, text);
  assert.equal(correctionGuidanceProposesUnverifiedOpposite(text), false, text);
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(text),
    false,
    text,
  );
  assert.equal(correctionGuidanceClaimsDeleteIsOnlyCorrection(text), false, text);
  assert.equal(correctionGuidanceContainsJargon(text), false, text);
  assert.equal(/\bbrc_/i.test(text), false, text);
}

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
  assert.match(
    routed.guidance,
    /Hiding internal tool names does not make it acceptable to describe an imagined reversal transaction/i,
  );
  assert.match(routed.guidance, /Do not invent an offsetting entry/i);
  assert.equal(/\bequal-and-opposite\b/i.test(routed.guidance), false);
  assert.equal(
    correctionGuidanceProposesUnverifiedOpposite(routed.guidance),
    false,
  );

  const explanation = explainFinancialReverse("cash payment");
  assert.match(explanation, /have not changed anything/i);
  assert.match(explanation, /can mean different things/i);
  assert.match(explanation, /remove this Cash Payment/i);
  assert.match(explanation, /change supported details/i);
  assert.match(explanation, /amount, date, supplier/i);
  assert.match(explanation, /Which action is appropriate depends/i);
  assert.match(explanation, /haven't verified a separate formal reversal process/i);
  assert.match(explanation, /won't invent one/i);
  assert.match(explanation, /What are you trying to correct/);
  assert.equal(/\bthe only supported\b/i.test(explanation), false);
  assert.equal(/\bdelete\s+it\s+now\b/i.test(explanation), false);
  assert.equal(/\bsafest (?:concrete )?option\b/i.test(explanation), false);
  assertSafeCustomerFacingReversal(explanation);
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
    /Neither is automatically the correct accounting treatment/i,
  );
  assert.match(
    routed.guidance,
    /Do not present deletion and an invented offsetting transaction as two equally verified options/i,
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

test("customer-facing correction and reversal guidance does not expose internal tool names", async () => {
  const explanation = explainFinancialReverse("cash payment");
  const customerFacing = [
    CORRECTION_CUSTOMER_LANGUAGE_RULES,
    explanation,
    explainQuoteReferenceUndo({ fromReference: "QT0001", toReference: "QT0002" }),
    explainDeletedRecordUndo("quote"),
    explainLinkedQuoteInvoice(),
  ];

  for (const sample of customerFacing) {
    assert.equal(/\bbrc_/i.test(sample), false, sample);
    assert.equal(correctionGuidanceContainsJargon(sample), false, sample);
  }

  assert.match(explanation, /remove this Cash Payment/i);
  assert.match(explanation, /change supported details/i);
  assert.match(explanation, /have not changed anything/i);
  assert.equal(/\bbrc_delete_cash_payment\b/i.test(explanation), false);
  assert.equal(/\bbrc_update_cash_payment\b/i.test(explanation), false);

  const routed = await routeRequest("Reverse Cash Payment id 581729508");
  assert.equal(routed.mode, "correction");
  assert.equal(/\bbrc_/i.test(routed.guidance), false);
  assert.match(
    routed.guidance,
    /Never quote internal tool identifiers/i,
  );
  assert.match(
    routed.guidance,
    /plain business language/i,
  );
});

test("staging: Reverse Cash Payment id 581729508 does not invent a reversal method", async () => {
  const message = "Reverse Cash Payment id 581729508";
  assertCorrectionPlan(message);

  const routed = await routeRequest(message);
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.equal(routed.blockTransactionalTools, true);
  assert.equal(routed.confirmationContinuation, undefined);
  assert.match(
    routed.guidance,
    /Hiding internal tool names does not make it acceptable to describe an imagined reversal transaction/i,
  );
  assert.match(
    routed.guidance,
    /do not suggest an accounting reversal method unless that exact flow is supported and verified/i,
  );
  assert.equal(/\bbrc_/i.test(routed.guidance), false);

  const explanation = explainFinancialReverse("cash payment");
  assertSafeCustomerFacingReversal(explanation);
  assertSafeCustomerFacingReversal(CORRECTION_CUSTOMER_LANGUAGE_RULES);

  assert.match(explanation, /remove this Cash Payment/i);
  assert.match(explanation, /change supported details/i);
  assert.match(explanation, /amount, date, supplier/i);
  assert.match(explanation, /Which action is appropriate depends/i);
  assert.match(explanation, /What are you trying to correct/);
  assert.match(explanation, /won't invent one/i);
  assert.equal(/\boption 2\b/i.test(explanation), false);
  assert.equal(/\bthe only supported\b/i.test(explanation), false);
  assert.equal(/\bbrc_delete_cash_payment\b/i.test(explanation), false);
  assert.equal(/\bbrc_update_cash_payment\b/i.test(explanation), false);

  assert.equal(
    customerFacingReversalContainsInventedMethod(STAGING_FAILURE_REVERSAL_WORDING),
    true,
  );
  assert.equal(
    correctionGuidanceProposesUnverifiedOpposite(STAGING_FAILURE_REVERSAL_WORDING),
    true,
  );
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(
      STAGING_FAILURE_REVERSAL_WORDING,
    ),
    true,
  );
  assert.equal(
    customerFacingReversalContainsInventedMethod(CORRECTION_ASSISTANT_GUIDANCE),
    true,
  );
  assert.equal(
    correctionGuidanceProposesUnverifiedOpposite(CORRECTION_ASSISTANT_GUIDANCE),
    false,
  );
});

test("staging: Reverse Cash Payment does not say delete is the only supported correction", async () => {
  const message = "Reverse Cash Payment id 581729508";
  const routed = await routeRequest(message);
  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.equal(routed.blockTransactionalTools, true);
  assert.match(
    routed.guidance,
    /Do not say deletion or removal is the only supported correction/i,
  );
  assert.match(
    routed.guidance,
    /both removing the existing record and changing supported details/i,
  );
  assert.equal(correctionGuidanceClaimsDeleteIsOnlyCorrection(routed.guidance), false);

  const explanation = explainFinancialReverse("cash payment");
  assert.match(explanation, /remove this Cash Payment/i);
  assert.match(explanation, /change supported details/i);
  assert.match(explanation, /amount, date, supplier/i);
  assert.match(explanation, /What are you trying to correct/);
  assert.equal(correctionGuidanceClaimsDeleteIsOnlyCorrection(explanation), false);
  assert.equal(/\bthe only supported\b/i.test(explanation), false);
  assert.equal(/\bonly supported correction action\b/i.test(explanation), false);
  assertSafeCustomerFacingReversal(explanation);
  assert.equal(correctionGuidanceProposesUnverifiedOpposite(explanation), false);
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(explanation),
    false,
  );
  assert.equal(/\bbrc_/i.test(explanation), false);

  const stagingDeleteOnly =
    "Red can delete this cash payment record. That's the only supported correction action available for a cash payment.";
  assert.equal(
    correctionGuidanceClaimsDeleteIsOnlyCorrection(stagingDeleteOnly),
    true,
  );
  assert.equal(
    correctionGuidanceClaimsDeleteIsOnlyCorrection(
      "Red has a supported action to permanently delete this cash payment record. That's the only supported operation for this record type",
    ),
    true,
  );
});

test("assembled runtime guidance for Reverse Cash Payment is not delete-only", async () => {
  const message = "Reverse Cash Payment id 581729508";
  const routed = await routeRequest(message);
  const instructions = getBrcMcpServerInstructions(50, false);
  const assembled = [
    instructions,
    ROUTE_REQUEST_TOOL_DESCRIPTION,
    JSON.stringify(routed),
  ].join("\n");

  assert.equal(routed.mode, "correction");
  assert.equal(routed.routeToken, undefined);
  assert.equal(routed.blockTransactionalTools, true);
  assert.deepEqual(routed.supportedExistingRecordActions, [
    "remove",
    "change_supported_details",
  ]);
  assert.equal(
    routed.preferredTools.includes("brc_delete_cash_payment"),
    false,
  );
  assert.equal(
    routed.preferredTools.includes("brc_update_cash_payment"),
    false,
  );

  assert.match(routed.guidance, /Two verified actions exist on the existing Cash Payment/i);
  assert.match(routed.guidance, /remove it, and change supported details/i);
  assert.match(routed.guidance, /Both are available/i);
  assert.match(routed.guidance, /Neither is automatically the correct accounting treatment/i);
  assert.match(
    routed.guidance,
    /Do not say deletion is the only supported operation for this record type/i,
  );
  assert.equal(/\bbrc_/i.test(routed.guidance), false);
  assert.equal(correctionGuidanceClaimsDeleteIsOnlyCorrection(routed.guidance), false);
  assert.equal(correctionGuidanceProposesUnverifiedOpposite(routed.guidance), false);
  assert.equal(
    correctionGuidanceMakesUnverifiedAccountingEffectClaim(routed.guidance),
    false,
  );

  assert.match(assembled, /remove it, and change supported details/i);
  assert.match(assembled, /change_supported_details/);
  assert.match(assembled, /Ask what the user is trying to correct/i);
  assert.equal(/rather than naming one/i.test(assembled), false);
  assert.equal(
    correctionGuidanceClaimsDeleteIsOnlyCorrection(
      "Red has a supported action to permanently delete this cash payment record. That's the only supported operation for this record type",
    ),
    true,
  );
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
    assertSafeCustomerFacingReversal(sample);
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
