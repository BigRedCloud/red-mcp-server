# Copilot tranche: 35 to 43 tools

This tranche adds eight tools only. The normal `/mcp` catalogue stays at 159 tools with descriptor SHA-256 `c5e420ed1f7e9f3201fadb283b72e4b90a00eb58c64bfd641d3c8cab0d684f6f`. The existing 35 Copilot descriptors are also pinned by a regression hash. Their handlers, including nominal local paging and both transaction searches, retain their existing behavior.

## Audit and selection

Reviewed the actual registrations in `src/tools/general/list_tools.ts` and `src/tools/journals/nominal_journal_batch_tools.ts`, and the [official v1 Swagger](https://app.bigredcloud.com/api/swagger/docs/v1). All six selected list endpoints document `PageResult`/`Items` responses and ordering by ID. None has the documented raw-array contract that required special handling for nominal accounts and transaction ledgers.

| Copilot tool | Existing RED handler | Reason and retained summary |
| --- | --- | --- |
| `search_sales_reps` | `brc_list_sales_reps` | Identify sales staff by ID, code, name, phone and email; distinct from customers. |
| `fetch_sales_rep` | `brc_get_sales_rep` | Real get-by-ID for one representative. |
| `search_nominal_journal_batches` | `brc_list_nominal_journal_batches` | General-ledger journals: ID, entry/processing dates, transaction type and total. Omits `accountTransactions` and timestamps from search. |
| `fetch_nominal_journal_batch` | `brc_get_nominal_journal_batch` | Real get-by-ID includes debit/credit lines within the existing detail-size limit. |
| `search_vat_types` | `brc_list_vat_types` | Domestic/EU/exempt/reverse-charge treatments; ID, code, description, `isOnlyZero`, `isNotApplicable`. Distinct from rates and categories. |
| `search_vat_analysis_types` | `brc_list_vat_analysis_types` | None/Goods/Services classifications; ID and description, including valid ID zero. |
| `search_category_types` | `brc_list_category_types` | Accounting-book category-type definitions; ID and description. Distinct from posting analysis categories. |
| `search_book_transaction_types` | `brc_list_book_tran_types` | Decode ledger `bookTranTypeId`; ID, code and description. No transaction execution or resolver action. |

The two pairs have real individual GET handlers. The other four are search-only; no fetch endpoint is invented. The private Copilot collector captures only the two read callbacks from the journal registration module, excluding its write callbacks.

## Request and response contracts

- Sales reps and references reuse the general list schema: company, default page/pageSize, optional OData top/skip/orderBy/filter. The facade supplies top/skip and `id asc`, never a raw user filter. Text and code filtering are local.
- Journal list accepts company plus optional filter/orderBy/top/skip, without page/pageSize. The existing private argument adapter validates the original schema; unknown legacy page fields do not reach the journal API. Public date bounds are matched locally against `entryDate`. No nominal-code filter is advertised because the list's root record has no such code.
- Journal get requires a positive numeric ID. The existing private schema adapter converts the public string identifier and validates it before calling the original handler. Sales-rep get accepts string or numeric ID.
- Reference endpoints without codes do not advertise an exact-code filter. VAT-type flags are added only to that new tool's projection, preserving older tool projections.
- Existing three-request budgets, 50-row page limit, 2 MB handler-response limit, 128 KB result/detail limit, encrypted owner/company/query-bound cursors and repeated-page guards remain in use. There is no per-row fetch fan-out. No new local-dump paging is introduced: the selected contracts are paged envelopes, not unpaged arrays. Live behavior still requires post-deployment verification.
- The authenticated owner's linked-company context is used even for global reference definitions. No authentication, linking, Cosmos, routing or normal `/mcp` code is changed.

## Remaining candidate classification

| Candidate | Classification and decision |
| --- | --- |
| `brc_list_sales_entries` / `brc_get_sales_entry` | Read-only pair with real GET, deferred because routing overlaps existing invoice/credit-note and customer-ledger searches. Its list also contains accounting/VAT/detail collections. |
| `brc_list_product_types` | Read-only, deferred: Swagger names Product Types but references `PageResult[OwnerTypeDto]` and shows Prospect/Customer/Supplier examples. Confirm live meaning before exposing misleading product classifications. |
| `brc_list_owner_types`, `brc_list_owner_type_groups` | Read-only technical reference lists, deferred for lower immediate bookkeeping value and ambiguity with Microsoft identity ownership. |
| `brc_list_user_defined_fields` | Read-only configurable metadata, deferred until a specific user workflow justifies fields and scope. |
| Company settings/setup/configuration dumps | Some reads exist, but broad/heavy configuration payloads are deferred; write/setup actions remain excluded. |
| Opening balances and allocations | Read/query operations may be safe individually, but require account-specific scope and careful distinction from balance/allocate writes; deferred. All allocation writes remain excluded. |
| Combined `/v1/sales` | Read-only but mixed document semantics and overlap; deferred. |
| Nominal ledger by ID and grouped/multi-company nominal reports | Read-only but larger results, aggregation or fan-out; deferred. The working chart-of-accounts search is unchanged. |
| Company logo | Read-only binary/media lookup, not useful for this accounting search tranche; deferred. |
| Help, audit, readiness, deployment and setup helpers | Outside the compact accounting-data surface; excluded from this tranche. |
| Create/update/delete/post/import/upload operations | Write/destructive: excluded regardless of corresponding read capability. |
| Authentication, API-key management, company linking and routing/admin helpers | Internal/setup: excluded from the federated facade. |

The tranche stops at eight additions. No commit, push or deployment is part of this work.

## Validation and changed files

- Focused facade/customer/paging tests: 71 passed.
- `npm run build`: passed, including the resource processor build.
- Copilot/profile/Entra HTTP integration tests: 4 passed.
- Full `npm test`: 1,197 passed, one existing skipped test, zero failures (1,171 unit + 25 HTTP + one resource-processor test).
- Normal descriptor hash and 159-tool count passed. The original 35 Copilot descriptor hash also passed: `c87254d84410000d20aea40cb44aec236fe0d8f1675202808cfc5b5300f361ec`.
- Copilot exposes exactly 43 tools. Both live-proven transaction wrappers and nominal local paging retain passing regression coverage. The eight new tools still need live Microsoft Copilot verification after a separately authorized deployment.

Exact changed files:

1. `src/copilot_facade.ts`
2. `src/copilot_facade.test.ts`
3. `src/tests/copilot_diagnostic.integration.test.ts`
4. `src/tests/entra_mock_server.ts`
5. `src/tests/entra_sso.integration.test.ts`
6. `build/copilot_facade.js`
7. `build/copilot_facade.test.js`
8. `build/tests/copilot_diagnostic.integration.test.js`
9. `build/tests/entra_mock_server.js`
10. `build/tests/entra_sso.integration.test.js`
11. `docs/copilot-next-tranche.md`

The generated resource-sync data fixture was restored after testing; it is not part of the change.
