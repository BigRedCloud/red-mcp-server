/**
 * Reserved red-help command detection.
 * Only messages that begin with red-help / red-help: / red-help, / /red-help
 * enter manual-help mode. Ordinary "help me" / "how do I" wording stays normal mode.
 */

export type HelpModeDetection = {
  isHelpMode: boolean;
  cleanedQuery: string;
};

export type HelpModeToolPolicy = HelpModeDetection & {
  /** When true, create/update/delete/email/batch tools must not be auto-selected. */
  blockTransactionalTools: boolean;
  /**
   * Connection tooling remains available in red-help mode only when the cleaned
   * query is specifically about connecting companies.
   */
  allowCompanyConnectionTool: boolean;
  preferredHelpTools: readonly string[];
};

/**
 * Reserved command at message start (optional leading slash), then optional
 * colon/comma/whitespace before the rest of the query.
 * Does not match mid-sentence uses such as "I need red-help documentation".
 */
const RED_HELP_COMMAND_PATTERN =
  /^\s*\/?red-help(?=\s*[:\-–—,]|\s+|$)\s*[:\-–—,]?\s*/i;

const COMPANY_CONNECTION_QUERY_PATTERN =
  /\b(?:connect(?:ing|ed)?|reconnect(?:ing|ed)?|connection\s+link|secure\s+(?:red\s+)?connection)\b.{0,40}\bcompan(?:y|ies)\b|\bcompan(?:y|ies)\b.{0,40}\b(?:connect(?:ing|ed)?|reconnect(?:ing|ed)?)\b/i;

export const HELP_MODE_PREFERRED_TOOLS = [
  "brc_red_help",
  "brc_find_help_resources",
  "brc_get_help_resource_details",
] as const;

export const RED_HELP_COMMAND = "red-help";

/**
 * Detect whether a user message begins with the reserved red-help command and
 * strip that command from the searchable query.
 */
export function detectHelpMode(userMessage: string): HelpModeDetection {
  const original = typeof userMessage === "string" ? userMessage : "";
  const trimmedStart = original.replace(/^\s+/, "");

  if (!trimmedStart) {
    return { isHelpMode: false, cleanedQuery: "" };
  }

  RED_HELP_COMMAND_PATTERN.lastIndex = 0;
  const match = RED_HELP_COMMAND_PATTERN.exec(trimmedStart);
  if (!match || match.index !== 0) {
    return {
      isHelpMode: false,
      cleanedQuery: trimmedStart.trim(),
    };
  }

  return {
    isHelpMode: true,
    cleanedQuery: trimmedStart.slice(match[0].length).trim(),
  };
}

/** True when a red-help cleaned query is specifically about connecting companies. */
export function isRedHelpCompanyConnectionQuery(cleanedQuery: string): boolean {
  return COMPANY_CONNECTION_QUERY_PATTERN.test(cleanedQuery.trim());
}

/**
 * Query to pass into help search / details. Uses the cleaned red-help query
 * when the reserved command was present; otherwise the trimmed original message.
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
 * Tool-selection policy for red-help messages.
 * Callers (and MCP instructions) must not auto-invoke transactional tools.
 */
export function resolveHelpModeToolPolicy(
  userMessage: string,
): HelpModeToolPolicy {
  const detection = detectHelpMode(userMessage);
  const allowCompanyConnectionTool =
    detection.isHelpMode &&
    isRedHelpCompanyConnectionQuery(detection.cleanedQuery);

  return {
    ...detection,
    blockTransactionalTools: detection.isHelpMode,
    allowCompanyConnectionTool,
    preferredHelpTools: detection.isHelpMode ? HELP_MODE_PREFERRED_TOOLS : [],
  };
}

export const HELP_MODE_INSTRUCTION_SUMMARY =
  "red-help is Red's reserved manual-help command. When a user begins a message with red-help, provide customer-help resources and manual instructions instead of performing the accounting action. Call brc_red_help with the text after red-help as query (preferred), or brc_find_help_resources for compatibility, then brc_get_help_resource_details for the best Freshdesk match. Do not ask for customer details first. Do not call create, update, delete, email, or batch tools unless the user later explicitly asks Red to perform the action. Put manual guidance and Sources before any optional Do this through Red offer. Use brc_start_company_connection only when the cleaned red-help query is specifically about connecting companies. MCP clients remain responsible for selecting the initial tool — detectHelpMode alone cannot force tool selection.";
