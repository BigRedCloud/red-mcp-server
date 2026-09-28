# Copilot company connection and Entra SSO

The current `/mcp/copilot` facade exposes 57 read-only tools. The main `/mcp`
registry remains unchanged at 159 tools. See [the current catalogue](copilot-read-only-catalogue.md)
for tool coverage. This document describes company connection and its original
SSO implementation; historical customer-tool details below are retained as context.
Nothing in this work deploys code or changes Microsoft configuration.

## Identity and storage

Every customer-tool HTTP call verifies its own bearer token with `jose`.
Only RS256, configured tenants/audiences, the exact tenant-specific v2 issuer,
valid time claims, a GUID `tid`/`oid`, and a delegated scope are accepted.
App-only tokens are rejected. An optional authorized-client allowlist checks `azp`.
Discovery/JWKS are obtained from Microsoft over HTTPS and cached with key rotation.
Identity headers, MCP session IDs, connection references and cookies cannot
authorize accounting calls. No Microsoft tokens are persisted.

The normalized verified `(tid, oid)` pair is hashed into an owner key. An
`entra:<owner-key>` partition contains an `entraOwner` record with a random
connection UUID, legacy `entraLink` records, new `entraPendingRequest` records,
and encrypted `entraCompany` records.
The existing Cosmos container's `/pk` partition key and `(pk,id)` uniqueness
are sufficient: create, never upsert, arbitrates owner creation; link consumption
uses an ETag `IfMatch` replacement. Memory uses the same ownership service with
atomic synchronous map operations. Owner records contain no credentials or tokens.
Existing anonymous `connection:*`, `pending:*`, session/ref/claim records remain
unchanged. Their records are never searched or migrated into Entra ownership.

New connection URLs use `/connect?request=req_<random-handle>`. The handle is
public, contains 256 random bits and no identity, claims or credentials.
Its SHA-256 digest identifies a distinct `request:` record, never a legacy
secret-link record. Possession grants no access: only the verified Microsoft
owner can resolve it within their partition. Initial GETs perform no lookup,
reveal no existence information and never consume state; scanners are harmless.
The query is copied into a hidden POST field and optionally removed from browser
history. No fragment is required.

The original ten-minute database deadline remains authoritative through sign-in
and retries. The authenticated cookie is capped to that deadline. Completion
uses atomic ETag consumption; wrong users, unknown handles, expired requests
and replays receive the same generic failure. The browser preserves authorization
code flow with PKCE, state and nonce. Old secret link records are not exposed in
URLs or reinterpreted as public requests.
The Microsoft-authenticated, owner-bound credential form uses the same RED-branded
connection experience as other clients, without the normal `/mcp` connection code.
Users can enter companies manually or upload a CSV, with a maximum of five
companies per Copilot connection request. CSV uploads are limited to 1 MB and
processed in memory; the original file is never persisted. The expected columns
are `companyName,apiKey`; existing supported header aliases remain accepted.
CSV takes precedence over manual entries and submits directly without a preview.
Successful and failed companies are shown separately by HTML-escaped company
name. All-success results direct users back to Microsoft Copilot; partial results
also identify the failed companies. When every company fails, the heading is
“Companies could not be connected”. API keys are never redisplayed, and validation
internals are not included. Once a request is consumed, failed companies require
a new connection link requested through Microsoft Copilot.

Encrypted Secure/HttpOnly host-only cookies carry
short-lived flow state; origin and CSRF checks protect submission. Consumption
happens before BRC validation: failed validation requires a new link.
Credentials use the existing AES-GCM encoder; SSO refuses its unencrypted memory
fallback. Multiple links can add/update companies; existing companies are retained.

## Historical proof-of-concept customer-tool results and limits

The tool accepts only optional `pageSize` (1–50) and `cursor`. It uses the existing
customer endpoint/query builder and BRC client in a request-local credential map.
Each call makes at most three page requests, each with a 15-second timeout.
Each company-page payload is capped at 128 KB; an oversized page is reported
as a company failure rather than truncated. An encrypted ten-minute continuation
cursor binds owner, company snapshot, page and page size. A full page always
requires another page check; no row is silently dropped. A changed company
snapshot invalidates the cursor and requires restarting. The result has company
groups and explicit per-company failure entries; later companies still proceed.
The public result projects common customer identity/contact/balance fields from
the existing response, strips secret fields and credential values, and rejects
oversized/unrecognized pages with an explicit company failure. It does not return
raw BRC errors, internal connection IDs, Entra IDs, or credential metadata.
Results are bounded by pages, not a consistent BRC database snapshot: source
changes during pagination can still affect results.

## Manual staging configuration

Decide the allowed pilot tenant(s), API app ID, browser app ID, public staging
origin and authorized Microsoft caller IDs. Values below are placeholders.
Configure only staging; this document is not authorization to modify production.

1. In Entra register the API application and expose delegated `access_as_user`.
   Set `api.requestedAccessTokenVersion` to `2`. Use organizational accounts,
   not personal Microsoft accounts. Use a tenant allowlist even with multitenancy.
2. In Teams Developer Portal, Tools → Microsoft Entra SSO client ID registration,
   register the API client ID, existing MCP URL, organization/app restrictions,
   and delegated scope. Copy its SSO registration ID and generated Application
   ID URI. Add that URI to the API app's `identifierUris`; preauthorize the
   Microsoft Enterprise token-store client for the delegated scope. Add the Web
   redirect `https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect`.
   Use the current Microsoft-documented token-store client ID when setting the
   optional caller allowlist; do not invent a tenant-specific ID.
   [Microsoft SSO setup](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-entra-sso)
3. In the existing federated connector, select Microsoft Entra SSO and supply
   the Teams SSO registration ID. Keep
   `https://brc-live-mcp-app-staging.azurewebsites.net/mcp/copilot` as the endpoint.
   Restrict rollout to pilot users. No new connector or MCP route is needed.
   [Federated connector configuration](https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/set-up-custom-federated-connectors)
4. Register a confidential Web app for the connection page (or deliberately use
   the same registration). Set its exact redirect to
   `https://<staging-host>/connect/sso/callback`; allow authorization code flow.
   Do not enable implicit grants. Store its client secret through staging secret
   configuration/Key Vault references, never in source. This implementation uses
   the `organizations` authority: configure the browser app for organizational
   multi-tenant sign-in and restrict admitted tenants in server configuration.
   It requests only `openid profile`, with no Graph or offline-access permission.
5. For eventual cross-tenant distribution, use organizational multi-tenant app
   registrations and explicit tenant onboarding. A single-tenant API can serve
   an initial single-tenant pilot, but not general customer distribution.
   Tenant administrators must approve scope consent where admin-only scope or
   tenant user-consent policy requires it; connector setup also requires the
   appropriate Microsoft 365/Entra administrative roles. Plan customer-tenant
   consent before rollout. [Account types](https://learn.microsoft.com/en-us/entra/identity-platform/single-and-multi-tenant-apps)

Set these Azure staging environment variables:

| Variable | Value |
| --- | --- |
| `RED_ENTRA_ALLOWED_TENANTS` | `<pilot-tenant-guid>[,<approved-customer-tenant-guid>]` |
| `RED_ENTRA_AUDIENCES` | `<API-client-id>,<Teams-generated-application-ID-URI>`; explicit accepted audiences only |
| `RED_ENTRA_REQUIRED_SCOPE` | `access_as_user` (scope claim value, not full URI) |
| `RED_ENTRA_ALLOWED_CLIENTS` | `<authorized-Microsoft-client-id>[,...]`; optional additional restriction |
| `RED_ENTRA_PUBLIC_BASE_URL` | `https://brc-live-mcp-app-staging.azurewebsites.net` |
| `RED_ENTRA_WEB_CLIENT_ID` | `<browser-app-client-id>` |
| `RED_ENTRA_WEB_CLIENT_SECRET` | `<Key-Vault-reference-or-secret-setting>` |
| `RED_CONNECT_CONNECTION_STORE` | `cosmos` for durable staging; memory is ephemeral |
| `RED_CONNECT_COSMOS_CONNECTION_STRING` | existing secure staging Cosmos setting |
| `RED_CONNECT_COSMOS_DATABASE` / `RED_CONNECT_COSMOS_CONTAINER` | existing staging database/container |
| `RED_CONNECT_ENCRYPTION_KEY` | secure existing encryption material; shared across instances |

No BRC company credentials belong in these settings. Missing Entra configuration
fails closed for customers while the status tool remains public. Configure HTTPS
at the public ingress; do not configure Easy Auth to redirect anonymous MCP
status/initialize calls. The application does not trust Easy Auth identity headers.
Use v2 tokens: v1 tokens are intentionally unsupported. Confirm actual connector
token audiences during the pilot without logging or copying tokens into chat.

## Verification and security assumptions

Run `npm run build`, then `npm run demo:copilot-sso`. The demo generates ephemeral
test JWT keys, uses explicit test-only discovery/token/BRC mocks, exercises the
browser form, and shows `connection_required` followed by two-company results.
It prints neither the token nor the connection link. Never set its
`RED_ENTRA_TEST_PRIVATE_JWK` or preload in a deployment. The status-only
`npm run demo:copilot-diagnostic` still works against the current profile.

Focused commands: `node --test build/auth/entra_auth.test.js build/auth/entra_store.test.js`
and `node --test build/tests/entra_sso.integration.test.js build/tests/mcp_profile_routing.integration.test.js build/tests/copilot_diagnostic.integration.test.js`.
Run the existing connection-isolation tests and `npm test` as regressions.

This is a local proof of concept, not customer-ready certification. Cosmos
concurrency is exercised through a mocked Cosmos adapter, not a live account.
Browser tests exercise the HTTP protocol, not Microsoft's real sign-in UI.
Trust requires HTTPS, protected encryption/application secrets, correct admin
configuration, and trusted application/storage administrators. Do not enable
request-body, Authorization/Cookie/header, response-body or credential-form
logging at the proxy or APM layer. The code does not emit those secrets, but
cannot control a separately configured external logger. Connection URLs are
intentionally returned only when linking is required. New request handles are
public locators, not authorization credentials; avoid unnecessary diagnostic logging.

## Restore the previous diagnostic profile

In `src/remote.ts`, change only `registerCopilotDiagnosticTools(server, true)`
to `registerCopilotDiagnosticTools(server)` in the `copilot-sso` branch. The
existing default registrar restores status plus `brc_find_help_resources`;
`/mcp` remains unchanged. In the routing and diagnostic integration tests restore
the second tool name to `brc_find_help_resources`; restore its help invocation
in the diagnostic test. Remove/disable the SSO integration test and demo command
when deliberately rolling back that feature. Rebuild. Owner records may remain
inert in Cosmos; do not reinterpret or migrate them into anonymous connections.
If rolling back all SSO changes, also remove the browser-route registration and
SSO-specific modules after reviewing unrelated working-tree edits. Any later
deployment or connector authentication change is a separate manual action.

## Implementation file inventory

New files:

- `src/auth/entra_auth.ts`
- `src/auth/entra_store.ts`
- `src/auth/entra_browser.ts`
- `src/copilot_customers.ts`
- `src/auth/entra_auth.test.ts`
- `src/auth/entra_store.test.ts`
- `src/copilot_customers.test.ts`
- `src/tests/entra_fixture.ts`
- `src/tests/entra_mock_server.ts`
- `src/tests/entra_sso.integration.test.ts`
- `scripts/demo_copilot_sso.mjs`
- `docs/copilot-entra-sso.md`

Updated files:

- `package.json` and `package-lock.json`: direct `jose` dependency; SSO demo command.
- `src/remote.ts`: profile selection, per-request bearer verification, browser
  routes and generic SSO body-parser errors.
- `src/copilot_diagnostic.ts`: retain public diagnostic registrar and select the
  authenticated customer tool for the current profile.
- `src/auth/connection_store_types.ts`, `src/auth/memory_connection_store.ts`,
  `src/auth/cosmos_connection_store.ts`: additive owner-store integration.
- `src/auth/connection_page.ts`: RED-branded SSO manual/CSV entry and named connection results.
- `src/auth/credential_validation.ts`, `src/shared.ts`: suppress credential
  debugging/raw BRC errors in the SSO request context only.
- `src/tools/general/list_tools.ts`: reuse customer endpoint, query builder and
  existing BRC client with a bounded request timeout.
- `src/tests/mcp_profile_routing.integration.test.ts` and
  `src/tests/copilot_diagnostic.integration.test.ts`: exact minimal profile and
  public status regression coverage.
- `scripts/tests/lib/diagnostic_guards.mjs`: detect Entra-store access too.
- `docs/copilot-diagnostic.md`: identify the diagnostic document as historical
  and link to the current profile/rollback instructions.

Corresponding `build/` outputs are generated only by `npm run build`. Existing
unrelated working-tree changes are not reverted or included as SSO source edits.

### SSO browser regression prerequisites

The SSO integration test uses Playwright to exercise native browser form POSTs,
including the public-query-to-hidden-field handoff and browser-generated Origin.
Windows runs use installed Microsoft Edge in headless mode. On other platforms,
install the test browser with `npx playwright install --with-deps chromium` before
running `npm test`. No real Microsoft sign-in or BRC credentials are used.

SSO pages use `Referrer-Policy: strict-origin` so native form POSTs retain Origin
without sending URL paths, queries or fragments as referrers. The company-entry
page must not override this with a `no-referrer` meta policy. Anonymous connection
pages retain their existing privacy policy. The landing page enables sign-in
only for a syntactically valid public request handle. Infrastructure URL logs
may contain that non-secret locator; application diagnostics do not emit it.
