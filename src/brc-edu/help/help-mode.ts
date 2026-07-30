/**
 * Explicit help-mode detection for customer messages that begin with a
 * recognised help/manual prefix. Help mode means: search Red help content and
 * return manual instructions — do not perform the accounting action.
 */

export type HelpModeDetection = {
  isHelpMode: boolean;
  cleanedQuery: string;
};

export type HelpModeToolPolicy = HelpModeDetection & {
  /** When true, create/update/delete/email/batch tools must not be auto-selected. */
  blockTransactionalTools: boolean;
  preferredHelpTools: readonly string[];
};

/**
 * Longer prefixes first so "help me" wins over "help", etc.
 * Applied only at the start of the message (after optional leading whitespace).
 */
const HELP_MODE_PREFIX_PATTERNS: RegExp[] = [
  /^\s*tell\s+me\s+how\s+to\s+do\s+this\s+manually\s*[:\-–—,]?\s*/i,
  /^\s*manual\s+help\s*[:\-–—,]?\s*/i,
  /^\s*show\s+me\s+how(?:\s+to)?\s*/i,
  /^\s*help\s+me\s*[:\-–—,]?\s*/i,
  /^\s*how\s+do\s+/i,
  // "help", "help,", "help:" — require boundary so "helpfulness" does not match.
  /^\s*help(?=\s*[:\-–—,]|\s+|$)\s*[:\-–—,]?\s*/i,
];

export const HELP_MODE_PREFERRED_TOOLS = [
  "brc_find_help_resources",
  "brc_get_help_resource_details",
] as const;

/**
 * Detect whether a user message is an explicit help-mode request and strip the
 * recognised command prefix from the searchable query.
 */
export function detectHelpMode(userMessage: string): HelpModeDetection {
  const original = typeof userMessage === "string" ? userMessage : "";
  const trimmedStart = original.replace(/^\s+/, "");

  if (!trimmedStart) {
    return { isHelpMode: false, cleanedQuery: "" };
  }

  for (const pattern of HELP_MODE_PREFIX_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(trimmedStart);
    if (!match || match.index !== 0) {
      continue;
    }

    const cleanedQuery = trimmedStart.slice(match[0].length).trim();
    return {
      isHelpMode: true,
      cleanedQuery,
    };
  }

  return {
    isHelpMode: false,
    cleanedQuery: trimmedStart.trim(),
  };
}

/**
 * Query to pass into help search / details. Uses the cleaned help-mode query
 * when a prefix was present; otherwise the trimmed original message.
 */
export function resolveHelpSearchQuery(userMessage: string): {
  isHelpMode: boolean;
  searchQuery: string;
  cleanedQuery: string;
  originalMessage: string;
} {
  const originalMessage = typeof userMessage === "string" ? userMessage : "";
  const detection = detectHelpMode(originalMessage);
  const fallback = originalMessage.trim();
  const searchQuery =
    detection.cleanedQuery.trim() ||
    (detection.isHelpMode ? fallback : detection.cleanedQuery || fallback);

  return {
    isHelpMode: detection.isHelpMode,
    searchQuery: searchQuery.trim(),
    cleanedQuery: detection.cleanedQuery,
    originalMessage,
  };
}

/**
 * Tool-selection policy for help-mode messages.
 * Callers (and MCP instructions) must not auto-invoke transactional tools.
 */
export function resolveHelpModeToolPolicy(
  userMessage: string,
): HelpModeToolPolicy {
  const detection = detectHelpMode(userMessage);
  return {
    ...detection,
    blockTransactionalTools: detection.isHelpMode,
    preferredHelpTools: detection.isHelpMode ? HELP_MODE_PREFERRED_TOOLS : [],
  };
}

export const HELP_MODE_INSTRUCTION_SUMMARY =
  "When a message is in help mode (it begins with help, help,, help:, help me, manual help, show me how, how do, or tell me how to do this manually), answer the user's how-to question using Red's customer-help resources. Do not interpret it as permission to perform the accounting action. Call brc_find_help_resources with the cleaned question (prefix removed), then brc_get_help_resource_details for the best Freshdesk match. Do not ask for customer details first. Do not call create, update, delete, email, or batch tools unless the user later explicitly asks Red to perform the action. Put manual guidance and Sources before any optional Do this through Red offer.";
