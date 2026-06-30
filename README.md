# Red MCP Server

Red is an open-source [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects AI assistants (such as Cursor or Claude Desktop) to [Big Red Cloud](https://www.bigredcloud.com) accounting data through a set of controlled MCP tools.

Instead of calling the Big Red Cloud REST API directly, users work in plain language. The server translates requests into structured API calls and applies safety checks around anything that changes data.

With Red, a connected user can:

- **Review** Big Red Cloud data with read-only lookups (customers, suppliers, products, invoices, quotes, nominal reports, and more).
- **Prepare drafts** of new records and see a plain-English preview before anything is sent.
- **Create, update, or delete** records only after explicit confirmation.

---

## Why open source?

We believe AI infrastructure should be transparent. Customers should be able to inspect the software that connects their accounting data to AI assistants.

Our competitive advantage is not the connector itself; it is our accounting platform, our expert bookkeeping advice, our customer experience, and the value we build on top of it.

By open-sourcing Red, we hope to encourage trust, community contributions, and wider adoption of open standards.

---

## Features

- Secure company connection flow (session-scoped, no credentials in chat)
- Read-only Big Red Cloud lookups
- Customer, supplier, product, sales rep, VAT, and analysis category tools
- Sales quotes, invoices, credit notes, purchases, payments, and cash tools
- Draft-before-write confirmation flow for create, update, delete, batch, and email actions
- VAT and transaction safety checks
- Sales invoice safeguards, including Gross Price Entry `priceBasis` handling, Sales VAT category validation, placeholder product ID blocking, and CR analysis category confirmation
- Session audit log of writes made through the MCP session
- Local stdio and hosted HTTP transports

---

## Security and safety model

Red is designed so that AI-driven access to accounting data stays controlled and auditable.

- **No credentials in the repository.** API keys and secrets are never committed. Configuration is supplied at runtime through environment variables.
- **No credentials in chat.** Customer credentials and API keys must not be pasted into chat. Companies are connected through the secure Red connection page instead.
- **Session-scoped connections.** A connected company is available only within the current MCP session and is held in session memory, not persisted to disk in normal operation.
- **Explicit confirmation for writes.** Create, update, delete, batch, and email actions require an explicit confirmation flag after a draft has been shown.
- **Draft previews before changes.** The first call to a write tool returns a draft/preview rather than performing the action.
- **Read and write are separated.** Read-only lookups are clearly distinct from actions that change data.
- **Audit log.** Writes made through the MCP session are recorded in a session audit log; read-only calls are not logged.
- **Deployment flags.** Update, delete, email, batch, and operator/dev tools can each be disabled per deployment, in which case the matching tools return a permission message instead of calling Big Red Cloud.

### Sales invoice safety checks

Recent work hardened sales invoice handling:

- **Gross Price Entry** requires an explicit `priceBasis` of `gross` or `net` so VAT is never guessed.
- **Sales VAT rates only.** Sales invoices must use a Sales VAT category; purchase VAT rates are blocked, even when the percentage matches.
- **Placeholder product IDs** (`productId` `0` and `1`) are treated as placeholders and blocked before a draft or post.
- **`note`** defaults to the customer name unless a note is explicitly provided, and is never set to a product name.
- **`deliveryTo`** is included only when a delivery address is explicitly provided.
- **Plain-language results.** Technical HTTP status codes are translated into plain-language messages for users.

---

## Architecture

Two entry points share one tool registry:

| Entry | File | Transport | Use case |
| ----- | ---- | --------- | -------- |
| Local stdio | `src/index.ts` | `StdioServerTransport` | An MCP client spawns `node build/index.js` |
| Hosted HTTP | `src/remote.ts` | Streamable HTTP on `/mcp` | `npm run start` — one MCP server per session |

Key shared modules:

- `src/server.ts` — MCP server factory and stdio singleton
- `src/register_all_tools.ts` — central tool registration; wraps the server so disabled skills register a permission-message blocker instead of the real tool, and so write tools get draft/confirmation handling
- `src/config/server_config.ts` — deployment skill gating driven by the `BRC_ALLOW_*` flags
- `src/config/mcp_config.ts` — MCP server instructions and connection-safety rules
- `src/shared.ts` — Big Red Cloud HTTP client, session-scoped connections, audit log, and helpers
- `src/guards/` — transaction, reference, VAT category, product line, and write-confirmation safety checks
- `src/auth/` — secure connection flow and connection store

Domain logic lives under `src/tools/`, with generic create/update/delete/list/batch helpers in `src/tools/general/`.

### Technology

- TypeScript / Node.js (ES modules)
- `@modelcontextprotocol/sdk`
- Zod for tool input validation
- Express + Streamable HTTP for hosted mode

---

## Requirements

- Use a current LTS version of Node.js.
- npm (bundled with Node.js).

---

## Installation

```bash
npm install
npm run build
```

If a `.env.example` file is provided, copy it to `.env` and adjust the values:

```bash
cp .env.example .env
```

Never commit your `.env` file or any real credentials.

---

## Running

Hosted HTTP server:

```bash
npm run start
# Serves the MCP endpoint at http://localhost:3000/mcp
```

Local stdio server:

```bash
npm run start:local
```

Opening the HTTP endpoint in a browser without an MCP session returns an error — that is expected.

### MCP client configuration

Local stdio (the client spawns the process):

```json
{
  "mcpServers": {
    "red-mcp-server": {
      "command": "node",
      "args": ["build/index.js"],
      "env": {
        "BRC_API_BASE_URL": "https://app.bigredcloud.com/api"
      }
    }
  }
}
```

Hosted HTTP:

```json
{
  "mcpServers": {
    "red-mcp-server": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

## Development and regression testing

| Script | Command | Purpose |
| ------ | ------- | ------- |
| Build | `npm run build` | Compile TypeScript to `build/` |
| Dev HTTP | `npm run dev` | Run the HTTP server from source with `tsx` |
| Dev stdio | `npm run dev:local` | Run the stdio server from source with `tsx` |
| All tests | `npm test` | Build, then run the full test suite |
| Unit tests | `npm run test:unit` | Unit tests only |
| Security tests | `npm run test:security` | Security-focused tests |
| Config tests | `npm run test:config` | Deployment/config tests |
| Integration tests | `npm run test:integration` | Integration tests |
| Production audit | `npm run audit:prod` | `npm audit` for production dependencies |

Tests cover the safety guards described above, including the sales invoice checks, transaction date validation, connection flow wording, and response wording.

---

## Environment variables

Configure the server with environment variables (for example via a `.env` file). The values below are **examples only** and must never contain real secrets or be committed.

```env
# Big Red Cloud API base URL
BRC_API_BASE_URL=https://app.bigredcloud.com/api

# HTTP port for hosted mode
PORT=3000

# MCP session lifetime (minutes)
BRC_MCP_SESSION_TTL_MINUTES=60

# Connection lifetime within an MCP session (minutes)
BRC_API_KEY_TTL_MINUTES=60

# Rate limiting (requests per minute per IP)
BRC_RATE_LIMIT_REQUESTS_PER_MINUTE=300

# SHA-256 hashes of blocked API keys, comma separated (hashes only, never raw keys)
BRC_API_KEY_BLACKLIST_SHA256=
```

Deployment skill flags control which categories of tools are active. When a flag is off, the matching tools return a permission message instead of calling Big Red Cloud:

```env
BRC_ALLOW_READ_SKILLS=true
BRC_ALLOW_UPDATE_SKILLS=true
BRC_ALLOW_DELETE_SKILLS=true
BRC_ALLOW_EMAIL_SKILLS=true
BRC_ALLOW_BATCH_SKILLS=true
# Operator-only diagnostics; keep off for normal deployments
BRC_ALLOW_DEV_MODE=false
```

You can review the active policy at runtime with the `brc_get_deployment_policy` tool.

---

## Connecting a company

Customers should connect companies through the **secure Red connection page**. Credentials and API keys should not be sent through chat.

The flow is:

1. Ask the assistant to start a company connection. It returns a secure connection page link.
2. On that page, enter a single company (or upload a CSV for several companies). Credentials are entered on the secure page, not in chat.
3. Return to the chat and provide the confirmation code shown on the success page.

Connection links are **one-time use**, and a connection is **scoped to the MCP session**. To connect more companies later, start a new connection.

Helper tools:

- List connected companies in the session
- Clear one company connection
- Clear all company connections

---

## Tool coverage

Red exposes a focused set of MCP tools, grouped by domain. Exact tool names and their endpoint mappings live in the source code under `src/tools/`.

For a detailed developer guide to the source layout and MCP tool coverage, see [docs/TOOLS.md](docs/TOOLS.md).

- **Company setup and readiness** — company setup configuration, financial year, options, readiness checks, transaction date validation, and getting-started guidance.
- **Customers and suppliers** — list/get/create/update/delete plus opening balances and account transactions.
- **Products and sales reps** — list/get/create/update/delete and product types.
- **Sales documents** — quotes, sales invoices, sales credit notes, and sales entries, including generated-reference variants and generating an invoice from a quote.
- **Purchases and payments** — purchases, payments, cash payments, and cash receipts.
- **VAT and analysis lookups** — VAT rates, VAT categories, VAT types, analysis categories, accounts, and related reference data.
- **Nominal reports** — nominal account listings and grouped/multi-company nominal reporting.
- **Audit and session** — session connection management and the session audit log.
- **Under development or deployment-gated** — bank account writes and email sending are available only where enabled by tenant configuration and deployment flags; read-only bank lookups are available for payments workflows.

Batch variants exist for the main create workflows and apply the same safety checks as the single-record tools.

---

## Known limitations

- Some features depend on how the company is configured in Big Red Cloud.
- Email sending and bank write operations may require additional tenant configuration and may be disabled by deployment flags.
- Generated-reference behaviour can depend on Big Red Cloud tenant settings, and some generated-document endpoints may apply the tenant's current transaction date.
- Tool availability may vary by deployment policy.

---
## Maintainers

This project is maintained by the Big Red Cloud software development team.

---

## Status

Red is an open-source MCP integration for Big Red Cloud and is under active development. Tool availability and behaviour may change between releases, and some capabilities are gated by deployment policy.

---

## License

This project is licensed under the Apache License 2.0.

---

## Contributing

Contributions are welcome. Please:

- Open an issue to discuss significant changes before submitting a pull request.
- Keep changes focused and include tests where practical (`npm test`).
- Avoid introducing credentials, secrets, customer data, or personal data into the repository, tests, or fixtures.

---

## Support and responsible disclosure

If you believe you have found a security issue, please report it to Big Red Cloud's support team.

