# Red MCP Server — Developer Guide

This document describes the source layout, tool registration flow, safety guards, and MCP tool coverage of the Red MCP Server. It is intended for developers and technical reviewers who want to inspect the implementation. The main [`README.md`](../README.md) stays concise; this file holds the detail.

Tool names and endpoint paths below reflect what is implemented in the source under `src/`. When in doubt, the source is authoritative.

Public documentation note: this guide lists MCP tool names for developers. Customer-facing assistants should still prefer plain business language and the `brc_get_deployment_policy` capability summary rather than dumping tool catalogues to end users.

---

## 1. Source layout overview

```text
src/
├── index.ts                       Local stdio entry point
├── remote.ts                      Hosted HTTP entry point (Streamable HTTP on /mcp)
├── server.ts                      MCP server factory and stdio singleton
├── register_all_tools.ts          Central tool registration + routing + write-confirmation wrapping
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
├── routing/                       Request classification and short-lived routeToken handling
├── config/
│   ├── server_config.ts           Deployment skill gating (BRC_ALLOW_* flags)
│   ├── mcp_config.ts              MCP server instructions and connection-safety rules
│   └── red_public_base_url.ts     Public base URL used for help screenshot links
├── guards/                        Transaction, reference, VAT, product line, and write-confirmation checks
├── data_quality/                  Lightweight data-quality checks (e.g. customer name/email)
├── brc-edu/
│   ├── freshdesk/                 Freshdesk support articles, screenshots, and public image links
│   ├── customer-docs/             Customer documentation index
│   ├── youtube/                   YouTube / recorded-webinar catalogue helpers
│   ├── upcoming-webinars/         Upcoming webinar index
│   └── help/                      Unified help search and resource-detail formatting
├── edu/                           Help-resource loading, enrichment, workbook parsing, and storage configuration
└── tools/
    ├── general/                   Generic list/get/create/update/delete/batch + payload builders
    ├── setup/                     Company context, setup config, readiness, deployment policy, processing settings
    ├── routing/                   brc_route_request registration
    ├── sales-emails/              Quotes, sales invoices, sales entries, credit notes, sales reps, email
    ├── purchases/                 Purchases and suppliers
    ├── bank-payments/             Bank accounts, payments, cash payments, cash receipts
    ├── journals/                  Nominal reports and nominal journal batches
    ├── edu/                       Read-only help-resource tools (and staff admin URL helper)
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
  - tools whose skill group is disabled are **skipped** (not registered with the MCP client), and
  - transactional tools receive `routeToken` schema/description wrapping, and
  - write tools receive preview-before-posting/confirmation handling and the appropriate confirmation schema fields.
- **`src/shared.ts`** — The Big Red Cloud HTTP client (`brcFetch`, JSON request helpers), session-scoped connection storage, the session audit log, list/response helpers, and user-facing status wording.
- **`src/config/server_config.ts`** — Classifies each tool into a skill group and decides whether it is enabled, based on the `BRC_ALLOW_*` flags.
- **`src/config/mcp_config.ts`** — Server instructions, connection-safety rules, help-answer presentation rules, routing guidance, and rules that keep `connectionRef` out of normal user-facing chat.
- **`src/routing/`** — Intent classification helpers and opaque short-lived `routeToken` issuance/validation (`route-token.ts`).
- **`src/read_connection_metadata.ts`** — Adds `connectionStatus`, `activeConnectionRef`, `assistantInstruction`, and `presentationHint` to enriched tool responses in hosted HTTP mode.
- **`src/auth/connection_presentation.ts`** — `formatCredentialTtlForUser()`, confirm/list customer messages, and developer-detail presentation helpers.
- **`src/auth/credential_validation.ts`** — Validates each API key with the same class of BRC read access as live tools (`GET /v1/customers?page=1&pageSize=1`, plus financial year). Failed keys are not stored.
- **`src/auth/connection_persistence.ts`** — `validateAndPersistConnectedCompanies()` used by `POST /connect`; clears stale per-company entries before re-validating on CSV resubmit.
- **`src/auth/`** — The secure connection flow: connection page rendering, pending/connection stores (in-memory or Cosmos), connection codes, connectionRef, and credential handling. API keys are never returned to clients.
- **`src/telemetry/`** — Anonymous `telemetry_client_id` / `connection_session_id`, platform detection (`claude` | `chatgpt` | `mistral` | `unknown`), and span enrichment for hosted Application Insights. See [TELEMETRY.md](TELEMETRY.md).
- **`src/tools/sales-emails/sales_invoice_payload_schemas.ts`** — Multi-line generated-reference sales invoice payload schema and field-level reconciliation (`acEntries`, line totals, header totals).
- **`src/brc-edu/help/`** — Unified search across Freshdesk articles, customer documentation, recorded webinars, and upcoming webinars.
- **`src/brc-edu/freshdesk/`** — Freshdesk article processing, screenshot metadata, signed public image links, and help-answer formatting.
- **`src/tools/edu/help_resources_tools.ts`** — Registers `brc_red_help`, `brc_find_help_resources`, and `brc_get_help_resource_details`. These read-only tools do not require a connected company.
- **`src/tools/routing/route_request_tools.ts`** — Registers `brc_route_request`.
- **`src/config/red_public_base_url.ts`** — Resolves the public base URL used when generating screenshot links.

---

## 3. Tool registration flow

```text
index.ts / remote.ts
  → createBrcMcpServer()
  → registerAllTools(server)
       → wraps server.tool(...) (skill gating + routeToken + write confirmation)
       → registers each domain tool module once
```

Registration details:

- **Skill gating.** `registerAllTools` consults `isToolEnabled(toolName)`. If the tool's skill group is disabled by a deployment flag, registration is **skipped** (the tool is not exposed to MCP clients for that process).
- **Route tokens.** For update/delete/batch/email skill tools, the wrapper adds a required `routeToken` argument. Callers obtain the token from `brc_route_request` for the matching action workflow. A route token is routing permission only — it does not replace preview-before-posting or user confirmation.
- **Write confirmation.** For most write tools (update/delete/batch skill groups and equivalents), the wrapper adds `confirmWrite` and, where relevant, `confirmCounterpartyExplicit` to the schema, and routes the first call through a preview-before-posting response. The underlying handler runs only after explicit confirmation. Email tools use their own `confirmSend` flow; bank-account create uses `confirmCreate`.
- **Generic helpers.** Most list/get/create/update/delete/batch tools are produced by helpers in `src/tools/general/` (`registerListTool`, `registerGetTool`, `registerSubresourceGetTool`, `registerRawCreateTool`, `registerRawUpdateTool`, `registerRawDeleteTool`, `registerRawBatchTool`). Payload normalisation lives in `payloads_tools.ts`.

### Skill groups and deployment flags

| Skill group | Typical tools | Flag (default) |
| ----------- | ------------- | -------------- |
| session | connection, getting started, deployment policy, routing, help | always registered |
| read | list/get/readiness/reports/audit list | `BRC_ALLOW_READ_SKILLS` (true) |
| update | create/update/gen_ref/close/reopen/process | `BRC_ALLOW_UPDATE_SKILLS` (true) |
| delete | delete tools | `BRC_ALLOW_DELETE_SKILLS` (true) |
| email | `brc_send_*` | `BRC_ALLOW_EMAIL_SKILLS` (true) |
| batch | `brc_batch_*` | `BRC_ALLOW_BATCH_SKILLS` (true) |
| dev | operator diagnostics | `BRC_ALLOW_DEV_MODE` (false) |

`brc_get_deployment_policy` returns a **customer-facing** plain-language summary of which capability classes are available. It does not list MCP tool names or environment variables.

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

**connectionRef reuse.** Credential-requiring tools accept an optional `connectionRef` (see `src/auth/connection_ref.ts` and `withConnectionRefSchema` in `register_all_tools.ts`). MCP clients should preserve and silently reuse `connectionRef` / `activeConnectionRef` when platforms rotate MCP session IDs. Where a shared connection store is configured, connection persistence survives MCP session rotation.

Tools that never need company credentials omit the `connectionRef` argument (`CONNECTION_REF_SCHEMA_EXEMPT_TOOLS`):

- `brc_get_deployment_policy`
- `brc_route_request`
- `brc_red_help`
- `brc_find_help_resources`
- `brc_get_help_resource_details`
- `brc_open_edu_admin` (staff helper only — see section 8)

Operator/developer telemetry identity (anonymous only) is documented in [TELEMETRY.md](TELEMETRY.md).

---

## 5. Request routing and write safeguards

### Request routing (`routeToken`)

Transactional create/update/delete/batch/email tools require an opaque short-lived `routeToken` issued by `brc_route_request` for the matching action workflow.

- Call `brc_route_request` with the user's complete original message before transactional accounting tools.
- Tokens are HMAC-signed, expire after a short TTL (about five minutes), and are consumed after a confirmed write.
- A valid `routeToken` is **not** permission to post. Preview-before-posting and explicit confirmation still apply.
- Read-only tools, connection/session helpers, and help tools do not require a route token.

### Preview before posting and confirmation

Most write tools (skill groups update/delete/batch, plus `brc_clear_audit_log`) use the shared write-confirmation wrapper:

1. First call without `confirmWrite: true` returns `confirmation_required` and a payload preview.
2. The assistant shows a plain-English preview in chat and waits for an explicit later-message yes.
3. Retry with `confirmWrite: true` only after that confirmation.
4. Where a customer or supplier is required, `confirmCounterpartyExplicit: true` must also be set on the confirmed call.

Special cases:

| Tools | Confirmation field | Notes |
| ----- | ------------------ | ----- |
| Most create/update/delete/batch tools | `confirmWrite` | Shared preview wrapper |
| Document tools that require a counterparty | also `confirmCounterpartyExplicit` | Sales/purchase/cash/payment creates and matching batches |
| `brc_create_bank_account` | `confirmCreate` | Own preview/confirm path (still requires `routeToken`) |
| `brc_send_sales_invoice_email`, `brc_send_quote_email`, `brc_send_email_statement` | `confirmSend` | Email preview; not the shared `confirmWrite` wrapper |
| `brc_process_vat_category_rates` | `confirmProcess` | Still behind write-confirmation wrapping / routing as classified |

Guards in `src/guards/` run before preview-before-posting and before posting:

- **`write_confirmation.ts`** — Preview-before-posting flow; counterparty confirmation; placeholder product ID preflight; Sales VAT category preflight; missing-contact presentation.
- **`company_processing_settings.ts`** — VAT-sensitive workflow rules, including Gross Price Entry `priceBasis`, margin VAT scheme blocking, VAT discrepancy tolerance wording, reverse-charge guidance, and cash receipt VAT (VOCR) handling.
- **`company_reference_settings.ts`** — Manual vs auto-generated reference handling per workflow.
- **`sales_vat_category.ts`** — Blocks sales invoice lines that use a purchase/non-Sales VAT rate.
- **`document_draft_details.ts`** — Preview contact details for quotes and sales invoices.

Sales invoice safeguards (summary):

- Gross Price Entry requires an explicit `priceBasis` of `gross` or `net`.
- Sales invoices must use a Sales VAT category; purchase VAT rates are blocked.
- `productId` `0` and `1` are treated as placeholders and blocked before preview-before-posting and post.
- For `brc_create_sales_invoice_gen_ref`, each `productTrans` line must include its own nested `acEntries` analysis allocation. Cross-field checks cover line net/VAT/gross reconciliation, analysis allocation totals, header totals, and required product/VAT/analysis fields. Failures return structured field-level validation errors (`valid: false`) before preview-before-posting and before posting.
- `note` defaults to the customer name unless explicitly provided, and is never a product name.
- `deliveryTo` is included only when explicitly provided.

---

## 6. MCP tool coverage by domain

Endpoint paths are relative to the configured Big Red Cloud API base URL.

**Read-only** tools proceed without write confirmation. **Create / update / delete / batch / email** tools require routing and confirmation as described above.

### Company connection and session (setup)

| MCP tool | Kind | Purpose |
| -------- | ---- | ------- |
| `brc_start_company_connection` | setup | Start the secure connection flow; returns a connection page link |
| `brc_confirm_company_connection` | setup | Confirm a completed connection; returns `connectedCompanies`, `failedCompanies`, and `connectionRef` (for MCP clients) |
| `brc_get_company_api_key_status` | setup | Report whether a company is connected and when it expires (never returns the key) |
| `brc_list_company_contexts` | setup | List companies connected in the session (`customerMessage` + `presentationHint`) |
| `brc_clear_company_api_key` | setup | Clear one company connection |
| `brc_clear_all_company_api_keys` | setup | Clear all company connections |
| `brc_get_deployment_policy` | setup | Customer-facing capability summary for this deployment |
| `brc_route_request` | setup / routing | Classify the user message; for action mode, issue a short-lived `routeToken` for the permitted workflow |

Credential-requiring tools accept an optional `connectionRef` argument (hosted HTTP). Describe that behaviour once here — it is not repeated on every tool row below. See section 4 and `src/auth/connection_ref.ts`.

### Help and training resources (read-only)

These tools are read-only and do not require a connected Big Red Cloud company.

| MCP tool | Purpose |
| -------- | ------- |
| `brc_red_help` | Preferred help entry for reserved `red-help` / `/red-help` style commands and manual guidance |
| `brc_find_help_resources` | Search Freshdesk support articles, customer documentation, recorded webinars, and upcoming webinars (compatibility / general search) |
| `brc_get_help_resource_details` | Load the full details for a selected resource, including article steps and relevant screenshot links where available |

`brc_find_help_resources` / `brc_red_help` support source filtering so callers can search all help sources or a specific source (`all`, `freshdesk`, `customer_docs`, `recorded_webinar`, `upcoming_webinar`).

Freshdesk resource details may include official article links, step-by-step instructions, screenshot links, related recorded videos, and a Big Red Cloud support fallback.

These tools are intended for product help and training questions, not for accessing a customer’s accounting data.

### Company setup and readiness (read-only unless noted)

| MCP tool | HTTP | Endpoint |
| -------- | ---- | -------- |
| `brc_get_company_setup_config` | GET | `/v1/companySetupConfig` |
| `brc_get_company_logo` | GET | `/v1/companySetupConfig/getCompanyLogo` |
| `brc_get_financial_year` | GET | `/v1/companySetupConfig/getFinancialYear` |

| MCP tool | Kind | Purpose |
| -------- | ---- | ------- |
| `brc_company_readiness_check` | read | Overall company health/readiness for a connected company |
| `brc_validate_transaction_date` | read | Financial-year date validation |
| `brc_get_company_processing_settings` | read | Mapped processing settings (raw `/v1/companySetupConfig/getCompanyOptions` via `includeRaw`) |
| `brc_get_company_reference_settings` | read | Reference auto-generation settings |
| `brc_check_transaction_settings` | read | Combined transaction safety check for one VAT-sensitive workflow |

**`brc_company_readiness_check` overall statuses:** `ready`, `ready_with_warnings`, `not_ready`, `connection_problem`.

Checks include connection status, financial year / transaction date position, customers, products, suppliers, sales reps, active Sales VAT rates, Sales Analysis categories, processing settings, and reference settings. Missing suppliers is a purchase-setup warning and does **not** block sales-invoice readiness. Manual reference modes are warnings / preflight considerations, not necessarily blockers.

Use readiness for overall setup health. Use `brc_check_transaction_settings` (and the narrower date/processing/reference helpers) when preparing a specific workflow.

### Customers and suppliers

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_customers` | GET | `/v1/customers` | read |
| `brc_list_customers_without_dormant` | GET | `/v1/customers/GetWithoutDormant` | read |
| `brc_get_customer` | GET | `/v1/customers/{id}` | read |
| `brc_create_customer` | POST | `/v1/customers` | create |
| `brc_update_customer` | PUT | `/v1/customers/{id}` | update |
| `brc_delete_customer` | DELETE | `/v1/customers/{id}` | delete |
| `brc_get_customer_opening_balance` | GET | `/v1/customers/{id}/openingBalance` | read |
| `brc_list_customer_op_bal_trans` | GET | `/v1/customers/{id}/openingBalanceList` | read |
| `brc_list_customer_account_trans` | GET | `/v1/customers/{id}/accountTrans` | read |
| `brc_list_customer_quotes` | GET | `/v1/customers/{id}/quotes` | read |
| `brc_list_suppliers` | GET | `/v1/suppliers` | read |
| `brc_get_supplier` | GET | `/v1/suppliers/{id}` | read |
| `brc_create_supplier` | POST | `/v1/suppliers` | create |
| `brc_update_supplier` | PUT | `/v1/suppliers/{id}` | update |
| `brc_delete_supplier` | DELETE | `/v1/suppliers/{id}` | delete |
| `brc_get_supplier_opening_balance` | GET | `/v1/suppliers/{id}/openingBalance` | read |
| `brc_list_supplier_op_bal_trans` | GET | `/v1/suppliers/{id}/openingBalanceList` | read |
| `brc_list_supplier_account_trans` | GET | `/v1/suppliers/{id}/accountTrans` | read |

### Products and sales reps

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_products` | GET | `/v1/products` | read |
| `brc_list_products_without_dormant` | GET | `/v1/products/GetWithoutDormant` | read |
| `brc_list_product_types` | GET | `/v1/productTypes` | read |
| `brc_get_product` | GET | `/v1/products/{id}` | read |
| `brc_create_product` | POST | `/v1/products` | create |
| `brc_update_product` | PUT | `/v1/products/{id}` | update |
| `brc_delete_product` | DELETE | `/v1/products/{id}` | delete |
| `brc_list_sales_reps` | GET | `/v1/salesReps` | read |
| `brc_get_sales_rep` | GET | `/v1/salesReps/{id}` | read |
| `brc_create_sales_rep` | POST | `/v1/salesReps` | create |
| `brc_update_sales_rep` | PUT | `/v1/salesReps/{id}` | update |
| `brc_delete_sales_rep` | DELETE | `/v1/salesReps/{id}` | delete |

### Sales documents

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_sales_entries` | GET | `/v1/salesEntries` | read |
| `brc_get_sales_entry` | GET | `/v1/salesEntries/{id}` | read |
| `brc_create_sales_entry` | POST | `/v1/salesEntries` | create |
| `brc_update_sales_entry` | PUT | `/v1/salesEntries/{id}` | update |
| `brc_delete_sales_entry` | DELETE | `/v1/salesEntries/{id}` | delete |
| `brc_list_sales_invoices` | GET | `/v1/salesInvoices` | read |
| `brc_get_sales_invoice` | GET | `/v1/salesInvoices/{id}` | read |
| `brc_create_sales_invoice` | POST | `/v1/salesInvoices` | create |
| `brc_create_sales_invoice_gen_ref` | POST | `/v1/salesInvoices/createSaleInvoiceWithGeneratingReference` | create |
| `brc_update_sales_invoice` | PUT | `/v1/salesInvoices/{id}` | update |
| `brc_delete_sales_invoice` | DELETE | `/v1/salesInvoices/{id}` | delete |
| `brc_list_sales_credit_notes` | GET | `/v1/salesCreditNotes` | read |
| `brc_get_sales_credit_note` | GET | `/v1/salesCreditNotes/{id}` | read |
| `brc_create_sales_credit_note` | POST | `/v1/salesCreditNotes` | create |
| `brc_create_sales_credit_note_gen_ref` | POST | `/v1/salesCreditNotes/createCreditNoteWithGeneratingReference` | create |
| `brc_update_sales_credit_note` | PUT | `/v1/salesCreditNotes/{id}` | update |
| `brc_delete_sales_credit_note` | DELETE | `/v1/salesCreditNotes/{id}` | delete |
| `brc_list_quotes` | GET | `/v1/quotes` | read |
| `brc_get_quote` | GET | `/v1/quotes/{id}` | read |
| `brc_create_quote` | POST | `/v1/quotes` | create |
| `brc_create_quote_gen_ref` | POST | `/v1/quotes/createQuoteWithGeneratingReference` | create |
| `brc_update_quote` | PUT | `/v1/quotes/{id}` | update |
| `brc_close_quote` | POST/PUT | `/v1/quotes/{id}/close` | update |
| `brc_reopen_quote` | POST/PUT | `/v1/quotes/{id}/reopen` | update |
| `brc_generate_sales_invoice_from_quote` | POST | `/v1/quotes/generateSaleInvoice` | create |
| `brc_delete_quote` | DELETE | `/v1/quotes/{id}` | delete |
| `brc_list_sales` | GET | `/v1/sales` | read |

### Purchases, payments, cash, and bank accounts

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_purchases` | GET | `/v1/purchases` | read |
| `brc_get_purchase` | GET | `/v1/purchases/{id}` | read |
| `brc_create_purchase` | POST | `/v1/purchases` | create |
| `brc_create_purchase_gen_ref` | POST | `/v1/purchases/createPurchaseWithGeneratingReference` | create |
| `brc_update_purchase` | PUT | `/v1/purchases/{id}` | update |
| `brc_delete_purchase` | DELETE | `/v1/purchases/{id}` | delete |
| `brc_list_payments` | GET | `/v1/payments` | read |
| `brc_get_payment` | GET | `/v1/payments/{id}` | read |
| `brc_create_payment` | POST | `/v1/payments` | create |
| `brc_update_payment` | PUT | `/v1/payments/{id}` | update |
| `brc_delete_payment` | DELETE | `/v1/payments/{id}` | delete |
| `brc_list_bank_accounts` | GET | `/v1/bankAccounts` | read |
| `brc_get_bank_account` | GET | `/v1/bankAccounts/{id}` | read |
| `brc_create_bank_account` | POST | `/v1/bankAccounts` | create |
| `brc_update_bank_account` | PUT | `/v1/bankAccounts/{id}` | update |
| `brc_delete_bank_account` | DELETE | `/v1/bankAccounts/{id}` | delete |
| `brc_list_cash_payments` | GET | `/v1/cashPayments` | read |
| `brc_get_cash_payment` | GET | `/v1/cashPayments/{id}` | read |
| `brc_create_cash_payment` | POST | `/v1/cashPayments` | create |
| `brc_update_cash_payment` | PUT | `/v1/cashPayments/{id}` | update |
| `brc_delete_cash_payment` | DELETE | `/v1/cashPayments/{id}` | delete |
| `brc_list_cash_receipts` | GET | `/v1/cashReceipts` | read |
| `brc_get_cash_receipt` | GET | `/v1/cashReceipts/{id}` | read |
| `brc_create_cash_receipt` | POST | `/v1/cashReceipts` | create |
| `brc_update_cash_receipt` | PUT | `/v1/cashReceipts/{id}` | update |
| `brc_delete_cash_receipt` | DELETE | `/v1/cashReceipts/{id}` | delete |

Cash receipt create/update/batch read the company's VAT-on-Cash-Receipt (VOCR) setting and adjust VAT handling accordingly.

### Accruals, prepayments, and allocations

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_accruals` | GET | `/v1/accruals` | read |
| `brc_get_accrual` | GET | `/v1/accruals/{id}` | read |
| `brc_create_accrual` | POST | `/v1/accruals` | create |
| `brc_update_accrual` | PUT | `/v1/accruals/{id}` | update |
| `brc_delete_accrual` | DELETE | `/v1/accruals/{id}` | delete |
| `brc_list_prepayments` | GET | `/v1/prepayments` | read |
| `brc_get_prepayment` | GET | `/v1/prepayments/{id}` | read |
| `brc_create_prepayment` | POST | `/v1/prepayments` | create |
| `brc_update_prepayment` | PUT | `/v1/prepayments/{id}` | update |
| `brc_delete_prepayment` | DELETE | `/v1/prepayments/{id}` | delete |
| `brc_list_allocation_resolvers` | GET | `/v1/allocationResolvers` | read |
| `brc_list_allocated_transactions` | GET | `/v1/allocationResolvers/allocated` | read |
| `brc_update_allocations` | POST | `/v1/allocationResolvers` | update |
| `brc_delete_allocation_resolver` | DELETE | `/v1/allocationResolvers/{id}` | delete |

### VAT and analysis lookups

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_vat_rates` | GET | `/v1/vatRates` | read |
| `brc_list_vat_analysis_types` | GET | `/v1/vatAnalysisTypes` | read |
| `brc_list_vat_categories` | GET | `/v1/vatCategories` | read |
| `brc_list_vat_types` | GET | `/v1/vatTypes` | read |
| `brc_process_vat_category_rates` | POST | `/v1/vatCategories/vatRates` | update |
| `brc_list_accounts` | GET | `/v1/accounts` | read |
| `brc_list_analysis_categories` | GET | `/v1/analysisCategories` | read |
| `brc_list_category_types` | GET | `/v1/categoryTypes` | read |
| `brc_list_owner_type_groups` | GET | `/v1/ownerTypeGroups` | read |
| `brc_list_owner_types` | GET | `/v1/ownerTypes` | read |
| `brc_list_user_defined_fields` | GET | `/v1/userDefinedFields` | read |
| `brc_list_book_tran_types` | GET | `/v1/bookTranTypes` | read |
| `brc_list_company_settings` | GET | `/v1/companySettings` | read |

`brc_list_analysis_categories` and `brc_list_vat_rates` carry guidance to choose Sales categories/rates for sales document lines.

### Nominal reports and journals

| MCP tool | HTTP | Endpoint | Kind |
| -------- | ---- | -------- | ---- |
| `brc_list_nominal_accounts` | GET | `/v1/nominalAccounts` | read |
| `brc_get_nominal_account_ledger_by_id` | GET | `/v1/nominalAccounts/{id}` | read |
| `brc_get_nom_ac_ledger_by_ids` | GET | `/v1/nominalAccounts/{id}` (per id) | read |
| `brc_grouped_nominal_accounts_report` | GET | `/v1/nominalAccounts` (aggregated) | read |
| `brc_multi_company_nom_ac_report` | GET | `/v1/nominalAccounts` (per company) | read |
| `brc_list_nominal_journal_batches` | GET | `/v1/nominalJournalBatches` | read |
| `brc_get_nominal_journal_batch` | GET | `/v1/nominalJournalBatches/{id}` | read |
| `brc_create_nominal_journal_batch` | POST | `/v1/nominalJournalBatches` | create |
| `brc_update_nominal_journal_batch` | PUT | `/v1/nominalJournalBatches/{id}` | update |
| `brc_delete_nominal_journal_batch` | DELETE | `/v1/nominalJournalBatches/{id}` | delete |

### Batch tools (write)

Batch tools use `PUT /v1/{resource}/batch` with normalised item payloads and apply the same safety checks as the single-record tools. They require `routeToken` and `confirmWrite` (and counterparty confirmation where applicable).

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

### Email tools (write)

| MCP tool | Kind | Confirmation |
| -------- | ---- | ------------ |
| `brc_send_sales_invoice_email` | email | `confirmSend` + `routeToken` |
| `brc_send_quote_email` | email | `confirmSend` + `routeToken` |
| `brc_send_email_statement` | email | `confirmSend` + `routeToken` |

Endpoints are under `/v1/email/...` and depend on tenant email configuration. They may be omitted from the MCP tool list when `BRC_ALLOW_EMAIL_SKILLS` is false.

### Audit and session

| MCP tool | Kind | Purpose |
| -------- | ---- | ------- |
| `brc_list_audit_log` | read | List create/update/delete/email/batch changes made through the session |
| `brc_clear_audit_log` | write (confirmWrite) | Clear the session audit log |

Read-only API calls are not logged.

### MCP resources and prompts

- Resources: `brc://help` (getting-started overview), `brc://examples`, `brc://safety`
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

## 8. Deployment-gated and operator-only tools

### Deployment skill gating

Skill groups (read, update, delete, email, batch, dev) are toggled by the `BRC_ALLOW_*` environment variables. When a group is disabled, its tools are **not registered** with the MCP client for that process. Use `brc_get_deployment_policy` for the customer-facing capability summary.

Email sending and bank write operations may also depend on tenant configuration in Big Red Cloud even when the corresponding skill flag is enabled.

### Operator / development tools (not customer-facing)

These tools are available only when `BRC_ALLOW_DEV_MODE` is enabled (except `brc_open_edu_admin`, which is a staff helper and must not be presented as a normal customer company-data workflow):

| MCP tool | Notes |
| -------- | ----- |
| `brc_set_company_api_key` | Dev-only fallback for storing a key in memory — not the normal customer connection path |
| `brc_get_dev_mode_details` | Operator diagnostics; assistants must not quote or summarise this output in end-user chat |
| `brc_dev_diagnose_company_processing_settings` | Dev-only processing-settings diagnostic |
| `brc_get_connection_store_diagnostics` | Operator diagnostic for connection persistence; never exposes credentials |
| `brc_open_edu_admin` | Staff helper that returns the protected content-admin page URL (sign-in still required). Never returns upload secrets or bypass links |

Do not document or present these as customer-facing company workflows in product copy.

---

## 9. Where to find tests

Tests use the Node.js built-in test runner and live alongside the source as `*.test.ts` files (compiled to `build/` before running).

- `npm test` — build, then run the full suite.
- `npm run test:unit` — unit tests.
- `npm run test:security` — security-focused tests.
- `npm run test:config` — deployment/config tests.
- `npm run test:integration` — integration tests.

Representative coverage includes sales invoice safeguards (including multi-line generated-reference `acEntries` validation), transaction date validation, transaction settings warnings, company readiness scoring, the secure connection flow, connectionRef persistence/presentation rules, request routing / route tokens, TTL wording, response wording, unified help search, Freshdesk article ranking, screenshot links, recorded webinar matching, and help-resource details.

---

## 10. Help and training resources (detail)

Red can answer Big Red Cloud how-to and training questions using deployment-provided support indexes. These help tools are read-only and do not require a connected company.

### Supported sources

| Source | Content |
| ------ | ------- |
| Freshdesk | Official support articles and screenshots |
| Customer documentation | Big Red Cloud procedural and product documentation |
| Recorded webinars | Relevant training and webinar recordings |
| Upcoming webinars | Scheduled training events and registration information |

The optional source filter accepts: `all`, `freshdesk`, `customer_docs`, `recorded_webinar`, `upcoming_webinar`.

### Help search and details

`brc_red_help` / `brc_find_help_resources` rank resources according to the user's question and return the strongest matches (resource ID, title, source type, short description, article or video URL, relevance information, suggested next action).

Pass a returned `resourceId` to `brc_get_help_resource_details` for full information. For a Freshdesk article this may include title and official URL, step-by-step instructions, screenshot captions and signed links, related videos, and support contact information. For recorded webinars it may include video title, YouTube URL, description, and topic/category metadata.

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
- `src/tools/routing/route_request_tools.ts` — request-routing tool registration
- `src/routing/` — classification and `routeToken` helpers
- `src/brc-edu/help/unified-help-search.ts` — combined help-source ranking
- `src/brc-edu/help/help-resource-details.ts` — detailed resource responses
- `src/brc-edu/help/help-answer-layout.ts` — help answer structure
- `src/brc-edu/help/help-answer-sources.ts` — article and video source formatting
- `src/brc-edu/freshdesk/` — Freshdesk article and screenshot handling
- `src/brc-edu/customer-docs/` — customer-document search index
- `src/brc-edu/upcoming-webinars/` — upcoming-webinar parsing and index loading
- `src/edu/brc_edu_resources.ts` — recorded-webinar resource loading
- `src/config/red_public_base_url.ts` — public screenshot-link base URL

Help-resource indexes are supplied by the deployment operator. Public users cannot use these MCP tools to modify the live indexes or upload replacement support content.
