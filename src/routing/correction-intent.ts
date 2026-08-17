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
  "Then explain in friendly business language: what changed; whether it can genuinely be undone; what you propose; important consequences; anything you need to check first; and ask permission before another change.",
  "Existing preview-before-posting, confirmWrite, confirmDelete, counterparty, and email confirmation rules still apply after the user agrees to a plan.",
  "If the user agrees, start the normal supported business workflow for that plan — do not bypass confirmation.",
  "Do not automatically delete a financial record because the user said undo or reverse.",
  "Do not infer accounting treatment from the word reverse. Reverse can mean different things depending on the accounting situation.",
  "Never propose a specific accounting transaction type as a reversal unless that exact reversal flow is supported by existing Red tools and verified BRC behaviour.",
  "Do not assume Cash Payment is reversed with a Cash Receipt, Sales Invoice with a Sales Credit Note, or Purchase with an opposite purchase or credit. Do not invent negative or opposite transactions.",
  "For financial records: read the current record first; state only supported options Red actually knows are safe; if a formal reversing or correcting transaction has not been proven, say Red can check what correction options are supported rather than naming one; then ask permission.",
  "Do not claim an action is reversible unless Red can actually do it. If it cannot, say what Red can and cannot do and that the rest must be completed in Big Red Cloud.",
].join(" ");

/**
 * Customer-facing language rules for correction explanations.
 * Spoken replies should follow these; they must stay free of API jargon.
 */
export const CORRECTION_CUSTOMER_LANGUAGE_RULES = [
  "Talk to the user as an accountant or bookkeeper. Keep explanations short and specific.",
  "Prefer: change it back; leave everything else unchanged; check what changed; recreate the record; remove the record; check what correction options are supported; show you what will happen first.",
  "Do not invent previous values. If the earlier value is unknown, say you need to check what it was first.",
  "A deleted record cannot simply be switched back on. Offer to check whether there is enough information to recreate it, and show what would be recreated before anything is posted.",
  "Do not automatically delete a payment or other financial record because the user asked to reverse it. Explain that reverse can mean different things. State only supported options Red knows are safe for that record. If a formal reversing or correcting transaction has not been proven, offer to check what correction options are supported rather than naming an opposite transaction type.",
  "If a quote has generated a sales invoice, those are linked records. Changing or reopening the quote does not automatically remove the invoice. Explain what Red can safely do, then ask permission.",
  "Wait for explicit permission before making another change.",
].join(" ");

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
  return (
    `I will not automatically remove that ${recordLabel}. ` +
    `"Reverse" can mean different things depending on the accounting situation. ` +
    `Red can remove it if deleting it is the appropriate correction, or I can check what other supported correction options are available for this type of ${recordLabel}. ` +
    "I will not create an opposite transaction unless that is a confirmed supported method. Would you like me to check?"
  );
}

/**
 * True when customer-facing text invents an unverified opposite transaction
 * type — for example reversing a Cash Payment by creating a Cash Receipt.
 * Prohibitions such as "I will not create an opposite transaction" are allowed.
 */
export function correctionGuidanceProposesUnverifiedOpposite(text: string): boolean {
  if (/\bequal-and-opposite\b/i.test(text)) {
    return true;
  }
  if (/\boffsetting\b/i.test(text)) {
    return true;
  }
  if (/\bmatching reversal\b/i.test(text)) {
    return true;
  }
  if (/\bnegative (?:amount|transaction|entry)\b/i.test(text)) {
    return true;
  }
  if (/\bcreate(?:ing)? a reversing entry\b/i.test(text)) {
    return true;
  }
  if (/\bcash receipt\b/i.test(text)) {
    return true;
  }
  if (/\bsales credit note\b/i.test(text)) {
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

const FORBIDDEN_HTTP_METHODS = /\b(?:POST|PUT|DELETE|GET|PATCH)\b/;

export function correctionGuidanceContainsJargon(text: string): boolean {
  return FORBIDDEN_CUSTOMER_JARGON.test(text) || FORBIDDEN_HTTP_METHODS.test(text);
}
