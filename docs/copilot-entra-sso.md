# Microsoft Copilot and Entra sign-in

This is an optional hosted path for Microsoft 365 Copilot, registered as a [federated connector](https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/set-up-custom-federated-connectors). ChatGPT, Claude, and Mistral keep using `/mcp` and the connection flow in the [README](../README.md).

`/mcp/copilot` serves a read-only accounting catalogue. Each customer call must present a Microsoft Entra v2 access token. Company API keys are entered on Red's connection page, checked against Big Red Cloud, stored encrypted, and bound to the signed-in Microsoft user. Tokens and API keys are not returned to Copilot and must not be pasted into chat.

The read-only limit is a current Microsoft federated connector limitation. Create, update and delete tools stay on `/mcp`. The supported facade does not advertise accounting write tools.

## Operator/self-hosting setup

These steps are for operators deploying the server, not customers connecting to Big Red Cloud’s hosted RED service. Use your own HTTPS origin. Values below are placeholders.

1. In Entra, register an API application and expose the delegated scope `<delegated-scope-name>`. Set `RED_ENTRA_REQUIRED_SCOPE` to match that scope. Set the access token version to v2. Allow organisational accounts only.
2. In the Teams Developer Portal, register that API for Microsoft Entra SSO and point the connector at `https://<your-host>/mcp/copilot`. Add the generated Application ID URI to the API app. Preauthorize Microsoft's documented token-store client for the delegated scope, and add the Web redirect `https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect`.
3. Register a confidential web app for the connection page. Set its redirect to `https://<your-host>/connect/sso/callback` and allow the authorization code flow only. Store the client secret in your secret store, not in source. The app should allow organisational sign-in. Red requests `openid profile` only.
4. If customers in other Microsoft tenants will connect, keep the apps multi-tenant. Red does not keep a tenant allowlist. Each customer's administrators must consent where that tenant requires it. Personal Microsoft accounts are rejected.

Microsoft's current guides:

- [Plugin authentication with Entra SSO](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-entra-sso)
- [Custom federated connectors](https://learn.microsoft.com/en-us/microsoft-365/copilot/connectors/set-up-custom-federated-connectors)

## Environment variables

These are operator/self-hosting settings. Customers using Big Red Cloud's hosted RED connector do not supply its Azure or Entra secrets. The canonical [environment-variable reference](environment-variables.md#microsoft-365--entra-authentication) describes all deployment settings, formats, aliases and required conditions. The list below is a quick setup summary; its descriptions do not prescribe production values.

| Variable | Purpose |
| --- | --- |
| `RED_ENTRA_AUDIENCES` | API client id and the Teams-generated Application ID URI, comma-separated |
| `RED_ENTRA_REQUIRED_SCOPE` | `<delegated-scope-name>`; must match the API scope configured by the operator |
| `RED_ENTRA_ALLOWED_CLIENTS` | Optional comma-separated client ids allowed to call the API |
| `RED_ENTRA_PUBLIC_BASE_URL` | Public HTTPS origin, with no path |
| `RED_ENTRA_WEB_CLIENT_ID` | Connection-page application client id |
| `RED_ENTRA_WEB_CLIENT_SECRET` | Connection-page application client secret |
| `RED_CONNECT_CONNECTION_STORE` | `cosmos` when more than one instance must share connections; `memory` is lost on restart |
| `RED_CONNECT_COSMOS_CONNECTION_STRING` | Cosmos connection string when the store is `cosmos` |
| `RED_CONNECT_COSMOS_DATABASE` | Cosmos database name |
| `RED_CONNECT_COSMOS_CONTAINER` | Cosmos container name |
| `RED_CONNECT_ENCRYPTION_KEY` | `<encryption-key>` for stored credentials, browser state and continuations; dedicated material is recommended (code also permits a Cosmos connection-string fallback) |

Do not put Big Red Cloud company API keys in these settings. If `RED_ENTRA_AUDIENCES` is missing, customer calls fail closed. Serve the site over HTTPS, and do not log request bodies, `Authorization` headers, cookies, or connection-form fields. `RED_ENTRA_TEST_PRIVATE_JWK` is for local tests only and must not be set on a deployment.

The connection-store variables are the same ones described in the [README](../README.md).

## How a user connects a company

1. In Copilot they ask an accounting question, or ask to manage companies.
2. Red returns a link on your host. The link does not contain their identity or an API key. Opening it is not enough; they sign in with Microsoft first.
3. They enter a company name and API key, or upload a CSV with columns `companyName,apiKey`. One submission can include up to five companies, and the CSV is limited to 1 MB. Keys are validated before they are stored and are not shown again.
4. From `/manage-companies` they can later add a company, replace a key, or disconnect one company. Disconnect asks for confirmation and does not run on a normal page load. After the last company is removed, the next accounting question asks them to connect again.

A company stays with the Microsoft user who connected it. Another user's token cannot use it.

## Local check

For local verification, run the full test suite with `npm test` in an isolated checkout with test configuration. It builds generated files and tests can create temporary fixtures. Before running it on platforms other than Windows, install the test browser with `npx playwright install --with-deps chromium`. Windows runs use installed Microsoft Edge. `npm run demo:copilot-sso` exercises the current search and CSRF-protected company form using local synthetic fixtures only.
