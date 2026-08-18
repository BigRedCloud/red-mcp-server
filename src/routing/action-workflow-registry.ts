/**
 * Authoritative registry of transactional action workflows for Red.
 *
 * brc_route_request, route-token issuance, and coverage tests all use this
 * single source. Every transactional tool that requires a routeToken must
 * appear in exactly one workflow's allowedTools.
 */

import {
  getToolSkillGroup,
  isToolEnabled,
  type RedSkillGroup,
} from "../config/server_config.js";

export type DeploymentPermissionFlag = "update" | "delete" | "batch" | "email";

export type ActionWorkflowDefinition = {
  workflowId: string;
  description: string;
  allowedTools: readonly string[];
  actionVerbs: readonly string[];
  businessNouns: readonly string[];
  permissionFlag: DeploymentPermissionFlag;
  /** Verb+noun matcher; help phrases are excluded upstream by the classifier. */
  match: RegExp;
};

/** Legacy shape used by routeRequest / intent-classifier call sites. */
export type ActionWorkflow = {
  name: string;
  description: string;
  preferredTools: string[];
  requiresPreviewConfirmation: true;
};

function verbNoun(
  verbs: string,
  nouns: string,
  window = 60,
): RegExp {
  return new RegExp(
    `\\b(?:${verbs})\\b.{0,${window}}\\b(?:${nouns})\\b|\\b(?:${nouns})\\b.{0,${window}}\\b(?:${verbs})\\b`,
    "i",
  );
}

const CREATE_VERBS = "add|create|set\\s+up|setup|new|raise|prepare|record";
const UPDATE_VERBS = "update|change|edit|amend|modify|correct";
const DELETE_VERBS = "delete|remove|erase";
const POST_VERBS = "post|raise|create|add|prepare";
const BATCH_VERBS = "batch|bulk|import";
const EMAIL_VERBS = "email|send|mail";

/**
 * Batch intent that should win over an earlier create-style verb
 * (e.g. "prepare a batch of 2 Cash Payments", "create 2 Cash Payments").
 */
function hasExplicitBatchIntent(text: string): boolean {
  if (/\b(?:batch|bulk|import)\b/i.test(text)) {
    return true;
  }

  if (/\bmultiple\b/i.test(text)) {
    return true;
  }

  // "create 2 …", "add 3 …", "prepare 2 …" (quantity ≥ 2 before the noun)
  if (
    /\b(?:add|create|prepare|record|raise|post)\s+(?:[2-9]|\d{2,})\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Match batch/bulk/import near a noun, plus quantity and "multiple" phrasing
 * that clearly means more than one record.
 */
function batchNounMatch(nouns: string, window = 60): RegExp {
  return new RegExp(
    [
      `\\b(?:${BATCH_VERBS})\\b.{0,${window}}\\b(?:${nouns})\\b`,
      `\\b(?:${nouns})\\b.{0,${window}}\\b(?:${BATCH_VERBS})\\b`,
      // "create 2 Cash Payments", "prepare 2 disposable Cash Payments"
      `\\b(?:add|create|prepare|record|raise|post)\\s+(?:[2-9]|\\d{2,})\\b.{0,${window}}\\b(?:${nouns})\\b`,
      // "multiple Cash Payments"
      `\\bmultiple\\b.{0,${window}}\\b(?:${nouns})\\b`,
    ].join("|"),
    "i",
  );
}

/**
 * Ordered list — more specific patterns first (e.g. sales credit note before
 * generic sales entry; invoice from quote before create invoice).
 */
export const ACTION_WORKFLOW_REGISTRY: readonly ActionWorkflowDefinition[] = [
  // --- Quotes (special verbs) ---
  {
    workflowId: "generate_sales_invoice_from_quote",
    description:
      "Generate a sales invoice from an existing quote after confirming the quote and previewing the invoice.",
    allowedTools: ["brc_generate_sales_invoice_from_quote"],
    actionVerbs: ["generate", "convert", "create"],
    businessNouns: ["invoice from quote", "quote to invoice"],
    permissionFlag: "update",
    match: verbNoun(
      "generate|convert|create",
      "invoice\\s+from\\s+quote|quote\\s+to\\s+invoice|invoices?\\s+from\\s+(?:a\\s+)?quotes?",
    ),
  },
  {
    workflowId: "close_quote",
    description: "Close a quote after identifying the record and confirming.",
    allowedTools: ["brc_close_quote"],
    actionVerbs: ["close"],
    businessNouns: ["quote"],
    permissionFlag: "update",
    match: verbNoun("close", "quotes?"),
  },
  {
    workflowId: "reopen_quote",
    description: "Reopen a quote after identifying the record and confirming.",
    allowedTools: ["brc_reopen_quote"],
    actionVerbs: ["reopen", "re-open"],
    businessNouns: ["quote"],
    permissionFlag: "update",
    match: verbNoun("reopen|re-open", "quotes?"),
  },

  // --- Create ---
  {
    workflowId: "create_customer",
    description:
      "Create a customer in the connected company. Ask for required details, then show a preview before posting.",
    allowedTools: ["brc_create_customer"],
    actionVerbs: ["add", "create", "set up", "setup", "new"],
    businessNouns: ["customer"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "customers?"),
  },
  {
    workflowId: "create_supplier",
    description:
      "Create a supplier in the connected company. Ask for required details, then show a preview before posting.",
    allowedTools: ["brc_create_supplier"],
    actionVerbs: ["add", "create", "set up", "setup", "new"],
    businessNouns: ["supplier"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "suppliers?"),
  },
  {
    workflowId: "create_product",
    description:
      "Create a product. Ask for required details, then show a preview before posting.",
    allowedTools: ["brc_create_product"],
    actionVerbs: ["add", "create", "new"],
    businessNouns: ["product"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "products?"),
  },
  {
    workflowId: "create_sales_rep",
    description:
      "Create a sales rep. Ask for required details, then show a preview before posting.",
    allowedTools: ["brc_create_sales_rep"],
    actionVerbs: ["add", "create", "new"],
    businessNouns: ["sales rep", "sales representative"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "sales\\s+reps?|sales\\s+representatives?"),
  },
  {
    workflowId: "create_sales_credit_note",
    description:
      "Create a sales credit note. Confirm customer and lines, then show a preview before posting.",
    allowedTools: [
      "brc_create_sales_credit_note",
      "brc_create_sales_credit_note_gen_ref",
    ],
    actionVerbs: ["create", "raise", "add", "prepare"],
    businessNouns: ["credit note", "sales credit note"],
    permissionFlag: "update",
    match: verbNoun(
      CREATE_VERBS,
      "sales\\s+credit\\s+notes?|credit\\s+notes?",
    ),
  },
  {
    workflowId: "create_sales_invoice",
    description:
      "Create a sales invoice. Confirm customer, lines, VAT and totals, then show a preview before posting.",
    allowedTools: [
      "brc_create_sales_invoice",
      "brc_create_sales_invoice_gen_ref",
    ],
    actionVerbs: ["create", "raise", "prepare", "add", "post"],
    businessNouns: ["sales invoice", "invoice"],
    permissionFlag: "update",
    match: verbNoun(POST_VERBS, "(?:sales\\s+)?invoices?"),
  },
  {
    workflowId: "create_sales_entry",
    description:
      "Create a sales entry. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_sales_entry"],
    actionVerbs: ["create", "add", "raise"],
    businessNouns: ["sales entry"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "sales\\s+entries|sales\\s+entry"),
  },
  {
    workflowId: "create_quote",
    description:
      "Create a quote. Confirm customer and lines, then show a preview before posting.",
    allowedTools: ["brc_create_quote", "brc_create_quote_gen_ref"],
    actionVerbs: ["create", "add", "raise", "prepare"],
    businessNouns: ["quote", "quotation"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "quotes?|quotations?"),
  },
  {
    workflowId: "create_purchase",
    description:
      "Create a purchase. Confirm supplier and lines, then show a preview before posting.",
    allowedTools: ["brc_create_purchase", "brc_create_purchase_gen_ref"],
    actionVerbs: ["create", "raise", "prepare", "add", "post"],
    businessNouns: ["purchase"],
    permissionFlag: "update",
    match: verbNoun(POST_VERBS, "purchases?"),
  },
  {
    workflowId: "create_bank_account",
    description:
      "Create a bank account. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_bank_account"],
    actionVerbs: ["create", "add", "new"],
    businessNouns: ["bank account"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "bank\\s+accounts?"),
  },
  {
    workflowId: "create_cash_payment",
    description:
      "Create a cash payment. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_cash_payment"],
    actionVerbs: ["create", "add", "record"],
    businessNouns: ["cash payment"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "cash\\s+payments?"),
  },
  {
    workflowId: "create_cash_receipt",
    description:
      "Create a cash receipt. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_cash_receipt"],
    actionVerbs: ["create", "add", "record"],
    businessNouns: ["cash receipt"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "cash\\s+receipts?"),
  },
  {
    workflowId: "create_payment",
    description:
      "Create a payment. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_payment"],
    actionVerbs: ["create", "add", "record"],
    businessNouns: ["payment"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "payments?"),
  },
  {
    workflowId: "create_accrual",
    description:
      "Create an accrual. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_accrual"],
    actionVerbs: ["create", "add", "record"],
    businessNouns: ["accrual"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "accruals?"),
  },
  {
    workflowId: "create_prepayment",
    description:
      "Create a prepayment. Confirm details, then show a preview before posting.",
    allowedTools: ["brc_create_prepayment"],
    actionVerbs: ["create", "add", "record"],
    businessNouns: ["prepayment"],
    permissionFlag: "update",
    match: verbNoun(CREATE_VERBS, "prepayments?"),
  },
  {
    workflowId: "create_nominal_journal_batch",
    description:
      "Create a nominal journal batch. Confirm lines, then show a preview before posting.",
    allowedTools: ["brc_create_nominal_journal_batch"],
    actionVerbs: ["create", "add", "post"],
    businessNouns: ["nominal journal", "journal batch", "journal"],
    permissionFlag: "update",
    match: verbNoun(
      CREATE_VERBS + "|post",
      "nominal\\s+journal(?:\\s+batch(?:es)?)?|journal\\s+batch(?:es)?|journals?",
    ),
  },
  {
    workflowId: "process_vat_category_rates",
    description:
      "Process VAT category rates after confirming the change and previewing.",
    allowedTools: ["brc_process_vat_category_rates"],
    actionVerbs: ["process", "update", "apply"],
    businessNouns: ["vat category", "vat rate"],
    permissionFlag: "update",
    match: verbNoun(
      "process|update|apply",
      "vat\\s+category\\s+rates?|vat\\s+rates?|vat\\s+categor(?:y|ies)",
    ),
  },

  // --- Update ---
  {
    workflowId: "update_customer",
    description:
      "Update a customer after confirming which record and fields to change, with preview before posting.",
    allowedTools: ["brc_update_customer"],
    actionVerbs: ["update", "change", "edit", "amend"],
    businessNouns: ["customer"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "customers?"),
  },
  {
    workflowId: "update_supplier",
    description:
      "Update a supplier after confirming which record and fields to change, with preview before posting.",
    allowedTools: ["brc_update_supplier"],
    actionVerbs: ["update", "change", "edit", "amend"],
    businessNouns: ["supplier"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "suppliers?"),
  },
  {
    workflowId: "update_product",
    description:
      "Update a product after confirming which record and fields to change.",
    allowedTools: ["brc_update_product"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["product"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "products?"),
  },
  {
    workflowId: "update_sales_rep",
    description: "Update a sales rep after confirming the record and fields.",
    allowedTools: ["brc_update_sales_rep"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["sales rep"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "sales\\s+reps?|sales\\s+representatives?"),
  },
  {
    workflowId: "update_sales_credit_note",
    description: "Update a sales credit note after confirming the record.",
    allowedTools: ["brc_update_sales_credit_note"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["credit note"],
    permissionFlag: "update",
    match: verbNoun(
      UPDATE_VERBS,
      "sales\\s+credit\\s+notes?|credit\\s+notes?",
    ),
  },
  {
    workflowId: "update_sales_invoice",
    description: "Update a sales invoice after confirming the record.",
    allowedTools: ["brc_update_sales_invoice"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["sales invoice", "invoice"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "(?:sales\\s+)?invoices?"),
  },
  {
    workflowId: "update_sales_entry",
    description: "Update a sales entry after confirming the record.",
    allowedTools: ["brc_update_sales_entry"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["sales entry"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "sales\\s+entries|sales\\s+entry"),
  },
  {
    workflowId: "update_quote",
    description:
      "Update a quote's manual reference after confirming the record. Does not update Quote notes.",
    allowedTools: ["brc_update_quote"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["quote"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "quotes?|quotations?"),
  },
  {
    workflowId: "update_purchase",
    description: "Update a purchase after confirming the record.",
    allowedTools: ["brc_update_purchase"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["purchase"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "purchases?"),
  },
  {
    workflowId: "update_bank_account",
    description: "Update a bank account after confirming the record.",
    allowedTools: ["brc_update_bank_account"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["bank account"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "bank\\s+accounts?"),
  },
  {
    workflowId: "update_cash_payment",
    description: "Update a cash payment after confirming the record.",
    allowedTools: ["brc_update_cash_payment"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["cash payment"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "cash\\s+payments?"),
  },
  {
    workflowId: "update_cash_receipt",
    description: "Update a cash receipt after confirming the record.",
    allowedTools: ["brc_update_cash_receipt"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["cash receipt"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "cash\\s+receipts?"),
  },
  {
    workflowId: "update_payment",
    description: "Update a payment after confirming the record.",
    allowedTools: ["brc_update_payment"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["payment"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "payments?"),
  },
  {
    workflowId: "update_accrual",
    description: "Update an accrual after confirming the record.",
    allowedTools: ["brc_update_accrual"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["accrual"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "accruals?"),
  },
  {
    workflowId: "update_prepayment",
    description: "Update a prepayment after confirming the record.",
    allowedTools: ["brc_update_prepayment"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["prepayment"],
    permissionFlag: "update",
    match: verbNoun(UPDATE_VERBS, "prepayments?"),
  },
  {
    workflowId: "update_allocations",
    description:
      "Update allocations after confirming the records and amounts.",
    allowedTools: ["brc_update_allocations"],
    actionVerbs: ["update", "change", "allocate"],
    businessNouns: ["allocation"],
    permissionFlag: "update",
    match: /\b(?:update|change|edit|amend|allocate)\b.{0,60}\ballocations?\b|\ballocations?\b.{0,60}\b(?:update|change|edit|amend|allocate)\b|\ballocate\b.{0,40}\b(?:payment|invoice|credit)\b/i,
  },
  {
    workflowId: "update_nominal_journal_batch",
    description: "Update a nominal journal batch after confirming the record.",
    allowedTools: ["brc_update_nominal_journal_batch"],
    actionVerbs: ["update", "change", "edit"],
    businessNouns: ["nominal journal", "journal batch"],
    permissionFlag: "update",
    match: verbNoun(
      UPDATE_VERBS,
      "nominal\\s+journal(?:\\s+batch(?:es)?)?|journal\\s+batch(?:es)?",
    ),
  },

  // --- Delete ---
  {
    workflowId: "delete_customer",
    description:
      "Delete a customer after identifying the record and obtaining explicit confirmation.",
    allowedTools: ["brc_delete_customer"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["customer"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "customers?"),
  },
  {
    workflowId: "delete_supplier",
    description:
      "Delete a supplier after identifying the record and obtaining explicit confirmation.",
    allowedTools: ["brc_delete_supplier"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["supplier"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "suppliers?"),
  },
  {
    workflowId: "delete_product",
    description:
      "Delete a product after identifying the record and obtaining explicit confirmation.",
    allowedTools: ["brc_delete_product"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["product"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "products?"),
  },
  {
    workflowId: "delete_sales_rep",
    description: "Delete a sales rep after identifying the record.",
    allowedTools: ["brc_delete_sales_rep"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["sales rep"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "sales\\s+reps?|sales\\s+representatives?"),
  },
  {
    workflowId: "delete_sales_credit_note",
    description: "Delete a sales credit note after identifying the record.",
    allowedTools: ["brc_delete_sales_credit_note"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["credit note"],
    permissionFlag: "delete",
    match: verbNoun(
      DELETE_VERBS,
      "sales\\s+credit\\s+notes?|credit\\s+notes?",
    ),
  },
  {
    workflowId: "delete_sales_invoice",
    description:
      "Delete a sales invoice after identifying the record and obtaining explicit confirmation.",
    allowedTools: ["brc_delete_sales_invoice"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["sales invoice", "invoice"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "(?:sales\\s+)?invoices?"),
  },
  {
    workflowId: "delete_sales_entry",
    description: "Delete a sales entry after identifying the record.",
    allowedTools: ["brc_delete_sales_entry"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["sales entry"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "sales\\s+entries|sales\\s+entry"),
  },
  {
    workflowId: "delete_quote",
    description: "Delete a quote after identifying the record.",
    allowedTools: ["brc_delete_quote"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["quote"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "quotes?|quotations?"),
  },
  {
    workflowId: "delete_purchase",
    description: "Delete a purchase after identifying the record.",
    allowedTools: ["brc_delete_purchase"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["purchase"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "purchases?"),
  },
  {
    workflowId: "delete_bank_account",
    description: "Delete a bank account after identifying the record.",
    allowedTools: ["brc_delete_bank_account"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["bank account"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "bank\\s+accounts?"),
  },
  {
    workflowId: "delete_cash_payment",
    description: "Delete a cash payment after identifying the record.",
    allowedTools: ["brc_delete_cash_payment"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["cash payment"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "cash\\s+payments?"),
  },
  {
    workflowId: "delete_cash_receipt",
    description: "Delete a cash receipt after identifying the record.",
    allowedTools: ["brc_delete_cash_receipt"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["cash receipt"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "cash\\s+receipts?"),
  },
  {
    workflowId: "delete_payment",
    description: "Delete a payment after identifying the record.",
    allowedTools: ["brc_delete_payment"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["payment"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "payments?"),
  },
  {
    workflowId: "delete_accrual",
    description: "Delete an accrual after identifying the record.",
    allowedTools: ["brc_delete_accrual"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["accrual"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "accruals?"),
  },
  {
    workflowId: "delete_prepayment",
    description: "Delete a prepayment after identifying the record.",
    allowedTools: ["brc_delete_prepayment"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["prepayment"],
    permissionFlag: "delete",
    match: verbNoun(DELETE_VERBS, "prepayments?"),
  },
  {
    workflowId: "delete_allocation_resolver",
    description: "Delete an allocation resolver after identifying the record.",
    allowedTools: ["brc_delete_allocation_resolver"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["allocation resolver", "allocation"],
    permissionFlag: "delete",
    match: verbNoun(
      DELETE_VERBS,
      "allocation\\s+resolvers?|allocations?",
      80,
    ),
  },
  {
    workflowId: "delete_nominal_journal_batch",
    description: "Delete a nominal journal batch after identifying the record.",
    allowedTools: ["brc_delete_nominal_journal_batch"],
    actionVerbs: ["delete", "remove"],
    businessNouns: ["nominal journal", "journal batch"],
    permissionFlag: "delete",
    match: verbNoun(
      DELETE_VERBS,
      "nominal\\s+journal(?:\\s+batch(?:es)?)?|journal\\s+batch(?:es)?",
    ),
  },

  // --- Batch ---
  {
    workflowId: "batch_customers",
    description: "Batch-create or update customers with preview before posting.",
    allowedTools: ["brc_batch_customers"],
    actionVerbs: ["batch", "bulk", "import"],
    businessNouns: ["customer"],
    permissionFlag: "batch",
    match: batchNounMatch("customers?"),
  },
  {
    workflowId: "batch_suppliers",
    description: "Batch-create or update suppliers with preview before posting.",
    allowedTools: ["brc_batch_suppliers"],
    actionVerbs: ["batch", "bulk", "import"],
    businessNouns: ["supplier"],
    permissionFlag: "batch",
    match: batchNounMatch("suppliers?"),
  },
  {
    workflowId: "batch_products",
    description: "Batch-create or update products with preview before posting.",
    allowedTools: ["brc_batch_products"],
    actionVerbs: ["batch", "bulk", "import"],
    businessNouns: ["product"],
    permissionFlag: "batch",
    match: batchNounMatch("products?"),
  },
  {
    workflowId: "batch_sales_reps",
    description: "Batch sales reps with preview before posting.",
    allowedTools: ["brc_batch_sales_reps"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["sales rep"],
    permissionFlag: "batch",
    match: batchNounMatch("sales\\s+reps?"),
  },
  {
    workflowId: "batch_sales_credit_notes",
    description: "Batch sales credit notes with preview before posting.",
    allowedTools: ["brc_batch_sales_credit_notes"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["credit note"],
    permissionFlag: "batch",
    match: batchNounMatch("sales\\s+credit\\s+notes?|credit\\s+notes?"),
  },
  {
    workflowId: "batch_sales_invoices",
    description: "Batch sales invoices with preview before posting.",
    allowedTools: ["brc_batch_sales_invoices"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["sales invoice", "invoice"],
    permissionFlag: "batch",
    match: batchNounMatch("(?:sales\\s+)?invoices?"),
  },
  {
    workflowId: "batch_sales_entries",
    description: "Batch sales entries with preview before posting.",
    allowedTools: ["brc_batch_sales_entries"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["sales entry"],
    permissionFlag: "batch",
    match: batchNounMatch("sales\\s+entries|sales\\s+entry"),
  },
  {
    workflowId: "batch_quotes",
    description: "Batch quotes with preview before posting.",
    allowedTools: ["brc_batch_quotes"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["quote"],
    permissionFlag: "batch",
    match: batchNounMatch("quotes?"),
  },
  {
    workflowId: "batch_purchases",
    description: "Batch purchases with preview before posting.",
    allowedTools: ["brc_batch_purchases"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["purchase"],
    permissionFlag: "batch",
    match: batchNounMatch("purchases?"),
  },
  {
    workflowId: "batch_cash_receipts",
    description: "Batch cash receipts with preview before posting.",
    allowedTools: ["brc_batch_cash_receipts"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["cash receipt"],
    permissionFlag: "batch",
    match: batchNounMatch("cash\\s+receipts?"),
  },
  {
    workflowId: "batch_cash_payments",
    description: "Batch cash payments with preview before posting.",
    allowedTools: ["brc_batch_cash_payments"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["cash payment"],
    permissionFlag: "batch",
    match: batchNounMatch("cash\\s+payments?"),
  },
  {
    workflowId: "batch_payments",
    description: "Batch payments with preview before posting.",
    allowedTools: ["brc_batch_payments"],
    actionVerbs: ["batch", "bulk"],
    businessNouns: ["payment"],
    permissionFlag: "batch",
    match: batchNounMatch("payments?"),
  },

  // --- Email ---
  {
    workflowId: "send_sales_invoice_email",
    description: "Email a sales invoice after confirming recipients and content.",
    allowedTools: ["brc_send_sales_invoice_email"],
    actionVerbs: ["email", "send", "mail"],
    businessNouns: ["sales invoice", "invoice"],
    permissionFlag: "email",
    match: verbNoun(EMAIL_VERBS, "(?:sales\\s+)?invoices?"),
  },
  {
    workflowId: "send_quote_email",
    description: "Email a quote after confirming recipients and content.",
    allowedTools: ["brc_send_quote_email"],
    actionVerbs: ["email", "send", "mail"],
    businessNouns: ["quote"],
    permissionFlag: "email",
    match: verbNoun(EMAIL_VERBS, "quotes?|quotations?"),
  },
  {
    workflowId: "send_email_statement",
    description: "Email a customer statement after confirming recipients.",
    allowedTools: ["brc_send_email_statement"],
    actionVerbs: ["email", "send", "mail"],
    businessNouns: ["statement"],
    permissionFlag: "email",
    match: verbNoun(EMAIL_VERBS, "statements?"),
  },
];

const TRANSACTIONAL_GROUPS = new Set<RedSkillGroup>([
  "update",
  "delete",
  "batch",
  "email",
]);

export function listActionWorkflows(): readonly ActionWorkflowDefinition[] {
  return ACTION_WORKFLOW_REGISTRY;
}

export function getWorkflowById(
  workflowId: string,
): ActionWorkflowDefinition | undefined {
  const id = workflowId.trim();
  return ACTION_WORKFLOW_REGISTRY.find((entry) => entry.workflowId === id);
}

export function getWorkflowForTool(
  toolName: string,
): ActionWorkflowDefinition | undefined {
  const name = toolName.trim();
  return ACTION_WORKFLOW_REGISTRY.find((entry) =>
    entry.allowedTools.includes(name),
  );
}

export function isTransactionalToolName(toolName: string): boolean {
  return TRANSACTIONAL_GROUPS.has(getToolSkillGroup(toolName));
}

/** Tools currently enabled that require a routeToken. */
export function listEnabledTransactionalTools(): string[] {
  const tools = new Set<string>();
  for (const entry of ACTION_WORKFLOW_REGISTRY) {
    for (const tool of entry.allowedTools) {
      if (isToolEnabled(tool) && isTransactionalToolName(tool)) {
        tools.add(tool);
      }
    }
  }
  return [...tools].sort();
}

/**
 * Enabled tools for a workflow (permission flags applied).
 * Returns empty when the skill group is disabled.
 */
export function enabledToolsForWorkflow(
  definition: ActionWorkflowDefinition,
): string[] {
  return definition.allowedTools.filter(
    (tool) => isToolEnabled(tool) && isTransactionalToolName(tool),
  );
}

export function toActionWorkflow(
  definition: ActionWorkflowDefinition,
  allowedTools?: string[],
): ActionWorkflow {
  const tools = allowedTools ?? [...definition.allowedTools];
  return {
    name: definition.workflowId,
    description: definition.description,
    preferredTools: tools,
    requiresPreviewConfirmation: true,
  };
}

/**
 * Resolve a workflow from a user message. Returns null when no registry entry
 * matches. Callers must still filter by enabled tools before issuing a token.
 */
function detectPrimaryAction(
  text: string,
): {
  action: "create" | "update" | "delete" | "batch" | "email";
  index: number;
} | null {
  const regex =
    /\b(add|create|set\s+up|setup|new|raise|prepare|record|post|update|change|edit|amend|modify|correct|delete|remove|erase|batch|bulk|import|email|send|mail)\b/i;

  const match = regex.exec(text);

  if (!match) {
    return null;
  }

  const verb = match[1].toLowerCase();

  let action:
    | "create"
    | "update"
    | "delete"
    | "batch"
    | "email";

  if (/^(update|change|edit|amend|modify|correct)$/.test(verb)) {
    action = "update";
  } else if (/^(delete|remove|erase)$/.test(verb)) {
    action = "delete";
  } else if (/^(batch|bulk|import)$/.test(verb)) {
    action = "batch";
  } else if (/^(email|send|mail)$/.test(verb)) {
    action = "email";
  } else {
    action = "create";
  }

  return {
    action,
    index: match.index,
  };
}

function earliestBusinessNounIndex(
  text: string,
  workflow: ActionWorkflowDefinition,
  afterIndex: number,
): number {
  const lower = text.toLowerCase();

  const indexes = workflow.businessNouns
    .map((noun) =>
      lower.indexOf(
        noun.toLowerCase(),
        afterIndex
      )
    )
    .filter((index) => index >= 0);

  return indexes.length > 0
    ? Math.min(...indexes)
    : Number.MAX_SAFE_INTEGER;
}

export function resolveWorkflowFromMessage(
  cleanedQuery: string,
): ActionWorkflowDefinition | null {
  const text = cleanedQuery.trim();

  if (!text) {
    return null;
  }

  const matches = ACTION_WORKFLOW_REGISTRY.filter((entry) =>
    entry.match.test(text),
  );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  // Explicit tool-name mention (e.g. "Use brc_batch_cash_payments") wins.
  const toolMention = matches.find((entry) =>
    entry.allowedTools.some((tool) =>
      new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        text,
      ),
    ),
  );
  if (toolMention) {
    return toolMention;
  }

  // Explicit batch intent wins over an earlier create verb such as "prepare".
  if (hasExplicitBatchIntent(text)) {
    const batchMatches = matches.filter((entry) =>
      entry.workflowId.startsWith("batch_"),
    );
    if (batchMatches.length === 1) {
      return batchMatches[0];
    }
    if (batchMatches.length > 1) {
      const primary = detectPrimaryAction(text);
      const afterIndex = primary?.index ?? 0;
      batchMatches.sort(
        (a, b) =>
          earliestBusinessNounIndex(text, a, afterIndex) -
          earliestBusinessNounIndex(text, b, afterIndex),
      );
      return batchMatches[0];
    }
  }

  const primary = detectPrimaryAction(text);

  if (!primary) {
    return matches[0];
  }

  const sameAction = matches.filter((entry) =>
    entry.workflowId.startsWith(`${primary.action}_`),
  );

  if (sameAction.length === 0) {
    return matches[0];
  }

  sameAction.sort(
    (a, b) =>
      earliestBusinessNounIndex(text, a, primary.index) -
      earliestBusinessNounIndex(text, b, primary.index),
  );

  return sameAction[0];
}

/**
 * Resolve an enabled action workflow (legacy ActionWorkflow shape).
 * Returns null when unmatched or all mapped tools are disabled.
 */
export function resolveActionWorkflow(
  cleanedQuery: string,
): ActionWorkflow | null {
  const definition = resolveWorkflowFromMessage(cleanedQuery);
  if (!definition) {
    return null;
  }
  const tools = enabledToolsForWorkflow(definition);
  if (tools.length === 0) {
    return null;
  }
  return toActionWorkflow(definition, tools);
}

/** Representative sample utterance per workflow (for table-driven tests). */
export function sampleUtteranceForWorkflow(
  definition: ActionWorkflowDefinition,
): string {
  const verb = definition.actionVerbs[0] ?? "create";
  const noun = definition.businessNouns[0] ?? "record";
  return `${verb} ${noun}`;
}
