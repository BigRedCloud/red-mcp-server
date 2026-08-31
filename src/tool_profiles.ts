export const RED_MCP_TOOL_PROFILE_ENV = "RED_MCP_TOOL_PROFILE";

export type RedMcpToolProfile = "full" | "copilot";

/**
 * Minimal customer-account workflow exposed to Microsoft Copilot Studio.
 * Names are deliberately explicit and are verified against real registrations
 * in tool_profiles.test.ts.
 */
export const COPILOT_TOOL_ALLOWLIST = [
  "brc_start_company_connection",
  "brc_confirm_company_connection",
  "brc_list_company_contexts",
  "brc_get_company_api_key_status",
  "brc_list_customers",
  "brc_get_customer",
  "brc_get_customer_opening_balance",
  "brc_list_customer_op_bal_trans",
  "brc_list_customer_account_trans",
  "brc_list_sales_invoices",
  "brc_get_sales_invoice",
] as const;

const COPILOT_TOOL_NAMES = new Set<string>(COPILOT_TOOL_ALLOWLIST);

export function resolveRedMcpToolProfile(
  env: NodeJS.ProcessEnv = process.env,
): RedMcpToolProfile {
  const configured = env[RED_MCP_TOOL_PROFILE_ENV]?.trim();
  if (configured === undefined || configured === "full") {
    return "full";
  }
  if (configured === "copilot") {
    return "copilot";
  }

  throw new Error(
    `Invalid ${RED_MCP_TOOL_PROFILE_ENV} value ${JSON.stringify(configured)}. Expected "full" or "copilot".`,
  );
}

export function isToolAllowedByProfile(
  toolName: string,
  profile: RedMcpToolProfile,
): boolean {
  return profile === "full" || COPILOT_TOOL_NAMES.has(toolName);
}
