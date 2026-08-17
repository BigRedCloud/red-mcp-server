/**
 * Correction / undo / reversal intent.
 *
 * First "undo", "reverse", "put it back" language is planning — not a write,
 * not write confirmation, and not a destructive workflow token.
 */

const REVERSAL_PATTERNS: RegExp[] = [
  /\bundo\b/i,
  /\breverse\b/i,
  /\bput\s+(?:it|that|this)\s+back\b/i,
  /\bchange\s+(?:it|that|this)\s+back\b/i,
  /\brestore\s+(?:it|that|this|the)\b/i,
  /\brestore\s+that\b/i,
  /\bcancel\s+what\s+you\s+just\s+did\b/i,
  /\bcancel\s+(?:that|this|the)\s+(?:change|update|deletion|delete)\b/i,
  /\bi\s+made\s+a\s+mistake\b/i,
  /\bput\s+it\s+back\s+how\s+it\s+was\b/i,
  /\bcorrect\s+the\s+last\s+(?:transaction|change|action)\b/i,
];

/**
 * True when the message is asking to undo/reverse/restore a previous change
 * rather than stating an explicit new value (for example "change quote
 * reference to QT0003").
 */
export function isCorrectionIntent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  return REVERSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Assistant-facing routing guidance. Do not quote jargon to customers. */
export const CORRECTION_ASSISTANT_GUIDANCE = [
  "Correction mode: the user asked to undo, reverse, change something back, restore, or correct a previous Red write.",
  "This first request is not write confirmation and is not permission to post.",
  "Do not immediately create, update, delete, reverse, or email a record.",
  "Do not issue or invent a transactional routeToken for this message.",
  "Use read-only lookups and the current-session Red activity record where needed to establish what changed. Never invent previous values.",
  "Then explain in friendly business language: what changed; whether it can genuinely be undone; which verified actions on the existing record are available; any consequences that are actually verified; anything you need to check first; and ask permission before another change. Do not invent unverified accounting effects. Do not choose one action automatically.",
  "Existing preview-before-posting, confirmWrite, confirmDelete, counterparty, and email confirmation rules still apply after the user agrees to a plan.",
  "If the user agrees, start the normal supported business workflow for that plan — do not bypass confirmation.",
  "Never quote internal tool identifiers, preferredTools, allowedTools, route tokens, endpoints, HTTP methods, JSON, or MCP names in customer-facing correction or reversal explanations. Use those identifiers only to choose and call tools. Speak to the user in plain business language, for example remove the record, change the record, check the quote, recreate the record, or show the proposed change.",
  "Hiding internal tool names does not make it acceptable to describe an imagined reversal transaction in business language. The safety rule is semantic: do not suggest an accounting reversal method unless that exact flow is supported and verified.",
  "Do not automatically delete a financial record because the user said undo or reverse.",
  "Do not infer accounting treatment from the word reverse. Reverse can mean different things depending on the accounting situation. Ask what the user is trying to correct before choosing an accounting treatment.",
  "Never propose a specific accounting transaction type as a reversal unless that exact reversal flow is supported by existing Red tools and verified BRC behaviour.",
  "Do not assume Cash Payment is reversed with a Cash Receipt, Sales Invoice with a Sales Credit Note, or Purchase with an opposite purchase or credit. Do not invent negative or opposite transactions.",
  "Do not invent an offsetting entry, opposite entry, matching entry that cancels the original, or a new record for the same supplier and amount that supposedly cancels the accounting effect.",
  "Do not present deletion and an invented offsetting transaction as two equally verified options. Do not recommend one accounting treatment based on generic claims such as most businesses prefer.",
  "Distinguish clearly: (1) actions Red knows it can perform; (2) accounting or business consequences that have been verified from available data or a proven BRC workflow; (3) assumptions, which must not be stated as fact.",
  "Red may say it can remove a financial record when an existing delete action supports that, or change supported details on the existing record when that fits the user's intent. Neither is automatically the correct accounting treatment.",
  "For Cash Payment, both removing the existing record and changing supported details on it are verified correction actions. Do not say deletion or removal is the only supported correction. Example Cash Payment fields that the current update flow can change include amount, date, and supplier. Do not name a field unless the current Cash Payment update can merge it onto the existing record.",
  "Do not claim what the resulting customer or supplier outstanding balance, allocation state, ledger balance, VAT position, audit history, or outstanding amount will become unless that effect is directly supported by available data or a verified BRC workflow.",
  "Do not say deletion makes a transaction look like it never existed or never happened unless Big Red Cloud's retained-history behaviour is verified. Do not claim there will be no audit trail.",
  "If the downstream accounting effect is uncertain, say so clearly in non-technical language and do not invent it.",
  "For financial records: read the current record first. Name the verified actions Red can perform on the existing record. For a Cash Payment those are removing it and changing supported details. Do not invent a separate reversing transaction type. Do not treat the absence of a formal reversing-entry process as meaning deletion is the only supported operation. Do not say deletion is the only supported operation for this record type. Ask what the user is trying to correct before choosing.",
  "Do not claim an action is reversible unless Red can actually do it. If it cannot, say what Red can and cannot do and that the rest must be completed in Big Red Cloud.",
].join(" ");

/**
 * Customer-facing language rules for correction explanations.
 * Spoken replies should follow these; they must stay free of API jargon.
 */
export const CORRECTION_CUSTOMER_LANGUAGE_RULES = [
  "Talk to the user as an accountant or bookkeeper. Keep explanations short and specific.",
  "Prefer: change it back; leave everything else unchanged; check what changed; recreate the record; remove the record; change the record; check the quote; show you the proposed change; check what correction options are supported.",
  "Never mention internal tool names in customer-facing explanations. Describe supported actions in plain business language only. Plain wording is not permission to invent a reversal method.",
  "Do not invent previous values. If the earlier value is unknown, say you need to check what it was first.",
  "A deleted record cannot simply be switched back on. Offer to check whether there is enough information to recreate it, and show what would be recreated before anything is posted.",
  "Do not automatically delete a payment or other financial record because the user asked to reverse it. Explain that reverse can mean different things. Ask what they are trying to correct before choosing an accounting treatment.",
  "State supported actions Red can actually perform on the existing record. For a Cash Payment those include removing it and changing supported details such as amount, date, or supplier. Do not present removal as the sole available correction. Do not invent a new record that supposedly cancels the original. Do not treat the absence of a formal reversing-entry process as meaning deletion is the only supported operation.",
  "Do not call deletion the safest option just because Red can remove the record. Removing it and changing the existing record are both available when supported, but whether either is the correct accounting treatment depends on why the user wants to reverse it.",
  "Do not claim unverified effects on customer or supplier outstanding balances, allocations, ledger balances, VAT, or whether the transaction will still appear in accounting history. If those effects are uncertain, say so.",
  "If a quote has generated a sales invoice, those are linked records. Changing or reopening the quote does not automatically remove the invoice. Explain what Red can safely do, then ask permission.",
  "Wait for explicit permission before making another change.",
].join(" ");

export function isCashPaymentCorrectionMessage(message: string): boolean {
  return /\bcash\s+payments?\b/i.test(message);
}

/**
 * Prepended onto the route-request JSON guidance for Cash Payment reverse.
 * This is what the model actually reads; explainFinancialReverse is not sent
 * at runtime.
 */
export const CASH_PAYMENT_CORRECTION_ROUTE_GUIDANCE = [
  "Cash Payment reverse/correction: do not write yet.",
  "Two verified actions exist on the existing Cash Payment: remove it, and change supported details such as amount, date, or supplier.",
  "Both are available. Neither is automatically the correct accounting treatment.",
  "Do not say deletion is the only supported operation for this record type.",
  "Do not say permanently delete is the only supported action.",
  "Do not invent a reversing, offsetting, opposite, or negative transaction.",
  "Ask what the user is trying to correct before choosing.",
].join(" ");

export const CASH_PAYMENT_SUPPORTED_EXISTING_RECORD_ACTIONS = [
  "remove",
  "change_supported_details",
] as const;

/** Guidance actually returned by brc_route_request in correction mode. */
export function assembleCorrectionGuidance(message: string): string {
  const shared = [CORRECTION_ASSISTANT_GUIDANCE, CORRECTION_CUSTOMER_LANGUAGE_RULES].join(
    " ",
  );
  if (isCashPaymentCorrectionMessage(message)) {
    return `${CASH_PAYMENT_CORRECTION_ROUTE_GUIDANCE} ${shared}`;
  }
  return shared;
}

export function explainQuoteReferenceUndo(args: {
  fromReference?: string;
  toReference?: string;
}): string {
  if (!args.fromReference || !args.toReference) {
    return "I can check what the quote reference was changed from and to, then show you how I would change it back. I will not guess the earlier reference. Would you like me to check?";
  }

  return (
    `I can change that back. The quote reference was changed from ${args.fromReference} to ${args.toReference}. ` +
    `I would change it back to ${args.fromReference} and leave the rest of the quote unchanged. Would you like me to do that?`
  );
}

export function explainDeletedRecordUndo(recordLabel = "record"): string {
  return (
    `That ${recordLabel} was deleted, so I can't simply switch the deletion off. ` +
    "I can check whether we still have enough information to recreate it. I’ll show you what would be recreated before anything is posted. Would you like me to check?"
  );
}

export function explainFinancialReverse(recordLabel = "payment"): string {
  if (/cash payment/i.test(recordLabel)) {
    return (
      "I have checked the Cash Payment and have not changed anything. " +
      `"Reverse" can mean different things depending on what needs correcting. ` +
      "I can remove this Cash Payment, or change supported details on it if something such as the amount, date, supplier or another supported field is wrong. " +
      "Which action is appropriate depends on what you're trying to correct. " +
      "I haven't verified a separate formal reversal process for this type of payment, so I won't invent one. " +
      "What are you trying to correct?"
    );
  }

  return (
    `I have checked the ${recordLabel} and have not changed anything. ` +
    `"Reverse" can mean different things depending on what needs correcting. ` +
    `I can remove the ${recordLabel} or change supported details on it, but which action is appropriate depends on what you're trying to correct. ` +
    "I have not verified a separate reversing process for this type of record, so I will not invent one. " +
    "If you need a formal accounting reversal, I can first check what supported correction options are available. What are you trying to correct?"
  );
}

function clauseLooksLikeProhibition(text: string, matchIndex: number): boolean {
  const start = text.lastIndexOf(".", matchIndex);
  const clause = text.slice(start === -1 ? 0 : start + 1, matchIndex).trimStart();
  return /^(?:do not|don't|never|will not|won't|i will not|i have not|i haven't)\b/i.test(
    clause,
  );
}

function hasUnprohibitedMatch(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(global)) {
    if (match.index === undefined) {
      continue;
    }
    if (!clauseLooksLikeProhibition(text, match.index)) {
      return true;
    }
  }
  return false;
}

/**
 * True when customer-facing text invents an unverified opposite transaction
 * type — for example reversing a Cash Payment by creating a Cash Receipt.
 * Prohibitions such as "Do not invent an offsetting entry" are allowed in
 * assistant guidance. Customer-facing text should still avoid these concepts.
 */
export function correctionGuidanceProposesUnverifiedOpposite(text: string): boolean {
  return [
    /\bequal-and-opposite\b/i,
    /\boffsetting\b/i,
    /\bopposite (?:entry|transaction|record)\b/i,
    /\bmatching (?:reversal|entry)\b/i,
    /\bcancels? (?:it|the (?:payment|transaction|amount)) out\b/i,
    /\bsame supplier and amount\b/i,
    /\bnegative (?:amount|transaction|entry)\b/i,
    /\bcreate(?:ing)? a reversing entry\b/i,
    /\bcash receipt\b/i,
    /\bsales credit note\b/i,
  ].some((pattern) => hasUnprohibitedMatch(text, pattern));
}

/**
 * True when customer-facing text states an unverified accounting effect as fact
 * (outstanding balances, allocations, ledger/VAT position, or "never existed").
 * Explicit uncertainty ("I have not verified") is allowed.
 */
export function correctionGuidanceMakesUnverifiedAccountingEffectClaim(
  text: string,
): boolean {
  if (hasUnprohibitedMatch(text, /\bnever existed\b/i)) {
    return true;
  }
  if (hasUnprohibitedMatch(text, /\bas if it never happened\b/i)) {
    return true;
  }
  if (hasUnprohibitedMatch(text, /\bnever happened\b/i)) {
    return true;
  }
  if (hasUnprohibitedMatch(text, /\bno audit trail\b/i)) {
    return true;
  }
  if (hasUnprohibitedMatch(text, /\bmost businesses\b.{0,40}\bprefer\b/i)) {
    return true;
  }
  if (/\bstill owed\b/i.test(text)) {
    return true;
  }
  if (/\bputs?\b.{0,80}\boutstanding\b/i.test(text)) {
    return true;
  }
  if (
    /\bsafest (?:concrete )?option\b/i.test(text) &&
    /\b(?:delete|deleting|remove|removing)\b/i.test(text) &&
    !/\b(?:not|don't|do not)\b.{0,60}\bsafest\b/i.test(text)
  ) {
    return true;
  }
  if (
    /\bwill (?:restore|increase|decrease|clear|change|become|show)\b.{0,80}\b(?:outstanding|allocation|ledger|VAT|history)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(?:outstanding balance|allocation|ledger balance|VAT position).{0,40}\bwill\b/i.test(
      text,
    ) &&
    !/\b(?:have not verified|will not assume|won't assume|do not claim)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function explainLinkedQuoteInvoice(): string {
  return (
    "That quote and the sales invoice created from it are now linked. " +
    "Changing or reopening the quote does not automatically remove the invoice. " +
    "I can check both records and then explain what Red can safely do. Would you like me to check?"
  );
}

const FORBIDDEN_CUSTOMER_JARGON =
  /\b(?:rollback|mutation|inverse payload|compensating API call|endpoint|route token|routeToken|object clone|database rollback|HTTP|JSON|MCP)\b/i;

const FORBIDDEN_INTERNAL_TOOL_NAME = /\bbrc_[a-z0-9_]+\b/i;

const FORBIDDEN_HTTP_METHODS = /\b(?:POST|PUT|DELETE|GET|PATCH)\b/;

export function correctionGuidanceContainsJargon(text: string): boolean {
  return (
    FORBIDDEN_CUSTOMER_JARGON.test(text) ||
    FORBIDDEN_INTERNAL_TOOL_NAME.test(text) ||
    FORBIDDEN_HTTP_METHODS.test(text)
  );
}

/** Phrases from the staging reversal regression; must stay out of customer-facing text. */
const CUSTOMER_FACING_INVENTED_REVERSAL_PATTERNS = [
  /\boffsetting (?:entry|transaction|record)\b/i,
  /\bopposite entry\b/i,
  /\bmatching entry\b/i,
  /\bcancels? (?:it|the (?:payment|transaction|amount)) out\b/i,
  /\bsame supplier and amount\b/i,
  /\bas if it never happened\b/i,
  /\bno audit trail\b/i,
  /\bmost businesses\b.{0,60}\bprefer\b/i,
];

/**
 * True when customer-facing reversal text uses invented-method wording,
 * including the exact staging-failure phrases. Unlike the proposal detector,
 * prohibitions that still name those methods also fail this check.
 */
export function customerFacingReversalContainsInventedMethod(text: string): boolean {
  return CUSTOMER_FACING_INVENTED_REVERSAL_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
}

/**
 * True when customer-facing text claims deletion/removal is the only
 * supported Cash Payment (or similar) correction. Assistant phrasing such as
 * "state supported actions Red can actually perform" is allowed.
 */
export function correctionGuidanceClaimsDeleteIsOnlyCorrection(text: string): boolean {
  return [
    /\bthe only supported\b/i,
    /\bonly supported correction\b/i,
    /\bonly supported operation\b/i,
    /\bonly supported action\b/i,
    /\bonly (?:available )?correction (?:action|option)\b/i,
    /\b(?:delete|deletion|removing|removal) is the only\b/i,
    /\bpermanently delete\b/i,
    /\bsole (?:available )?correction\b/i,
  ].some((pattern) => hasUnprohibitedMatch(text, pattern));
}
