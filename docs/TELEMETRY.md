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

## Downstream Big Red Cloud failures

When a Big Red Cloud HTTP request fails, the outer MCP request may still complete
successfully (`success=true` on the MCP call). Red records **safe** diagnostic
telemetry for the failed downstream call so operators can search Application
Insights without logging secrets.

Dimensions, when available:

| Dimension | Meaning |
| --- | --- |
| `red.brc_method` | HTTP method of the failed BRC call (for example `GET`, `PUT`) |
| `red.brc_path` | BRC path with query strings removed |
| `red.brc_status_code` | HTTP status code from Big Red Cloud, when known |
| `red.failure_stage` | `preflight` or `write` |
| `red.operation` | Intended operation (for example `create`, `update`, `delete`) |
| `red.outcome` | Always `failure` for this event |
| `red.record_type` | Record type when known (for example `Quote`) |
| `red.record_id` | Record identifier when known |
| `red.company_id` | Company identifier when known |

Red also creates an OpenTelemetry **CLIENT** span (a dependency) for the failed
BRC call and emits a structured trace event (`brc_request_failed`) with the same
`red.*` dimensions. Values that look like secrets are omitted rather than logged.
Telemetry failure must never break the customer request.

## Support-report correlation

The downloadable support diagnostic (`brc_generate_support_report`) may include:

| Report field | Application Insights |
| --- | --- |
| `telemetryConnectionSessionId` | `customDimensions["red.connection_session_id"]` |
| `telemetryClientId` | `customDimensions["red.telemetry_client_id"]` |

These are anonymous diagnostic identifiers, not authenticated Big Red Cloud
identities. Support can use the connection-session identifier to locate related
Application Insights events. The report may also contain MCP/session or
connection diagnostic identifiers when available, but never raw connection
references or credentials.

## Initiating request capture

Red captures only the natural-language instruction passed to `brc_route_request`
(`message`). It does not receive the full ChatGPT, Claude or Mistral conversation
transcript.

Captured routing text is length-limited (400 characters). API keys, bearer
tokens, passwords, authorisation values, route tokens and connection references
are redacted. If no routed instruction was received for an action, Red must not
invent one; the support report uses an action summary instead.

## Privacy

Anonymous diagnostic identifiers (`red.telemetry_client_id`,
`red.connection_session_id`) are not authenticated Big Red Cloud identities.

Never sent to telemetry:

- API keys, passwords, email addresses, or authenticated user identity
- `connectionRef`, claim/confirmation codes, `routeToken` values, authorisation headers, or raw MCP session IDs
- Request bodies, invoice/customer/supplier payloads, or company credentials

Safe failure telemetry **may** include `red.company_id` and `red.record_id` when
those identifiers are known. Do not treat their presence as a full accounting
payload.

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

### Failed BRC requests by status and path

CLIENT spans for failed BRC calls appear as Application Insights **dependencies**.
The structured console event is also written to **traces**.

```kusto
union traces, dependencies
| where timestamp > ago(14d)
| where name startswith "BRC "
    or message has "Red BRC request failed"
    or message has "brc_request_failed"
| extend
    Status = tostring(customDimensions["red.brc_status_code"]),
    Path = tostring(customDimensions["red.brc_path"]),
    Method = tostring(customDimensions["red.brc_method"])
| summarize Failures = count() by Status, Method, Path
| order by Failures desc
```

### Failures by stage and operation

```kusto
union traces, dependencies
| where timestamp > ago(14d)
| where name startswith "BRC "
    or message has "Red BRC request failed"
    or message has "brc_request_failed"
| extend
    Stage = tostring(customDimensions["red.failure_stage"]),
    Operation = tostring(customDimensions["red.operation"]),
    Outcome = tostring(customDimensions["red.outcome"])
| summarize Failures = count() by Stage, Operation, Outcome
| order by Failures desc
```

### Events for a support report connection session

Replace the placeholder with `telemetryConnectionSessionId` from the support report.

```kusto
union requests, traces, dependencies
| where timestamp > ago(14d)
| where tostring(customDimensions["red.connection_session_id"]) == "<paste telemetryConnectionSessionId from the support report>"
| project timestamp, itemType, name, customDimensions
| order by timestamp asc
```
