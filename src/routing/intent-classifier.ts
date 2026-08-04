/**
 * Central request intent classifier for Red.
 *
 * Two main behaviours:
 * - action — Red should perform the accounting workflow
 * - help — manual Big Red Cloud instructions via the unified help pipeline
 *
 * Also returns connection / read / unknown for specialised routing.
 *
 * Deterministic how-to phrase detection runs before action-verb matching so
 * words like "add" / "create" never force action mode on how-to questions.
 *
 * Classification is stateless: each message is classified independently.
 * detectHelpMode / this classifier cannot force MCP clients to call a tool —
 * clients still select tools from metadata and server instructions.
 */

import {
  detectRedHelpCommand,
  isHowToHelpPhrase,
  isRedHelpCompanyConnectionQuery,
  HELP_MODE_PREFERRED_TOOLS,
} from "../brc-edu/help/help-mode.js";

export type RequestRouteMode =
  | "action"
  | "help"
  | "connection"
  | "read"
  | "unknown";

export type IntentClassification = {
  mode: RequestRouteMode;
  cleanedQuery: string;
  originalMessage: string;
  /** Deterministic reason label for tests and diagnostics. */
  reason: string;
  blockTransactionalTools: boolean;
  preferredTools: readonly string[];
  allowCompanyConnectionTool: boolean;
};

const CONNECTION_PATTERNS: RegExp[] = [
  /^\s*(?:please\s+)?(?:connect|reconnect)\b.{0,60}\bcompan(?:y|ies)\b/i,
  /^\s*(?:please\s+)?(?:connect|reconnect)\s+(?:my|a|the)\s+compan(?:y|ies)\b/i,
  /\b(?:start|open)\s+(?:a\s+)?(?:secure\s+)?(?:red\s+)?connection\b/i,
  /\bconnect(?:ion)?\s+(?:link|page)\b/i,
];

const READ_PATTERNS: RegExp[] = [
  /^\s*(?:please\s+)?(?:list|show|get|find|fetch|lookup|look\s+up)\b.{0,40}\b(?:customers?|suppliers?|invoices?|quotes?|balances?|transactions?|payments?|receipts?|reports?|bank\s+accounts?)\b/i,
  /^\s*(?:what(?:'s| is)|show\s+me)\b.{0,40}\b(?:balance|turnover|aged\s+debt|outstanding)\b/i,
  /^\s*(?:run|show|get)\b.{0,20}\b(?:report|vat\s+return|trial\s+balance|nominal)\b/i,
];

/** Explicit perform-action wording (checked only after how-to / connection / read). */
const ACTION_PATTERNS: RegExp[] = [
  /^\s*(?:please\s+)?(?:can\s+you|could\s+you|would\s+you)\s+(?:please\s+)?(?:add|create|post|update|delete|send|raise|prepare|record)\b/i,
  /^\s*(?:please\s+)?(?:add|create|post|update|delete|send|raise|prepare|record)\b/i,
  /^\s*(?:please\s+)?(?:help\s+me\s+)?(?:add|create|post|update|delete)\b/i,
  /\b(?:post|update|delete)\s+this\b/i,
];

export type ActionWorkflow = {
  name: string;
  description: string;
  preferredTools: string[];
  requiresPreviewConfirmation: true;
};

const ACTION_WORKFLOWS: Array<{
  match: RegExp;
  workflow: ActionWorkflow;
}> = [
  {
    match:
      /\b(?:add|create|set\s+up|setup|new)\b.{0,40}\bcustomers?\b|\bcustomers?\b.{0,40}\b(?:add|create)\b/i,
    workflow: {
      name: "create_customer",
      description:
        "Create a customer in the connected company. Ask for required details, then show a preview before posting.",
      preferredTools: ["brc_create_customer"],
      requiresPreviewConfirmation: true,
    },
  },
  {
    match:
      /\b(?:add|create|set\s+up|setup|new)\b.{0,40}\bsuppliers?\b|\bsuppliers?\b.{0,40}\b(?:add|create)\b/i,
    workflow: {
      name: "create_supplier",
      description:
        "Create a supplier in the connected company. Ask for required details, then show a preview before posting.",
      preferredTools: ["brc_create_supplier"],
      requiresPreviewConfirmation: true,
    },
  },
  {
    match:
      /\b(?:create|raise|prepare|add|post)\b.{0,40}\b(?:sales\s+)?invoices?\b|\b(?:sales\s+)?invoices?\b.{0,40}\b(?:create|raise|prepare|add|post)\b/i,
    workflow: {
      name: "create_sales_invoice",
      description:
        "Create a sales invoice. Confirm customer, lines, VAT and totals, then show a preview before posting.",
      preferredTools: [
        "brc_create_sales_invoice",
        "brc_create_sales_invoice_gen_ref",
      ],
      requiresPreviewConfirmation: true,
    },
  },
  {
    match:
      /\b(?:create|raise|prepare|add|post)\b.{0,40}\bpurchases?\b|\bpurchases?\b.{0,40}\b(?:create|raise|prepare|add|post)\b/i,
    workflow: {
      name: "create_purchase",
      description:
        "Create a purchase. Confirm supplier and lines, then show a preview before posting.",
      preferredTools: ["brc_create_purchase"],
      requiresPreviewConfirmation: true,
    },
  },
  {
    match: /\bdelete\b.{0,40}\binvoices?\b|\binvoices?\b.{0,40}\bdelete\b/i,
    workflow: {
      name: "delete_invoice",
      description:
        "Delete an invoice after identifying the record and obtaining explicit confirmation.",
      preferredTools: ["brc_delete_sales_invoice"],
      requiresPreviewConfirmation: true,
    },
  },
  {
    match:
      /\bupdate\b.{0,40}\bsuppliers?\b|\bsuppliers?\b.{0,40}\bupdate\b/i,
    workflow: {
      name: "update_supplier",
      description:
        "Update a supplier after confirming which record and fields to change, with preview before posting.",
      preferredTools: ["brc_update_supplier"],
      requiresPreviewConfirmation: true,
    },
  },
];

export function resolveActionWorkflow(
  cleanedQuery: string,
): ActionWorkflow | null {
  const text = cleanedQuery.trim();
  if (!text) {
    return null;
  }
  for (const entry of ACTION_WORKFLOWS) {
    if (entry.match.test(text)) {
      return entry.workflow;
    }
  }
  return null;
}

function isConnectionIntent(message: string): boolean {
  // How-to connect questions are classified as help first.
  // Bare "connect my companies" lands here as connection mode.
  return CONNECTION_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function isReadIntent(message: string): boolean {
  return READ_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function isActionIntent(message: string): boolean {
  const trimmed = message.trim();
  if (ACTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  // Topic + action verb without leading please/can you (e.g. "add a customer")
  return resolveActionWorkflow(trimmed) !== null;
}

/**
 * Classify a single user message. Stateless — does not remember prior modes.
 */
export function classifyRequestIntent(
  userMessage: string,
): IntentClassification {
  const originalMessage = typeof userMessage === "string" ? userMessage : "";
  const trimmed = originalMessage.replace(/^\s+/, "").trim();

  if (!trimmed) {
    return {
      mode: "unknown",
      cleanedQuery: "",
      originalMessage,
      reason: "empty_message",
      blockTransactionalTools: false,
      preferredTools: [],
      allowCompanyConnectionTool: false,
    };
  }

  const redHelp = detectRedHelpCommand(trimmed);
  if (redHelp.isHelpMode) {
    const cleanedQuery = redHelp.cleanedQuery || trimmed;
    const allowCompanyConnectionTool =
      isRedHelpCompanyConnectionQuery(cleanedQuery);
    return {
      mode: "help",
      cleanedQuery,
      originalMessage: trimmed,
      reason: "red_help_command",
      blockTransactionalTools: true,
      preferredTools: HELP_MODE_PREFERRED_TOOLS,
      allowCompanyConnectionTool,
    };
  }

  if (isHowToHelpPhrase(trimmed)) {
    return {
      mode: "help",
      cleanedQuery: trimmed,
      originalMessage: trimmed,
      reason: "how_to_phrase",
      blockTransactionalTools: true,
      preferredTools: HELP_MODE_PREFERRED_TOOLS,
      allowCompanyConnectionTool: false,
    };
  }

  if (isConnectionIntent(trimmed)) {
    return {
      mode: "connection",
      cleanedQuery: trimmed,
      originalMessage: trimmed,
      reason: "connection_request",
      blockTransactionalTools: true,
      preferredTools: [
        "brc_start_company_connection",
        "brc_confirm_company_connection",
      ],
      allowCompanyConnectionTool: true,
    };
  }

  if (isReadIntent(trimmed)) {
    return {
      mode: "read",
      cleanedQuery: trimmed,
      originalMessage: trimmed,
      reason: "read_lookup",
      blockTransactionalTools: true,
      preferredTools: [],
      allowCompanyConnectionTool: false,
    };
  }

  if (isActionIntent(trimmed)) {
    const workflow = resolveActionWorkflow(trimmed);
    return {
      mode: "action",
      cleanedQuery: trimmed,
      originalMessage: trimmed,
      reason: "action_request",
      blockTransactionalTools: false,
      preferredTools: workflow?.preferredTools ?? [],
      allowCompanyConnectionTool: false,
    };
  }

  return {
    mode: "unknown",
    cleanedQuery: trimmed,
    originalMessage: trimmed,
    reason: "unclassified",
    blockTransactionalTools: false,
    preferredTools: [],
    allowCompanyConnectionTool: false,
  };
}
