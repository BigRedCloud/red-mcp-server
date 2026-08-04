/**
 * Manual-help intent detection for Red.
 *
 * Help mode covers:
 * - reserved red-help / /red-help commands
 * - how-to wording (how do I, show me how, what are the steps, …)
 *
 * Explicit action wording ("add a customer", "can you add a customer for me")
 * stays outside help mode so Red can run transactional workflows.
 *
 * Classification is per-message and does not persist. MCP clients still select
 * the initial tool from metadata and instructions — these helpers alone cannot
 * force tool discovery.
 */
/**
 * Reserved command at message start (optional leading slash), then optional
 * colon/comma/whitespace before the rest of the query.
 * Does not match mid-sentence uses such as "I need red-help documentation".
 */
const RED_HELP_COMMAND_PATTERN = /^\s*\/?red-help(?=\s*[:\-–—,]|\s+|$)\s*[:\-–—,]?\s*/i;
/**
 * Deterministic how-to / manual-instruction phrases.
 * Checked before action verbs so "add"/"create" inside a how-to stay help mode.
 */
const HOW_TO_HELP_PATTERNS = [
    /\bhow\s+do\s+i\b/i,
    /\bhow\s+can\s+i\b/i,
    /\bhow\s+to\b/i,
    /\bshow\s+me\s+how\b/i,
    /\btell\s+me\s+how\b/i,
    /\bwhere\s+do\s+i\b/i,
    /\bwhat\s+are\s+the\s+steps(?:\s+to)?\b/i,
    /\bmanual\s+steps\s+for\b/i,
    /\bcan\s+you\s+show\s+me\s+how\b/i,
    /\bcould\s+you\s+show\s+me\s+how\b/i,
];
const COMPANY_CONNECTION_QUERY_PATTERN = /\b(?:connect(?:ing|ed)?|reconnect(?:ing|ed)?|connection\s+link|secure\s+(?:red\s+)?connection)\b.{0,40}\bcompan(?:y|ies)\b|\bcompan(?:y|ies)\b.{0,40}\b(?:connect(?:ing|ed)?|reconnect(?:ing|ed)?)\b/i;
export const HELP_MODE_PREFERRED_TOOLS = [
    "brc_red_help",
    "brc_find_help_resources",
    "brc_get_help_resource_details",
];
export const RED_HELP_COMMAND = "red-help";
/** Detect and strip a leading reserved red-help command. */
export function detectRedHelpCommand(userMessage) {
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
/** True when the message contains deterministic how-to / manual-help wording. */
export function isHowToHelpPhrase(userMessage) {
    const text = typeof userMessage === "string" ? userMessage.trim() : "";
    if (!text) {
        return false;
    }
    return HOW_TO_HELP_PATTERNS.some((pattern) => pattern.test(text));
}
/**
 * Detect whether a user message is a manual-help request (red-help or how-to)
 * and return a cleaned search query.
 */
export function detectHelpMode(userMessage) {
    const original = typeof userMessage === "string" ? userMessage : "";
    const trimmedStart = original.replace(/^\s+/, "").trim();
    if (!trimmedStart) {
        return { isHelpMode: false, cleanedQuery: "" };
    }
    const redHelp = detectRedHelpCommand(trimmedStart);
    if (redHelp.isHelpMode) {
        return redHelp;
    }
    if (isHowToHelpPhrase(trimmedStart)) {
        return {
            isHelpMode: true,
            cleanedQuery: trimmedStart,
        };
    }
    return {
        isHelpMode: false,
        cleanedQuery: trimmedStart,
    };
}
/** True when a help cleaned query is specifically about connecting companies. */
export function isRedHelpCompanyConnectionQuery(cleanedQuery) {
    return COMPANY_CONNECTION_QUERY_PATTERN.test(cleanedQuery.trim());
}
/**
 * Query to pass into help search / details. Uses the cleaned red-help query
 * when the reserved command was present; otherwise the trimmed original message
 * (including how-to wording).
 */
export function resolveHelpSearchQuery(userMessage) {
    const originalMessage = typeof userMessage === "string" ? userMessage : "";
    const detection = detectHelpMode(originalMessage);
    const fallback = originalMessage.trim();
    const searchQuery = detection.cleanedQuery.trim() ||
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
export function resolveHelpModeToolPolicy(userMessage) {
    const detection = detectHelpMode(userMessage);
    const allowCompanyConnectionTool = detection.isHelpMode &&
        isRedHelpCompanyConnectionQuery(detection.cleanedQuery);
    return {
        ...detection,
        blockTransactionalTools: detection.isHelpMode,
        allowCompanyConnectionTool,
        preferredHelpTools: detection.isHelpMode ? HELP_MODE_PREFERRED_TOOLS : [],
    };
}
export const HELP_MODE_INSTRUCTION_SUMMARY = "Manual help mode: when the user uses how-to wording (how do I, show me how, tell me how, where do I, what are the steps, manual steps for) or the reserved red-help command, provide customer-help resources and manual instructions instead of performing the accounting action. Prefer brc_route_request to classify, or call brc_red_help / brc_find_help_resources, then brc_get_help_resource_details for the best Freshdesk match. Do not ask for customer details first. Do not call create, update, delete, email, or batch tools unless the user later explicitly asks Red to perform the action. Put manual guidance and Sources before any optional Do this through Red offer. Explicit action wording such as add a customer or can you add a customer for me remains action mode. MCP clients remain responsible for selecting the initial tool — detectHelpMode alone cannot force tool selection.";
