# Environment variables

This is the canonical **operator and self-hosting** configuration reference for the RED MCP server. Customers using the hosted RED service through ChatGPT, Claude, Mistral or Microsoft 365 Copilot normally do not configure these variables. Standard integrations use `https://red.bigredcloud.com/mcp`; Microsoft 365 Copilot uses `https://red.bigredcloud.com/mcp/copilot` and its separate Microsoft sign-in flow.

Examples are formats, not a production configuration export. Replace angle-bracket placeholders privately in your deployment settings or secret store; do not paste secrets into GitHub, Markdown, logs, chat or customer setup instructions. No local environment values were used to prepare this reference. Resource names, client/tenant IDs, paths, limits and flags remain placeholders even when they are not credentials. Public service URLs are explicitly marked.

“Required” describes the code path that consumes a setting. Optional does not mean advisable to leave unconfigured in production. Platform settings without an application reader are labelled **Depends on deployment configuration**; their live platform bindings are not proven by source inspection. Numeric examples intentionally omit production values and code-default resource names.

## Requested deployment settings

### Core RED configuration

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `BRC_PUBLIC_BASE_URL` | Public hosted origin used to generate connection links. | `https://red.bigredcloud.com` | Optional; hosted deployments must resolve the correct public origin. | Public URL |
| `BRC_CONNECT_PUBLIC_BASE_URL` | Explicit connection-page origin override; takes precedence over slot and general public URL resolution. | `<public-https-origin>` | Optional. | Internal configuration; resulting URL is public |
| `BRC_DEPLOYMENT_ENV` | Deployment label for telemetry and hosted-slot/public-URL behavior. | `<environment-label>` | Optional. | Internal |
| `BRC_DISPLAY_TIMEZONE` | IANA timezone for user-facing credential-expiry wording; falls back to TZ and then a code default. | `<IANA-timezone>` | Optional. | Internal configuration |
| `BRC_MCP_SESSION_TTL_MINUTES` | Legacy HTTP session lifetime and recent client-claim inheritance window, in minutes. | `<minutes>` | Optional; code default applies. | Internal |
| `BRC_RATE_LIMIT_REQUESTS_PER_MINUTE` | Per-IP HTTP request limit; non-positive values disable this limiter. | `<requests-per-minute>` | Optional; code default applies. | Internal |
| `BRC_MAX_BATCH_ITEMS` | Maximum items per write batch, subject to the source-defined cap. | `<maximum-batch-size>` | Optional; code default applies. | Internal |
| `BRC_MAX_AUDIT_ENTRIES` | Maximum retained session audit entries. | `<maximum-item-count>` | Optional; code default applies. | Internal |

### Feature controls

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `BRC_ALLOW_READ_SKILLS` | Registers read tools. Applied by the central registry; the separate federated facade uses its own audited read catalogue. | `<true\|false>` | Optional; choose deployment policy explicitly. | Internal |
| `BRC_ALLOW_UPDATE_SKILLS` | Registers create, update and other change tools. Applied by the central registry; the separate federated facade uses its own audited read catalogue. | `<true\|false>` | Optional; choose deployment policy explicitly. | Internal |
| `BRC_ALLOW_DELETE_SKILLS` | Registers delete tools. Applied by the central registry; the separate federated facade uses its own audited read catalogue. | `<true\|false>` | Optional; choose deployment policy explicitly. | Internal |
| `BRC_ALLOW_EMAIL_SKILLS` | Registers email-sending tools. Applied by the central registry; the separate federated facade uses its own audited read catalogue. | `<true\|false>` | Optional; choose deployment policy explicitly. | Internal |
| `BRC_ALLOW_BATCH_SKILLS` | Registers batch tools. Applied by the central registry; the separate federated facade uses its own audited read catalogue. | `<true\|false>` | Optional; choose deployment policy explicitly. | Internal |
| `BRC_ALLOW_DEV_MODE` | Enables developer/operator-only tools in the central registry; not an authorization mechanism. | `<true\|false>` | Optional; keep operator tools disabled on customer deployments. | Internal |

### Big Red Cloud API

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `BRC_API_BASE_URL` | Base URL used by Big Red Cloud HTTP calls and credential validation. | `https://app.bigredcloud.com/api` | Optional; public API URL is the code fallback. | Public URL |
| `BRC_API_KEY_BLACKLIST_SHA256` | Comma-separated SHA-256 hexadecimal hashes of blocked company API keys; never raw keys. | `<sha256-hash>[,<sha256-hash>...]` | Optional. | Internal security policy |
| `BRC_API_KEY_TTL_MINUTES` | Stored-company-credential lifetime and related expiry wording. | `<minutes>` | Optional; code default applies. | Internal |

### Connection management

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `RED_CONNECT_CONNECTION_STORE` | Connection backend selector: memory or cosmos; azure-table is a legacy alias for cosmos. | `<memory\|cosmos>` | Optional; memory is the fallback and is lost on restart. | Internal |
| `RED_CONNECT_HTTP_MODE` | HTTP-mode marker set by the hosted entry point; some readers test presence and others compare against true. | `<true\|false>` | Set automatically by hosted entry point; normally omit in stdio. | Internal |
| `RED_CONNECT_CREDENTIAL_DEBUG` | Enables credential-resolution diagnostics in shared helpers; suppressed in verified Entra owner context. | `<true\|false>` | Optional. | Internal diagnostic control |
| `RED_CONNECT_ENCRYPTION_KEY` | Secret encryption material for stored API keys, browser envelopes and continuations. Code can fall back to the Cosmos connection string. | `<encryption-key>` | Required encryption material for Entra flows/encrypted storage; dedicated key recommended. | Internal secret |
| `RED_ALLOW_RECENT_CONNECTION_FALLBACK` | No reader found in current application, Functions or script source. Do not assume this controls current client-claim inheritance. | `<true\|false>` | Depends on deployment configuration; no implemented control found. | Internal; unverified/unused |
| `RED_RECENT_CONNECTION_FALLBACK_TTL_MS` | No reader found; current client-claim inheritance derives its window from BRC_MCP_SESSION_TTL_MINUTES. | `<milliseconds>` | Depends on deployment configuration; no implemented control found. | Internal; unverified/unused |

### Microsoft 365 / Entra authentication

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `RED_ENTRA_ALLOWED_CLIENTS` | Optional comma-separated allowed azp client IDs for delegated access tokens. | `<entra-client-id>[,<entra-client-id>...]` | Optional; empty list adds no client restriction. | Internal identifiers |
| `RED_ENTRA_AUDIENCES` | Comma-separated exact accepted API audiences: client IDs and/or Application ID URIs. | `<entra-client-id>,<application-id-uri>` | Required for token verification; absent/empty fails closed. | Internal identifiers |
| `RED_ENTRA_PUBLIC_BASE_URL` | HTTPS origin for browser sign-in and management links; no path, query, fragment or URL credentials. | `https://red.bigredcloud.com` | Required when browser connection/management flows are used. | Public URL |
| `RED_ENTRA_REQUIRED_SCOPE` | Delegated scope required in access-token scp; a code default applies when unset. Match the API's exposed scope. | `<delegated-scope-name>` | Optional override; required scope must be present in access tokens. | Internal configuration |
| `RED_ENTRA_WEB_CLIENT_ID` | Confidential browser application's Entra client ID. | `<entra-client-id>` | Required for browser sign-in. | Internal identifier |
| `RED_ENTRA_WEB_CLIENT_SECRET` | Confidential browser application's OAuth client secret. | `<entra-client-secret>` | Required for browser authorization-code exchange. | Internal secret |
| `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` | Azure authentication-provider secret setting; not read by this application's source. Consumed by Azure App Service Easy Auth; verify the live binding privately. | `<oauth-client-secret>` | Depends on deployment configuration. | Internal platform secret |
| `WEBSITE_AUTH_AAD_ALLOWED_TENANTS` | Azure authentication tenant-policy setting; not read by this application's verifier. Do not confuse it with the organizational multitenant Copilot verification policy. | `<entra-tenant-id>[,<entra-tenant-id>...]` | Depends on deployment configuration. | Internal platform identifiers |

### Cosmos connection store

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `RED_CONNECT_COSMOS_CONNECTION_STRING` | Cosmos connection string for the selected persistent connection backend; also a legacy encryption-material fallback. | `<cosmos-connection-string>` | Required when the selected backend is cosmos. | Internal secret |
| `RED_CONNECT_COSMOS_DATABASE` | Cosmos database name; code has a fallback name. | `<cosmos-database-name>` | Optional override for cosmos deployments. | Internal resource name |
| `RED_CONNECT_COSMOS_CONTAINER` | Cosmos container name; code has a fallback name. | `<cosmos-container-name>` | Optional override for cosmos deployments. | Internal resource name |

### RED help / education resources

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `BRC_EDU_SOURCE` | Help CSV source selector: graph selects Microsoft Graph; other/unset values select local resources. | `<local\|graph>` | Optional. | Internal |
| `BRC_EDU_CACHE_TTL_MINUTES` | Positive cache lifetime in minutes for help-resource loaders; invalid values fall back to code defaults. | `<minutes>` | Optional. | Internal |
| `BRC_EDU_ADMIN_UPLOAD_SECRET` | Shared admin-access fallback secret; separate from Microsoft-owner Copilot authentication. | `<secret>` | Required only when using secret-based admin fallback. | Internal secret |
| `BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET` | HMAC secret for public help-image access tokens; do not put it in customer URLs or Markdown. | `<random-signing-secret>` | Signing material required when signed image access is used. | Internal secret |
| `BRC_EDU_STORAGE_CONNECTION` | No reader found. Current storage readers use BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING and BRC_EDU_KB_STORAGE_CONNECTION / BRC_EDU_KB_STORAGE_CONNECTION_STRING. | `<storage-connection-string>` | Depends on deployment configuration; no implemented reader found. | Internal secret; unverified/unused |
| `BRC_EDU_SYNC_SECRET` | Shared secret required to authorize resource/service sync requests. | `<secret>` | Required for protected sync operations. | Internal secret |
| `BRC_EDU_SYNCED_RESOURCES_PATH` | Filesystem path for the synced help-resource JSON; code has a repository-relative fallback. | `<operator-configured-file-path>` | Optional. | Internal path |
| `BRC_EDU_UPLOAD_CONTAINER` | Shared Blob container for help indexes and catalogues. | `<storage-container-name>` | Required with shared Blob storage. | Internal resource name |
| `BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING` | Azure Blob connection string for shared help indexes and catalogues. | `<storage-connection-string>` | Required with shared Blob storage. | Internal secret |

### YouTube integration

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `BRC_YOUTUBE_API_KEY` | YouTube Data API credential used during catalogue sync. | `<api-key>` | Required for YouTube Data API sync. | Internal secret |
| `BRC_YOUTUBE_CHANNEL_ID` | Channel to synchronize. | `<youtube-channel-id>` | Required for YouTube Data API sync. | Internal identifier |
| `BRC_YOUTUBE_UPLOADS_PLAYLIST_ID` | Optional explicit uploads playlist selector. | `<playlist-id>` | Optional; channel uploads can be resolved. | Internal identifier |
| `BRC_YOUTUBE_WEBINAR_PLAYLIST_ID` | Webinar classification playlist; code has a deployment-specific fallback that self-hosters should review. | `<playlist-id>` | Optional override. | Internal identifier |
| `BRC_YOUTUBE_CATALOG_BLOB` | Raw YouTube catalogue blob path. | `<blob-path>` | Optional override; code default applies. | Internal path |
| `BRC_YOUTUBE_OVERRIDES_BLOB` | YouTube visibility/classification overrides blob path. | `<blob-path>` | Optional override; code default applies. | Internal path |
| `BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB` | Merged effective YouTube catalogue blob path. | `<blob-path>` | Optional override; code default applies. | Internal path |
| `BRC_YOUTUBE_SYNC_SCHEDULE` | Azure Functions timer schedule (NCRONTAB expression). | `<cron-expression>` | Optional; timer code has a fallback. | Internal |
| `BRC_YOUTUBE_WEBHOOK_CALLBACK_URL` | No reader found. Any callback registration is outside the application configuration proven by source. | `<webhook-callback-url>` | Depends on deployment configuration. | Internal URL; unverified/unused |
| `BRC_YOUTUBE_WEBHOOK_SECRET` | WebSub hub.secret used to authenticate exact POST bytes at both hosted webhook entry points. GET subscription challenges do not trigger sync. | `<secret>` | Required for accepting webhook POSTs; missing configuration fails closed. | Internal secret |

### Telemetry

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Enables Azure Monitor/Application Insights initialization in hosted mode. | `<application-insights-connection-string>` | Optional; unset disables this initialization. | Internal connection information |

### Security and signing

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `BRC_ROUTE_TOKEN_SIGNING_SECRET` | Shared HMAC signing material for action-route tokens. Unset uses an ephemeral process key. | `<random-signing-secret>` | Required operationally for consistent tokens across hosted instances/restarts; code permits fallback. | Internal secret |
| `OPENAI_APPS_CHALLENGE_TOKEN` | Deployment verification challenge served by the dedicated public challenge handler. Configure privately; never copy the issued token into Markdown. | `<challenge-token>` | Required only for the verification challenge; absent handler value returns unavailable. | Internal configuration; publicly served challenge |

### Azure/runtime settings

| Variable | Purpose | Example / format | Required | Public or internal |
| --- | --- | --- | --- | --- |
| `WEBSITE_NODE_DEFAULT_VERSION` | Azure runtime configuration setting; not read directly by the application. Align runtime choice with the lockfile and hosting configuration. | `<node-runtime-version>` | Depends on deployment configuration. | Internal platform setting |

## Additional settings found in source and runtime examples

These settings extend the requested list. They are server/operator settings unless labelled platform metadata. The final column identifies the reader or runtime example; names without a reader are not presented as working application controls.

| Variable | Purpose | Example / format | Required | Public or internal | Source |
| --- | --- | --- | --- | --- | --- |
| `PORT` | HTTP listener port; also used for local URL fallback. | `<port-number>` | Optional. | Internal | [src/remote.ts](../src/remote.ts); [src/config/server_config.ts](../src/config/server_config.ts) |
| `NODE_ENV` | Runtime label used for strict public URL validation and telemetry environment fallback. | `<runtime-environment>` | Optional. | Internal | [src/config/red_public_base_url.ts](../src/config/red_public_base_url.ts); [src/telemetry/platform.ts](../src/telemetry/platform.ts) |
| `TZ` | Fallback IANA timezone when BRC_DISPLAY_TIMEZONE is absent. | `<IANA-timezone>` | Optional. | Internal | [src/config/server_config.ts](../src/config/server_config.ts) |
| `WEBSITE_HOSTNAME` | Azure-supplied hostname used for slot-aware connection origins. | `<host-name>` | Depends on deployment configuration. | Internal platform identifier | [src/config/server_config.ts](../src/config/server_config.ts) |
| `WEBSITE_SLOT_NAME` | Azure slot label used to distinguish non-production connection origins. | `<slot-name>` | Depends on deployment configuration. | Internal platform identifier | [src/config/server_config.ts](../src/config/server_config.ts); [src/auth/connection_store.ts](../src/auth/connection_store.ts) |
| `WEBSITE_INSTANCE_ID` | Azure instance identifier hashed for diagnostics. | `<instance-id>` | Platform supplied; optional fallback chain. | Internal platform identifier | [src/auth/mcp_http_session.ts](../src/auth/mcp_http_session.ts) |
| `COMPUTERNAME` | Machine-name fallback for hashed instance diagnostics. | `<machine-name>` | Optional/platform supplied. | Internal identifier | [src/auth/mcp_http_session.ts](../src/auth/mcp_http_session.ts) |
| `HOSTNAME` | Host-name fallback for hashed instance diagnostics. | `<host-name>` | Optional/platform supplied. | Internal identifier | [src/auth/mcp_http_session.ts](../src/auth/mcp_http_session.ts) |
| `npm_package_version` | npm-provided version fallback for support reports. | `<package-version>` | Optional/platform supplied. | Runtime metadata | [src/audit/support_report.ts](../src/audit/support_report.ts) |
| `RED_PUBLIC_BASE_URL` | Preferred public help-image origin, ahead of BRC_PUBLIC_BASE_URL. | `<public-https-origin>` | Optional; valid hosted origin needed for public image links. | Internal configuration; resulting URL is public | [src/config/red_public_base_url.ts](../src/config/red_public_base_url.ts) |
| `RED_PUBLIC_ALLOWED_HOSTS` | Comma-separated host allowlist for strict public help-image URL validation. | `<host-name>[,<host-name>...]` | Optional. | Internal policy | [src/config/red_public_base_url.ts](../src/config/red_public_base_url.ts) |
| `RED_MCP_TOOL_PROFILE` | Local/stdio registry profile selector; hosted routes select profiles explicitly. | `<full\|copilot\|copilot-read-only>` | Optional; full is fallback. | Internal policy | [src/tool_profiles.ts](../src/tool_profiles.ts); [src/register_all_tools.ts](../src/register_all_tools.ts) |
| `RED_CONNECT_SESSION_DEBUG` | Explicit session diagnostic control; unset defaults to disabled. | `<true\|false>` | Optional. | Internal diagnostic control | [src/auth/mcp_http_session.ts](../src/auth/mcp_http_session.ts) |
| `RED_CONNECT_CREDENTIAL_VALIDATION_DEBUG` | Credential-validation diagnostic control, distinct from RED_CONNECT_CREDENTIAL_DEBUG; unset defaults to disabled. | `<true\|false>` | Optional. | Internal diagnostic control | [src/auth/credential_validation.ts](../src/auth/credential_validation.ts) |
| `BRC_EDU_ADMIN_ENTRA_TENANT_ID` | Staff-admin tenant restriction evaluated on trusted Easy Auth claims. | `<entra-tenant-id>` | Required for staff Entra admin access. | Internal identifier | [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts) |
| `BRC_EDU_ADMIN_ENTRA_GROUP_ID` | Approved staff group for admin access. | `<entra-group-id>` | At least group ID or app role required for staff Entra admin access. | Internal identifier | [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts) |
| `BRC_EDU_ADMIN_ENTRA_APP_ROLE` | Approved staff application role for admin access. | `<application-role-name>` | At least app role or group ID required for staff Entra admin access. | Internal policy | [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts) |
| `BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK` | Controls shared-secret admin fallback; absent value permits fallback. | `<true\|false>` | Optional. | Internal policy | [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts) |
| `BRC_EDU_ADMIN_PUBLIC_URL` | Operator-facing admin page URL override. | `<admin-page-url>` | Optional. | Internal URL | [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts) |
| `BRC_EDU_ADMIN_PROTECTED_PATH` | Protected admin path override. | `<protected-admin-path>` | Optional. | Internal path | [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts) |
| `BRC_EDU_GRAPH_TENANT_ID` | Tenant for the Graph help-resource application. | `<entra-tenant-id>` | Required with Graph resource loading. | Internal identifier | [src/edu/brc_edu_graph.ts](../src/edu/brc_edu_graph.ts) |
| `BRC_EDU_GRAPH_CLIENT_ID` | Application client ID for Graph resource loading. | `<entra-client-id>` | Required with Graph resource loading. | Internal identifier | [src/edu/brc_edu_graph.ts](../src/edu/brc_edu_graph.ts) |
| `BRC_EDU_GRAPH_CLIENT_SECRET` | Application secret for Graph client-credentials exchange. | `<oauth-client-secret>` | Required with Graph resource loading. | Internal secret | [src/edu/brc_edu_graph.ts](../src/edu/brc_edu_graph.ts) |
| `BRC_EDU_GRAPH_DRIVE_ID` | Graph drive containing the help-resource CSV. | `<graph-drive-id>` | Required with Graph resource loading. | Internal identifier | [src/edu/brc_edu_graph.ts](../src/edu/brc_edu_graph.ts) |
| `BRC_EDU_GRAPH_ITEM_ID` | Graph item containing the help-resource CSV. | `<graph-item-id>` | Required with Graph resource loading. | Internal identifier | [src/edu/brc_edu_graph.ts](../src/edu/brc_edu_graph.ts) |
| `BRC_EDU_SUPPORT_CSV_PATH` | Local source CSV path used by resource helpers/scripts. | `<operator-configured-file-path>` | Optional. | Internal path | [src/edu/brc_edu_paths.ts](../src/edu/brc_edu_paths.ts) |
| `BRC_EDU_ENRICHED_CSV_PATH` | Local enriched help CSV path. | `<operator-configured-file-path>` | Optional. | Internal path | [src/edu/brc_edu_paths.ts](../src/edu/brc_edu_paths.ts) |
| `BRC_EDU_KB_STORAGE_CONNECTION` | Preferred knowledge-base Blob connection string. | `<storage-connection-string>` | Optional override; shared upload storage is fallback. | Internal secret | [src/brc-edu/freshdesk/freshdesk-kb-storage.ts](../src/brc-edu/freshdesk/freshdesk-kb-storage.ts) |
| `BRC_EDU_KB_STORAGE_CONNECTION_STRING` | Alternative knowledge-base storage name used when the preferred variable is absent; an explicitly blank preferred value skips this alias and falls back to shared upload storage. | `<storage-connection-string>` | Optional alias. | Internal secret | [src/brc-edu/freshdesk/freshdesk-kb-storage.ts](../src/brc-edu/freshdesk/freshdesk-kb-storage.ts) |
| `BRC_EDU_KB_IMAGE_CONTAINER` | Knowledge-base screenshot container override. | `<storage-container-name>` | Optional. | Internal resource name | [src/brc-edu/freshdesk/freshdesk-kb-storage.ts](../src/brc-edu/freshdesk/freshdesk-kb-storage.ts) |
| `BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET_PREVIOUS` | Previous HMAC key for image-token validation during rotation. | `<previous-signing-secret>` | Optional; configure the current key for new tokens. | Internal secret | [src/brc-edu/freshdesk/freshdesk-public-image-token.ts](../src/brc-edu/freshdesk/freshdesk-public-image-token.ts) |
| `FRESHDESK_API_KEY` | Freshdesk API credential for help-article synchronization. | `<api-key>` | Required for Freshdesk sync. | Internal secret | [src/brc-edu/freshdesk/freshdesk-admin-sync.ts](../src/brc-edu/freshdesk/freshdesk-admin-sync.ts) |
| `FRESHDESK_BASE_URL` | Freshdesk help-service origin; code has a service-specific fallback. | `<freshdesk-https-origin>` | Optional override. | Internal service configuration | [src/brc-edu/freshdesk/freshdesk-admin-sync.ts](../src/brc-edu/freshdesk/freshdesk-admin-sync.ts) |
| `BRC_FRESHDESK_OVERRIDES_BLOB` | Freshdesk override blob path. | `<blob-path>` | Optional. | Internal path | [src/brc-edu/freshdesk/freshdesk-catalog-store.ts](../src/brc-edu/freshdesk/freshdesk-catalog-store.ts) |
| `BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB` | Effective Freshdesk catalogue blob path. | `<blob-path>` | Optional. | Internal path | [src/brc-edu/freshdesk/freshdesk-catalog-store.ts](../src/brc-edu/freshdesk/freshdesk-catalog-store.ts) |
| `BRC_FRESHDESK_SYNC_STATUS_BLOB` | Freshdesk sync-status blob path. | `<blob-path>` | Optional. | Internal path | [src/brc-edu/freshdesk/freshdesk-catalog-store.ts](../src/brc-edu/freshdesk/freshdesk-catalog-store.ts) |
| `BRC_YOUTUBE_SYNC_STATUS_BLOB` | YouTube sync-status blob path. | `<blob-path>` | Optional. | Internal path | [src/brc-edu/youtube/youtube-catalog-store.ts](../src/brc-edu/youtube/youtube-catalog-store.ts) |
| `RED_BRC_YOUTUBE_SYNC_ENDPOINT` | Function worker's target service-sync URL; contains an operator-configured internal route. | `<service-sync-url>` | Required for timer sync and enabled webhook forwarding. | Internal URL | [functions/brc-edu-resource-processor/src/constants.ts](../functions/brc-edu-resource-processor/src/constants.ts) |
| `RED_BRC_YOUTUBE_SYNC_SECRET` | Function worker's secret for the target service-sync endpoint. | `<secret>` | Required for timer sync and enabled webhook forwarding. | Internal secret | [functions/brc-edu-resource-processor/src/constants.ts](../functions/brc-edu-resource-processor/src/constants.ts) |
| `RED_BRC_YOUTUBE_WEBHOOK_FORWARD` | Controls Function webhook forwarding; values other than false enable it. | `<true\|false>` | Optional. | Internal policy | [functions/brc-edu-resource-processor/src/brcEduYouTubeWebhook.ts](../functions/brc-edu-resource-processor/src/brcEduYouTubeWebhook.ts) |
| `AzureWebJobsStorage` | Azure Functions host storage setting in the configuration example; not directly read by application code. | `<storage-connection-string>` | Depends on deployment configuration. | Internal platform secret | [functions/brc-edu-resource-processor/local.settings.json.example](../functions/brc-edu-resource-processor/local.settings.json.example) |
| `FUNCTIONS_WORKER_RUNTIME` | Azure Functions worker selection in the configuration example. | `<worker-runtime>` | Depends on deployment configuration. | Internal platform setting | [functions/brc-edu-resource-processor/local.settings.json.example](../functions/brc-edu-resource-processor/local.settings.json.example) |

## Configuration relationships and limits

- Connection-page origin resolution prefers `BRC_CONNECT_PUBLIC_BASE_URL`, then a non-production Azure slot hostname, then `BRC_PUBLIC_BASE_URL`, hosted hostname, and finally a local development URL. Set the origin to the instance/store that owns the connection; do not copy internal slot hostnames into public examples.
- Public help-image links use a separate resolver: `RED_PUBLIC_BASE_URL`, then `BRC_PUBLIC_BASE_URL`. `RED_PUBLIC_ALLOWED_HOSTS` applies when strict URL validation is active.
- `RED_CONNECT_CONNECTION_STORE=azure-table` is a legacy selector alias for Cosmos, not an Azure Table backend. Only the supported backend selectors should be used for new deployments.
- `BRC_EDU_STORAGE_CONNECTION` has no implemented alias relationship. The knowledge-base storage reader prefers `BRC_EDU_KB_STORAGE_CONNECTION`, then its `_STRING` alias when the preferred name is absent, then shared upload storage. Do not assume similar names are interchangeable.
- `RED_CONNECT_CREDENTIAL_DEBUG`, `RED_CONNECT_CREDENTIAL_VALIDATION_DEBUG` and `RED_CONNECT_SESSION_DEBUG` are three separate controls. Session and credential-validation diagnostics are off unless explicitly enabled; review all diagnostics and log access for production.
- Entra access-token validation requires configured audiences and the required delegated scope. The optional caller allowlist is not a tenant allowlist. The application accepts verified organizational tenants and rejects personal Microsoft accounts. Azure staff-admin authentication policy is a separate boundary.
- Entra browser flows require protected encryption material. The current code can derive it from the Cosmos connection string if a dedicated key is absent; review rotation and recovery privately. Do not publish either value.
- The action router permits an ephemeral signing key if its setting is absent. Hosted instances need shared, privately configured signing material for reliable route-token verification.
- Feature controls apply to the central registry; the current federated Copilot facade has its own explicit read catalogue. A feature flag is not a substitute for authentication or authorization.
- The webhook callback setting in the requested list has no code reader. Inspect private subscription/platform configuration before relying on it. Never publish a callback containing a secret query string.

## Operator-script and test-only inventory

These names are not general customer setup or server deployment requirements. They are used by optional export/sync scripts or local test helpers. Supply credentials privately and use isolated test data; never enable write/email/cleanup scripts against production as a documentation check.

- Export scripts: `BRC_EXPORT_COMPANY`, `BRC_EXPORT_API_KEY`, `BRC_COMPANY_A_API_KEY`, `BRC_COMPANY_B_API_KEY`, `BRC_COMPANY_C_API_KEY`, `BRC_COMPANY_D_API_KEY`, and the dynamic pattern `BRC_<normalized-company-name>_API_KEY`. Credential formats are `<api-key>`; names use `<company-name>`.
- Manual staging sync script: `BRC_EDU_STAGING_SYNC_SECRET` uses `<secret>` and is read from the operator's user environment; no staging host or local filesystem value belongs in public examples.
- Local Entra fixture preload: `RED_ENTRA_TEST_PRIVATE_JWK` uses `<test-only-private-jwk-json>`. It is test-only, never a production authentication setting.

The safe local test bootstrap also sets `DOTENV_CONFIG_PATH` to a nonexistent fixture path, clears operator credentials and uses in-memory storage. This is a test-only control, not production setup.

### Script and test names found during the source scan

| Variable | Scope / format | Source |
| --- | --- | --- |
| `BRC_ALLOW_BANK_WRITE_TESTS` | Operator script/test only; `<true\|false>` | [scripts/tests/dev-only/dev_test.mjs:51](../scripts/tests/dev-only/dev_test.mjs#L51) |
| `BRC_ALLOW_DEV_WRITE_TESTS` | Operator script/test only; `<true\|false>` | [scripts/tests/dev-only/dev_test.mjs:34](../scripts/tests/dev-only/dev_test.mjs#L34) |
| `BRC_ALLOW_EMAIL_TESTS` | Operator script/test only; `<true\|false>` | [scripts/tests/dev-only/dev_test.mjs:53](../scripts/tests/dev-only/dev_test.mjs#L53) |
| `BRC_COMPANY_A_API_KEY` | Operator script/test only; `<api-key>` | [scripts/exports/export-customer-balances-to-excel.mjs:22](../scripts/exports/export-customer-balances-to-excel.mjs#L22) |
| `BRC_COMPANY_B_API_KEY` | Operator script/test only; `<api-key>` | [scripts/exports/export-customer-balances-to-excel.mjs:26](../scripts/exports/export-customer-balances-to-excel.mjs#L26) |
| `BRC_COMPANY_C_API_KEY` | Operator script/test only; `<api-key>` | [scripts/exports/export-customer-balances-to-excel.mjs:30](../scripts/exports/export-customer-balances-to-excel.mjs#L30) |
| `BRC_COMPANY_D_API_KEY` | Operator script/test only; `<api-key>` | [scripts/exports/export-customer-balances-to-excel.mjs:34](../scripts/exports/export-customer-balances-to-excel.mjs#L34) |
| `BRC_COMPANY_KEYS_FILE` | Operator script/test only; `<operator-configured-file-path>` | [scripts/tests/lib/connection_env.mjs:56](../scripts/tests/lib/connection_env.mjs#L56) |
| `BRC_COMPANY_KEYS_JSON` | Operator script/test only; `<company-credentials-json>` | [scripts/tests/lib/connection_env.mjs:54](../scripts/tests/lib/connection_env.mjs#L54) |
| `BRC_CONFIRM_DELETE` | Operator script/test only; `<true\|false>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:19](../scripts/tests/dev-only/dev_test_cleanup.mjs#L19) |
| `BRC_EDU_STAGING_SYNC_SECRET` | Operator script/test only; `<secret>` | [scripts/sync_brc_edu_to_staging_slot.ps1:5](../scripts/sync_brc_edu_to_staging_slot.ps1#L5) |
| `BRC_EXPORT_API_KEY` | Operator script/test only; `<api-key>` | [scripts/exports/export-full-company-report-to-excel.mjs:22](../scripts/exports/export-full-company-report-to-excel.mjs#L22) |
| `BRC_EXPORT_COMPANY` | Operator script/test only; `<test-or-script-value>` | [scripts/exports/export-full-company-report-to-excel.mjs:18](../scripts/exports/export-full-company-report-to-excel.mjs#L18) |
| `BRC_LEFTOVERS_ACTION` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:18](../scripts/tests/dev-only/dev_test_cleanup.mjs#L18) |
| `BRC_LEFTOVERS_PAGE_SIZE` | Operator script/test only; `<maximum-item-count>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:21](../scripts/tests/dev-only/dev_test_cleanup.mjs#L21) |
| `BRC_LEFTOVERS_PROFILE` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:20](../scripts/tests/dev-only/dev_test_cleanup.mjs#L20) |
| `BRC_LEFTOVERS_REPORT` | Operator script/test only; `<operator-configured-file-path>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:287](../scripts/tests/dev-only/dev_test_cleanup.mjs#L287) |
| `BRC_MCP_SERVER_ENTRY` | Operator script/test only; `<operator-configured-file-path>` | [scripts/tests/dev-only/dev_test.mjs:89](../scripts/tests/dev-only/dev_test.mjs#L89) |
| `BRC_SEARCH_NEEDLES` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:27](../scripts/tests/dev-only/dev_test_cleanup.mjs#L27) |
| `BRC_TEST_API_KEY` | Operator script/test only; `<api-key>` | [scripts/tests/lib/connection_env.mjs:18](../scripts/tests/lib/connection_env.mjs#L18) |
| `BRC_TEST_COMPANY` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/lib/connection_env.mjs:11](../scripts/tests/lib/connection_env.mjs#L11) |
| `BRC_TEST_COMPANY_NAME` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/lib/connection_env.mjs:12](../scripts/tests/lib/connection_env.mjs#L12) |
| `BRC_TEST_DATE` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test.mjs:90](../scripts/tests/dev-only/dev_test.mjs#L90) |
| `BRC_TEST_EMAIL_FROM` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test_email_tools.mjs:47](../scripts/tests/dev-only/dev_test_email_tools.mjs#L47) |
| `BRC_TEST_EMAIL_TO` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test_email_tools.mjs:38](../scripts/tests/dev-only/dev_test_email_tools.mjs#L38) |
| `BRC_TEST_MARKER` | Operator script/test only; `<test-or-script-value>` | [scripts/tests/dev-only/dev_test_cleanup.mjs:22](../scripts/tests/dev-only/dev_test_cleanup.mjs#L22) |
| `RED_ENTRA_TEST_PRIVATE_JWK` | Operator script/test only; `<test-only-private-jwk-json>` | [src/tests/entra_mock_server.ts:3](../src/tests/entra_mock_server.ts#L3) |

## Source verification map

The requested settings were checked against these readers:

- **Core RED configuration:** [src/config/server_config.ts](../src/config/server_config.ts); [src/telemetry/platform.ts](../src/telemetry/platform.ts); [src/auth/connection_store.ts](../src/auth/connection_store.ts); [src/remote.ts](../src/remote.ts).
- **Feature controls:** [src/config/server_config.ts](../src/config/server_config.ts); [src/register_all_tools.ts](../src/register_all_tools.ts).
- **Big Red Cloud API:** [src/shared.ts](../src/shared.ts); [src/auth/credential_validation.ts](../src/auth/credential_validation.ts); [src/config/server_config.ts](../src/config/server_config.ts).
- **Connection management:** [src/auth/connection_store.ts](../src/auth/connection_store.ts); [src/remote.ts](../src/remote.ts); [src/shared.ts](../src/shared.ts); [src/auth/credential_encryption.ts](../src/auth/credential_encryption.ts); [src/auth/credential_secret.ts](../src/auth/credential_secret.ts).
- **Microsoft 365 / Entra authentication:** [src/auth/entra_auth.ts](../src/auth/entra_auth.ts); [src/auth/entra_browser.ts](../src/auth/entra_browser.ts); platform/unused settings have no application reader.
- **Cosmos connection store:** [src/auth/connection_store.ts](../src/auth/connection_store.ts); [src/auth/credential_encryption.ts](../src/auth/credential_encryption.ts).
- **RED help / education resources:** [src/edu/brc_edu_resources.ts](../src/edu/brc_edu_resources.ts); [src/brc-edu/customer-docs/customer-docs-index-store.ts](../src/brc-edu/customer-docs/customer-docs-index-store.ts); [src/edu/brc_edu_upload_store.ts](../src/edu/brc_edu_upload_store.ts); [src/edu/brc_edu_admin_auth.ts](../src/edu/brc_edu_admin_auth.ts); [src/brc-edu/freshdesk/freshdesk-public-image-token.ts](../src/brc-edu/freshdesk/freshdesk-public-image-token.ts); [src/brc-edu/freshdesk/freshdesk-kb-storage.ts](../src/brc-edu/freshdesk/freshdesk-kb-storage.ts); [src/edu/brc_edu_synced_store.ts](../src/edu/brc_edu_synced_store.ts).
- **YouTube integration:** [src/brc-edu/youtube/youtube-client.ts](../src/brc-edu/youtube/youtube-client.ts); [src/brc-edu/youtube/youtube-catalog-store.ts](../src/brc-edu/youtube/youtube-catalog-store.ts); [functions/brc-edu-resource-processor/src/brcEduYouTubeSyncTimer.ts](../functions/brc-edu-resource-processor/src/brcEduYouTubeSyncTimer.ts); platform/unused settings have no application reader; [src/remote.ts](../src/remote.ts); [src/brc-edu/youtube/youtube-admin-http.ts](../src/brc-edu/youtube/youtube-admin-http.ts).
- **Telemetry:** [src/telemetry.ts](../src/telemetry.ts).
- **Security and signing:** [src/routing/route-token.ts](../src/routing/route-token.ts); [src/openai_apps_challenge.ts](../src/openai_apps_challenge.ts).
- **Azure/runtime settings:** platform/unused settings have no application reader.

## Requested-variable validation checklist

This checklist records documentation coverage and the examples in this reference, not a comparison with a live production environment. **NO** means no literal deployment-specific value is included in the reviewed Markdown for that setting; **YES (public)** is limited to the intentionally public URLs below. Every name also appears in the tracked [developer guide configuration index](TOOLS.md#deployment-configuration-index). This new reference must be included in the eventual release commit; it has not been staged by this documentation task.

| Variable | Documented? | Literal production value present? | Placeholder / public value used | Location |
| --- | --- | --- | --- | --- |
| `BRC_PUBLIC_BASE_URL` | YES | YES (public) | `https://red.bigredcloud.com` | [Core RED configuration](#core-red-configuration) |
| `BRC_CONNECT_PUBLIC_BASE_URL` | YES | NO | `<public-https-origin>` | [Core RED configuration](#core-red-configuration) |
| `BRC_DEPLOYMENT_ENV` | YES | NO | `<environment-label>` | [Core RED configuration](#core-red-configuration) |
| `BRC_DISPLAY_TIMEZONE` | YES | NO | `<IANA-timezone>` | [Core RED configuration](#core-red-configuration) |
| `BRC_MCP_SESSION_TTL_MINUTES` | YES | NO | `<minutes>` | [Core RED configuration](#core-red-configuration) |
| `BRC_RATE_LIMIT_REQUESTS_PER_MINUTE` | YES | NO | `<requests-per-minute>` | [Core RED configuration](#core-red-configuration) |
| `BRC_MAX_BATCH_ITEMS` | YES | NO | `<maximum-batch-size>` | [Core RED configuration](#core-red-configuration) |
| `BRC_MAX_AUDIT_ENTRIES` | YES | NO | `<maximum-item-count>` | [Core RED configuration](#core-red-configuration) |
| `BRC_ALLOW_READ_SKILLS` | YES | NO | `<true\|false>` | [Feature controls](#feature-controls) |
| `BRC_ALLOW_UPDATE_SKILLS` | YES | NO | `<true\|false>` | [Feature controls](#feature-controls) |
| `BRC_ALLOW_DELETE_SKILLS` | YES | NO | `<true\|false>` | [Feature controls](#feature-controls) |
| `BRC_ALLOW_EMAIL_SKILLS` | YES | NO | `<true\|false>` | [Feature controls](#feature-controls) |
| `BRC_ALLOW_BATCH_SKILLS` | YES | NO | `<true\|false>` | [Feature controls](#feature-controls) |
| `BRC_ALLOW_DEV_MODE` | YES | NO | `<true\|false>` | [Feature controls](#feature-controls) |
| `BRC_API_BASE_URL` | YES | YES (public) | `https://app.bigredcloud.com/api` | [Big Red Cloud API](#big-red-cloud-api) |
| `BRC_API_KEY_BLACKLIST_SHA256` | YES | NO | `<sha256-hash>[,<sha256-hash>...]` | [Big Red Cloud API](#big-red-cloud-api) |
| `BRC_API_KEY_TTL_MINUTES` | YES | NO | `<minutes>` | [Big Red Cloud API](#big-red-cloud-api) |
| `RED_CONNECT_CONNECTION_STORE` | YES | NO | `<memory\|cosmos>` | [Connection management](#connection-management) |
| `RED_CONNECT_HTTP_MODE` | YES | NO | `<true\|false>` | [Connection management](#connection-management) |
| `RED_CONNECT_CREDENTIAL_DEBUG` | YES | NO | `<true\|false>` | [Connection management](#connection-management) |
| `RED_CONNECT_ENCRYPTION_KEY` | YES | NO | `<encryption-key>` | [Connection management](#connection-management) |
| `RED_ALLOW_RECENT_CONNECTION_FALLBACK` | YES | NO | `<true\|false>` | [Connection management](#connection-management) |
| `RED_RECENT_CONNECTION_FALLBACK_TTL_MS` | YES | NO | `<milliseconds>` | [Connection management](#connection-management) |
| `RED_ENTRA_ALLOWED_CLIENTS` | YES | NO | `<entra-client-id>[,<entra-client-id>...]` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `RED_ENTRA_AUDIENCES` | YES | NO | `<entra-client-id>,<application-id-uri>` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `RED_ENTRA_PUBLIC_BASE_URL` | YES | YES (public) | `https://red.bigredcloud.com` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `RED_ENTRA_REQUIRED_SCOPE` | YES | NO | `<delegated-scope-name>` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `RED_ENTRA_WEB_CLIENT_ID` | YES | NO | `<entra-client-id>` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `RED_ENTRA_WEB_CLIENT_SECRET` | YES | NO | `<entra-client-secret>` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` | YES | NO | `<oauth-client-secret>` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `WEBSITE_AUTH_AAD_ALLOWED_TENANTS` | YES | NO | `<entra-tenant-id>[,<entra-tenant-id>...]` | [Microsoft 365 / Entra authentication](#microsoft-365--entra-authentication) |
| `RED_CONNECT_COSMOS_CONNECTION_STRING` | YES | NO | `<cosmos-connection-string>` | [Cosmos connection store](#cosmos-connection-store) |
| `RED_CONNECT_COSMOS_DATABASE` | YES | NO | `<cosmos-database-name>` | [Cosmos connection store](#cosmos-connection-store) |
| `RED_CONNECT_COSMOS_CONTAINER` | YES | NO | `<cosmos-container-name>` | [Cosmos connection store](#cosmos-connection-store) |
| `BRC_EDU_SOURCE` | YES | NO | `<local\|graph>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_CACHE_TTL_MINUTES` | YES | NO | `<minutes>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_ADMIN_UPLOAD_SECRET` | YES | NO | `<secret>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET` | YES | NO | `<random-signing-secret>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_STORAGE_CONNECTION` | YES | NO | `<storage-connection-string>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_SYNC_SECRET` | YES | NO | `<secret>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_SYNCED_RESOURCES_PATH` | YES | NO | `<operator-configured-file-path>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_UPLOAD_CONTAINER` | YES | NO | `<storage-container-name>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING` | YES | NO | `<storage-connection-string>` | [RED help / education resources](#red-help--education-resources) |
| `BRC_YOUTUBE_API_KEY` | YES | NO | `<api-key>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_CHANNEL_ID` | YES | NO | `<youtube-channel-id>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_UPLOADS_PLAYLIST_ID` | YES | NO | `<playlist-id>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_WEBINAR_PLAYLIST_ID` | YES | NO | `<playlist-id>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_CATALOG_BLOB` | YES | NO | `<blob-path>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_OVERRIDES_BLOB` | YES | NO | `<blob-path>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_EFFECTIVE_CATALOG_BLOB` | YES | NO | `<blob-path>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_SYNC_SCHEDULE` | YES | NO | `<cron-expression>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_WEBHOOK_CALLBACK_URL` | YES | NO | `<webhook-callback-url>` | [YouTube integration](#youtube-integration) |
| `BRC_YOUTUBE_WEBHOOK_SECRET` | YES | NO | `<secret>` | [YouTube integration](#youtube-integration) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | YES | NO | `<application-insights-connection-string>` | [Telemetry](#telemetry) |
| `BRC_ROUTE_TOKEN_SIGNING_SECRET` | YES | NO | `<random-signing-secret>` | [Security and signing](#security-and-signing) |
| `OPENAI_APPS_CHALLENGE_TOKEN` | YES | NO | `<challenge-token>` | [Security and signing](#security-and-signing) |
| `WEBSITE_NODE_DEFAULT_VERSION` | YES | NO | `<node-runtime-version>` | [Azure/runtime settings](#azureruntime-settings) |


## Hosting and webhook boundaries

The current HTTP host trusts forwarded proxy metadata for HTTPS detection and client addresses. Run it behind a trusted ingress that replaces untrusted forwarded headers and blocks direct backend access. Staff administration relies on Azure Easy Auth validating and replacing identity headers before forwarding; client-supplied Easy Auth headers must never reach these routes as trusted identity. Copilot ownership independently verifies signed bearer tokens. These hosting controls require deployment verification; source tests cannot prove ingress policy.

YouTube uses [WebSub](https://developers.google.com/youtube/v3/guides/push_notifications). For each enabled webhook entry point, privately configure `BRC_YOUTUBE_WEBHOOK_SECRET` and resubscribe with the same value as `hub.secret`. The server verifies the [standard `X-Hub-Signature`](https://www.w3.org/TR/websub/#authenticated-content-distribution) against exact request bytes. Unsigned/malformed/tampered POSTs are rejected before synchronization or privileged forwarding; no secret in the callback URL or proprietary header is needed. The timer remains a recovery path. Verify signed deliveries in an isolated slot before enabling the candidate. Synchronization updates help catalogues, not accounting records, but consumes quota and operator storage.

Azure consumes `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` and `WEBSITE_AUTH_AAD_ALLOWED_TENANTS` through [App Service authentication](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad). `WEBSITE_NODE_DEFAULT_VERSION` is a platform runtime setting, principally relevant to Windows hosting; the current Linux pipeline selects Node 24 through its runtime stack. Do not remove platform settings merely because the application has no direct reader.
