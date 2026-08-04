# Red telemetry identity (non-OAuth)

Red attaches **anonymous** Application Insights dimensions so operators can
approximate repeat browsers/devices separately from confirmed connection flows.

These metrics are **not** verified Big Red Cloud users. Until BRC OAuth exists,
do not describe them as unique authenticated users.

## Identifiers

| Dimension | Meaning |
| --- | --- |
| `red.telemetry_client_id` | Stable anonymous UUID for a browser/device, stored as a first-party cookie (`red_telemetry_client_id`) on the secure connection page. `localStorage` is a same-device fallback when cookies are blocked between visits. |
| `red.connection_session_id` | New server-generated UUID for each successful `brc_confirm_company_connection` claim. Stored with connection telemetry metadata (Cosmos/memory). |
| `red.client_platform` | `mistral`, `chatgpt`, `claude`, or `unknown`. Vibe is normalised to `mistral`. MCP client information is preferred, with stored session context and safe request signals used as fallbacks. |
| `red.environment` | From `BRC_DEPLOYMENT_ENV` (`staging` / `production`) when set. |
| `red.connected_company_count` | Count of companies loaded for the request/session. |
| `red.tool_name` | MCP tool name when a tool handler runs. |

The anonymous client id is also mapped to Application Insights **user id** via
OpenTelemetry `enduser.pseudo.id`. **Authenticated user id is never set.**

## Privacy

Never sent to telemetry:

- API keys, passwords, email addresses, or authenticated user identity
- `connectionRef`, claim/confirmation codes, `routeToken` values, authorisation headers, or raw MCP session IDs
- Company credentials or customer, supplier, invoice, or other accounting payloads

Telemetry failures never block connection or MCP requests. Missing client IDs
do not block users.

## Approximate vs verified

- **Unique clients** ≈ distinct anonymous browser/device cookies. Clearing
  cookies/localStorage or switching device/browser creates another client id.
- **Connection sessions** = confirmed connection flows (claim successes).
- Neither equals a verified BRC user account.

## MCP request ordering

Telemetry context is prepared in this order on each MCP request:

1. Resolve MCP session id
2. Resolve confirmed connection (`connectionRef` from tools/call args, session binding, or client claim)
3. Rehydrate company credentials into the session key store
4. Load `saveConnectionTelemetry` record for that connection id
5. Count companies from the connection store (not an empty in-memory map)
6. Enter `runWithRedTelemetryContext` and enrich the active span
7. Handle the MCP/tool request

Safe diagnostics log only booleans and counts (never id values):
`telemetryRecordFound`, `connectionContextFound`, `companyCount`, `platform`,
`clientIdPresent`, `connectionSessionIdPresent`.

## Kusto validation queries

### Unique anonymous clients

```kusto
requests
| where timestamp > ago(14d)
| extend ClientId = tostring(customDimensions["red.telemetry_client_id"])
| where isnotempty(ClientId)
| summarize UniqueClients = dcount(ClientId)
```

### Connection sessions

```kusto
requests
| where timestamp > ago(14d)
| extend SessionId = tostring(customDimensions["red.connection_session_id"])
| where isnotempty(SessionId)
| summarize ConnectionSessions = dcount(SessionId)
```

### Clients and sessions by environment

```kusto
requests
| where timestamp > ago(14d)
| extend
    ClientId = tostring(customDimensions["red.telemetry_client_id"]),
    SessionId = tostring(customDimensions["red.connection_session_id"]),
    Environment = tostring(customDimensions["red.environment"])
| summarize
    UniqueClients = dcountif(ClientId, isnotempty(ClientId)),
    ConnectionSessions = dcountif(SessionId, isnotempty(SessionId)),
    Requests = count()
    by Environment
```
