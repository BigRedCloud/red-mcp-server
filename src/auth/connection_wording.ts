/**
 * Shared user- and assistant-facing wording for the secure Red company connection flow.
 * Keeps fresh-link / no-reuse guidance consistent across tools, errors, and the connection page.
 */

export const DO_NOT_REUSE_OLD_CONNECTION_LINK =
  "Do not reuse an old, used, expired, or previously shared secure Red connection link.";

export const DO_NOT_PASTE_API_KEY_IN_CHAT =
  "Do not ask the user to paste an API key into chat.";

export const FRESH_CONNECTION_ASSISTANT_GUIDANCE = [
  "To continue, ask the user to start a fresh company connection and generate a new secure Red connection link and confirmation code.",
  DO_NOT_REUSE_OLD_CONNECTION_LINK,
  DO_NOT_PASTE_API_KEY_IN_CHAT,
].join(" ");

export const START_COMPANY_CONNECTION_TOOL_DESCRIPTION = [
  "Starts the secure Red company connection flow and generates a fresh one-time secure Red connection link and confirmation code.",
  "Use for first-time connect, reconnect, try again after a failed connection, expired session credentials, or when an old, used, or stale secure connection link no longer works.",
  "Always call this tool again to generate a new link — never reuse a previous connection link.",
  "Returns a one-time connection page URL (no time expiry, but each link works only once).",
  "On that page the user can enter a single company or upload a CSV for multiple companies — never in chat.",
  "After completing the secure page, the user should return to this chat and provide (copy/paste) the confirmation code shown on the success page.",
  DO_NOT_PASTE_API_KEY_IN_CHAT.replace("ask the user to ", ""),
].join(" ");

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
