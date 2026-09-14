# Temporary Copilot diagnostic profile

This describes the previous public diagnostic profile. The current branch uses
the [minimal Entra SSO profile](copilot-entra-sso.md); see that document for
restoring this two-public-tool profile.

The existing `/mcp/copilot` URL exposes only `brc_copilot_connector_status`
and `brc_find_help_resources`. No connector configuration change is needed.
This is a source-level temporary switch, not an environment flag: wherever
this revision runs, that exact path uses the diagnostic profile.

The help tool uses the existing public resource search schema and handler.
It needs no company, company API key, or user identity. It may read configured
resource storage; when unavailable, existing local catalogue fallbacks apply.
It does not call the accounting API. Its optional resource-service configuration
is distinct from company credentials; no new credentials are introduced.

Run `npm run build`, then `npm run demo:copilot-diagnostic`. The demo starts
and stops a local HTTP server, initializes `/mcp/copilot`, lists tools, and calls
the status tool. It does not contact the staging deployment.

To restore the normal Copilot profile, change the three exact `/mcp/copilot`
POST, GET, and DELETE handler arguments in `src/remote.ts` from
`copilot-diagnostic` to `copilot-read-only`, then rebuild. Update or remove the
temporary diagnostic integration test and demo when restoring. Restore the
`/mcp/copilot` expectations in `src/tests/mcp_profile_routing.integration.test.ts`
to the normal `copilot-read-only` catalogue and its allowlist assertions when
switching back; keep the assertions for all other routes. The diagnostic
registrar can remain unused or be removed. The main `/mcp` registry and the
existing explicit `/mcp/copilot/read-only` and `/mcp/copilot-full` routes are
unchanged. Deployment remains a separate action.
