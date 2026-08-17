/**
 * Central request intent classifier for Red.
 *
 * Two main behaviours:
 * - action — Red should perform the accounting workflow
 * - help — manual Big Red Cloud instructions via the unified help pipeline
 *
 * Also returns connection / read / correction / unsupported_action / unknown.
 *
 * Deterministic how-to phrase detection runs before action-verb matching so
 * words like "add" / "create" never force action mode on how-to questions.
 *
 * Workflow matching comes from action-workflow-registry (single source of truth).
 * Incomplete action responses (mode=action with empty preferredTools) are not
 * produced here — unmatched action verbs become unsupported_action.
 */

import {
  detectRedHelpCommand,
  isHowToHelpPhrase,
  isRedHelpCompanyConnectionQuery,
  HELP_MODE_PREFERRED_TOOLS,
} from "../brc-edu/help/help-mode.js";
import {
  resolveActionWorkflow,
  resolveWorkflowFromMessage,
  type ActionWorkflow,
} from "./action-workflow-registry.js";
import { isCorrectionIntent } from "./correction-intent.js";

export type RequestRouteMode =
  | "action"
  | "help"
  | "connection"
  | "read"
  | "correction"
  | "unsupported_action"
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
  /** Set when an action workflow matched (enabled tools). */
  workflow?: ActionWorkflow;
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
  /^\s*(?:please\s+)?(?:can\s+you|could\s+you|would\s+you)\s+(?:please\s+)?(?:add|create|post|update|change|edit|correct|delete|remove|send|email|raise|prepare|record|batch|bulk|import|allocate|process|close|reopen)\b/i,
  /^\s*(?:please\s+)?(?:add|create|post|update|change|edit|correct|delete|remove|send|email|raise|prepare|record|batch|bulk|import|allocate|process|close|reopen)\b/i,
  /^\s*(?:please\s+)?(?:help\s+me\s+)?(?:add|create|post|update|change|correct|delete|remove)\b/i,
  /\b(?:post|update|change|correct|delete|remove)\s+this\b/i,
];

export type { ActionWorkflow };

/** Re-export registry resolver for call sites that imported from this module. */
export { resolveActionWorkflow } from "./action-workflow-registry.js";

function isConnectionIntent(message: string): boolean {
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
  return resolveWorkflowFromMessage(trimmed) !== null;
}

/**
 * Classify a single user message. Stateless — does not remember prior modes.
 * Confirmation continuation is handled in routeRequest, not here.
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

  if (isCorrectionIntent(trimmed)) {
    return {
      mode: "correction",
      cleanedQuery: trimmed,
      originalMessage: trimmed,
      reason: "correction_request",
      blockTransactionalTools: true,
      preferredTools: ["brc_list_audit_log"],
      allowCompanyConnectionTool: false,
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
    if (workflow && workflow.preferredTools.length > 0) {
      return {
        mode: "action",
        cleanedQuery: trimmed,
        originalMessage: trimmed,
        reason: "action_request",
        blockTransactionalTools: false,
        preferredTools: workflow.preferredTools,
        allowCompanyConnectionTool: false,
        workflow,
      };
    }

    // Action verb / noun detected but no enabled workflow mapping.
    return {
      mode: "unsupported_action",
      cleanedQuery: trimmed,
      originalMessage: trimmed,
      reason: "unsupported_action",
      blockTransactionalTools: true,
      preferredTools: [],
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
