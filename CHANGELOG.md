# Changelog

## 1.5.0 — 2026-08-05

### Added

- Authoritative action-workflow registry covering create, update, delete, batch, and email tools.
- Durable pending-action state for confirmation continuation after previews.
- Public release notes (`RELEASE.md`) and this changelog.

### Improved

- Request routing continuity across MCP session rotation and multi-step write workflows.
- Company connection guidance (Copy message for chat; credentials only on the secure page).
- Help versus action classification guidance for customers and assistants.
- Documentation of email fields and Big Red Cloud–controlled subject lines.

### Security / repository hygiene

- Removed sample ledger export from the public tree where present.
- Scrubbed employee machine paths and internal staging hostnames from examples and tests.
- Hardened `.gitignore` for logs, test results, secrets, and export artefacts.

## Earlier versions

See git history on prior release branches for details before 1.5.0.
