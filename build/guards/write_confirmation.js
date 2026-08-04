import { z } from "zod";
import { getToolSkillGroup } from "../config/server_config.js";
import { buildQuoteOrSalesInvoiceDraftDetails } from "./document_draft_details.js";
import { jsonResponse } from "../shared.js";
import { applySalesPriceBasisToRawPayload, enforceSalesProductLineProductIdOrThrow, } from "../tools/general/payloads_tools.js";
import { buildSalesInvoiceGenRefValidationFailureBody, validateGeneratedReferenceSalesInvoicePayload, } from "../tools/sales-emails/sales_invoice_payload_schemas.js";
import { assertSalesVatRatesOrThrow, loadSalesVatCategoryContext, } from "./sales_vat_category.js";
/**
 * Validates gen-ref sales invoice payloads before preview-before-posting and
 * before posting. Returns a structured MCP jsonResponse on failure so missing
 * or empty nested acEntries never reach BRC or escape as an unhandled error.
 */
function validateGenRefSalesInvoicePayloadOrRespond(toolName, companyName, args) {
    if (toolName !== "brc_create_sales_invoice_gen_ref") {
        return null;
    }
    try {
        const body = getWriteBody(args);
        const priceBasis = args.priceBasis === "net" || args.priceBasis === "gross"
            ? args.priceBasis
            : undefined;
        const prepared = applySalesPriceBasisToRawPayload({ ...body }, priceBasis);
        const validation = validateGeneratedReferenceSalesInvoicePayload(prepared);
        if (validation.valid) {
            return null;
        }
        return jsonResponse(buildSalesInvoiceGenRefValidationFailureBody(companyName ?? "", validation.errors));
    }
    catch (error) {
        return jsonResponse(buildSalesInvoiceGenRefValidationFailureBody(companyName ?? "", [
            {
                field: "(root)",
                message: error instanceof Error
                    ? error.message
                    : "Unexpected sales invoice payload validation failure.",
            },
        ]));
    }
}
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
async function runSalesDocumentSalesVatPreflight(toolName, companyName, args) {
    if (!SALES_DOCUMENT_VAT_PREFLIGHT_TOOLS.has(toolName) || !companyName) {
        return;
    }
    const context = await loadSalesVatCategoryContext(companyName);
    const bodies = toolName.startsWith("brc_batch_") && getBatchItems(args).length > 0
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
function runSalesDocumentProductIdPreflight(toolName, args) {
    if (!SALES_DOCUMENT_PRODUCT_LINE_TOOLS.has(toolName)) {
        return;
    }
    const bodies = toolName.startsWith("brc_batch_") && getBatchItems(args).length > 0
        ? getBatchItems(args).map((entry) => extractBatchItemBody(entry))
        : [getWriteBody(args)];
    for (const body of bodies) {
        enforceSalesProductLineProductIdOrThrow(body);
    }
}
function extractBatchItemBody(entry) {
    const inner = entry.item ?? entry.Item;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner;
    }
    return entry;
}
const WRITE_CONFIRMATION_SKILL_GROUPS = new Set([
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
    .describe("Must be true only after a plain-English preview before posting has been shown in the current conversation and the user explicitly confirmed posting (for example yes, create it / post it now / confirm). Never set true on the first call or because the user initially asked to create something. Nothing is written to Big Red Cloud until you confirm.");
export const confirmCounterpartyExplicitSchema = z
    .boolean()
    .optional()
    .describe("Must be true only after the user explicitly named or confirmed the customer, supplier, or other counterparty in the current conversation. Never set true because a customer or supplier appeared in an earlier preview, was inferred from context, or was filled in without the user's explicit choice in this conversation.");
export const WRITE_CONFIRMATION_TOOL_SUFFIX = " First call without confirmWrite: true returns confirmation_required and a payload preview — show a plain-English preview before posting in chat, then retry with confirmWrite: true only after explicit user confirmation in a later message. Red shows what it will post and waits for confirmation. Passing preflight is not confirmation.";
export const COUNTERPARTY_CONFIRMATION_TOOL_SUFFIX = " Also requires confirmCounterpartyExplicit: true once the user has explicitly named or confirmed the customer/supplier in the current conversation. Do not reuse a counterparty from an earlier preview without that confirmation.";
export const WRITE_DRAFT_FIELDS_COMMON = [
    "company",
    "customer or supplier",
    "entry/processing dates",
    "line details (product, quantity, price)",
    "VAT",
    "totals",
    "reference handling",
];
export function requiresWriteConfirmation(toolName) {
    if (TOOL_SELF_CONFIRMATION.has(toolName)) {
        return false;
    }
    if (WRITE_CONFIRMATION_EXTRA_TOOLS.has(toolName)) {
        return true;
    }
    return WRITE_CONFIRMATION_SKILL_GROUPS.has(getToolSkillGroup(toolName));
}
export function isWriteActionConfirmed(args) {
    return (args.confirmWrite === true ||
        args.confirmDelete === true ||
        args.confirmCreate === true ||
        args.confirmSend === true ||
        args.confirmProcess === true ||
        args.confirmClear === true);
}
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
function isPositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function getWriteBody(args) {
    const payload = args.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return payload;
    }
    return args;
}
function getBatchItems(args) {
    if (!Array.isArray(args.items)) {
        return [];
    }
    return args.items.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item));
}
function hasCustomerCounterparty(body) {
    const customerId = body.customerId ?? body.customerOwnerId;
    return ((isPositiveNumber(customerId) ||
        (typeof customerId === "string" && customerId.trim().length > 0)) &&
        isNonEmptyString(body.acCode));
}
function hasSupplierCounterparty(body) {
    const supplierId = body.supplierId;
    return ((isPositiveNumber(supplierId) ||
        (typeof supplierId === "string" && supplierId.trim().length > 0)) &&
        isNonEmptyString(body.acCode));
}
function hasCashReceiptCounterparty(body) {
    if (hasCustomerCounterparty(body)) {
        return true;
    }
    if (isPositiveNumber(body.analysisCategoryId) &&
        isNonEmptyString(body.accountCode)) {
        return true;
    }
    if (Array.isArray(body.acEntries) && body.acEntries.length > 0) {
        return true;
    }
    return false;
}
function hasCashPaymentCounterparty(body) {
    if (hasSupplierCounterparty(body)) {
        return true;
    }
    if (isPositiveNumber(body.bankAccountId) && body.lodgement !== undefined) {
        return true;
    }
    if (isPositiveNumber(body.analysisCategoryId) &&
        isNonEmptyString(body.accountCode)) {
        return true;
    }
    return false;
}
function hasPaymentCounterparty(body) {
    if (hasSupplierCounterparty(body)) {
        return true;
    }
    if (isPositiveNumber(body.analysisCategoryId) &&
        isNonEmptyString(body.accountCode)) {
        return true;
    }
    return false;
}
function getCounterpartyKind(toolName) {
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
export function requiresCounterpartyConfirmation(toolName) {
    return getCounterpartyKind(toolName) !== null;
}
function bodyHasCounterparty(kind, body) {
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
function counterpartyLabel(kind) {
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
function counterpartyNameHint(body) {
    if (isNonEmptyString(body.customerOwnerName)) {
        return body.customerOwnerName.trim();
    }
    if (isNonEmptyString(body.acCode)) {
        return body.acCode.trim();
    }
    return undefined;
}
export function isCounterpartyExplicitlyConfirmed(args) {
    if (args.confirmCounterpartyExplicit === true) {
        return true;
    }
    // Preserve automated and self-confirm tool flows.
    return (args.confirmCreate === true ||
        args.confirmSend === true ||
        args.confirmProcess === true);
}
async function validateCounterpartyForWrite(args) {
    const kind = getCounterpartyKind(args.toolName);
    if (!kind) {
        return null;
    }
    const bodies = args.toolName.startsWith("brc_batch_") && getBatchItems(args.payload).length > 0
        ? getBatchItems(args.payload)
        : [getWriteBody(args.payload)];
    const missingIndex = bodies.findIndex((body) => !bodyHasCounterparty(kind, body));
    if (missingIndex !== -1) {
        const label = counterpartyLabel(kind);
        return jsonResponse({
            status: "counterparty_missing",
            message: [
                `Red stopped before showing a preview because the required ${label} is missing.`,
                "",
                `Ask the user which ${label} to use before calling this tool again.`,
                "You may suggest a customer or supplier from an earlier preview as a convenience, but do not select or reuse one without explicit confirmation in the current conversation.",
                "",
                "Do not call this tool again, and do not pass confirmWrite: true, until the user has explicitly provided or confirmed the counterparty.",
            ].join("\n"),
            toolName: args.toolName,
            companyName: args.companyName,
            counterpartyKind: kind,
            counterpartyLabel: label,
            missingBatchItemIndex: args.toolName.startsWith("brc_batch_") ? missingIndex : undefined,
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
    const exampleQuestion = buildCounterpartyQuestion(label, isBatch, batchHints, hint);
    return jsonResponse(await enrichWriteConfirmationResponse(args.toolName, args.companyName, args.payload, {
        status: "counterparty_confirmation_required",
        message: [
            `Red stopped because the ${label} must be explicitly confirmed in the current conversation before showing a validated preview for posting.`,
            "",
            "Do not silently carry over a customer or supplier from an earlier preview.",
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
    }));
}
function collectBatchCounterpartyHints(bodies) {
    const names = new Set();
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
function buildCounterpartyQuestion(label, isBatch, batchHints, hint) {
    if (isBatch && batchHints.length > 1) {
        return `Please confirm all ${label}s for this batch before I show the final preview for posting: ${batchHints.join(", ")}. Should I show a preview for all of these ${label}s?`;
    }
    if (label === "customer") {
        return hint
            ? `Please confirm the customer for this invoice before I show the preview for posting. Did you want to use ${hint}, or choose another customer?`
            : "Please confirm the customer for this invoice before I show the preview for posting.";
    }
    return hint
        ? `I need the ${label} before I can show a preview for posting. Did you want to use ${hint} from the previous preview, or choose another ${label}?`
        : `I need the ${label} before I can show a preview for posting. Which ${label} should be used?`;
}
function writeActionLabel(toolName) {
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
function draftFieldsForTool(toolName) {
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
    if (toolName.includes("sales_invoice") ||
        toolName.includes("sales_credit_note") ||
        toolName.includes("credit_note")) {
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
async function enrichWriteConfirmationResponse(toolName, companyName, payload, response) {
    const draftDetails = await buildQuoteOrSalesInvoiceDraftDetails(toolName, companyName, payload);
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
        missingDetailsDisplayHint: "Show the 'Missing or not provided' section once. Do not repeat the same customer phone or email warnings elsewhere in the reply.",
    };
}
function buildWritePayloadPreview(input) {
    const preview = { ...input };
    for (const key of Object.keys(preview)) {
        if (key === "confirmWrite" || key.startsWith("confirm")) {
            delete preview[key];
        }
    }
    return preview;
}
export async function requireWriteConfirmation(args) {
    const action = writeActionLabel(args.toolName);
    const draftFields = draftFieldsForTool(args.toolName);
    const payload = buildWritePayloadPreview((args.payload ?? {}));
    const response = await enrichWriteConfirmationResponse(args.toolName, args.companyName, payload, {
        status: "confirmation_required",
        message: [
            `Red stopped before ${action} because explicit user confirmation is required.`,
            "",
            "This is a preview-before-posting step only. Nothing has been written to Big Red Cloud.",
            "",
            "Show the user a clear plain-English preview in chat before posting. Include:",
            ...draftFields.map((field) => `- ${field}`),
            "",
            "Treat requests such as \"create a sales invoice...\" as permission to review before posting, not to post.",
            "Red shows what it will post and waits for confirmation.",
            "Passing preflight checks is not confirmation.",
            "",
            "The customer or supplier must be explicitly named or confirmed in the current conversation before any validated preview for posting. Do not reuse a counterparty from an earlier preview without that confirmation.",
            "",
            "Red must not invent missing customer phone or customer email values.",
            "",
            "Only call this tool again with confirmWrite: true after the preview has been shown in the current conversation and the user explicitly confirms, for example: \"yes, create it\", \"post it now\", \"confirm\", or an equivalent clear yes.",
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
    });
    return jsonResponse(response);
}
export function wrapWriteToolHandler(toolName, handler) {
    if (!requiresWriteConfirmation(toolName)) {
        return handler;
    }
    return async (args) => {
        const companyName = typeof args.companyName === "string" ? args.companyName : undefined;
        runSalesDocumentProductIdPreflight(toolName, args);
        await runSalesDocumentSalesVatPreflight(toolName, companyName, args);
        const genRefValidationBlock = validateGenRefSalesInvoicePayloadOrRespond(toolName, companyName, args);
        if (genRefValidationBlock) {
            return genRefValidationBlock;
        }
        const counterpartyBlock = await validateCounterpartyForWrite({
            toolName,
            companyName,
            payload: args,
        });
        if (counterpartyBlock) {
            return counterpartyBlock;
        }
        if (isWriteActionConfirmed(args)) {
            if (requiresCounterpartyConfirmation(toolName) &&
                !isCounterpartyExplicitlyConfirmed(args)) {
                return validateCounterpartyForWrite({
                    toolName,
                    companyName,
                    payload: args,
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
export function appendWriteConfirmationDescription(description, toolName) {
    let next = description;
    if (!next.includes("confirmWrite") &&
        !next.includes("confirmation_required")) {
        next = `${next}${WRITE_CONFIRMATION_TOOL_SUFFIX}`;
    }
    if (toolName &&
        requiresCounterpartyConfirmation(toolName) &&
        !next.includes("confirmCounterpartyExplicit")) {
        next = `${next}${COUNTERPARTY_CONFIRMATION_TOOL_SUFFIX}`;
    }
    return next;
}
