import {
  getToolSkillGroup,
  isToolEnabled,
} from "../../../build/config/server_config.js";

/** Session tools safe for read-only regression. */
const SESSION_READONLY = new Set([
  "brc_list_company_contexts",
  "brc_get_company_api_key_status",
  "brc_getting_started",
  "brc_get_deployment_policy",
]);

/** Session tools excluded from read-only regression (side effects). */
const SESSION_SKIP_IN_READONLY = new Set([
  "brc_start_company_connection",
  "brc_confirm_company_connection",
  "brc_clear_company_api_key",
  "brc_clear_all_company_api_keys",
]);

/** Bank write tools — skipped in dev write regression unless explicitly enabled. */
export const BANK_WRITE_TOOLS = new Set([
  "brc_get_bank_account",
  "brc_create_bank_account",
  "brc_update_bank_account",
  "brc_delete_bank_account",
  "brc_batch_bank_accounts",
]);

/** Email send tools — covered by email legacy script unless explicitly enabled. */
export const EMAIL_SEND_TOOLS = new Set([
  "brc_send_sales_invoice_email",
  "brc_send_email_statement",
  "brc_send_quote_email",
]);

/**
 * Maps a registered tool to a legacy regression category.
 * Categories: read-only | write | delete | email | dev-only | skipped
 */
export function classifyToolForRegression(toolName, options = {}) {
  const skillGroup = getToolSkillGroup(toolName);
  const enabled = isToolEnabled(toolName);

  if (!enabled) {
    return {
      tool: toolName,
      skillGroup,
      category: "skipped",
      skipReason: `Not registered — disabled by deployment flags (${skillGroup})`,
    };
  }

  if (skillGroup === "dev") {
    return {
      tool: toolName,
      skillGroup,
      category: "dev-only",
      skipReason: "Dev-only tool — use when BRC_ALLOW_DEV_MODE=true",
    };
  }

  if (skillGroup === "email" || EMAIL_SEND_TOOLS.has(toolName)) {
    return {
      tool: toolName,
      skillGroup,
      category: "email",
      skipReason: "Email send — covered by test:email:legacy",
    };
  }

  if (skillGroup === "delete" || toolName.startsWith("brc_delete_")) {
    return {
      tool: toolName,
      skillGroup,
      category: "delete",
      skipReason: null,
    };
  }

  if (
    skillGroup === "update" ||
    skillGroup === "batch" ||
    toolName === "brc_clear_audit_log" ||
    toolName.startsWith("brc_create_") ||
    toolName.startsWith("brc_update_") ||
    toolName.startsWith("brc_batch_") ||
    toolName.startsWith("brc_process_") ||
    toolName.includes("_gen_ref") ||
    toolName.includes("generate") ||
    toolName.includes("close_") ||
    toolName.includes("reopen_")
  ) {
    if (BANK_WRITE_TOOLS.has(toolName) && !options.allowBankWrites) {
      return {
        tool: toolName,
        skillGroup,
        category: "skipped",
        skipReason:
          "Bank account write — set BRC_ALLOW_BANK_WRITE_TESTS=true to include",
      };
    }

    return {
      tool: toolName,
      skillGroup,
      category: "write",
      skipReason: null,
    };
  }

  if (skillGroup === "session") {
    if (SESSION_READONLY.has(toolName)) {
      return {
        tool: toolName,
        skillGroup,
        category: "read-only",
        skipReason: null,
      };
    }

    if (SESSION_SKIP_IN_READONLY.has(toolName)) {
      return {
        tool: toolName,
        skillGroup,
        category: "skipped",
        skipReason:
          "Secure connection management — not exercised in automated regression",
      };
    }
  }

  if (skillGroup === "read" || toolName.startsWith("brc_list_")) {
    return {
      tool: toolName,
      skillGroup,
      category: "read-only",
      skipReason: null,
    };
  }

  if (toolName.startsWith("brc_get_") || toolName.includes("report")) {
    return {
      tool: toolName,
      skillGroup,
      category: "read-only",
      skipReason: null,
    };
  }

  return {
    tool: toolName,
    skillGroup,
    category: "read-only",
    skipReason: null,
  };
}

export function buildToolRegistry(toolNames, options = {}) {
  return [...toolNames]
    .sort()
    .map((toolName) => classifyToolForRegression(toolName, options));
}

export function registrySummary(registry) {
  return registry.reduce((acc, entry) => {
    acc[entry.category] = (acc[entry.category] || 0) + 1;
    return acc;
  }, {});
}
