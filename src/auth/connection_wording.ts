/**
 * Shared user- and assistant-facing wording for the secure Red company connection flow.
 * Keeps fresh-link / no-reuse guidance consistent across tools, errors, and the connection page.
 */

export const DO_NOT_REUSE_OLD_CONNECTION_LINK =
  "Do not reuse an old, used, expired, or previously shared secure Red connection link.";

export const DO_NOT_PASTE_API_KEY_IN_CHAT =
  "Do not ask the user to paste an API key into chat.";

export const CONNECTION_REF_PERSISTENCE_GUIDANCE = [
  "If brc_confirm_company_connection returned a connectionRef, pass that exact value on every later tool call in this chat.",
  "When a tool call succeeds with connectionRef, keep using the same connectionRef — do not call brc_start_company_connection again.",
  "Do not treat empty lists, zero results, or partial data as an expired connection.",
  "If one company has no sales or purchases, report no data for that company — not a connection expiry.",
  "When comparing companies, missing data for one company is zero or unknown data, not a reconnect prompt.",
  "Start a new connection only when there is no active connection, connectionRef is missing or rejected, or the user explicitly asks to connect or reconnect.",
].join(" ");

export const VIBE_MISTRAL_CONNECTION_REF_GUIDANCE = [
  "Vibe/Mistral rotates MCP session ids — always pass connectionRef on every tool call after confirm.",
  "If brc_list_sales_invoices, brc_list_purchases, or other lookups succeed with connectionRef, the connection is active.",
  "Do not call brc_start_company_connection after successful lookups just because another company returned no rows or an empty list.",
].join(" ");

export const START_COMPANY_CONNECTION_DO_NOT_USE_WHEN = [
  "Do not call this tool when a valid connectionRef from brc_confirm_company_connection is already available and recent tool calls succeeded with it.",
  "Do not call this tool because a lookup returned no rows, partial data, or an empty list — that means no matching records, not an expired connection.",
  "Do not call this tool after successful company data retrieval unless the user explicitly asks to connect, reconnect, or add more companies.",
].join(" ");

export const FRESH_CONNECTION_ASSISTANT_GUIDANCE = [
  "To continue, ask the user to start a fresh company connection and generate a new secure Red connection link and confirmation code.",
  DO_NOT_REUSE_OLD_CONNECTION_LINK,
  DO_NOT_PASTE_API_KEY_IN_CHAT,
].join(" ");

export const START_COMPANY_CONNECTION_TOOL_DESCRIPTION = [
  "Starts the secure Red company connection flow and generates a fresh one-time secure Red connection link and confirmation code.",
  "Use only when there is no active company connection, no valid connectionRef, the user explicitly asks to connect or reconnect, try again after a failed connection, expired session credentials, or when an old, used, or stale secure connection link no longer works.",
  START_COMPANY_CONNECTION_DO_NOT_USE_WHEN,
  "Always call this tool again to generate a new link — never reuse a previous connection link.",
  "Returns a one-time connection page URL (no time expiry, but each link works only once).",
  "On that page the user can enter a single company or upload a CSV for multiple companies — never in chat.",
  "After completing the secure page, the user should return to this chat and provide (copy/paste) the confirmation code shown on the success page.",
  DO_NOT_PASTE_API_KEY_IN_CHAT.replace("ask the user to ", ""),
].join(" ");

export const CONFIRM_COMPANY_CONNECTION_TOOL_DESCRIPTION = [
  "Claims a completed secure Red connection code for the current MCP session.",
  "Use after the user has submitted the secure connection page and returns to this chat with the confirmation code shown on the success page (for example when the MCP session changed after opening the browser).",
  "Returns an opaque connectionRef for later tool calls when the MCP client rotates session ids (for example Vibe/Mistral). Pass it silently in tool arguments — do not show connectionRef or redconn_ values to normal users.",
  "After confirm succeeds, keep passing the same connectionRef on every later tool call — do not call brc_start_company_connection while that connectionRef still works.",
  "Never exposes connection credentials.",
].join(" ");

export const LIST_COMPANY_CONTEXTS_TOOL_DESCRIPTION = [
  "Lists company contexts currently connected in this MCP server session.",
  "Use this when the user asks which companies are connected, how long the connection lasts, how much time is left, when companies disconnect, when the session expires, or what timezone the expiry is in.",
  "Present the result to the user with the customerMessage text, company names, and expiryMessage when connected.",
  "Answer duration and time-left questions using connectionDurationText, timeRemainingText, expiryTimeWithTimezoneText, expiryTimezoneName, expiryTimezoneAbbreviation, expiryUtcOffset, and expiryMessage from the response — do not say you do not know the current time or that you lack a live clock when timeRemainingText is present. Do not ask the user to check their device clock. Do not say local time on its own.",
  "Customer duration answers should explain how long the connection lasts, that a fresh secure link is needed after expiry, and that the one-time connection link itself cannot be reused.",
  "Do not mention authentication classifications, empty-result logic, connectionRef, rehydration, HTTP status codes, session bindings, or other internal diagnostics in customer answers.",
  "Do not show connectionRef, activeConnectionRef, redconn_ values, session IDs, or diagnostic metadata to normal users.",
  "Do not show raw ISO expiresAt or credentialType to normal users unless they specifically ask or dev mode is enabled.",
  "Connection credentials are never returned.",
  "If you have connectionRef from brc_confirm_company_connection, pass it silently on this call when the MCP client rotates session ids.",
  "An empty list with a working connectionRef means no companies are bound yet — not a reason to start a new connection if other tools already succeeded with the same connectionRef.",
].join(" ");

export const CONFIRM_CONNECTION_SUCCESS_LINES = [
  "Use connectionRef silently on every later tool call in this chat — do not mention it to normal users.",
  "Do not call brc_start_company_connection again while this connectionRef works.",
  "Empty sales, purchases, or other lists mean no matching records for that company — not an expired connection.",
  VIBE_MISTRAL_CONNECTION_REF_GUIDANCE,
] as const;

export const START_CONNECTION_RESPONSE_LINES = [
  "To connect your Big Red Cloud companies, open this fresh secure Red connection page:",
  "",
  "{url}",
  "",
  "On that page you can connect one company using the form, or connect several at once by uploading a CSV file. Credentials are not sent through chat.",
  "",
  "This link is for one-time use only. Do not open or reuse an older connection link from a previous attempt.",
  "",
  "If you need to reconnect, try again after a failure, or fix an expired or stale connection, ask Red to start a new company connection to generate a fresh link.",
  "",
  "After connecting your companies, return to this chat and copy/paste the confirmation code shown on the success page. Your connection will not be active until you do.",
] as const;

export function formatStartConnectionResponse(url: string): string {
  return START_CONNECTION_RESPONSE_LINES.join("\n").replace("{url}", url);
}

export const FRESH_CONNECTION_LINK_CLAIM_GUIDANCE =
  "Start a fresh company connection to generate a new secure Red connection link — do not reuse an old link.";

export const EXPIRED_CONNECTION_LINK_PAGE_MESSAGE =
  "This connection link is invalid, expired, or has already been used. Each secure connection link works only once. Return to your chat and ask Red to start a fresh company connection to generate a new secure Red connection link. Do not reuse an old connection link.";
