

export const RED_MCP_TOOL_PROFILE_ENV = "RED_MCP_TOOL_PROFILE";

export type RedMcpToolProfile =
  | "full"
  | "copilot"
  | "copilot-read-only";

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
  "brc_list_suppliers",
  "brc_get_supplier",
  "brc_list_supplier_account_trans",
  "brc_list_purchases",
  "brc_get_purchase",
  "brc_grouped_nominal_accounts_report",
] as const;

const COPILOT_TOOL_NAMES = new Set<string>(COPILOT_TOOL_ALLOWLIST);

/**
 * Broad, explicitly audited read-only accounting catalogue for Microsoft
 * Copilot Studio. New production tools remain excluded until deliberately
 * reviewed and added here.
 */
export const COPILOT_READ_ONLY_TOOL_ALLOWLIST = [
  "brc_check_transaction_settings",
  "brc_company_readiness_check",
  "brc_confirm_company_connection",
  "brc_find_help_resources",
  "brc_generate_support_report",
  "brc_get_accrual",
  "brc_get_bank_account",
  "brc_get_cash_payment",
  "brc_get_cash_receipt",
  "brc_get_company_api_key_status",
  "brc_get_company_logo",
  "brc_get_company_processing_settings",
  "brc_get_company_reference_settings",
  "brc_get_company_setup_config",
  "brc_get_customer",
  "brc_get_customer_opening_balance",
  "brc_get_deployment_policy",
  "brc_get_financial_year",
  "brc_get_help_resource_details",
  "brc_get_nom_ac_ledger_by_ids",
  "brc_get_nominal_account_ledger_by_id",
  "brc_get_nominal_journal_batch",
  "brc_get_payment",
  "brc_get_prepayment",
  "brc_get_product",
  "brc_get_purchase",
  "brc_get_quote",
  "brc_get_sales_credit_note",
  "brc_get_sales_entry",
  "brc_get_sales_invoice",
  "brc_get_sales_rep",
  "brc_get_supplier",
  "brc_get_supplier_opening_balance",
  "brc_grouped_nominal_accounts_report",
  "brc_list_accounts",
  "brc_list_accruals",
  "brc_list_allocated_transactions",
  "brc_list_allocation_resolvers",
  "brc_list_analysis_categories",
  "brc_list_bank_accounts",
  "brc_list_book_tran_types",
  "brc_list_cash_payments",
  "brc_list_cash_receipts",
  "brc_list_category_types",
  "brc_list_company_contexts",
  "brc_list_company_settings",
  "brc_list_customer_account_trans",
  "brc_list_customer_op_bal_trans",
  "brc_list_customer_quotes",
  "brc_list_customers",
  "brc_list_customers_without_dormant",
  "brc_list_nominal_accounts",
  "brc_list_nominal_journal_batches",
  "brc_list_owner_type_groups",
  "brc_list_owner_types",
  "brc_list_payments",
  "brc_list_prepayments",
  "brc_list_product_types",
  "brc_list_products",
  "brc_list_products_without_dormant",
  "brc_list_purchases",
  "brc_list_quotes",
  "brc_list_sales",
  "brc_list_sales_credit_notes",
  "brc_list_sales_entries",
  "brc_list_sales_invoices",
  "brc_list_sales_reps",
  "brc_list_supplier_account_trans",
  "brc_list_supplier_op_bal_trans",
  "brc_list_suppliers",
  "brc_list_user_defined_fields",
  "brc_list_vat_analysis_types",
  "brc_list_vat_categories",
  "brc_list_vat_rates",
  "brc_list_vat_types",
  "brc_multi_company_nom_ac_report",
  "brc_red_help",
  "brc_resolve_book_transaction_type",
  "brc_start_company_connection",
  "brc_validate_transaction_date",
] as const;

const COPILOT_READ_ONLY_TOOL_NAMES = new Set<string>(
  COPILOT_READ_ONLY_TOOL_ALLOWLIST,
);

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
  if (configured === "copilot-read-only") {
    return "copilot-read-only";
  }

  throw new Error(
    `Invalid ${RED_MCP_TOOL_PROFILE_ENV} value ${JSON.stringify(configured)}. Expected "full", "copilot", "copilot-read-only".`,
  );
}

export function isToolAllowedByProfile(
  toolName: string,
  profile: RedMcpToolProfile,
): boolean {
  if (profile === "full") {
    return true;
  }
  if (profile === "copilot") {
    return COPILOT_TOOL_NAMES.has(toolName);
  }
  return profile === "copilot-read-only" && COPILOT_READ_ONLY_TOOL_NAMES.has(toolName);
}
