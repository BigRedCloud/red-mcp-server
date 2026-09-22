import { z } from "zod";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./auth/connection_store.js";
import { decodeStoredApiKey } from "./auth/credential_secret.js";
import { normaliseCompanyName, runWithSessionKeyStore, type CompanyApiContext } from "./shared.js";

/** Explicitly audited accounting queries. New normal tools are excluded by default. */
export const COPILOT_FEDERATED_READ_TOOLS = [
  "brc_check_transaction_settings",
  "brc_get_accrual",
  "brc_get_bank_account",
  "brc_get_cash_payment",
  "brc_get_cash_receipt",
  "brc_get_company_logo",
  "brc_get_company_processing_settings",
  "brc_get_company_reference_settings",
  "brc_get_company_setup_config",
  "brc_get_customer",
  "brc_get_customer_opening_balance",
  "brc_get_financial_year",
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
  "brc_resolve_book_transaction_type",
  "brc_validate_transaction_date",
] as const;
export const COPILOT_FEDERATED_TOOL_NAMES = new Set<string>([
  "search_customers", "fetch_customer", ...COPILOT_FEDERATED_READ_TOOLS,
]);

const failure = (status: string, message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({ status, message }) }],
});

/** Reuse accounting handlers with fresh credentials belonging only to the verified owner.
 * No legacy connectionRef, client-header inheritance, or shared credential fallback.
 */
export function wrapCopilotReadHandler(handler: (args: any) => any) {
  return async (args: Record<string, unknown>) => {
    const owner = entraRequestOwner.getStore();
    if (!owner) return failure("authentication_required", "Sign in with Microsoft to query your linked companies.");
    try {
      await ensureConnectionStoreInitialized();
      const companies = await getConnectionStore().entra.listCompanies(owner);
      const requested = typeof args.companyName === "string" ? [args.companyName]
        : Array.isArray(args.companyNames) ? args.companyNames : [];
      if (!requested.length || requested.some(name => typeof name !== "string" ||
        !companies.some(company => normaliseCompanyName(company.companyName) === normaliseCompanyName(name) && company.expiresAt > Date.now()))) {
        return failure("company_unavailable", "Use a company linked to your Microsoft sign-in. Search customers with an empty query to discover linked company names.");
      }
      const contexts = new Map<string, CompanyApiContext>();
      const secrets = [owner.tenantId, owner.objectId];
      for (const company of companies) {
        const apiKey = decodeStoredApiKey(company.encryptedSecret);
        secrets.push(apiKey, Buffer.from(`${apiKey}:`).toString("base64"));
        if (requested.some(name => normaliseCompanyName(String(name)) === normaliseCompanyName(company.companyName))) {
          contexts.set(normaliseCompanyName(company.companyName), { companyName: company.companyName, apiKey, expiresAt: company.expiresAt });
        }
      }
      const result = await runWithSessionKeyStore(contexts, () => handler(args));
      // Existing handlers may include upstream error text. Never expose credentials or identity claims.
      let serialized = JSON.stringify(result);
      for (const secret of secrets) if (secret) serialized = serialized.split(secret).join("[redacted]");
      serialized = serialized.replace(/Bearer\s+[^\s"\\]+/gi, "[redacted]");
      return JSON.parse(serialized);
    } catch {
      return failure("query_unavailable", "Could not query this company's accounting data. Please retry.");
    }
  };
}

export function copilotReadSchema(schema: Record<string, any>) {
  return z.object(schema).strict();
}
