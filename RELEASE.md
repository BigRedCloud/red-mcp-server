# Red 1.5.0 — 5 August 2026

Customer-facing release notes for the public Red MCP server.

## Highlights

- More reliable **create, update, delete, batch, and email** actions through persistent request routing across the full workflow.
- Routing continuity through **lookup, preview, confirmation, and final write**, including short confirmations such as “yes” or “delete it” after a preview.
- Improved **company connection continuity** across MCP session changes on supported hosted platforms, using the secure connection page and silent `connectionRef` handling by the client.
- Clearer **connection flow**: credentials only on the secure page; success page **Copy message for chat** for confirmation.
- Better distinction between **help questions** (how-to / manual steps) and **actions** (perform the accounting workflow).
- Improved matching for **BRC Edu / Freshdesk / YouTube / webinar** help resources, with operator-managed synchronisation of supported content.
- Refreshed customer guidance in the README and tool catalogue.
- Listed on the public **MCP Register** for discovery (registration does not change connection behaviour or reliability).

## Safety reminders

- Company API keys are never entered in chat.
- Write actions still require preview and explicit confirmation.
- Email subject lines are controlled by **Big Red Cloud** where the API does not expose a subject override — Red does not set invoice email subjects.
- Assistants and MCP clients obtain `routeToken` values; end users do not provide them.

## Version

- Package / MCP server version: **1.5.0**
- Release date: **5 August 2026**
