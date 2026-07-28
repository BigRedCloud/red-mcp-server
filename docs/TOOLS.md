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
├── telemetry/                     Anonymous client/session identity and platform detection
├── config/
│   ├── server_config.ts           Deployment skill gating (BRC_ALLOW_* flags)
│   ├── mcp_config.ts              MCP server instructions and connection-safety rules
│   └── red_public_base_url.ts     Public base URL used for help screenshot links
├── guards/                        Transaction, reference, VAT, product line, and write-confirmation checks
├── data_quality/                  Lightweight data-quality checks (e.g. customer name/email)
├── brc-edu/
│   ├── freshdesk/                 Freshdesk support articles, screenshots, and public image links
│   ├── customer-docs/             Customer documentation index
│   ├── upcoming-webinars/         Upcoming webinar index
│   └── help/                      Unified help search and resource-detail formatting
├── edu/                           Help-resource loading, enrichment, workbook parsing, and storage configuration
└── tools/
    ├── general/                   Generic list/get/create/update/delete/batch + payload builders
    ├── setup/                     Company context, setup config, readiness, deployment policy, processing settings
    ├── sales-emails/              Quotes, sales invoices, sales entries, credit notes, sales reps, email
    ├── purchases/                 Purchases and suppliers
    ├── bank-payments/             Bank accounts, payments, cash payments, cash receipts
    ├── journals/                  Nominal reports and nominal journal batches
    ├── edu/                       Read-only help-resource tools
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
- **`src/config/mcp_config.ts`** — Server instructions, connection-safety rules, help-answer presentation rules, and rules that keep `connectionRef` out of normal user-facing chat.
- **`src/read_connection_metadata.ts`** — Adds `connectionStatus`, `activeConnectionRef`, `assistantInstruction`, and `presentationHint` to enriched tool responses in hosted HTTP mode.
- **`src/auth/connection_presentation.ts`** — `formatCredentialTtlForUser()`, confirm/list customer messages, and `shouldShowDeveloperConnectionDetails()` (respects `BRC_ALLOW_DEV_MODE`).
- **`src/auth/credential_validation.ts`** — Validates each API key with the same class of BRC read access as live tools (`GET /v1/customers?page=1&pageSize=1`, plus financial year). Failed keys are not stored.
- **`src/auth/connection_persistence.ts`** — `validateAndPersistConnectedCompanies()` used by `POST /connect`; clears stale per-company entries before re-validating on CSV resubmit.
- **`src/auth/`** — The secure connection flow: connection page rendering, pending/connection stores (in-memory or Cosmos), connection codes, connectionRef, and credential handling. API keys are never returned to clients.
- **`src/telemetry/`** — Anonymous `telemetry_client_id` / `connection_session_id`, platform detection (`claude` | `chatgpt` | `mistral` | `unknown`), and span enrichment for hosted Application Insights. See [TELEMETRY.md](TELEMETRY.md).
- **`src/tools/sales-emails/sales_invoice_payload_schemas.ts`** — Multi-line generated-reference sales invoice payload schema and field-level reconciliation (`acEntries`, line totals, header totals).
- **`src/brc-edu/help/`** — Unified search across Freshdesk articles, customer documentation, recorded webinars, and upcoming webinars.
- **`src/brc-edu/freshdesk/`** — Freshdesk article processing, screenshot metadata, signed public image links, and help-answer formatting.
- **`src/tools/edu/help_resources_tools.ts`** — Registers `brc_find_help_resources` and `brc_get_help_resource_details`. These read-only tools do not require a connected company.
- **`src/config/red_public_base_url.ts`** — Resolves the public base URL used when generating screenshot links.

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
Runtime auth failure (confirmed 401 / invalid-credential body only)
  → invalidateCompanyCredential(); company_credential_invalid response
Other non-2xx (403/404/422/500, timeouts, validation/permission failures)
  → preserve stored credential; surface as an API/request error (not “expired API key”)
```

**CSV and partial success.** Each row is validated independently. A bad key for Company A does not prevent Companies B/C/D from connecting. Stale store entries for a resubmitted company name are cleared before validation.

**Presentation.** `customerMessage` and MCP instructions tell assistants to use plain language for users. `connectionRef`, `redconn_…`, and session diagnostics stay in structured tool output for MCP clients only.

**Session duration.** `BRC_API_KEY_TTL_MINUTES` controls credential expiry and user-facing duration text via `connection_presentation.ts` (for example `240` → “about 4 hours”).

**connectionRef reuse.** Credential-requiring tools accept an optional `connectionRef` (see `src/auth/connection_ref.ts` and `withConnectionRefSchema` in `register_all_tools.ts`). MCP clients should preserve and silently reuse `connectionRef` / `activeConnectionRef` when platforms rotate MCP session IDs. Where a shared connection store is configured, connection persistence survives MCP session rotation. Tools that never need company credentials omit the argument (`CONNECTION_REF_SCHEMA_EXEMPT_TOOLS`: getting started, deployment policy, help tools, and `brc_open_edu_admin`).

Operator/developer telemetry identity (anonymous only) is documented in [TELEMETRY.md](TELEMETRY.md).

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
- For `brc_create_sales_invoice_gen_ref`, each `productTrans` line must include its own nested `acEntries` analysis allocation. Cross-field checks cover line net/VAT/gross reconciliation, analysis allocation totals, header totals, and required product/VAT/analysis fields. Failures return structured field-level validation errors (`valid: false`) before preview-before-posting and before posting.
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

Credential-requiring tools accept an optional `connectionRef` argument (hosted HTTP). Describe that behaviour once here — it is not repeated on every tool row below. See section 4 and `src/auth/connection_ref.ts`.

### Help and training resources

These tools are read-only and do not require a connected Big Red Cloud company.

| MCP tool | Purpose |
| -------- | ------- |
| `brc_find_help_resources` | Search Freshdesk support articles, customer documentation, recorded webinars, and upcoming webinars |
| `brc_get_help_resource_details` | Load the full details for a selected resource, including article steps and relevant screenshot links where available |
| `brc_open_edu_admin` | Staff helper: returns the protected BRC Edu admin page URL (Microsoft Entra sign-in still required). Never returns upload secrets or bypass links. Not a customer company-data tool. |

`brc_find_help_resources` supports source filtering so callers can search all help sources or a specific source.

Freshdesk resource details may include:

- official article links;
- step-by-step instructions;
- screenshot links;
- related recorded videos;
- a Big Red Cloud support fallback.

These tools are intended for product help and training questions, not for accessing a customer’s accounting data.

### Help and training resources

These tools are read-only and do not require a connected Big Red Cloud company.

| MCP tool | Purpose |
| -------- | ------- |
| `brc_find_help_resources` | Search Freshdesk support articles, customer documentation, recorded webinars, and upcoming webinars |
| `brc_get_help_resource_details` | Load the full details for a selected resource, including article steps and relevant screenshot links where available |

`brc_find_help_resources` supports source filtering so callers can search all help sources or a specific source.

Freshdesk resource details may include:

- official article links;
- step-by-step instructions;
- screenshot links;
- related recorded videos;
- a Big Red Cloud support fallback.

These tools are intended for product help and training questions, not for accessing a customer’s accounting data.

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
| `brc_company_readiness_check` | Overall company health/readiness for a connected company |
| `brc_validate_transaction_date` | Financial-year date validation |
| `brc_get_deployment_policy` | Active safety flags and policy |
| `brc_get_company_processing_settings` | Mapped processing settings |
| `brc_get_company_reference_settings` | Reference auto-generation settings |
| `brc_check_transaction_settings` | Combined transaction safety check for one VAT-sensitive workflow |

**`brc_company_readiness_check` overall statuses:** `ready`, `ready_with_warnings`, `not_ready`, `connection_problem`.

Checks include connection status, financial year / transaction date position, customers, products, suppliers, sales reps, active Sales VAT rates, Sales Analysis categories, processing settings, and reference settings. Missing suppliers is a purchase-setup warning and does **not** block sales-invoice readiness. Manual reference modes are warnings / preflight considerations, not necessarily blockers.

Use readiness for overall setup health. Use `brc_check_transaction_settings` (and the narrower date/processing/reference helpers) when preparing a specific workflow.

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
| `brc_list_bank_accounts` | GET | `/v1/bankAccounts` |
| `brc_get_bank_account` | GET | `/v1/bankAccounts/{id}` |
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
- **`brc_create_sales_invoice_gen_ref` multi-line behaviour.** The raw BRC payload may contain multiple `productTrans` lines. Each line must include its own nested `acEntries` analysis allocation (at least one entry). Before preview-before-posting and before posting, Red validates line net/VAT/gross reconciliation, analysis allocation totals against line net, header totals, and required product/VAT/analysis fields. Validation failures return structured field-level errors (for example `productTrans.1.acEntries`) and do not call Big Red Cloud. Placeholder `productId` values `0` and `1` are blocked; Sales VAT category validation still applies. Write tools still require explicit confirmation after a successful preview — nothing is written until confirmed. Previews before posting are not drafts stored in Big Red Cloud.

---

## 8. Under-development and deployment-gated tools

- **Bank account writes.** Read-only `brc_list_bank_accounts` and `brc_get_bank_account` are available for payment workflows. Bank create/update/delete may require additional tenant configuration and can be gated by deployment flags.
- **Email sending.** `brc_send_sales_invoice_email`, `brc_send_email_statement`, and `brc_send_quote_email` (endpoints under `/v1/email/...`) require a send confirmation and depend on tenant email configuration; they may be disabled by deployment flags.
- **Operator/dev diagnostics.** Tools such as `brc_set_company_api_key`, `brc_get_dev_mode_details`, `brc_dev_diagnose_company_processing_settings`, and `brc_get_connection_store_diagnostics` are available only when `BRC_ALLOW_DEV_MODE` is enabled. They are operator/development aids, not normal customer tools. Do not document or present them as customer-facing company workflows.

Skill groups (read, update, delete, email, batch, dev) are toggled by the `BRC_ALLOW_*` environment variables. When a group is disabled, its tools return a permission message instead of calling Big Red Cloud. Use `brc_get_deployment_policy` to inspect the active policy.

---

## 9. Where to find tests

Tests use the Node.js built-in test runner and live alongside the source as `*.test.ts` files (compiled to `build/` before running).

- `npm test` — build, then run the full suite.
- `npm run test:unit` — unit tests.
- `npm run test:security` — security-focused tests.
- `npm run test:config` — deployment/config tests.
- `npm run test:integration` — integration tests.


Representative coverage includes sales invoice safeguards (including multi-line generated-reference `acEntries` validation), transaction date validation, transaction settings warnings, company readiness scoring, the secure connection flow, connectionRef persistence/presentation rules, TTL wording, response wording, unified help search, Freshdesk article ranking, screenshot links, recorded webinar matching, and help-resource details.


---

## 10. Help and training resources

Red can answer Big Red Cloud how-to and training questions using deployment-provided support indexes. These help tools are read-only and do not require a connected company.

### Supported sources

`brc_find_help_resources` can search:

| Source | Content |
| ------ | ------- |
| Freshdesk | Official support articles and screenshots |
| Customer documentation | Big Red Cloud procedural and product documentation |
| Recorded webinars | Relevant training and webinar recordings |
| Upcoming webinars | Scheduled training events and registration information |

The optional source filter accepts:

- `all`
- `freshdesk`
- `customer_docs`
- `recorded_webinar`
- `upcoming_webinar`

### Help search

`brc_find_help_resources` ranks resources according to the user's question and returns the strongest matches.

Results can contain:

- resource ID;
- title;
- source type;
- short description;
- article or video URL;
- relevance information;
- suggested next action.

The returned `resourceId` can be passed to `brc_get_help_resource_details`.

### Resource details

`brc_get_help_resource_details` returns the full available information for one selected resource.

For a Freshdesk article, this may include:

- article title and official URL;
- step-by-step instructions;
- screenshot captions;
- signed screenshot links;
- related videos;
- support contact information.

For recorded webinars, it may include:

- video title;
- YouTube URL;
- description;
- topic and category metadata.

### Screenshot links

Freshdesk screenshots are served through a public, signed image route. The links are time-limited and do not expose storage credentials.

The hosted server uses the configured public application base URL when creating screenshot links.

Public route format:

```text
/public/brc-edu/freshdesk-images/:articleId/:imageToken
```

The public repository includes the route, token validation, and image presentation logic. It does not include Big Red Cloud's internal content-management or resource-upload workflow.

### Source layout

Key implementation files:

- `src/tools/edu/help_resources_tools.ts` — MCP help-tool registration
- `src/brc-edu/help/unified-help-search.ts` — combined help-source ranking
- `src/brc-edu/help/help-resource-details.ts` — detailed resource responses
- `src/brc-edu/help/help-answer-layout.ts` — help answer structure
- `src/brc-edu/help/help-answer-sources.ts` — article and video source formatting
- `src/brc-edu/freshdesk/` — Freshdesk article and screenshot handling
- `src/brc-edu/customer-docs/` — customer-document search index
- `src/brc-edu/upcoming-webinars/` — upcoming-webinar parsing and index loading
- `src/edu/brc_edu_resources.ts` — recorded-webinar resource loading
- `src/edu/brc_edu_storage_config.ts` — shared help-index storage configuration
- `src/config/red_public_base_url.ts` — public screenshot-link base URL

Help-resource indexes are supplied by the deployment operator. Public users cannot use these MCP tools to modify the live indexes or upload replacement support content.
