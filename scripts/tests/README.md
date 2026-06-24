# Legacy manual regression scripts

These scripts live under `scripts/tests/` and are **not** part of CI. The production automated test suite is:

```bash
npm test
```

Run `npm run build` before any legacy script.

## Connection setup (all scripts)

Legacy scripts seed the in-memory connection store via `scripts/tests/lib/stdio_test_server_entry.mjs`. They **do not** use `brc_set_company_api_key` unless you enable dev mode yourself.

After company context setup, each script runs an **auth preflight** (`brc_get_financial_year`). If BRC returns 401 Unauthorized, the script stops immediately, writes a `setup_failed` report (all unrun tools marked SKIPPED, not FAIL), and prints a safe message without exposing credentials.

Required environment variables:

| Variable | Purpose |
|----------|---------|
| `BRC_TEST_COMPANY` | Company name to test against |
| `BRC_TEST_API_KEY` | Company API key — **never printed or logged** |

Optional:

| Variable | Purpose |
|----------|---------|
| `BRC_MCP_SERVER_ENTRY` | Override MCP server entry (default: stdio test entry) |
| `BRC_TEST_DATE` | Safe transaction date for write tests |
| `BRC_API_KEY_TTL_MINUTES` | Credential TTL for seeded session (default 120) |

## Scripts

### Safe — read-only (`npm run test:readonly:legacy`)

- Exercises list/get/report/deployment read tools only
- Does **not** create, update, delete, batch, or email
- Fails clearly if the company is not connected
- Writes `reports/readonly-tools-test-results.json` and `reports/readonly-tools-test-summary.txt`
- Classifies every registered tool (pass / fail / skipped)

### Write regression (`npm run test:dev:legacy`)

**Requires:** `BRC_ALLOW_DEV_WRITE_TESTS=true`

- Creates temporary records tagged with `MCP TEST DEMO LD <stamp>`
- Cleans up via delete tools where possible
- Skips bank account writes unless `BRC_ALLOW_BANK_WRITE_TESTS=true`
- Skips email sends unless `BRC_ALLOW_EMAIL_TESTS=true` (use email script instead)
- Writes `reports/dev_test_results.json` and `reports/dev_test_summary.txt`

### Email regression (`npm run test:email:legacy`)

**Requires:**

- `BRC_ALLOW_EMAIL_TESTS=true`
- `BRC_TEST_EMAIL_TO` — safe test mailbox (never a real customer email)
- `BRC_TEST_EMAIL_FROM` — optional sender address

Sends real emails to the configured test recipient only.

### Cleanup (`npm run leftovers:scan` / `npm run leftovers:delete`)

- **Scan** (default): find leftover test records by marker (`MCP TEST DEMO LD`, LD-prefixed codes, etc.)
- **Delete:** requires `BRC_CONFIRM_DELETE=true`

Multi-company cleanup:

- `BRC_COMPANY_KEYS_FILE` — JSON map of company name → API key (do not commit)
- or `BRC_COMPANY_KEYS_JSON` inline

## Tool classification

Shared logic in `scripts/tests/lib/tool_classification.mjs` mirrors `src/config/server_config.ts` and assigns each registered tool to:

- `read-only`
- `write`
- `delete`
- `email`
- `dev-only`
- `skipped` (with explicit reason)

Each legacy script reports **every** tool returned by `tools/list` so nothing is silently omitted.

## Example commands

```powershell
npm run build
npm test
npm run audit:prod

$env:BRC_TEST_COMPANY = "Company C"
$env:BRC_TEST_API_KEY = "<from secure store>"
npm run test:readonly:legacy

$env:BRC_ALLOW_DEV_WRITE_TESTS = "true"
$env:BRC_TEST_DATE = "2015-01-15"
npm run test:dev:legacy

$env:BRC_ALLOW_EMAIL_TESTS = "true"
$env:BRC_TEST_EMAIL_TO = "you+red-test@example.test"
npm run test:email:legacy

npm run leftovers:scan
$env:BRC_CONFIRM_DELETE = "true"
npm run leftovers:delete
```
