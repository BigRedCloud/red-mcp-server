export const AUTH_PREFLIGHT_TOOL = "brc_get_financial_year";

export function authFailureMessage(companyName) {
  return `BRC test authentication failed for ${companyName}. Check BRC_TEST_COMPANY and BRC_TEST_API_KEY or start a fresh company connection to generate a new secure Red connection link — do not reuse an old connection link.`;
}

/**
 * Detects BRC API 401 / Unauthorized responses without logging secrets.
 */
export function isUnauthorizedToolResult(raw, data, text = "") {
  const toolText = String(text);
  const blob = JSON.stringify(data ?? {}).toLowerCase();

  if (data?.statusCode === 401) {
    return true;
  }

  if (/401\s+unauthorized/i.test(toolText) || /401\s+unauthorised/i.test(toolText)) {
    return true;
  }

  if (
    blob.includes('"statuscode":401') ||
    blob.includes('"status":401') ||
    /401\s+unauthorized/.test(blob) ||
    /401\s+unauthorised/.test(blob)
  ) {
    return true;
  }

  if (raw?.isError && /401/.test(toolText) && /unauthor/i.test(toolText)) {
    return true;
  }

  return false;
}

/**
 * Runs a safe read-only BRC call to verify credentials before the full suite.
 */
export async function runAuthPreflight(client, companyName, options = {}) {
  const toolName = options.toolName || AUTH_PREFLIGHT_TOOL;
  const raw = await client.call(
    toolName,
    { companyName },
    options.timeoutMs || 45000
  );
  const data = client.parsed(raw);
  const text = client.toolText(raw);
  const unauthorized = isUnauthorizedToolResult(raw, data, text);

  return {
    toolName,
    raw,
    data,
    text,
    unauthorized,
    ok: !unauthorized && !client.isFailure(raw, data),
  };
}

export function printAuthFailure(companyName) {
  console.error(authFailureMessage(companyName));
}
