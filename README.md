# BRC Company MCP Server (Red)

## For customers: how to start

After the extension is connected in your chat app, type one of the following:

- Start
- Getting started
- How do I start?
- What can I do here?
- Show me examples

The assistant should guide you through:

1. Connecting a Big Red Cloud company.
2. Checking whether the company is ready.
3. Starting with read-only questions.
4. Preparing drafts before creating records.
5. Confirming before anything is created, updated, deleted, emailed or batch processed.

Example prompts:

- Show me my customers.
- Show me recent sales invoices.
- Show me open quotes.
- Check whether this transaction date is valid.
- Prepare a quote, but do not create it until I confirm.
- Show me nominal account groups.

---

## Project overview

This project is a **Model Context Protocol (MCP) server** for the Big Red Cloud (BRC) REST API.

Users interact with BRC company data through natural language in MCP clients such as Cursor or Claude Desktop, instead of calling REST endpoints manually.

Example:

```text
Show me all open quotes for Company C.
```

The MCP server performs the structured API calls in the background.

---

## Architecture

Two entry points share one tool registry:

| Entry | File | Transport | Use case |
| ----- | ---- | --------- | -------- |
| Local stdio | `src/index.ts` | `StdioServerTransport` | Cursor spawns `node build/index.js` |
| Hosted HTTP | `src/remote.ts` | Streamable HTTP on `/mcp` | `npm run start` — one MCP server per session |

Shared modules:

- **`src/server.ts`** — `createBrcMcpServer()` factory and stdio singleton
- **`src/register_all_tools.ts`** — `registerAllTools()` registers every tool module once, wrapping the server so disabled skills register a permission-message blocker instead of the real tool
- **`src/server_config.ts`** — deployment skill gating (`isToolEnabled`, `getDisabledSkillMessage`) driven by the `BRC_ALLOW_*` flags
- **`src/mcp_config.ts`** — MCP server instructions (API key safety, customer-mode rules)
- **`src/cash_receipt_settings.ts`** — VOCR (VAT on Cash Receipt) detection used by cash receipt tools
- **`src/shared.ts`** — BRC fetch, multi-company API keys, audit log, helpers

```text
index.ts / remote.ts  →  registerAllTools(server)  →  tools/*.ts
```

Generic helpers in `src/tools/general/`:

- **`list_tools.ts`** — `registerListTool`, `registerGetTool`, `registerSubresourceGetTool`
- **`crud_tools.ts`** — raw create / update / delete / batch
- **`payloads_tools.ts`** — normalise BRC payloads
- **`batch_tools.ts`** — batch endpoints

Domain-specific logic stays in `src/tools/*.ts` (quotes, purchases, nominal reports, etc.).

Bank and email tools live under `src/tools/under-development/`. Read-only bank tools (`brc_list_bank_accounts`, `brc_get_bank_account`) are registered for production; bank create/update/delete/batch and all email send tools are **not** registered for customer deployments until finished.

Cash receipt create/update/batch reads **VOCR** (`vocrSettingValue` from `/v1/companySetupConfig` and `/v1/companySetupConfig/getCompanyOptions`, with XML `VOCRSettings` fallback) and omits VAT rate fields when VOCR is off (`src/cash_receipt_settings.ts`).

---

## Main features

- Plain-English access to BRC data through MCP tools
- Multi-company API key handling (session memory only)
- Customers, suppliers, products, sales reps
- Sales quotes, invoices, credit notes, entries
- Purchases, payments, cash payments, cash receipts
- Batch create/update
- Nominal account reporting
- VAT lookup and guarded VAT processing
- Bank account list/get/create/update/delete (tenant setup may block create)
- Email send tools with `confirmSend` guard
- **Red session audit log** for writes made through this MCP server
- Customer onboarding tools (`brc_getting_started`, readiness check, date validation)
- Excel/report export scripts and regression tests

---

## Technology

- **TypeScript** / **Node.js** (ES modules)
- **@modelcontextprotocol/sdk**
- **Zod** for tool input validation
- **Express** + Streamable HTTP for hosted mode

---

## Project structure

```text
brc-company-mcp-server/
├── build/                    Compiled JavaScript (tsc output)
├── exports/                  Generated Excel/report outputs
├── reports/                  Regression test results
├── scripts/
│   ├── exports/              Excel export helpers
│   ├── reports/              Report generators
│   └── tests/                Read-only smoke test + dev-only/ regression & cleanup scripts
├── src/
│   ├── index.ts              Stdio entry point
│   ├── remote.ts             HTTP entry point
│   ├── server.ts             MCP server factory
│   ├── register_all_tools.ts Central tool registration
│   ├── server_config.ts      Deployment skill gating (BRC_ALLOW_* flags)
│   ├── mcp_config.ts         Server instructions
│   ├── cash_receipt_settings.ts  VOCR (VAT on Cash Receipt) detection
│   ├── shared.ts             API + session helpers
│   └── tools/
│       ├── general/
│       │   ├── batch_tools.ts
│       │   ├── crud_tools.ts
│       │   ├── list_tools.ts
│       │   └── payloads_tools.ts
│       ├── under-development/
│       │   ├── bank_tools.ts
│       │   └── email_tools.ts
│       ├── audit_session_tools.ts
│       ├── cash_payments_tools.ts
│       ├── company_context_tools.ts
│       ├── company_setup_tools.ts
│       ├── customer_tools.ts
│       ├── deployment_tools.ts
│       ├── nominal_report_tools.ts
│       ├── product_tools.ts
│       ├── purchases_tools.ts
│       ├── quotes_tools.ts
│       ├── sales_cn_rep_tools.ts
│       ├── sales_entry_inv_tools.ts
│       ├── supplier_tools.ts
│       └── vat_sales_tools.ts
├── package.json
└── README.md
```

---

## What each main file does

### `src/index.ts`

Local stdio entry: `registerAllTools(server)` then connects stdio transport.

Cursor example:

```json
{
  "mcpServers": {
    "brc-company-mcp-server": {
      "command": "node",
      "args": ["build/index.js"],
      "env": {
        "BRC_API_BASE_URL": "https://app.bigredcloud.com/api"
      }
    }
  }
}
```

### `src/remote.ts`

Streamable HTTP server. Each new MCP session gets `createBrcMcpServer()` + `registerAllTools()` and an isolated API key store.

```bash
npm run start
# http://localhost:3000/mcp
```

Cursor HTTP example:

```json
{
  "mcpServers": {
    "brc-company-mcp-server": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Opening `http://localhost:3000/mcp` in a browser without an MCP session returns an error — that is expected.

### `src/server.ts`

`createBrcMcpServer()` — shared server metadata (name **Red**, version, instructions).

### `src/register_all_tools.ts`

Single registration list used by both entry points. Add new tool modules here only.

### `src/shared.ts`

BRC HTTP client, company API key store, audit logging, JSON helpers.

### `src/tools/general/list_tools.ts`

List/get tools and `registerSubresourceGetTool` for nested GET routes (opening balances, `accountTrans`, customer quotes, etc.).

### `src/tools/general/crud_tools.ts`

Generic create/update/delete/batch. Applies payload builders for customers (`ownerTypeId` 1), suppliers (3), products, bank accounts, cash receipts.

### `src/tools/customer_tools.ts` / `supplier_tools.ts`

CRUD via `crud_tools`; sub-resource reads via `registerSubresourceGetTool`. Suppliers match the same raw-payload pattern as customers.

### `src/tools/under-development/bank_tools.ts` / `email_tools.ts`

`registerBankListTools()` registers **read-only** `brc_list_bank_accounts` and `brc_get_bank_account` in production (needed for payments). Create/update/delete/batch remain under development — call `registerBankTools()` from a dev entry point. Email tools are not registered in production.

### `src/tools/audit_session_tools.ts`

`brc_list_audit_log` / `brc_clear_audit_log` — session change history (writes only).

### `src/tools/deployment_tools.ts`

Getting started, readiness check, transaction date validation, deployment policy, MCP resources/prompts.

---

## Installation

```bash
npm install
npm run build
```

Scripts:

| Script | Command | Purpose |
| ------ | ------- | ------- |
| Build | `npm run build` | Compile TypeScript to `build/` (also runs on `postinstall`) |
| HTTP server | `npm run start` | `node build/remote.js` |
| Stdio server | `npm run start:local` | `node build/index.js` |
| Dev HTTP | `npm run dev` | `tsx src/remote.ts` |
| Dev stdio | `npm run dev:local` | `tsx src/index.ts` |
| Read-only test | `npm run test:readonly` | Read-only tool smoke test |
| Full regression test | `npm run test:dev` | `node scripts/tests/dev-only/dev_test.mjs` |
| Scan test leftovers | `npm run leftovers:scan` | Find records left by tests |
| Delete test leftovers | `npm run leftovers:delete` | Remove records left by tests |

---

## Environment variables

Example `.env` (see `.env.example`):

```env
BRC_API_BASE_URL=https://app.bigredcloud.com/api
PORT=3000

# MCP session lifetime (minutes)
BRC_MCP_SESSION_TTL_MINUTES=20

# Rate limiting (requests per minute per IP)
BRC_RATE_LIMIT_REQUESTS_PER_MINUTE=300

# SHA-256 hashes of blocked API keys, comma separated (never raw keys)
BRC_API_KEY_BLACKLIST_SHA256=
```

Do not store customer API keys in `.env`. Set keys per session with `brc_set_company_api_key`.

Deployment skill flags (see `brc_get_deployment_policy`). When a flag is off, matching tools register a permission-message blocker instead of calling BRC:

```powershell
$env:BRC_ALLOW_READ_SKILLS="true"
$env:BRC_ALLOW_UPDATE_SKILLS="true"
$env:BRC_ALLOW_DELETE_SKILLS="true"
$env:BRC_ALLOW_EMAIL_SKILLS="true"
$env:BRC_ALLOW_BATCH_SKILLS="true"
# Exposes operator-only diagnostics (brc_get_dev_mode_details); off for customers
$env:BRC_ALLOW_DEV_MODE="false"
```

---

## Company API keys

Connect in chat (assistant uses `brc_set_company_api_key`). Keys stay in MCP session memory and are never returned in tool output.

- List contexts: `brc_list_company_contexts`
- Clear one: `brc_clear_company_api_key`
- Clear all: `brc_clear_all_company_api_keys`

Never paste API keys into chat unless you intend to connect. Assistants must not repeat keys from history.

---

## Red audit log

| MCP Tool | Purpose |
| -------- | ------- |
| `brc_list_audit_log` | Lists create/update/delete/email/batch changes made through this MCP session |
| `brc_clear_audit_log` | Clears the session audit log (`confirmClear=true`) |

Read-only API calls are not logged.

---

## Regression test (DEVELOPERS ONLY)

```bash
npm run test:dev
```

Latest documented result:

```text
Registered tools: 126
Total invocations: 177
PASS: 167
FAIL: 0
SKIPPED: 1
EXCLUDED: 8
UNTESTED: 1
```

Excluded tools are bank account writes and email sends; `brc_get_dev_mode_details` is untested (operator-only, off by default).

Reports: `reports/dev_test_summary.txt`, `reports/dev_test_results.json`

---

## Known limitations (tenant / setup, not MCP bugs)

### Email sending

Tools are registered; delivery depends on BRC OAuth and company email configuration. All require `confirmSend=true`.

### Bank account creation

BRC may reject create/batch when bank-to-nominal linking rules are not satisfied in the tenant.

### Company logo

Skipped when the tenant has no logo configured.

### VAT processing

`brc_process_vat_category_rates` requires `confirmProcess=true` and a full BRC-shaped payload.

---

## MCP tools and BRC endpoints

Paths below match the current TypeScript implementation.

### Company context (MCP memory)

| MCP Tool | Purpose |
| -------- | ------- |
| `brc_set_company_api_key` | Store company API key |
| `brc_get_company_api_key_status` | Report whether a company is connected (never returns the key) |
| `brc_list_company_contexts` | List connected company names |
| `brc_clear_company_api_key` | Clear one company key |
| `brc_clear_all_company_api_keys` | Clear all keys |

### Company setup

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_get_company_setup_config` | GET | `/v1/companySetupConfig` |
| `brc_get_company_logo` | GET | `/v1/companySetupConfig/getCompanyLogo` |
| `brc_get_financial_year` | GET | `/v1/companySetupConfig/getFinancialYear` |
| `brc_get_company_options` | GET | `/v1/companySetupConfig/getCompanyOptions` |

### Customers

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_customers` | GET | `/v1/customers` |
| `brc_list_customers_without_dormant` | GET | `/v1/customers/GetWithoutDormant` |
| `brc_get_customer` | GET | `/v1/customers/{id}` |
| `brc_create_customer` | POST | `/v1/customers` |
| `brc_update_customer` | PUT | `/v1/customers/{id}` |
| `brc_delete_customer` | DELETE | `/v1/customers/{id}?timestamp=...` |
| `brc_get_customer_opening_balance` | GET | `/v1/customers/{id}/openingBalance` |
| `brc_list_customer_op_bal_trans` | GET | `/v1/customers/{id}/openingBalanceList` |
| `brc_list_customer_account_trans` | GET | `/v1/customers/{id}/accountTrans` |
| `brc_list_customer_quotes` | GET | `/v1/customers/{id}/quotes` |

### Suppliers

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_suppliers` | GET | `/v1/suppliers` |
| `brc_get_supplier` | GET | `/v1/suppliers/{id}` |
| `brc_create_supplier` | POST | `/v1/suppliers` |
| `brc_update_supplier` | PUT | `/v1/suppliers/{id}` |
| `brc_delete_supplier` | DELETE | `/v1/suppliers/{id}?timestamp=...` |
| `brc_get_supplier_opening_balance` | GET | `/v1/suppliers/{id}/openingBalance` |
| `brc_list_supplier_op_bal_trans` | GET | `/v1/suppliers/{id}/openingBalanceList` |
| `brc_list_supplier_account_trans` | GET | `/v1/suppliers/{id}/accountTrans` |

### Products

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_products` | GET | `/v1/products` |
| `brc_list_products_without_dormant` | GET | `/v1/products/GetWithoutDormant` |
| `brc_list_product_types` | GET | `/v1/productTypes` |
| `brc_get_product` | GET | `/v1/products/{id}` |
| `brc_create_product` | POST | `/v1/products` |
| `brc_update_product` | PUT | `/v1/products/{id}` |
| `brc_delete_product` | DELETE | `/v1/products/{id}?timestamp=...` |

### Sales reps

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_sales_reps` | GET | `/v1/salesReps` |
| `brc_get_sales_rep` | GET | `/v1/salesReps/{id}` |
| `brc_create_sales_rep` | POST | `/v1/salesReps` |
| `brc_update_sales_rep` | PUT | `/v1/salesReps/{id}` |
| `brc_delete_sales_rep` | DELETE | `/v1/salesReps/{id}?timestamp=...` |

### Purchases

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_purchases` | GET | `/v1/purchases` |
| `brc_get_purchase` | GET | `/v1/purchases/{id}` |
| `brc_create_purchase` | POST | `/v1/purchases` |
| `brc_create_purchase_gen_ref` | POST | `/v1/purchases/createPurchaseWithGeneratingReference` |
| `brc_update_purchase` | PUT | `/v1/purchases/{id}` |
| `brc_delete_purchase` | DELETE | `/v1/purchases/{id}?timestamp=...` |

### Sales entries and invoices

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_sales_entries` | GET | `/v1/salesEntries` |
| `brc_get_sales_entry` | GET | `/v1/salesEntries/{id}` |
| `brc_create_sales_entry` | POST | `/v1/salesEntries` |
| `brc_update_sales_entry` | PUT | `/v1/salesEntries/{id}` |
| `brc_delete_sales_entry` | DELETE | `/v1/salesEntries/{id}?timestamp=...` |
| `brc_list_sales_invoices` | GET | `/v1/salesInvoices` |
| `brc_get_sales_invoice` | GET | `/v1/salesInvoices/{id}` |
| `brc_create_sales_invoice` | POST | `/v1/salesInvoices` |
| `brc_create_sales_invoice_gen_ref` | POST | `/v1/salesInvoices/createSaleInvoiceWithGeneratingReference` |
| `brc_update_sales_invoice` | PUT | `/v1/salesInvoices/{id}` |
| `brc_delete_sales_invoice` | DELETE | `/v1/salesInvoices/{id}?timestamp=...` |

### Quotes

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_quotes` | GET | `/v1/quotes` |
| `brc_get_quote` | GET | `/v1/quotes/{id}` |
| `brc_create_quote` | POST | `/v1/quotes` |
| `brc_create_quote_gen_ref` | POST | `/v1/quotes/createQuoteWithGeneratingReference` |
| `brc_update_quote` | PUT | `/v1/quotes/{id}` |
| `brc_close_quote` | POST/PUT | `/v1/quotes/{id}/close` |
| `brc_reopen_quote` | POST/PUT | `/v1/quotes/{id}/reopen` |
| `brc_generate_sales_invoice_from_quote` | POST | `/v1/quotes/generateSaleInvoice` |
| `brc_delete_quote` | DELETE | `/v1/quotes/{id}?timestamp=...` (requires `confirmDelete`) |

### Sales credit notes

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_sales_credit_notes` | GET | `/v1/salesCreditNotes` |
| `brc_get_sales_credit_note` | GET | `/v1/salesCreditNotes/{id}` |
| `brc_create_sales_credit_note` | POST | `/v1/salesCreditNotes` |
| `brc_create_sales_credit_note_gen_ref` | POST | `/v1/salesCreditNotes/createCreditNoteWithGeneratingReference` |
| `brc_update_sales_credit_note` | PUT | `/v1/salesCreditNotes/{id}` |
| `brc_delete_sales_credit_note` | DELETE | `/v1/salesCreditNotes/{id}?timestamp=...` |

### Payments and cash

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_payments` | GET | `/v1/payments` |
| `brc_get_payment` | GET | `/v1/payments/{id}` |
| `brc_create_payment` | POST | `/v1/payments` |
| `brc_update_payment` | PUT | `/v1/payments/{id}` |
| `brc_delete_payment` | DELETE | `/v1/payments/{id}?timestamp=...` |
| `brc_list_cash_payments` | GET | `/v1/cashPayments` |
| `brc_get_cash_payment` | GET | `/v1/cashPayments/{id}` |
| `brc_create_cash_payment` | POST | `/v1/cashPayments` |
| `brc_update_cash_payment` | PUT | `/v1/cashPayments/{id}` |
| `brc_delete_cash_payment` | DELETE | `/v1/cashPayments/{id}?timestamp=...` |
| `brc_list_cash_receipts` | GET | `/v1/cashReceipts` |
| `brc_get_cash_receipt` | GET | `/v1/cashReceipts/{id}` |
| `brc_create_cash_receipt` | POST | `/v1/cashReceipts` |
| `brc_update_cash_receipt` | PUT | `/v1/cashReceipts/{id}` |
| `brc_delete_cash_receipt` | DELETE | `/v1/cashReceipts/{id}?timestamp=...` |

### Bank accounts (under development — not registered)

`brc_list_bank_accounts` and `brc_get_bank_account` are registered. Bank create/update/delete/batch are not.

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_bank_accounts` | GET | `/v1/bankAccounts` |
| `brc_get_bank_account` | GET | `/v1/bankAccounts/{id}` |
| `brc_create_bank_account` | POST | `/v1/bankAccounts` |
| `brc_update_bank_account` | PUT | `/v1/bankAccounts/{id}` |
| `brc_delete_bank_account` | DELETE | `/v1/bankAccounts/{id}?timestamp=...` |

### Batch tools

All use `PUT /v1/{resource}/batch` with normalised item payloads.

| MCP Tool | BRC base path |
| -------- | ------------- |
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

### Lookup and reference

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_accounts` | GET | `/v1/accounts` |
| `brc_list_analysis_categories` | GET | `/v1/analysisCategories` |
| `brc_list_category_types` | GET | `/v1/categoryTypes` |
| `brc_list_owner_type_groups` | GET | `/v1/ownerTypeGroups` |
| `brc_list_owner_types` | GET | `/v1/ownerTypes` |
| `brc_list_user_defined_fields` | GET | `/v1/userDefinedFields` |
| `brc_list_book_tran_types` | GET | `/v1/bookTranTypes` |
| `brc_list_company_settings` | GET | `/v1/companySettings` |
| `brc_list_sales` | GET | `/v1/sales` |

### Nominal accounts

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_nominal_accounts` | GET | `/v1/nominalAccounts` |
| `brc_get_nominal_account_ledger_by_id` | GET | `/v1/nominalAccounts/{id}` |
| `brc_get_nom_ac_ledger_by_ids` | GET | `/v1/nominalAccounts/{id}` (per id) |
| `brc_grouped_nominal_accounts_report` | GET | `/v1/nominalAccounts` (aggregated) |
| `brc_multi_company_nom_ac_report` | GET | `/v1/nominalAccounts` per company |

Legacy `/v1/nominalAccounts/ledger` is not used.

### VAT

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_list_vat_rates` | GET | `/v1/vatRates` |
| `brc_list_vat_analysis_types` | GET | `/v1/vatAnalysisTypes` |
| `brc_list_vat_categories` | GET | `/v1/vatCategories` |
| `brc_list_vat_types` | GET | `/v1/vatTypes` |
| `brc_process_vat_category_rates` | POST | `/v1/vatCategories/vatRates` (`confirmProcess=true`) |

### Email (under development — not registered)

| MCP Tool | HTTP | BRC Endpoint |
| -------- | ---- | ------------ |
| `brc_send_sales_invoice_email` | POST | `/v1/email/sendSalesInvoice` |
| `brc_send_email_statement` | POST | `/v1/email/sendEmailStatement` |
| `brc_send_quote_email` | POST | `/v1/email/sendQuote` |

All require `confirmSend=true`.

### Deployment and audit

| MCP Tool | Purpose |
| -------- | ------- |
| `brc_getting_started` | Customer onboarding text |
| `brc_company_readiness_check` | Pre-flight company checks |
| `brc_validate_transaction_date` | Financial year date validation |
| `brc_get_deployment_policy` | Safety flags and rollout guidance |
| `brc_get_dev_mode_details` | Operator-only diagnostics (requires `BRC_ALLOW_DEV_MODE`) |
| `brc_list_audit_log` | Session change log |
| `brc_clear_audit_log` | Clear session change log |

MCP resources: `brc://help`, `brc://examples`, `brc://safety`

MCP prompts: `brc_setup_company`, `brc_safe_company_review`, `brc_create_quote_workflow`

---

## Example customer-facing prompts

```text
Show me all customers in <Company Name>.
Show me all open quotes in <Company Name>.
Create a quote for <Company Name> using product <Product Code>.
Turn that quote into a sales invoice.
Show me the nominal accounts for <Company Name> grouped by account group.
Show me the Red audit log for this session.
Clear all connected company API keys from this session.
```

---

## Demo workflow

1. Connect a company (`brc_set_company_api_key`)
2. Run `brc_company_readiness_check`
3. List customers / products / quotes (read-only)
4. Show nominal grouping
5. Create a quote (with confirmation)
6. Generate sales invoice from quote
7. Show audit log
8. Explain email/bank skips if tenant setup blocks them

---

## Recommended first use

```text
Use brc_getting_started.
Connect my company using API key <paste key>.
Run brc_company_readiness_check for my company.
Show me my customers and recent sales invoices.
```

The MCP protocol cannot force a welcome message into Cursor/Claude chats; onboarding is exposed via tools, resources and prompts above.

For production customer data:

1. Run read-only tools first.
2. Run readiness check before transactions.
3. Validate dates with `brc_validate_transaction_date`.
4. Require explicit confirmation before writes, deletes, email, VAT or batch.
5. Some BRC generated-reference endpoints may use the tenant’s current transaction date internally.

---

## Future work

- BRC-controlled authentication instead of session API keys
- Short-lived tokens and company-level permissions
- Clearer user-facing BRC validation errors
- Production logging and hosted deployment auth
- Broader coverage for generated-reference create tools
- Bank create once BRC linking rules are fully documented

---

## Author

Proof of concept for Big Red Cloud MCP/API access.
