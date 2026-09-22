# Previous raw Copilot catalogue audit (superseded)

This is the historical audit for the previous raw profile. The current endpoint now uses the [12-tool search/fetch facade](copilot-search-fetch-facade.md). The counts and implementation below describe the earlier iteration.

The `/mcp/copilot` endpoint expands from **2 to 72 tools**: the unchanged `search_customers` and `fetch_customer`, plus **70** existing accounting queries. `/mcp` retains its **159** descriptors. No commit, push, deployment, Microsoft configuration, OAuth verifier, owner binding, company-linking flow, or Cosmos record changes are needed.

Reference: the 80-tool `COPILOT_READ_ONLY_TOOL_ALLOWLIST` still present in `src/tool_profiles.ts`, introduced by history commit `81219515`. Its ten connection/support/setup helpers are intentionally not restored. Legacy local profiles remain unchanged.

Each added tool reuses the original business handler and field schemas. Only the federated profile adds a strict object boundary, concise description and idempotent hint. `openWorldHint: false` describes the closed, authenticated BRC accounting system, not unrestricted web interaction. Original full-profile wrappers/descriptors are unchanged.

The existing Entra verification dispatch now recognizes all 72 names. Every new handler requires the verified request owner, reads that owner's linked companies, validates all requested companies before any accounting call, and installs a fresh credential map for those companies. No caller-supplied connection reference, credentials or owner claims are accepted. Search/fetch and the existing OAuth flow are unchanged.

## Safe read-only tools added (70)

- `brc_check_transaction_settings`
- `brc_get_accrual`
- `brc_get_bank_account`
- `brc_get_cash_payment`
- `brc_get_cash_receipt`
- `brc_get_company_logo`
- `brc_get_company_processing_settings`
- `brc_get_company_reference_settings`
- `brc_get_company_setup_config`
- `brc_get_customer`
- `brc_get_customer_opening_balance`
- `brc_get_financial_year`
- `brc_get_nom_ac_ledger_by_ids`
- `brc_get_nominal_account_ledger_by_id`
- `brc_get_nominal_journal_batch`
- `brc_get_payment`
- `brc_get_prepayment`
- `brc_get_product`
- `brc_get_purchase`
- `brc_get_quote`
- `brc_get_sales_credit_note`
- `brc_get_sales_entry`
- `brc_get_sales_invoice`
- `brc_get_sales_rep`
- `brc_get_supplier`
- `brc_get_supplier_opening_balance`
- `brc_grouped_nominal_accounts_report`
- `brc_list_accounts`
- `brc_list_accruals`
- `brc_list_allocated_transactions`
- `brc_list_allocation_resolvers`
- `brc_list_analysis_categories`
- `brc_list_bank_accounts`
- `brc_list_book_tran_types`
- `brc_list_cash_payments`
- `brc_list_cash_receipts`
- `brc_list_category_types`
- `brc_list_company_settings`
- `brc_list_customer_account_trans`
- `brc_list_customer_op_bal_trans`
- `brc_list_customer_quotes`
- `brc_list_customers`
- `brc_list_customers_without_dormant`
- `brc_list_nominal_accounts`
- `brc_list_nominal_journal_batches`
- `brc_list_owner_type_groups`
- `brc_list_owner_types`
- `brc_list_payments`
- `brc_list_prepayments`
- `brc_list_product_types`
- `brc_list_products`
- `brc_list_products_without_dormant`
- `brc_list_purchases`
- `brc_list_quotes`
- `brc_list_sales`
- `brc_list_sales_credit_notes`
- `brc_list_sales_entries`
- `brc_list_sales_invoices`
- `brc_list_sales_reps`
- `brc_list_supplier_account_trans`
- `brc_list_supplier_op_bal_trans`
- `brc_list_suppliers`
- `brc_list_user_defined_fields`
- `brc_list_vat_analysis_types`
- `brc_list_vat_categories`
- `brc_list_vat_rates`
- `brc_list_vat_types`
- `brc_multi_company_nom_ac_report`
- `brc_resolve_book_transaction_type`
- `brc_validate_transaction_date`

## Write/destructive tools excluded (73)

These create, update, delete, batch, post/process, change quote state, generate invoices or send email. Even tools that initially return a preview remain excluded because their confirmed path writes.

- `brc_batch_cash_payments`
- `brc_batch_cash_receipts`
- `brc_batch_customers`
- `brc_batch_payments`
- `brc_batch_products`
- `brc_batch_purchases`
- `brc_batch_quotes`
- `brc_batch_sales_credit_notes`
- `brc_batch_sales_entries`
- `brc_batch_sales_invoices`
- `brc_batch_sales_reps`
- `brc_batch_suppliers`
- `brc_close_quote`
- `brc_create_accrual`
- `brc_create_bank_account`
- `brc_create_cash_payment`
- `brc_create_cash_receipt`
- `brc_create_customer`
- `brc_create_nominal_journal_batch`
- `brc_create_payment`
- `brc_create_prepayment`
- `brc_create_product`
- `brc_create_purchase`
- `brc_create_purchase_gen_ref`
- `brc_create_quote`
- `brc_create_quote_gen_ref`
- `brc_create_sales_credit_note`
- `brc_create_sales_credit_note_gen_ref`
- `brc_create_sales_entry`
- `brc_create_sales_invoice`
- `brc_create_sales_invoice_gen_ref`
- `brc_create_sales_rep`
- `brc_create_supplier`
- `brc_delete_accrual`
- `brc_delete_allocation_resolver`
- `brc_delete_bank_account`
- `brc_delete_cash_payment`
- `brc_delete_cash_receipt`
- `brc_delete_customer`
- `brc_delete_nominal_journal_batch`
- `brc_delete_payment`
- `brc_delete_prepayment`
- `brc_delete_product`
- `brc_delete_purchase`
- `brc_delete_quote`
- `brc_delete_sales_credit_note`
- `brc_delete_sales_entry`
- `brc_delete_sales_invoice`
- `brc_delete_sales_rep`
- `brc_delete_supplier`
- `brc_generate_sales_invoice_from_quote`
- `brc_process_vat_category_rates`
- `brc_reopen_quote`
- `brc_send_email_statement`
- `brc_send_quote_email`
- `brc_send_sales_invoice_email`
- `brc_update_accrual`
- `brc_update_allocations`
- `brc_update_bank_account`
- `brc_update_cash_payment`
- `brc_update_cash_receipt`
- `brc_update_customer`
- `brc_update_nominal_journal_batch`
- `brc_update_payment`
- `brc_update_prepayment`
- `brc_update_product`
- `brc_update_purchase`
- `brc_update_quote`
- `brc_update_sales_credit_note`
- `brc_update_sales_entry`
- `brc_update_sales_invoice`
- `brc_update_sales_rep`
- `brc_update_supplier`

## Connection/auth/admin/internal tools excluded (16)

- `brc_clear_all_company_api_keys`: Credential management.
- `brc_clear_audit_log`: Internal audit management and deletion.
- `brc_clear_company_api_key`: Credential management.
- `brc_company_readiness_check`: Setup/connection readiness helper.
- `brc_confirm_company_connection`: Legacy company connection flow.
- `brc_find_help_resources`: Public help lookup; outside this accounting query profile.
- `brc_generate_support_report`: Internal session diagnostics and downloadable support artifact.
- `brc_get_company_api_key_status`: Credential status helper.
- `brc_get_deployment_policy`: Deployment/admin capability helper.
- `brc_get_help_resource_details`: Public help content; outside this accounting query profile.
- `brc_list_audit_log`: Legacy session audit scope, not accounting query data.
- `brc_list_company_contexts`: Legacy connection context helper.
- `brc_open_edu_admin`: Administration helper.
- `brc_red_help`: Setup/help guidance referencing the full RED workflow.
- `brc_route_request`: Internal routing and write authorization helper.
- `brc_start_company_connection`: Legacy company connection flow.

Development-only tools (already absent from the normal 159) also remain excluded:

- `brc_set_company_api_key`
- `brc_get_dev_mode_details`
- `brc_dev_diagnose_company_processing_settings`
- `brc_get_connection_store_diagnostics`

## Borderline tools reviewed

No unresolved read/write classifications. `brc_get_company_setup_config`, processing/reference settings, financial year, company logo and company settings read company data; they do not configure the connector. `brc_check_transaction_settings`, `brc_validate_transaction_date` and `brc_resolve_book_transaction_type` only query/reference or calculate; they do not authorize or post a transaction. Allocation list/resolver queries read existing or eligible transactions; allocation updates/deletions remain excluded. The nominal reports calculate from GET results; “report” does not mean creating a persistent record. Help queries are read-only but deliberately outside this accounting scope.

## Discovery/performance assessment

The measured compact JSON `tools/list` response grows from **1,598 bytes** for the existing pair to **64,865 bytes** for all 72 tools (about **41x**). This increases discovery payload size and can increase selection ambiguity, especially overlapping customer and nominal query tools. This is a plausible material risk, not a measured regression or known 72-tool limit. Microsoft documents dynamic runtime selection for federated connectors, but its overview supplies no numerical tool-count guarantee. Concise descriptions and an explicit allowlist help; real normal Copilot Chat prompts across each accounting area should be evaluated before deployment. Local tests cannot measure Microsoft's ranking or latency.

Source: [Microsoft federated connectors overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/federated-connectors-overview).

## Validation

- Build: passed, including the resource-processor build.
- Focused suite: 16 passed; the browser OAuth regression required execution outside the network-restricted sandbox.
- Additional exhaustive handler check: all 70 added handlers invoked with mocked accounting data; every upstream request was GET and used the selected owner's credential. Cross-user and cross-tenant rejection, no unauthenticated business IO, strict inputs and atomic multi-company rejection passed.
- Full catalogue: a SHA-256 baseline captured from HEAD verifies all 159 normal descriptors, including titles, descriptions, schemas and annotations, unchanged.
- Full `npm test`: **passed - 1,129 passed, zero failed, one skipped** (1,103 unit passes, 25 HTTP integration passes, one resource-processor pass). The existing Cosmos telemetry persistence test was skipped. The initial sandbox run failed only the browser OAuth redirect with `ERR_NETWORK_ACCESS_DENIED`; the complete rerun outside the sandbox passed, including that regression.

On this Windows installation the PowerShell `npm` launcher resolves a missing roaming npm file. The installed npm CLI was invoked directly with Node to execute the unchanged `build` and `test` package scripts. No dependency or system configuration was changed.
