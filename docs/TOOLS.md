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
├── read_connection_metadata.ts    Connection status metadata on tool responses (activeConnectionRef, presentation hints)
├── auth/
│   ├── connection_page.ts         Secure /connect page (form + CSV upload)
│   ├── connection_store.ts        Pending codes, session binding, connectionRef issuance
│   ├── connection_persistence.ts  Validate-and-persist on connect; hydrate session key store
│   ├── credential_validation.ts   BRC read validation before storing API keys
│   ├── connection_presentation.ts User-facing TTL wording; assistant presentation rules
│   ├── connection_wording.ts      Shared connection-flow tool descriptions
│   ├── memory_connection_store.ts In-process connection store
│   └── cosmos_connection_store.ts Optional shared Cosmos DB connection store
├── config/
│   ├── server_config.ts           Deployment skill gating (BRC_ALLOW_* flags)
│   └── mcp_config.ts              MCP server instructions and connection-safety rules
├── guards/                        Transaction, reference, VAT, product line, and write-confirmation checks
├── data_quality/                  Lightweight data-quality checks (e.g. customer name/email)
├── edu/                           BRC Edu CSV path resolution, enrichment, and help-resource lookup
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
  - write tools receive preview-before-posting/confirmation handling and the appropriate confirmation schema fields.
- **`src/shared.ts`** — The Big Red Cloud HTTP client (`brcFetch`, JSON request helpers), session-scoped connection storage, the session audit log, list/response helpers, and user-facing status wording.
- **`src/config/server_config.ts`** — Classifies each tool into a skill group and decides whether it is enabled, based on the `BRC_ALLOW_*` flags.
- **`src/config/mcp_config.ts`** — Server instructions, connection-safety rules, and rules that keep `connectionRef` out of normal user-facing chat.
- **`src/read_connection_metadata.ts`** — Adds `connectionStatus`, `activeConnectionRef`, `assistantInstruction`, and `presentationHint` to enriched tool responses in hosted HTTP mode.
- **`src/auth/connection_presentation.ts`** — `formatCredentialTtlForUser()`, confirm/list customer messages, and `shouldShowDeveloperConnectionDetails()` (respects `BRC_ALLOW_DEV_MODE`).
- **`src/auth/credential_validation.ts`** — Validates each API key with the same class of BRC read access as live tools (`GET /v1/customers?page=1&pageSize=1`, plus financial year). Failed keys are not stored.
- **`src/auth/connection_persistence.ts`** — `validateAndPersistConnectedCompanies()` used by `POST /connect`; clears stale per-company entries before re-validating on CSV resubmit.
- **`src/auth/`** — The secure connection flow: connection page rendering, pending/connection stores (in-memory or Cosmos), connection codes, connectionRef, and credential handling. API keys are never returned to clients.

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
- **Write confirmation.** For write tools (update/delete/email/batch and equivalents), the wrapper adds `confirmWrite` and, where relevant, `confirmCounterpartyExplicit` to the schema, and routes the first call through a preview-before-posting response. The underlying handler runs only after explicit confirmation.
- **Generic helpers.** Most list/get/create/update/delete/batch tools are produced by helpers in `src/tools/general/` (`registerListTool`, `registerGetTool`, `registerSubresourceGetTool`, `registerRawCreateTool`, `registerRawUpdateTool`, `registerRawDeleteTool`, `registerRawBatchTool`). Payload normalisation lives in `payloads_tools.ts`.

---

## 4. Secure company connection flow

End-to-end path for hosted HTTP (`src/remote.ts`) and confirm (`brc_confirm_company_connection`):

```text
brc_start_company_connection
  → pending connection code + /connect?code=… link
POST /connect (form or CSV)
  → validateAndPersistConnectedCompanies()
       → credential_validation (BRC customers + financial year)
       → save valid companies with credentialValidatedAt
       → record failedCompanies for invalid keys
brc_confirm_company_connection(code)
  → claimConnectionCodeForSession()
       → re-validate only legacy unvalidated store entries
       → issue connectionRef (TTL = BRC_API_KEY_TTL_MINUTES)
  → JSON: connectionRef, connectedCompanies, failedCompanies, customerMessage
Later tool calls (hosted HTTP)
  → optional connectionRef argument on credential-requiring tools
  → enrichToolResponseData() echoes activeConnectionRef + presentation hints
Runtime auth failure (401/403 on a company)
  → invalidateCompanyCredential(); company_credential_invalid response
```

**CSV and partial success.** Each row is validated independently. A bad key for Company A does not prevent Companies B/C/D from connecting. Stale store entries for a resubmitted company name are cleared before validation.

**Presentation.** `customerMessage` and MCP instructions tell assistants to use plain language for users. `connectionRef`, `redconn_…`, and session diagnostics stay in structured tool output for MCP clients only.

**Session duration.** `BRC_API_KEY_TTL_MINUTES` controls credential expiry and user-facing duration text via `connection_presentation.ts` (for example `240` → “about 4 hours”).

---

## 5. Safety and guard modules

Guards live in `src/guards/` and run before preview-before-posting and before posting.

- **`write_confirmation.ts`** — Preview-before-posting flow; counterparty confirmation; placeholder product ID preflight; Sales VAT category preflight; single "Missing or not provided" presentation for missing contact details.
- **`company_processing_settings.ts`** — Reads company processing settings and enforces VAT-sensitive workflow rules, including Gross Price Entry `priceBasis` handling, margin VAT scheme blocking, VAT discrepancy tolerance wording, reverse-charge guidance, and cash receipt VAT (VOCR) handling.
- **`company_reference_settings.ts`** — Enforces safe reference handling (manual vs auto-generated references) per workflow.
- **`sales_vat_category.ts`** — Maps each VAT rate to its VAT category and blocks sales invoice lines that use a purchase/non-Sales VAT rate (even when the percentage matches).
- **`document_draft_details.ts`** — Builds the preview contact details and the single missing-details section for quotes and sales invoices.

Sales invoice safeguards (summary):

- Gross Price Entry requires an explicit `priceBasis` of `gross` or `net`.
- Sales invoices must use a Sales VAT category; purchase VAT rates are blocked.
- `productId` `0` and `1` are treated as placeholders and blocked before preview-before-posting and post.
- `note` defaults to the customer name unless explicitly provided, and is never a product name.
- `deliveryTo` is included only when explicitly provided.

---

## 6. MCP tool coverage by domain

Endpoint paths are relative to the configured Big Red Cloud API base URL. Write tools require explicit confirmation; delete tools require a delete confirmation and a record timestamp.

### Company connection and session

| MCP tool | Purpose |
| -------- | ------- |
| `brc_start_company_connection` | Start the secure connection flow; returns a connection page link |
| `brc_confirm_company_connection` | Confirm a completed connection; returns `connectedCompanies`, `failedCompanies`, and `connectionRef` (for MCP clients) |
| `brc_get_company_api_key_status` | Report whether a company is connected and when it expires (never returns the key) |
| `brc_list_company_contexts` | List companies connected in the session (`customerMessage` + `presentationHint`) |
| `brc_clear_company_api_key` | Clear one company connection |
| `brc_clear_all_company_api_keys` | Clear all company connections |

Credential-requiring tools accept an optional `connectionRef` argument (hosted HTTP). See `src/auth/connection_ref.ts` and `register_all_tools.ts`.

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

## 7. Notes on generated-reference tools

Several create tools have a `*_gen_ref` variant that posts to a Big Red Cloud endpoint which generates the document reference, rather than requiring a caller-supplied reference:

- `brc_create_sales_invoice_gen_ref` → `/v1/salesInvoices/createSaleInvoiceWithGeneratingReference`
- `brc_create_sales_credit_note_gen_ref` → `/v1/salesCreditNotes/createCreditNoteWithGeneratingReference`
- `brc_create_quote_gen_ref` → `/v1/quotes/createQuoteWithGeneratingReference`
- `brc_create_purchase_gen_ref` → `/v1/purchases/createPurchaseWithGeneratingReference`

Considerations:

- Whether references are auto-generated or manual depends on the company's reference settings; the reference guard (`company_reference_settings.ts`) chooses or blocks the appropriate workflow.
- Some generated-document endpoints may apply the tenant's current transaction date, so the active financial year affects whether they succeed. Use `brc_validate_transaction_date` first where relevant.

---

## 8. Under-development and deployment-gated tools

- **Bank account writes.** Read-only `brc_list_bank_accounts` and `brc_get_bank_account` are available for payment workflows. Bank create/update/delete may require additional tenant configuration and can be gated by deployment flags.
- **Email sending.** `brc_send_sales_invoice_email`, `brc_send_email_statement`, and `brc_send_quote_email` (endpoints under `/v1/email/...`) require a send confirmation and depend on tenant email configuration; they may be disabled by deployment flags.
- **Operator/dev diagnostics.** Diagnostic tools are available only when dev mode is explicitly enabled and are intended for operators, not end users.

Skill groups (read, update, delete, email, batch, dev) are toggled by the `BRC_ALLOW_*` environment variables. When a group is disabled, its tools return a permission message instead of calling Big Red Cloud. Use `brc_get_deployment_policy` to inspect the active policy.

---

## 9. Where to find tests

Tests use the Node.js built-in test runner and live alongside the source as `*.test.ts` files (compiled to `build/` before running).

- `npm test` — build, then run the full suite.
- `npm run test:unit` — unit tests.
- `npm run test:security` — security-focused tests.
- `npm run test:config` — deployment/config tests.
- `npm run test:integration` — integration tests.

Representative coverage includes the sales invoice safeguards (Gross Price Entry `priceBasis`, Sales VAT category validation, placeholder product ID blocking, note/delivery handling), transaction date validation, transaction settings warnings, the secure connection flow (CSV validation, partial confirm, runtime credential invalidation), connectionRef presentation rules, TTL wording from `BRC_API_KEY_TTL_MINUTES`, and response wording.

---

## 10. BRC Edu help resources

Support and webinar teams maintain `webinar_video_routing_index.csv` in the shared **Red Edu** OneDrive folder:

[Red Edu folder on SharePoint](https://bigredbook-my.sharepoint.com/my?id=%2Fpersonal%2Flauren%5Fdwyer%5Fbigredbook%5Fcom%2FDocuments%2FRed%20Edu&viewid=c3f46ceb%2D1a27%2D45f7%2Dbcb6%2D3a692ffb1e97)

That SharePoint link is for humans. Red does not write to OneDrive or SharePoint during normal user chats.

Support CSV columns (support-friendly headers shown; internal names also accepted):

- `Video Title` / `title`
- `Video URL` / `url`
- `Help-Routing Category` / `preferredCategory`
- `notes` (optional)
- `active` (optional; defaults to true)

### Local / dev workflow

Developers run `npm run build` then `npm run sync:brc-edu`. The sync writes `dev_only_video_routing_index_updated.csv` for local inspection. With `BRC_EDU_SOURCE=local`, Red reads that generated CSV through `brc_find_help_resources`.

Path configuration (optional):

- `BRC_EDU_SUPPORT_CSV_PATH` — support CSV path (default: `data/webinar_video_routing_index.csv`)
- `BRC_EDU_ENRICHED_CSV_PATH` — generated CSV path (default: `data/dev_only_video_routing_index_updated.csv`)

Local OneDrive example:

```text
BRC_EDU_SOURCE=local
BRC_EDU_SUPPORT_CSV_PATH=C:\Users\Lauren.Dwyer\OneDrive - Big Red Book\Red Edu\webinar_video_routing_index.csv
BRC_EDU_ENRICHED_CSV_PATH=C:\Users\Lauren.Dwyer\OneDrive - Big Red Book\Red Edu\dev_only_video_routing_index_updated.csv
```

### Production / staging (admin upload)

Internal/support users manage BRC Edu webinar resources through a browser admin page. Red stores uploaded files in Azure Blob Storage for downstream processing (for example, an Azure Function). This step does not parse or enrich the file.

#### Staff access (Microsoft Entra / App Service Authentication)

Primary access is Azure App Service Authentication with Microsoft Entra ID. Staff ask Red to open the admin page; Red returns a clickable link only — never a shared password or secret.

1. Staff ask Red: "Open Red's admin page"
2. Red calls `brc_open_edu_admin` and returns the protected URL
3. Opening the link redirects to Microsoft sign-in when the user is not authenticated
4. After sign-in, only authorised Big Red Book staff (configured Entra group or app role) can access the page
5. Unauthorised users see: `This area is available only to authorised Big Red Cloud staff.`

Protected route (default):

- `GET /internal/brc-edu/resources/upload` — admin page
- `POST /internal/brc-edu/resources/upload` — `multipart/form-data` with field name `file`
- Workbook API routes under the same path prefix

MCP tool:

- `brc_open_edu_admin` — returns the customer-facing protected admin URL only (no secret, no query parameters, does not bypass authentication)

Entra configuration:

- `BRC_EDU_ADMIN_ENTRA_TENANT_ID` — allowed Microsoft Entra tenant ID (required for Entra access)
- `BRC_EDU_ADMIN_ENTRA_GROUP_ID` — allowed Entra security group object ID (for example BRC Edu Admins), and/or
- `BRC_EDU_ADMIN_ENTRA_APP_ROLE` — allowed app role value
- `BRC_EDU_ADMIN_PROTECTED_PATH` — protected admin path (default `/internal/brc-edu/resources/upload`)
- `BRC_EDU_ADMIN_PUBLIC_URL` — customer-facing absolute admin URL (optional; otherwise derived from `RED_PUBLIC_BASE_URL` / `BRC_PUBLIC_BASE_URL`)

App Service setup:

- Enable Authentication with Microsoft as the identity provider
- Allow unauthenticated requests at the platform level so Red can redirect to `/.auth/login/aad` and enforce group/role checks in application code
- Configure the Entra app registration to emit group claims or assign the configured app role

Access logging:

- Logs authenticated staff identity, access time, method (`entra` or `secret`), and result
- Never logs tokens or `BRC_EDU_ADMIN_UPLOAD_SECRET`

#### Emergency secret fallback (temporary)

Until Entra access is verified, the shared secret query parameter remains available as an emergency fallback only. Do not expose it to Red, MCP output, browser bookmarks shared with customers, or logs.

- `?secret=<BRC_EDU_ADMIN_UPLOAD_SECRET>` — emergency fallback only
- `BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK=false` — disable the secret path after Entra is verified

Accepted files:

- `.xlsx` or `.csv` only
- Maximum size: 5 MB

Blob paths written on successful upload:

- Latest: `brc-edu/latest/webinar_video_routing_index.<ext>`
- Archive: `brc-edu/archive/webinar_video_routing_index_YYYYMMDD_HHmmss.<ext>`

Responses:

- `200` — HTML success page (POST) or upload form (GET)
- `302` — redirect to Microsoft sign-in when Entra is configured and the user is unauthenticated
- `400` — missing file, invalid file type, or file too large
- `401` — missing/wrong emergency secret (secret-only mode), or authentication required
- `403` — signed-in user is not in the approved Entra group/role
- `503` — admin access is not configured, or blob storage env vars are missing (POST upload only)

Storage configuration:

- `BRC_EDU_ADMIN_UPLOAD_SECRET` — emergency shared secret only (optional once Entra is verified)
- `BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING` — Azure Storage connection string for uploaded files
- `BRC_EDU_UPLOAD_CONTAINER` — blob container name for uploaded files

### Production / staging (Azure Function processor)

When a BRC Edu resource file is uploaded to blob storage, an Azure Function can process the latest blob and push CSV text to Red’s existing sync endpoint.

Trigger:

- Blob trigger on `brc-edu-resources/brc-edu/latest/{name}`

Supported files:

- `.csv` — read as UTF-8 text
- `.xlsx` — first worksheet converted to CSV text

The function POSTs to Red:

- `POST /internal/brc-edu/resources/sync`
- Header: `x-red-edu-sync-secret: <secret>`
- Body: `{ "csvText": "..." }`

Function configuration:

- `AzureWebJobsStorage` — Function App runtime storage account
- `BRC_EDU_STORAGE_CONNECTION` — BRC Edu blob storage account connection for the blob trigger
- `RED_BRC_EDU_SYNC_ENDPOINT` — full Red sync URL
- `RED_BRC_EDU_SYNC_SECRET` — shared secret for the sync header

Logging:

- Logs filename and success/failure only
- Does not log the sync secret or full file content

Implementation:

- `functions/brc-edu-resource-processor/` — Azure Function app (`brcEduResourceProcessor`)

### Production / staging (push sync)

Power Automate or another trusted internal automation can push the support CSV to Red without OneDrive access from the server.

Endpoint:

- `POST /internal/brc-edu/resources/sync`
- Header: `x-red-edu-sync-secret: <secret>` (from `BRC_EDU_SYNC_SECRET`)
- Body: `{ "csvText": "Video Title,Video URL,Help-Routing Category\n..." }`

Responses:

- `200` — `{ ok, rowsRead, rowsEnriched, inactiveRows, needsReviewRows, storedAt }`
- `400` — missing or invalid `csvText`
- `401` — missing or wrong sync secret header
- `503` — `BRC_EDU_SYNC_SECRET` is not configured

Red validates the secret, parses and enriches the CSV, and writes `data/brc_edu_synced_resources.json` (or `BRC_EDU_SYNCED_RESOURCES_PATH`). `brc_find_help_resources` prefers this synced JSON over the local generated CSV fallback.

Configuration:

- `BRC_EDU_SYNC_SECRET` — shared secret for the sync endpoint (required for sync to work)
- `BRC_EDU_SYNCED_RESOURCES_PATH` — JSON store path (default: `data/brc_edu_synced_resources.json`)

### Production / staging (Microsoft Graph, optional)

With `BRC_EDU_SOURCE=graph`, Red can still read the support CSV from OneDrive/SharePoint using Microsoft Graph when no synced JSON is available. This path is optional and not the default for new deployments.

Graph configuration:

- `BRC_EDU_GRAPH_TENANT_ID`
- `BRC_EDU_GRAPH_CLIENT_ID`
- `BRC_EDU_GRAPH_CLIENT_SECRET`
- `BRC_EDU_GRAPH_DRIVE_ID`
- `BRC_EDU_GRAPH_ITEM_ID`

If Graph is unavailable or misconfigured, Red logs a safe warning and falls back to the local generated CSV when present. Synced JSON (from push sync) is always preferred when available.

Implementation:

- `functions/brc-edu-resource-processor/` — Azure Function blob trigger that converts uploaded files and calls Red sync
- `src/edu/brc_edu_paths.ts` — resolves support and enriched CSV paths from environment variables
- `src/edu/brc_edu_synced_store.ts` — push-sync JSON store, validation, and enrichment pipeline for the HTTP endpoint
- `src/edu/brc_edu_upload_store.ts` — admin upload auth, validation, and Azure Blob Storage writes
- `src/edu/brc_edu_admin_auth.ts` — Microsoft Entra / Easy Auth staff access for the admin page
- `src/tools/edu/edu_admin_tools.ts` — `brc_open_edu_admin` MCP tool (protected URL only)
- `src/edu/brc_edu_upload_page.ts` — internal HTML upload form and result pages
- `src/edu/brc_edu_graph.ts` — client-credentials Microsoft Graph download for the support CSV
- `src/edu/brc_edu_enrichment.ts` — category inference and CSV formatting for sync
- `src/edu/brc_edu_resources.ts` — loads synced JSON first, then graph/local CSV; searches enriched resources for `brc_find_help_resources`
- `scripts/sync_brc_edu_from_support_csv.mjs` — dev/admin sync only; normal user chats do not write CSV
