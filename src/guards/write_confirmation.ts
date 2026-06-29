import { z } from "zod";
import { getToolSkillGroup, type RedSkillGroup } from "../config/server_config.js";
import { buildQuoteOrSalesInvoiceDraftDetails } from "./document_draft_details.js";
import { jsonResponse } from "../shared.js";
import { enforceSalesProductLineProductIdOrThrow } from "../tools/general/payloads_tools.js";
import {
  assertSalesVatRatesOrThrow,
  loadSalesVatCategoryContext,
} from "./sales_vat_category.js";

/** Sales invoice write tools where lines must use a Sales VAT rate before any draft preview or post. */
const SALES_DOCUMENT_VAT_PREFLIGHT_TOOLS = new Set([
  "brc_create_sales_invoice",
  "brc_create_sales_invoice_gen_ref",
  "brc_batch_sales_invoices",
]);

/**
 * Runs the Sales VAT category guard before any draft/confirmation preview or
 * post. A purchase/non-Sales VAT rate is blocked immediately so the wrong
 * vatRateId never reaches payloadPreview. Requires a connected company; without
 * one the guard is skipped and the pre-post backstop still applies.
 */
async function runSalesDocumentSalesVatPreflight(
  toolName: string,
  companyName: string | undefined,
  args: Record<string, unknown>
): Promise<void> {
  if (!SALES_DOCUMENT_VAT_PREFLIGHT_TOOLS.has(toolName) || !companyName) {
    return;
  }

  const context = await loadSalesVatCategoryContext(companyName);

  const bodies =
    toolName.startsWith("brc_batch_") && getBatchItems(args).length > 0
      ? getBatchItems(args).map((entry) => extractBatchItemBody(entry))
      : [getWriteBody(args)];

  for (const body of bodies) {
    assertSalesVatRatesOrThrow(body, context);
  }
}

/** Sales-document write tools whose product lines must never carry placeholder productId 0/1. */
const SALES_DOCUMENT_PRODUCT_LINE_TOOLS = new Set([
  "brc_create_sales_invoice",
  "brc_create_sales_invoice_gen_ref",
  "brc_create_sales_credit_note",
  "brc_create_sales_credit_note_gen_ref",
  "brc_create_quote",
  "brc_create_quote_gen_ref",
  "brc_batch_sales_invoices",
  "brc_batch_sales_credit_notes",
  "brc_batch_quotes",
]);

/**
 * Runs the placeholder productId guard before any draft preview or post so a
 * placeholder productId (0 or 1) can never reach payloadPreview or BRC. Throws a
 * customer-facing error when a placeholder is present.
 */
function runSalesDocumentProductIdPreflight(
  toolName: string,
  args: Record<string, unknown>
): void {
  if (!SALES_DOCUMENT_PRODUCT_LINE_TOOLS.has(toolName)) {
    return;
  }

  const bodies =
    toolName.startsWith("brc_batch_") && getBatchItems(args).length > 0
      ? getBatchItems(args).map((entry) => extractBatchItemBody(entry))
      : [getWriteBody(args)];

  for (const body of bodies) {
    enforceSalesProductLineProductIdOrThrow(body);
  }
}

function extractBatchItemBody(entry: Record<string, unknown>): Record<string, unknown> {
  const inner = entry.item ?? entry.Item;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return entry;
}

const WRITE_CONFIRMATION_SKILL_GROUPS = new Set<RedSkillGroup>([
  "update",
  "delete",
  "batch",
  "email",
]);

/** Tools that implement their own draft/confirm UX before posting. */
const TOOL_SELF_CONFIRMATION = new Set([
  "brc_create_bank_account",
  "brc_send_sales_invoice_email",
  "brc_send_email_statement",
  "brc_send_quote_email",
]);

const WRITE_CONFIRMATION_EXTRA_TOOLS = new Set(["brc_clear_audit_log"]);

export const confirmWriteSchema = z
  .boolean()
  .optional()
  .describe(
    "Must be true only after a plain-English draft has been shown in the current conversation and the user explicitly confirmed posting (for example yes, create it / post it now / confirm). Never set true on the first call or because the user initially asked to create something."
  );

export const confirmCounterpartyExplicitSchema = z
  .boolean()
  .optional()
  .describe(
    "Must be true only after the user explicitly named or confirmed the customer, supplier, or other counterparty in the current conversation. Never set true because a customer or supplier appeared in an earlier draft, was inferred from context, or was filled in without the user's explicit choice in this conversation."
  );

export const WRITE_CONFIRMATION_TOOL_SUFFIX =
  " First call without confirmWrite: true returns confirmation_required and a payload preview — show a plain-English draft in chat, then retry with confirmWrite: true only after explicit user confirmation in a later message. Passing preflight is not confirmation.";

export const COUNTERPARTY_CONFIRMATION_TOOL_SUFFIX =
  " Also requires confirmCounterpartyExplicit: true once the user has explicitly named or confirmed the customer/supplier in the current conversation. Do not reuse a counterparty from an earlier draft without that confirmation.";

export const WRITE_DRAFT_FIELDS_COMMON = [
  "company",
  "customer or supplier",
  "entry/processing dates",
  "line details (product, quantity, price)",
  "VAT",
  "totals",
  "reference handling",
] as const;

export function requiresWriteConfirmation(toolName: string): boolean {
  if (TOOL_SELF_CONFIRMATION.has(toolName)) {
    return false;
  }

  if (WRITE_CONFIRMATION_EXTRA_TOOLS.has(toolName)) {
    return true;
  }

  return WRITE_CONFIRMATION_SKILL_GROUPS.has(getToolSkillGroup(toolName));
}

export function isWriteActionConfirmed(args: Record<string, unknown>): boolean {
  return (
    args.confirmWrite === true ||
    args.confirmDelete === true ||
    args.confirmCreate === true ||
    args.confirmSend === true ||
    args.confirmProcess === true ||
    args.confirmClear === true
  );
}

type CounterpartyKind =
  | "customer"
  | "supplier"
  | "cash_receipt"
  | "cash_payment"
  | "payment";

const CUSTOMER_COUNTERPARTY_TOOLS = new Set([
  "brc_create_sales_invoice",
  "brc_create_sales_invoice_gen_ref",
  "brc_create_sales_credit_note",
  "brc_create_sales_credit_note_gen_ref",
  "brc_create_quote",
  "brc_create_quote_gen_ref",
  "brc_create_sales_entry",
  "brc_batch_sales_invoices",
  "brc_batch_quotes",
  "brc_batch_sales_credit_notes",
  "brc_batch_sales_entries",
]);

const SUPPLIER_COUNTERPARTY_TOOLS = new Set([
  "brc_create_purchase",
  "brc_create_purchase_gen_ref",
  "brc_batch_purchases",
]);

const CASH_RECEIPT_COUNTERPARTY_TOOLS = new Set([
  "brc_create_cash_receipt",
  "brc_batch_cash_receipts",
]);

const CASH_PAYMENT_COUNTERPARTY_TOOLS = new Set([
  "brc_create_cash_payment",
  "brc_batch_cash_payments",
]);

const PAYMENT_COUNTERPARTY_TOOLS = new Set([
  "brc_create_payment",
  "brc_batch_payments",
]);

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getWriteBody(args: Record<string, unknown>): Record<string, unknown> {
  const payload = args.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  return args;
}

function getBatchItems(args: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(args.items)) {
    return [];
  }

  return args.items.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item)
  );
}

function hasCustomerCounterparty(body: Record<string, unknown>): boolean {
  const customerId = body.customerId ?? body.customerOwnerId;
  return (
    (isPositiveNumber(customerId) ||
      (typeof customerId === "string" && customerId.trim().length > 0)) &&
    isNonEmptyString(body.acCode)
  );
}

function hasSupplierCounterparty(body: Record<string, unknown>): boolean {
  const supplierId = body.supplierId;
  return (
    (isPositiveNumber(supplierId) ||
      (typeof supplierId === "string" && supplierId.trim().length > 0)) &&
    isNonEmptyString(body.acCode)
  );
}

function hasCashReceiptCounterparty(body: Record<string, unknown>): boolean {
  if (hasCustomerCounterparty(body)) {
    return true;
  }

  if (
    isPositiveNumber(body.analysisCategoryId) &&
    isNonEmptyString(body.accountCode)
  ) {
    return true;
  }

  if (Array.isArray(body.acEntries) && body.acEntries.length > 0) {
    return true;
  }

  return false;
}

function hasCashPaymentCounterparty(body: Record<string, unknown>): boolean {
  if (hasSupplierCounterparty(body)) {
    return true;
  }

  if (isPositiveNumber(body.bankAccountId) && body.lodgement !== undefined) {
    return true;
  }

  if (
    isPositiveNumber(body.analysisCategoryId) &&
    isNonEmptyString(body.accountCode)
  ) {
    return true;
  }

  return false;
}

function hasPaymentCounterparty(body: Record<string, unknown>): boolean {
  if (hasSupplierCounterparty(body)) {
    return true;
  }

  if (
    isPositiveNumber(body.analysisCategoryId) &&
    isNonEmptyString(body.accountCode)
  ) {
    return true;
  }

  return false;
}

function getCounterpartyKind(toolName: string): CounterpartyKind | null {
  if (CUSTOMER_COUNTERPARTY_TOOLS.has(toolName)) {
    return "customer";
  }

  if (SUPPLIER_COUNTERPARTY_TOOLS.has(toolName)) {
    return "supplier";
  }

  if (CASH_RECEIPT_COUNTERPARTY_TOOLS.has(toolName)) {
    return "cash_receipt";
  }

  if (CASH_PAYMENT_COUNTERPARTY_TOOLS.has(toolName)) {
    return "cash_payment";
  }

  if (PAYMENT_COUNTERPARTY_TOOLS.has(toolName)) {
    return "payment";
  }

  return null;
}

export function requiresCounterpartyConfirmation(toolName: string): boolean {
  return getCounterpartyKind(toolName) !== null;
}

function bodyHasCounterparty(
  kind: CounterpartyKind,
  body: Record<string, unknown>
): boolean {
  switch (kind) {
    case "customer":
      return hasCustomerCounterparty(body);
    case "supplier":
      return hasSupplierCounterparty(body);
    case "cash_receipt":
      return hasCashReceiptCounterparty(body);
    case "cash_payment":
      return hasCashPaymentCounterparty(body);
    case "payment":
      return hasPaymentCounterparty(body);
    default:
      return false;
  }
}

function counterpartyLabel(kind: CounterpartyKind): string {
  switch (kind) {
    case "customer":
      return "customer";
    case "supplier":
      return "supplier";
    case "cash_receipt":
      return "customer or cash receipt allocation";
    case "cash_payment":
      return "supplier, bank lodgement, or cash payment analysis";
    case "payment":
      return "supplier or payment analysis account";
    default:
      return "counterparty";
  }
}

function counterpartyNameHint(body: Record<string, unknown>): string | undefined {
  if (isNonEmptyString(body.customerOwnerName)) {
    return body.customerOwnerName.trim();
  }

  if (isNonEmptyString(body.acCode)) {
    return body.acCode.trim();
  }

  return undefined;
}

export function isCounterpartyExplicitlyConfirmed(
  args: Record<string, unknown>
): boolean {
  if (args.confirmCounterpartyExplicit === true) {
    return true;
  }

  // Preserve automated and self-confirm tool flows.
  return (
    args.confirmCreate === true ||
    args.confirmSend === true ||
    args.confirmProcess === true
  );
}

async function validateCounterpartyForWrite(args: {
  toolName: string;
  companyName?: string;
  payload: Record<string, unknown>;
}) {
  const kind = getCounterpartyKind(args.toolName);
  if (!kind) {
    return null;
  }

  const bodies =
    args.toolName.startsWith("brc_batch_") && getBatchItems(args.payload).length > 0
      ? getBatchItems(args.payload)
      : [getWriteBody(args.payload)];

  const missingIndex = bodies.findIndex((body) => !bodyHasCounterparty(kind, body));
  if (missingIndex !== -1) {
    const label = counterpartyLabel(kind);
    return jsonResponse({
      status: "counterparty_missing",
      message: [
        `Red stopped before preparing this draft because the required ${label} is missing.`,
        "",
        `Ask the user which ${label} to use before calling this tool again.`,
        "You may suggest a customer or supplier from an earlier draft as a convenience, but do not select or reuse one without explicit confirmation in the current conversation.",
        "",
        "Do not call this tool again, and do not pass confirmWrite: true, until the user has explicitly provided or confirmed the counterparty.",
      ].join("\n"),
      toolName: args.toolName,
      companyName: args.companyName,
      counterpartyKind: kind,
      counterpartyLabel: label,
      missingBatchItemIndex:
        args.toolName.startsWith("brc_batch_") ? missingIndex : undefined,
      confirmationField: "confirmCounterpartyExplicit",
    });
  }

  if (isCounterpartyExplicitlyConfirmed(args.payload)) {
    return null;
  }

  const label = counterpartyLabel(kind);
  const isBatch = args.toolName.startsWith("brc_batch_");
  const batchHints = isBatch ? collectBatchCounterpartyHints(bodies) : [];
  const hint = isBatch
    ? batchHints[0]
    : counterpartyNameHint(getWriteBody(args.payload));

  const exampleQuestion = buildCounterpartyQuestion(
    label,
    isBatch,
    batchHints,
    hint
  );

  return jsonResponse(
    await enrichWriteConfirmationResponse(args.toolName, args.companyName, args.payload, {
      status: "counterparty_confirmation_required",
      message: [
        `Red stopped because the ${label} must be explicitly confirmed in the current conversation before preparing a postable draft.`,
        "",
        "Do not silently carry over a customer or supplier from an earlier draft.",
        "Do not pass confirmWrite: true until the counterparty has been explicitly confirmed.",
        ...(isBatch && batchHints.length > 1
          ? [
              "",
              `This batch covers ${batchHints.length} ${label}s. Confirming applies to all of them, not just the first: ${batchHints.join(", ")}.`,
            ]
          : []),
        "",
        `Ask the user in plain English, for example: "${exampleQuestion}"`,
        "",
        "Only retry this tool with confirmCounterpartyExplicit: true after the user explicitly names or confirms the counterparty in the current conversation.",
      ].join("\n"),
      toolName: args.toolName,
      companyName: args.companyName,
      counterpartyKind: kind,
      counterpartyLabel: label,
      suggestedCounterpartyName: hint,
      batchCounterpartyNames: isBatch ? batchHints : undefined,
      exampleUserQuestion: exampleQuestion,
      payloadPreview: buildWritePayloadPreview(args.payload),
      confirmationField: "confirmCounterpartyExplicit",
      confirmWriteRequiresExplicitCounterparty: true,
    })
  );
}

function collectBatchCounterpartyHints(
  bodies: Record<string, unknown>[]
): string[] {
  const names = new Set<string>();
  for (const body of bodies) {
    const hint = counterpartyNameHint(body);
    if (hint) {
      names.add(hint);
    }
  }
  return [...names];
}

/**
 * Builds the plain-English confirmation question. For a batch covering several
 * customers it makes clear the user is confirming all of them, not just one.
 */
function buildCounterpartyQuestion(
  label: string,
  isBatch: boolean,
  batchHints: string[],
  hint: string | undefined
): string {
  if (isBatch && batchHints.length > 1) {
    return `Please confirm all ${label}s for this batch before I prepare the final draft: ${batchHints.join(", ")}. Should I prepare drafts for all of these ${label}s?`;
  }

  if (label === "customer") {
    return hint
      ? `Please confirm the customer for this invoice before I prepare the final draft. Did you want to use ${hint}, or choose another customer?`
      : "Please confirm the customer for this invoice before I prepare the final draft.";
  }

  return hint
    ? `I need the ${label} before I can prepare this draft for posting. Did you want to use ${hint} from the previous draft, or choose another ${label}?`
    : `I need the ${label} before I can prepare this draft for posting. Which ${label} should be used?`;
}

function writeActionLabel(toolName: string): string {
  const group = getToolSkillGroup(toolName);

  if (group === "delete" || toolName.startsWith("brc_delete_")) {
    return "deleting this record";
  }

  if (group === "batch" || toolName.startsWith("brc_batch_")) {
    return "processing this batch";
  }

  if (group === "email" || toolName.startsWith("brc_send_")) {
    return "sending this email";
  }

  if (toolName.startsWith("brc_update_")) {
    return "updating this record";
  }

  if (toolName.includes("close")) {
    return "closing this record";
  }

  if (toolName.includes("reopen")) {
    return "reopening this record";
  }

  if (toolName.includes("purchase")) {
    return "creating this purchase";
  }

  if (toolName.includes("quote")) {
    return "creating this quote";
  }

  if (toolName.includes("sales_credit_note") || toolName.includes("credit_note")) {
    return "creating this sales credit note";
  }

  if (toolName.includes("sales_invoice") || toolName.includes("sales_entry")) {
    return "creating this sales invoice or sales entry";
  }

  if (toolName.includes("cash_receipt") || toolName.includes("cash_payment")) {
    return "creating this cash receipt or cash payment";
  }

  if (toolName.includes("payment")) {
    return "creating this payment";
  }

  return "creating or changing this record";
}

function draftFieldsForTool(toolName: string): string[] {
  if (toolName.startsWith("brc_batch_")) {
    return [
      "company",
      "batch action summary for each item",
      "dates, amounts, VAT, and references where applicable",
      "record counts within the batch limit",
    ];
  }

  if (toolName.startsWith("brc_delete_") || toolName.startsWith("brc_update_")) {
    return [
      "company",
      "record type and identifier",
      "exact change or deletion being requested",
    ];
  }

  if (toolName.includes("purchase")) {
    return [
      ...WRITE_DRAFT_FIELDS_COMMON,
      "supplier",
      "purchase reference handling",
    ];
  }

  if (toolName.includes("quote")) {
    return [
      ...WRITE_DRAFT_FIELDS_COMMON,
      "customer",
      "sales rep",
      "analysis category and account code",
      "Missing or not provided section for blank customer phone or customer email when applicable",
    ];
  }

  if (
    toolName.includes("sales_invoice") ||
    toolName.includes("sales_credit_note") ||
    toolName.includes("credit_note")
  ) {
    return [
      ...WRITE_DRAFT_FIELDS_COMMON,
      "customer",
      "sales rep",
      "analysis category and account code",
      ...(toolName.includes("sales_invoice")
        ? [
            "Missing or not provided section for blank customer phone or customer email when applicable",
          ]
        : []),
    ];
  }

  if (toolName.includes("cash_receipt") || toolName.includes("cash_payment")) {
    return [
      "company",
      "customer or supplier",
      "entry/processing dates",
      "amount",
      "VAT or allocation details where applicable",
      "reference",
    ];
  }

  if (toolName.includes("payment")) {
    return [
      "company",
      "supplier or bank details",
      "entry/processing dates",
      "amount",
      "analysis category and account code where applicable",
      "reference",
    ];
  }

  return [...WRITE_DRAFT_FIELDS_COMMON];
}

async function enrichWriteConfirmationResponse(
  toolName: string,
  companyName: string | undefined,
  payload: Record<string, unknown>,
  response: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const draftDetails = await buildQuoteOrSalesInvoiceDraftDetails(
    toolName,
    companyName,
    payload
  );

  if (!draftDetails.documentDraftDetails) {
    return response;
  }

  // Show the missing-details warning once via missingOrNotProvidedSection only.
  // The message text is left unchanged so the same phone/email warning is not
  // repeated across message, a warnings array, and the section.
  return {
    ...response,
    documentDraftDetails: draftDetails.documentDraftDetails,
    missingOrNotProvidedSection: draftDetails.missingOrNotProvidedSection,
    missingDetailsDisplayHint:
      "Show the 'Missing or not provided' section once. Do not repeat the same customer phone or email warnings elsewhere in the reply.",
  };
}

function buildWritePayloadPreview(
  input: Record<string, unknown>
): Record<string, unknown> {
  const preview: Record<string, unknown> = { ...input };

  for (const key of Object.keys(preview)) {
    if (key === "confirmWrite" || key.startsWith("confirm")) {
      delete preview[key];
    }
  }

  return preview;
}

export async function requireWriteConfirmation(args: {
  toolName: string;
  companyName?: string;
  payload?: unknown;
}) {
  const action = writeActionLabel(args.toolName);
  const draftFields = draftFieldsForTool(args.toolName);
  const payload = buildWritePayloadPreview(
    (args.payload ?? {}) as Record<string, unknown>
  );

  const response = await enrichWriteConfirmationResponse(
    args.toolName,
    args.companyName,
    payload,
    {
      status: "confirmation_required",
      message: [
        `Red stopped before ${action} because explicit user confirmation is required.`,
        "",
        "This is a draft/preview step only. Nothing has been posted to Big Red Cloud.",
        "",
        "Show the user a clear plain-English draft in chat before posting. Include:",
        ...draftFields.map((field) => `- ${field}`),
        "",
        "Treat requests such as \"create a sales invoice...\" as permission to prepare a draft, not to post.",
        "Passing preflight checks is not confirmation.",
        "",
        "The customer or supplier must be explicitly named or confirmed in the current conversation before any postable draft. Do not reuse a counterparty from an earlier draft without that confirmation.",
        "",
        "Red must not invent missing customer phone or customer email values.",
        "",
        "Only call this tool again with confirmWrite: true after the draft has been shown in the current conversation and the user explicitly confirms, for example: \"yes, create it\", \"post it now\", \"confirm\", or an equivalent clear yes.",
        "When confirmWrite: true is used, confirmCounterpartyExplicit: true must also be true if this tool requires a customer or supplier.",
        "Do not pass confirmWrite: true in the same turn as the initial create request.",
      ].join("\n"),
      toolName: args.toolName,
      companyName: args.companyName,
      proposedAction: action,
      draftFieldsToShow: draftFields,
      payloadPreview: payload,
      confirmationField: "confirmWrite",
      preflightPassedIsNotConfirmation: true,
      initialCreateRequestIsNotConfirmation: true,
    }
  );

  return jsonResponse(response);
}

export function wrapWriteToolHandler<T extends Record<string, unknown>>(
  toolName: string,
  handler: (args: T) => Promise<unknown> | unknown
): (args: T) => Promise<unknown> | unknown {
  if (!requiresWriteConfirmation(toolName)) {
    return handler;
  }

  return async (args: T) => {
    const companyName =
      typeof args.companyName === "string" ? args.companyName : undefined;

    runSalesDocumentProductIdPreflight(toolName, args as Record<string, unknown>);
    await runSalesDocumentSalesVatPreflight(
      toolName,
      companyName,
      args as Record<string, unknown>
    );

    const counterpartyBlock = await validateCounterpartyForWrite({
      toolName,
      companyName,
      payload: args as Record<string, unknown>,
    });
    if (counterpartyBlock) {
      return counterpartyBlock;
    }

    if (isWriteActionConfirmed(args)) {
      if (
        requiresCounterpartyConfirmation(toolName) &&
        !isCounterpartyExplicitlyConfirmed(args)
      ) {
        return validateCounterpartyForWrite({
          toolName,
          companyName,
          payload: args as Record<string, unknown>,
        });
      }

      return handler(args);
    }

    return requireWriteConfirmation({
      toolName,
      companyName,
      payload: buildWritePayloadPreview(args),
    });
  };
}

export function appendWriteConfirmationDescription(
  description: string,
  toolName?: string
): string {
  let next = description;

  if (
    !next.includes("confirmWrite") &&
    !next.includes("confirmation_required")
  ) {
    next = `${next}${WRITE_CONFIRMATION_TOOL_SUFFIX}`;
  }

  if (
    toolName &&
    requiresCounterpartyConfirmation(toolName) &&
    !next.includes("confirmCounterpartyExplicit")
  ) {
    next = `${next}${COUNTERPARTY_CONFIRMATION_TOOL_SUFFIX}`;
  }

  return next;
}
