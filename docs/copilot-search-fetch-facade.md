# Microsoft federated search/fetch facade

`/mcp` stays at **159 -> 159 tools**. `/mcp/copilot` changes from **72 -> 12 tools**. This replaces the raw Copilot catalogue with the requested six entity pairs; it does not rename or alter RED's normal tools.

No normal registry, tool implementation, field schema, shared API function, profile definition, OAuth verifier, owner binding, company-linking flow, Cosmos record format or Microsoft configuration is changed. `src/remote.ts` changes only the import supplying the Copilot-only authenticated tool-name set. The normal endpoint dispatch is untouched. The existing customer module is untouched. The previous raw-read adapter remains in the repository for compatibility but is no longer called by `/mcp/copilot`.

## Exact tools and internal reuse

| Copilot tool | Existing RED implementation reused | Lookup semantics |
| --- | --- | --- |
| `search_customers` | Existing `listCopilotCustomers` -> `listBrcCustomers` -> `brcFetch` | Existing behavior/schema unchanged; paged linked-company customer search |
| `fetch_customer` | Existing `fetchCopilotCustomer` -> `brcFetch` | Existing behavior/schema unchanged; exact customer ID plus company |
| `search_suppliers` | Original `brc_list_suppliers` callback captured from `registerTools` | Bounded text/code search over supplier pages |
| `fetch_supplier` | Original `brc_get_supplier` callback | Exact supplier ID plus company |
| `search_products` | Original `brc_list_products` callback captured from `registerTools` | Bounded text/code search over product pages |
| `fetch_product` | Original `brc_get_product` callback captured from `registerProductTools` | Exact product ID plus company |
| `search_sales_invoices` | Original `brc_list_sales_invoices` callback | Text/reference, transaction date range and customer code |
| `fetch_sales_invoice` | Original `brc_get_sales_invoice` callback | Exact invoice ID, not a possibly nonunique reference |
| `search_purchases` | Original `brc_list_purchases` callback | Text/reference, transaction date range and supplier code |
| `fetch_purchase` | Original `brc_get_purchase` callback | Exact purchase ID, not a possibly nonunique reference |
| `search_accounts` | Original `brc_list_accounts` callback | Bounded text/code search over accounts, distinct from nominal accounts |
| `fetch_account` | Original `brc_list_accounts` callback | Exact `id:...` identifier, or `code:...` when a row has no ID; bounded paged lookup |

The private adapter captures only nine named read callbacks and their existing schemas, and validates arguments through those schemas before calling them. It never registers or changes tools on the normal MCP server. No write callback is retained or invoked. The facade registers only its ten new names alongside the two unchanged customer names.

## Search and fetch contract

The five new searches require `query`; an empty string lists records. `companyName` optionally limits the search to a linked company. Otherwise searches traverse the signed-in owner's linked companies. `pageSize` defaults to 20 and is limited to 50. Each invocation examines at most three upstream pages. `nextCursor` resumes the scan, including when the current batch contains no matching results.

Suppliers, products and accounts also accept an exact, case-insensitive `code`. Sales invoices and purchases accept `counterpartyCode`, `dateFrom` and `dateTo` (inclusive ISO dates). Text matches summary fields; filters are applied locally rather than assuming undocumented endpoint-specific OData support. Consequently a search can need several calls even when it has few matches. Missing date fields do not satisfy a date filter. No arbitrary OData, URL, API key, connection reference or owner identifier input is exposed.

Search results include company name, a named stable identifier, a title and a compact record summary. Rows without a usable identifier are marked `fetchAvailable: false`. Fetches require the returned identifier and company and verify the retrieved record's identifier. Detailed fetch results retain accounting data and line items, with credential/identity material removed and response size bounded.

There is **no existing `brc_get_account` or audited `/v1/accounts/{id}` endpoint**. `fetch_account` therefore scans up to three 50-record list pages per call. It returns one exact match, `not_found` after exhausting the list, or `incomplete` with an owner-bound continuation. Keep the same `accountId` and company on continuation. Code fallback uses the exact code returned by search when an account lacks an ID; it does not conflate accounts with nominal accounts. An identifier that matches multiple rows in a page is rejected as ambiguous.

## Isolation and exclusions

Every exposed tool has a title, concise description, `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false` for the closed authenticated BRC data source. Existing Entra verification covers only the twelve advertised names. New handlers obtain companies from the verified request owner and create a fresh credential map for the selected company; no normal connectionRef/session credential fallback is used. Unexpected legacy session scope fails closed.

Encrypted continuations expire after ten minutes and bind to owner, tool/purpose, linked-company snapshot, query, filters and page size. Cross-owner, cross-tenant, cross-tool, changed-filter, tampered, expired and stale-connection continuations cannot issue accounting requests.

All 70 previously exposed `brc_*` names disappear from the Copilot endpoint. All writes, deletes, creates, posting, batching, imports, uploads, email sends, routing, auth, company-connection, API-key, support and admin tools remain excluded. They retain their existing normal `/mcp` behavior where applicable.

## Proposed next pairs (not exposed in this iteration)

These are deliberately left out to keep the first facade at the twelve requested tools and validate routing before expanding it. The table identifies the existing readers and the identifier design needed rather than mechanically renaming tools.

| Area | Proposed Microsoft tools | Reuse and design |
| --- | --- | --- |
| Quotes | `search_quotes`, `fetch_quote` | `brc_list_quotes`, `brc_get_quote`; company + quote ID, customer/date/reference filters; references need not be unique |
| Sales credit notes | `search_sales_credit_notes`, `fetch_sales_credit_note` | `brc_list_sales_credit_notes`, `brc_get_sales_credit_note`; customer/date/reference filters and exact credit-note ID |
| Bank accounts | `search_bank_accounts`, `fetch_bank_account` | `brc_list_bank_accounts`, `brc_get_bank_account`; account code/name search and bank-account ID |
| Nominal accounts | `search_nominal_accounts`, `fetch_nominal_account` | `brc_list_nominal_accounts`, `brc_get_nominal_account_ledger_by_id`; nominal code/description and ID; distinguish monthly movements from balances |
| Customer transactions | `search_customer_transactions`, `fetch_customer_transaction` | `brc_list_customer_account_trans` plus `brc_resolve_book_transaction_type` and the appropriate document reader; bind company, customer, book transaction ID and type, since IDs/types are company-specific |
| Supplier transactions | `search_supplier_transactions`, `fetch_supplier_transaction` | `brc_list_supplier_account_trans` plus type resolver and a document reader; same compound-identity requirement, with supplier scope |
| VAT | `search_vat`, `fetch_vat` | `brc_list_vat_rates`, `brc_list_vat_categories`, `brc_list_vat_types`, `brc_list_vat_analysis_types`; one pair with a `kind` discriminator and kind + ID; list-backed exact lookup where no get reader exists |
| Analysis categories | `search_analysis_categories`, `fetch_analysis_category` | `brc_list_analysis_categories`; book/category context filter; list-backed exact ID lookup |
| Company settings | `search_company_settings`, `fetch_company_setting` | `brc_list_company_settings`, processing/reference/setup config readers; search by setting section/key; define stable section + key identifiers before exposing |
| Financial year | `search_financial_years`, `fetch_financial_year` | `brc_get_financial_year`; search current years across linked companies, fetch exact company/current-year identity; no historical-year capability claimed |
| Cash payments | `search_cash_payments`, `fetch_cash_payment` | `brc_list_cash_payments`, `brc_get_cash_payment`; date/reference/bank or supplier filters, payment ID |
| Cash receipts | `search_cash_receipts`, `fetch_cash_receipt` | `brc_list_cash_receipts`, `brc_get_cash_receipt`; date/reference/customer filters, receipt ID |
| Accruals | `search_accruals`, `fetch_accrual` | `brc_list_accruals`, `brc_get_accrual`; nominal code/date/reference filters, accrual ID |
| Prepayments | `search_prepayments`, `fetch_prepayment` | `brc_list_prepayments`, `brc_get_prepayment`; nominal code/date/reference filters, prepayment ID |

Other read-only areas remain unexposed: sales entries and ordinary bank payments could use their own later document pairs; product types, sales reps, category/owner types and user-defined fields could become typed reference-data searches; opening balances and allocation queries fit transaction detail rather than separate top-level pairs; grouped and multi-company nominal reports need a report-specific design rather than forced record-fetch names. Company logos, readiness/validation helpers, help and support reports are outside this initial business-record facade.

No claim is made that all proposals are already verified against live Microsoft routing or backend shapes. In particular transaction type resolution, setting keys, VAT kind-specific identifiers and financial-year identity require separate design/fixture validation before implementation.

## Validation

- Build: passed, including the resource-processor build.
- Focused suite: **23 passed, zero failed**; includes the unchanged customer tests, the 159-tool descriptor fingerprint, all five new list/get mappings, local query/date/code filters, strict schema rejection, bounded scans, account lookup continuation, cursor tamper/expiry/owner/filter/entity binding, credential isolation and redaction, HTTP discovery and the full OAuth browser regression.
- Full `npm test`: **1,136 passed, zero failed, one skipped** (1,110 unit passes, 25 HTTP integration passes, one resource-processor pass). The existing Cosmos telemetry persistence test was skipped.
- Normal descriptor baseline SHA-256: `c5e420ed1f7e9f3201fadb283b72e4b90a00eb58c64bfd641d3c8cab0d684f6f`; unchanged across all 159 names, titles, descriptions, schemas and annotations.
- Git diff confirms no edits to `register_all_tools`, `shared`, normal `tools`, `tool_profiles`, `tool_annotations`, `server`, `auth`, or the existing `copilot_customers` implementation (including their compiled counterparts). The one import change in `remote` affects the Copilot-only name set, not normal dispatch.
- The generated test fixture data was restored after the suite. No commit, push or deployment was performed.

The installed npm CLI was invoked directly with Node because the Windows PowerShell npm launcher resolves a missing roaming file. Package scripts were unchanged. OAuth browser tests ran outside the network-restricted sandbox. These tests use mocked BRC responses; no live Microsoft 365 Copilot routing or production deployment was performed.
