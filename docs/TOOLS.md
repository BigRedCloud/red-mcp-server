# Red MCP Server — Developer Guide

This document describes the source layout, tool registration flow, safety guards, and MCP tool coverage of the Red MCP Server. It is intended for developers and technical reviewers who want to inspect the implementation. The main [`README.md`](../README.md) stays concise; this file holds the detail.

Tool names and endpoint paths below reflect what is implemented in the source under `src/`. When in doubt, the source is authoritative.

---

## 1. Source layout overview

```text
src/
├── index.ts                       Local stdio entry point
├── remote.ts                      Hosted HTTP entry point (Streamable HTTP on /mcp)
├── server.ts                      MCP server factory and stdio singleton
├── register_all_tools.ts          Central tool registration + write-confirmation wrapping
├── shared.ts                      BRC HTTP client, session-scoped connections, audit log, helpers
├── auth/                          Secure connection flow and connection store
├── config/
│   ├── server_config.ts           Deployment skill gating (BRC_ALLOW_* flags)
│   └── mcp_config.ts              MCP server instructions and connection-safety rules
├── guards/                        Transaction, reference, VAT, product line, and write-confirmation checks
├── data_quality/                  Lightweight data-quality checks (e.g. customer name/email)
└── tools/
    ├── general/                   Generic list/get/create/update/delete/batch + payload builders
    ├── setup/                     Company context, setup config, readiness, deployment policy, processing settings
    ├── sales-emails/              Quotes, sales invoices, sales entries, credit notes, sales reps, email
    ├── purchases/                 Purchases and suppliers
    ├── bank-payments/             Bank accounts, payments, cash payments, cash receipts
    ├── journals/                  Nominal reports and nominal journal batches
    ├── customer_tools.ts          Customers
    ├── product_tools.ts           Products
    ├── vat_sales_tools.ts         VAT processing + combined sales listing
    ├── accrual_tools.ts           Accruals
    ├── prepayment_tools.ts        Prepayments
    ├── alloc_tools.ts             Allocation resolvers
    └── audit_session_tools.ts     Session audit log
```

---

## 2. Key files and what they do

- **`src/index.ts`** — Local stdio entry. Builds the server, registers all tools, and connects a stdio transport. Suitable for MCP clients that spawn `node build/index.js`.
- **`src/remote.ts`** — Streamable HTTP server. Each new MCP session gets its own server instance, tool registration, and isolated session state.
- **`src/server.ts`** — `createBrcMcpServer()` factory holding shared server metadata (name, version, instructions).
- **`src/register_all_tools.ts`** — The single registration list used by both entry points. It wraps `server.tool(...)` so that:
  - disabled skill groups register a permission-message blocker instead of the real tool, and
  - write tools receive draft/confirmation handling and the appropriate confirmation schema fields.
- **`src/shared.ts`** — The Big Red Cloud HTTP client (`brcFetch`, JSON request helpers), session-scoped connection storage, the session audit log, list/response helpers, and user-facing status wording.
- **`src/config/server_config.ts`** — Classifies each tool into a skill group and decides whether it is enabled, based on the `BRC_ALLOW_*` flags.
- **`src/config/mcp_config.ts`** — Server instructions and connection-safety rules surfaced to MCP clients.
- **`src/auth/`** — The secure connection flow: connection page rendering, pending/connection stores (in-memory and an optional persistent backend), connection codes, and credential handling. Connection credentials are never returned to clients.

---

## 3. Tool registration flow

```text
index.ts / remote.ts
  → createBrcMcpServer()
  → registerAllTools(server)
       → wraps server.tool(...) (skill gating + write confirmation)
       → registers each domain tool module once
```

Registration details:

- **Skill gating.** `registerAllTools` consults `isToolEnabled(toolName)`. If the tool's skill group is disabled by a deployment flag, a blocker is registered that returns a permission message instead of calling Big Red Cloud.
- **Write confirmation.** For write tools (update/delete/email/batch and equivalents), the wrapper adds `confirmWrite` and, where relevant, `confirmCounterpartyExplicit` to the schema, and routes the first call through a draft/preview response. The underlying handler runs only after explicit confirmation.
- **Generic helpers.** Most list/get/create/update/delete/batch tools are produced by helpers in `src/tools/general/` (`registerListTool`, `registerGetTool`, `registerSubresourceGetTool`, `registerRawCreateTool`, `registerRawUpdateTool`, `registerRawDeleteTool`, `registerRawBatchTool`). Payload normalisation lives in `payloads_tools.ts`.

---

## 4. Safety and guard modules

Guards live in `src/guards/` and run before drafts and before posting.

- **`write_confirmation.ts`** — Draft-before-write flow; counterparty confirmation; placeholder product ID preflight; Sales VAT category preflight; single "Missing or not provided" presentation for missing contact details.
- **`company_processing_settings.ts`** — Reads company processing settings and enforces VAT-sensitive workflow rules, including Gross Price Entry `priceBasis` handling, margin VAT scheme blocking, VAT discrepancy tolerance wording, reverse-charge guidance, and cash receipt VAT (VOCR) handling.
- **`company_reference_settings.ts`** — Enforces safe reference handling (manual vs auto-generated references) per workflow.
- **`sales_vat_category.ts`** — Maps each VAT rate to its VAT category and blocks sales invoice lines that use a purchase/non-Sales VAT rate (even when the percentage matches).
- **`document_draft_details.ts`** — Builds the draft contact details and the single missing-details section for quotes and sales invoices.

Sales invoice safeguards (summary):

- Gross Price Entry requires an explicit `priceBasis` of `gross` or `net`.
- Sales invoices must use a Sales VAT category; purchase VAT rates are blocked.
- `productId` `0` and `1` are treated as placeholders and blocked before draft and post.
- `note` defaults to the customer name unless explicitly provided, and is never a product name.
- `deliveryTo` is included only when explicitly provided.

---

## 5. MCP tool coverage by domain

Endpoint paths are relative to the configured Big Red Cloud API base URL. Write tools require explicit confirmation; delete tools require a delete confirmation and a record timestamp.

### Company connection and session

| MCP tool | Purpose |
| -------- | ------- |
| `brc_start_company_connection` | Start the secure connection flow; returns a connection page link |
| `brc_confirm_company_connection` | Confirm a completed connection using the code from the success page |
| `brc_get_company_api_key_status` | Report whether a company is connected (never returns the key) |
| `brc_list_company_contexts` | List companies connected in the session |
| `brc_clear_company_api_key` | Clear one company connection |
| `brc_clear_all_company_api_keys` | Clear all company connections |

### Company setup and readiness

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_get_company_setup_config` | GET | `/v1/companySetupConfig` |
| `brc_get_company_logo` | GET | `/v1/companySetupConfig/getCompanyLogo` |
| `brc_get_financial_year` | GET | `/v1/companySetupConfig/getFinancialYear` |
| `brc_get_company_options` | GET | `/v1/companySetupConfig/getCompanyOptions` |

| MCP tool | Purpose |
| -------- | ------- |
| `brc_getting_started` | Onboarding guidance text |
| `brc_company_readiness_check` | Pre-flight company checks |
| `brc_validate_transaction_date` | Financial-year date validation |
| `brc_get_deployment_policy` | Active safety flags and policy |
| `brc_get_company_processing_settings` | Mapped processing settings |
| `brc_get_company_reference_settings` | Reference auto-generation settings |
| `brc_check_transaction_settings` | Combined transaction safety check |

### Customers and suppliers

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_customers` | GET | `/v1/customers` |
| `brc_list_customers_without_dormant` | GET | `/v1/customers/GetWithoutDormant` |
| `brc_get_customer` | GET | `/v1/customers/{id}` |
| `brc_create_customer` | POST | `/v1/customers` |
| `brc_update_customer` | PUT | `/v1/customers/{id}` |
| `brc_delete_customer` | DELETE | `/v1/customers/{id}` |
| `brc_get_customer_opening_balance` | GET | `/v1/customers/{id}/openingBalance` |
| `brc_list_customer_op_bal_trans` | GET | `/v1/customers/{id}/openingBalanceList` |
| `brc_list_customer_account_trans` | GET | `/v1/customers/{id}/accountTrans` |
| `brc_list_customer_quotes` | GET | `/v1/customers/{id}/quotes` |
| `brc_list_suppliers` | GET | `/v1/suppliers` |
| `brc_get_supplier` | GET | `/v1/suppliers/{id}` |
| `brc_create_supplier` | POST | `/v1/suppliers` |
| `brc_update_supplier` | PUT | `/v1/suppliers/{id}` |
| `brc_delete_supplier` | DELETE | `/v1/suppliers/{id}` |
| `brc_get_supplier_opening_balance` | GET | `/v1/suppliers/{id}/openingBalance` |
| `brc_list_supplier_op_bal_trans` | GET | `/v1/suppliers/{id}/openingBalanceList` |
| `brc_list_supplier_account_trans` | GET | `/v1/suppliers/{id}/accountTrans` |

### Products and sales reps

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_products` | GET | `/v1/products` |
| `brc_list_products_without_dormant` | GET | `/v1/products/GetWithoutDormant` |
| `brc_list_product_types` | GET | `/v1/productTypes` |
| `brc_get_product` | GET | `/v1/products/{id}` |
| `brc_create_product` | POST | `/v1/products` |
| `brc_update_product` | PUT | `/v1/products/{id}` |
| `brc_delete_product` | DELETE | `/v1/products/{id}` |
| `brc_list_sales_reps` | GET | `/v1/salesReps` |
| `brc_get_sales_rep` | GET | `/v1/salesReps/{id}` |
| `brc_create_sales_rep` | POST | `/v1/salesReps` |
| `brc_update_sales_rep` | PUT | `/v1/salesReps/{id}` |
| `brc_delete_sales_rep` | DELETE | `/v1/salesReps/{id}` |

### Sales documents

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_sales_entries` | GET | `/v1/salesEntries` |
| `brc_get_sales_entry` | GET | `/v1/salesEntries/{id}` |
| `brc_create_sales_entry` | POST | `/v1/salesEntries` |
| `brc_update_sales_entry` | PUT | `/v1/salesEntries/{id}` |
| `brc_delete_sales_entry` | DELETE | `/v1/salesEntries/{id}` |
| `brc_list_sales_invoices` | GET | `/v1/salesInvoices` |
| `brc_get_sales_invoice` | GET | `/v1/salesInvoices/{id}` |
| `brc_create_sales_invoice` | POST | `/v1/salesInvoices` |
| `brc_create_sales_invoice_gen_ref` | POST | `/v1/salesInvoices/createSaleInvoiceWithGeneratingReference` |
| `brc_update_sales_invoice` | PUT | `/v1/salesInvoices/{id}` |
| `brc_delete_sales_invoice` | DELETE | `/v1/salesInvoices/{id}` |
| `brc_list_sales_credit_notes` | GET | `/v1/salesCreditNotes` |
| `brc_get_sales_credit_note` | GET | `/v1/salesCreditNotes/{id}` |
| `brc_create_sales_credit_note` | POST | `/v1/salesCreditNotes` |
| `brc_create_sales_credit_note_gen_ref` | POST | `/v1/salesCreditNotes/createCreditNoteWithGeneratingReference` |
| `brc_update_sales_credit_note` | PUT | `/v1/salesCreditNotes/{id}` |
| `brc_delete_sales_credit_note` | DELETE | `/v1/salesCreditNotes/{id}` |
| `brc_list_quotes` | GET | `/v1/quotes` |
| `brc_get_quote` | GET | `/v1/quotes/{id}` |
| `brc_create_quote` | POST | `/v1/quotes` |
| `brc_create_quote_gen_ref` | POST | `/v1/quotes/createQuoteWithGeneratingReference` |
| `brc_update_quote` | PUT | `/v1/quotes/{id}` |
| `brc_close_quote` | POST/PUT | `/v1/quotes/{id}/close` |
| `brc_reopen_quote` | POST/PUT | `/v1/quotes/{id}/reopen` |
| `brc_generate_sales_invoice_from_quote` | POST | `/v1/quotes/generateSaleInvoice` |
| `brc_delete_quote` | DELETE | `/v1/quotes/{id}` |
| `brc_list_sales` | GET | `/v1/sales` |

### Purchases, payments, and cash

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_purchases` | GET | `/v1/purchases` |
| `brc_get_purchase` | GET | `/v1/purchases/{id}` |
| `brc_create_purchase` | POST | `/v1/purchases` |
| `brc_create_purchase_gen_ref` | POST | `/v1/purchases/createPurchaseWithGeneratingReference` |
| `brc_update_purchase` | PUT | `/v1/purchases/{id}` |
| `brc_delete_purchase` | DELETE | `/v1/purchases/{id}` |
| `brc_list_payments` | GET | `/v1/payments` |
| `brc_get_payment` | GET | `/v1/payments/{id}` |
| `brc_create_payment` | POST | `/v1/payments` |
| `brc_update_payment` | PUT | `/v1/payments/{id}` |
| `brc_delete_payment` | DELETE | `/v1/payments/{id}` |
| `brc_list_cash_payments` | GET | `/v1/cashPayments` |
| `brc_get_cash_payment` | GET | `/v1/cashPayments/{id}` |
| `brc_create_cash_payment` | POST | `/v1/cashPayments` |
| `brc_update_cash_payment` | PUT | `/v1/cashPayments/{id}` |
| `brc_delete_cash_payment` | DELETE | `/v1/cashPayments/{id}` |
| `brc_list_cash_receipts` | GET | `/v1/cashReceipts` |
| `brc_get_cash_receipt` | GET | `/v1/cashReceipts/{id}` |
| `brc_create_cash_receipt` | POST | `/v1/cashReceipts` |
| `brc_update_cash_receipt` | PUT | `/v1/cashReceipts/{id}` |
| `brc_delete_cash_receipt` | DELETE | `/v1/cashReceipts/{id}` |

Cash receipt create/update/batch read the company's VAT-on-Cash-Receipt (VOCR) setting and adjust VAT handling accordingly.

### Accruals, prepayments, and allocations

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_accruals` | GET | `/v1/accruals` |
| `brc_get_accrual` | GET | `/v1/accruals/{id}` |
| `brc_create_accrual` | POST | `/v1/accruals` |
| `brc_update_accrual` | PUT | `/v1/accruals/{id}` |
| `brc_delete_accrual` | DELETE | `/v1/accruals/{id}` |
| `brc_list_prepayments` | GET | `/v1/prepayments` |
| `brc_get_prepayment` | GET | `/v1/prepayments/{id}` |
| `brc_create_prepayment` | POST | `/v1/prepayments` |
| `brc_update_prepayment` | PUT | `/v1/prepayments/{id}` |
| `brc_delete_prepayment` | DELETE | `/v1/prepayments/{id}` |
| `brc_list_allocation_resolvers` | GET | `/v1/allocationResolvers` |
| `brc_list_allocated_transactions` | GET | `/v1/allocationResolvers/allocated` |
| `brc_update_allocations` | POST | `/v1/allocationResolvers` |
| `brc_delete_allocation_resolver` | DELETE | `/v1/allocationResolvers/{id}` |

### VAT and analysis lookups

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_vat_rates` | GET | `/v1/vatRates` |
| `brc_list_vat_analysis_types` | GET | `/v1/vatAnalysisTypes` |
| `brc_list_vat_categories` | GET | `/v1/vatCategories` |
| `brc_list_vat_types` | GET | `/v1/vatTypes` |
| `brc_process_vat_category_rates` | POST | `/v1/vatCategories/vatRates` |
| `brc_list_accounts` | GET | `/v1/accounts` |
| `brc_list_analysis_categories` | GET | `/v1/analysisCategories` |
| `brc_list_category_types` | GET | `/v1/categoryTypes` |
| `brc_list_owner_type_groups` | GET | `/v1/ownerTypeGroups` |
| `brc_list_owner_types` | GET | `/v1/ownerTypes` |
| `brc_list_user_defined_fields` | GET | `/v1/userDefinedFields` |
| `brc_list_book_tran_types` | GET | `/v1/bookTranTypes` |
| `brc_list_company_settings` | GET | `/v1/companySettings` |

`brc_list_analysis_categories` and `brc_list_vat_rates` carry guidance to choose Sales categories/rates for sales document lines.

### Nominal reports and journals

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_list_nominal_accounts` | GET | `/v1/nominalAccounts` |
| `brc_get_nominal_account_ledger_by_id` | GET | `/v1/nominalAccounts/{id}` |
| `brc_get_nom_ac_ledger_by_ids` | GET | `/v1/nominalAccounts/{id}` (per id) |
| `brc_grouped_nominal_accounts_report` | GET | `/v1/nominalAccounts` (aggregated) |
| `brc_multi_company_nom_ac_report` | GET | `/v1/nominalAccounts` (per company) |
| `brc_list_nominal_journal_batches` | GET | `/v1/nominalJournalBatches` |
| `brc_get_nominal_journal_batch` | GET | `/v1/nominalJournalBatches/{id}` |
| `brc_create_nominal_journal_batch` | POST | `/v1/nominalJournalBatches` |
| `brc_update_nominal_journal_batch` | PUT | `/v1/nominalJournalBatches/{id}` |
| `brc_delete_nominal_journal_batch` | DELETE | `/v1/nominalJournalBatches/{id}` |

### Batch tools

Batch tools use `PUT /v1/{resource}/batch` with normalised item payloads and apply the same safety checks as the single-record tools.

| MCP tool | Base path |
| -------- | --------- |
| `brc_batch_customers` | `/v1/customers` |
| `brc_batch_suppliers` | `/v1/suppliers` |
| `brc_batch_products` | `/v1/products` |
| `brc_batch_sales_reps` | `/v1/salesReps` |
| `brc_batch_purchases` | `/v1/purchases` |
| `brc_batch_sales_entries` | `/v1/salesEntries` |
| `brc_batch_sales_invoices` | `/v1/salesInvoices` |
| `brc_batch_sales_credit_notes` | `/v1/salesCreditNotes` |
| `brc_batch_quotes` | `/v1/quotes` |
| `brc_batch_cash_receipts` | `/v1/cashReceipts` |
| `brc_batch_payments` | `/v1/payments` |
| `brc_batch_cash_payments` | `/v1/cashPayments` |

### Audit and session

| MCP tool | Purpose |
| -------- | ------- |
| `brc_list_audit_log` | List create/update/delete/email/batch changes made through the session |
| `brc_clear_audit_log` | Clear the session audit log |

Read-only API calls are not logged.

### MCP resources and prompts

- Resources: `brc://help`, `brc://examples`, `brc://safety`
- Prompts: `brc_setup_company`, `brc_safe_company_review`, `brc_create_quote_workflow`

---

## 6. Notes on generated-reference tools

Several create tools have a `*_gen_ref` variant that posts to a Big Red Cloud endpoint which generates the document reference, rather than requiring a caller-supplied reference:

- `brc_create_sales_invoice_gen_ref` → `/v1/salesInvoices/createSaleInvoiceWithGeneratingReference`
- `brc_create_sales_credit_note_gen_ref` → `/v1/salesCreditNotes/createCreditNoteWithGeneratingReference`
- `brc_create_quote_gen_ref` → `/v1/quotes/createQuoteWithGeneratingReference`
- `brc_create_purchase_gen_ref` → `/v1/purchases/createPurchaseWithGeneratingReference`

Considerations:

- Whether references are auto-generated or manual depends on the company's reference settings; the reference guard (`company_reference_settings.ts`) chooses or blocks the appropriate workflow.
- Some generated-document endpoints may apply the tenant's current transaction date, so the active financial year affects whether they succeed. Use `brc_validate_transaction_date` first where relevant.

---

## 7. Under-development and deployment-gated tools

- **Bank account writes.** Read-only `brc_list_bank_accounts` and `brc_get_bank_account` are available for payment workflows. Bank create/update/delete may require additional tenant configuration and can be gated by deployment flags.
- **Email sending.** `brc_send_sales_invoice_email`, `brc_send_email_statement`, and `brc_send_quote_email` (endpoints under `/v1/email/...`) require a send confirmation and depend on tenant email configuration; they may be disabled by deployment flags.
- **Operator/dev diagnostics.** Diagnostic tools are available only when dev mode is explicitly enabled and are intended for operators, not end users.

Skill groups (read, update, delete, email, batch, dev) are toggled by the `BRC_ALLOW_*` environment variables. When a group is disabled, its tools return a permission message instead of calling Big Red Cloud. Use `brc_get_deployment_policy` to inspect the active policy.

---

## 8. Where to find tests

Tests use the Node.js built-in test runner and live alongside the source as `*.test.ts` files (compiled to `build/` before running).

- `npm test` — build, then run the full suite.
- `npm run test:unit` — unit tests.
- `npm run test:security` — security-focused tests.
- `npm run test:config` — deployment/config tests.
- `npm run test:integration` — integration tests.

Representative coverage includes the sales invoice safeguards (Gross Price Entry `priceBasis`, Sales VAT category validation, placeholder product ID blocking, note/delivery handling), transaction date validation, transaction settings warnings, the secure connection flow, and response wording.
