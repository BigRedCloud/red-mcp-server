# Copilot final controlled read-only tranche

Baseline: clean HEAD `004ad0c3`, 43 live-verified Copilot tools. This tranche adds five tools (48 total). Fewer than six are justified: the remaining candidates overlap existing concepts, require reporting design, or have unclear contracts. No padding.

## Selected tools and contracts

| Copilot tool | Existing RED handler | BRC GET path | Purpose / response |
|---|---|---|---|
| search_sales_entries | brc_list_sales_entries | /v1/salesEntries | Sales-book accounting entries; PageResult[SalesEntryQueryDto], lightweight reference/customer/date/totals |
| fetch_sales_entry | brc_get_sales_entry | /v1/salesEntries/{id} | SalesEntryDto, full sanitized analysis/VAT/custom-field detail |
| search_account_owner_types | brc_list_owner_types | /v1/ownerTypes | PageResult[OwnerTypeDto]: id, description, recordTypeGroupId |
| search_account_owner_type_groups | brc_list_owner_type_groups | /v1/ownerTypeGroups | PageResult[OwnerTypeGroupDto]: id, description |
| search_user_defined_fields | brc_list_user_defined_fields | /v1/userDefinedFields | PageResult[UserDefinedFieldDto]: id, description, orderIndex, categoryTypeId; definitions, not values |

The three references are search-only (`fetchAvailable: false`). Sales entries use accounting/VAT allocation DTOs, whereas invoice/credit/quote DTOs have product transaction detail. Descriptions distinguish these concepts without assuming fixed company-specific transaction-type IDs.

Source contract: [official BRC Swagger](https://app.bigredcloud.com/api/swagger/docs/v1), linked from [BRC API help](https://app.bigredcloud.com/api/Help/?v=1#/). Inspected alongside `src/tools/general/list_tools.ts`, shared response enrichment, and the Copilot parser. Generic list schemas accept companyName, page/pageSize, filter/orderBy/top/skip; individual GET accepts companyName and id. The handlers call the listed paths and jsonResponse without entity-specific transformation. Shared response enrichment preserves PageResult objects and wraps bare arrays under result. Copilot accepts the documented Items collection.

All four selected lists document OData paging and ordering by id. Owner types/groups forbid upstream filtering; UDF filtering permits categoryTypeId, sales entries permit entryDate. The facade uses local text/date/customer filtering and sends no $filter. It reuses page/pageSize plus $top/$skip/$orderby=id asc, default 20/max 50 rows per page, at most three pages per call, existing 128 KB output limits and owner/query/company-bound continuation cursors. No local paging workaround or per-row fetches were added. Nominal local paging and customer/supplier ledger code are untouched.

Search omits timestamps and nested allocation/custom-field collections. Only new reference mappings opt into recordTypeGroupId/orderIndex summary fields, preserving all existing projections. Authentication, company selection, key scoping and sanitization are inherited unchanged.

## Full remaining read-only classification at the 43-tool baseline

### Good search/fetch candidates - selected

Separate sales-book accounting entries, with analysis/VAT allocations and a genuine detail GET.

- `brc_list_sales_entries`
- `brc_get_sales_entry`

### Good search-only/reference candidates - selected

Small reference definitions; no individual GET handlers. Owner types classify accounting records, not Microsoft identities.

- `brc_list_owner_types`
- `brc_list_owner_type_groups`
- `brc_list_user_defined_fields`

### Useful but overlapping/ambiguous - deferred

Dormant variants and account-specific quotes overlap existing searches. Combined sales mixes entries, invoices and credits and would weaken routing.

- `brc_list_customers_without_dormant`
- `brc_list_products_without_dormant`
- `brc_list_customer_quotes`
- `brc_list_sales`

### Large/reporting/complex - deferred

Settings/setup dumps and formatted workflow settings are not bounded entity discovery. Opening balances and allocation/ledger reports require separate semantics; multi-company reports fan out. Logo is binary.

- `brc_list_company_settings`
- `brc_get_company_setup_config`
- `brc_get_company_logo`
- `brc_get_customer_opening_balance`
- `brc_list_customer_op_bal_trans`
- `brc_get_supplier_opening_balance`
- `brc_list_supplier_op_bal_trans`
- `brc_get_nominal_account_ledger_by_id`
- `brc_get_nom_ac_ledger_by_ids`
- `brc_grouped_nominal_accounts_report`
- `brc_multi_company_nom_ac_report`
- `brc_get_company_processing_settings`
- `brc_get_company_reference_settings`
- `brc_list_allocation_resolvers`
- `brc_list_allocated_transactions`

### Misleading API contract - deferred

GET /v1/productTypes still declares PageResult[OwnerTypeDto] and Prospect/Customer/Supplier examples. The pass-through handler cannot establish a genuine product-type contract.

- `brc_list_product_types`

### Read-only admin/auth/internal - excluded

Connection, routing, workflow checks, help resources and operator diagnostics are not accounting searches. Transaction type reference discovery already exists.

- `brc_get_company_api_key_status`
- `brc_list_company_contexts`
- `brc_get_deployment_policy`
- `brc_validate_transaction_date`
- `brc_company_readiness_check`
- `brc_resolve_book_transaction_type`
- `brc_route_request`
- `brc_red_help`
- `brc_find_help_resources`
- `brc_get_help_resource_details`
- `brc_open_edu_admin`
- `brc_list_audit_log`
- `brc_generate_support_report`
- `brc_check_transaction_settings`

## Remaining non-read-only tools - excluded (78)

Every non-read-only handler remains excluded, including preview/import/write and connection/admin actions:

- `brc_start_company_connection`
- `brc_confirm_company_connection`
- `brc_clear_company_api_key`
- `brc_clear_all_company_api_keys`
- `brc_create_customer`
- `brc_update_customer`
- `brc_delete_customer`
- `brc_create_supplier`
- `brc_update_supplier`
- `brc_delete_supplier`
- `brc_create_purchase`
- `brc_create_purchase_gen_ref`
- `brc_update_purchase`
- `brc_delete_purchase`
- `brc_create_sales_entry`
- `brc_update_sales_entry`
- `brc_delete_sales_entry`
- `brc_create_sales_invoice`
- `brc_create_sales_invoice_gen_ref`
- `brc_update_sales_invoice`
- `brc_delete_sales_invoice`
- `brc_create_quote`
- `brc_create_quote_gen_ref`
- `brc_update_quote`
- `brc_close_quote`
- `brc_reopen_quote`
- `brc_delete_quote`
- `brc_generate_sales_invoice_from_quote`
- `brc_create_sales_credit_note`
- `brc_create_sales_credit_note_gen_ref`
- `brc_update_sales_credit_note`
- `brc_delete_sales_credit_note`
- `brc_create_sales_rep`
- `brc_update_sales_rep`
- `brc_delete_sales_rep`
- `brc_create_cash_payment`
- `brc_update_cash_payment`
- `brc_delete_cash_payment`
- `brc_batch_cash_payments`
- `brc_create_cash_receipt`
- `brc_update_cash_receipt`
- `brc_delete_cash_receipt`
- `brc_batch_cash_receipts`
- `brc_create_payment`
- `brc_update_payment`
- `brc_delete_payment`
- `brc_batch_payments`
- `brc_create_bank_account`
- `brc_update_bank_account`
- `brc_delete_bank_account`
- `brc_create_product`
- `brc_update_product`
- `brc_delete_product`
- `brc_batch_purchases`
- `brc_batch_quotes`
- `brc_batch_sales_credit_notes`
- `brc_batch_sales_entries`
- `brc_batch_sales_invoices`
- `brc_batch_sales_reps`
- `brc_batch_suppliers`
- `brc_batch_customers`
- `brc_batch_products`
- `brc_process_vat_category_rates`
- `brc_clear_audit_log`
- `brc_send_sales_invoice_email`
- `brc_send_email_statement`
- `brc_send_quote_email`
- `brc_update_allocations`
- `brc_delete_allocation_resolver`
- `brc_create_nominal_journal_batch`
- `brc_update_nominal_journal_batch`
- `brc_delete_nominal_journal_batch`
- `brc_create_accrual`
- `brc_update_accrual`
- `brc_delete_accrual`
- `brc_create_prepayment`
- `brc_update_prepayment`
- `brc_delete_prepayment`

## Invariants and validation

Normal /mcp: 159 tools; descriptor SHA-256 must remain `c5e420ed1f7e9f3201fadb283b72e4b90a00eb58c64bfd641d3c8cab0d684f6f`.
Locked original 43 Copilot descriptors: `c6e6860b46851bb8ae4731853f504bf8f5ab0fdd089482fd44ae26f56c5fec4b`.
Tests retain the earlier 35-tool descriptor snapshot too.

New tests cover correct underlying HTTP path/method/credentials, reference summary fields, genuine detail fetch, absence of fake fetches, no N+1, OData offsets, unique continuation results, owner/company/query binding, unauthenticated rejection, strict input schemas, local filtering and repeated-page termination. Entra HTTP tests exercise each new tool through verified owner scope and deny another owner access.

Live Microsoft routing for these five additions has not been tested. Five differentiated additions are more conservative than restoring a raw catalogue, but discovery quality still requires live Copilot validation; no latency/discovery benchmark is claimed.
