import { z } from "zod";
import type { ServerType } from "../../server.js";
import { API_KEY_REFUSAL_MESSAGE } from "../../config/mcp_config.js";
import {
  companyNameSchema,
  setApiKeyForCompany,
  listConnectedCompanyNames,
  clearCredentialForCompany,
  clearAllCompanyCredentials,
  getCredentialForCompany,
  jsonResponse,
  getCompanyApiContexts, 
  textResponse,
  ensureCredentialsForCurrentSession,
  resolveActiveMcpSessionId,
  resolveHttpClientKey,
  getCurrentMcpSessionId,
  getCurrentConnectionId,
} from "../../shared.js";
import {
  redServerConfig,
  assertApiKeyAllowed,
  getApiKeyExpirationMs,
  getPublicBaseUrl,
} from "../../config/server_config.js";
import {
  claimConnectionCodeForSession,
  ClaimConnectionError,
  createPendingConnection,
  ensureConnectionStoreInitialized,
  getConnectionStore,
  enterMcpSessionContext,
} from "../../auth/connection_store.js";

export function registerCompanyContextTools(server: ServerType) {
  server.tool(
    "brc_start_company_connection",
    "Starts the secure Red company connection flow. Use whenever the user wants to connect one or more companies. Returns a one-time connection page URL (no time expiry, but each link works only once). On that page the user can enter a single company or upload a CSV for multiple companies — never in chat. After completing the secure page, the user should return to this chat and provide (copy/paste) the confirmation code shown on the success page. To connect more companies later, start a new connection. Do not ask the user to type credentials into chat.",
    {},
    async () => {
      await ensureConnectionStoreInitialized();

      const sessionId = resolveActiveMcpSessionId();
      if (!sessionId) {
        return textResponse(
          [
            "Red could not determine the current MCP session.",
            "",
            "Please try again from your MCP client. If the problem continues, restart the connection flow.",
          ].join("\n")
        );
      }

      const { code } = await createPendingConnection(sessionId);
      const url = `${getPublicBaseUrl()}/connect?code=${encodeURIComponent(code)}`;

      return textResponse(
        [
          "To connect your Big Red Cloud companies, open this secure Red connection page:",
          "",
          url,
          "",
          "On that page you can connect one company using the form, or connect several at once by uploading a CSV file. Credentials are not sent through chat.",
          "",
          "This link is for one-time use only. After you use it, ask for a new secure connection link if you want to connect more companies.",
          "",
          "After connecting your companies, return to this chat and copy/paste the confirmation code shown on the success page. Your connection will not be active until you do.",
        ].join("\n")
      );
    }
  );

  server.tool(
    "brc_confirm_company_connection",
    "Claims a completed secure Red connection code for the current MCP session. Use after the user has submitted the secure connection page and returns to this chat with the confirmation code shown on the success page (for example when the MCP session changed after opening the browser). Never exposes connection credentials.",
    {
      code: z
        .string()
        .min(1)
        .describe(
          "The connection code from the secure Red connection page success message."
        ),
    },
    async ({ code }) => {
      await ensureConnectionStoreInitialized();

      const sessionId = resolveActiveMcpSessionId();
      if (!sessionId) {
        return textResponse(
          [
            "Red could not determine the current MCP session.",
            "",
            "Please try again from your MCP client. If the problem continues, restart the connection flow.",
          ].join("\n")
        );
      }

      try {
        const result = await claimConnectionCodeForSession(code, sessionId, {
          clientKey: resolveHttpClientKey(),
        });
        await ensureCredentialsForCurrentSession();

        const count = result.companyNames.length;
        const summary =
          count === 1
            ? "1 company is now connected in this session:"
            : `${count} companies are now connected in this session:`;

        enterMcpSessionContext({ sessionId, connectionId: result.connectionId });

        return textResponse(
          [
            "Connection confirmed.",
            "",
            summary,
            ...result.companyNames.map((name) => `- ${name}`),
            "",
            "You can now ask for connected companies or work with your company records.",
          ].join("\n")
        );
      } catch (error) {
        if (error instanceof ClaimConnectionError) {
          return textResponse(error.message);
        }

        throw error;
      }
    }
  );

  server.tool(
    "brc_get_company_api_key_status",
    "Use when the user asks for an API key, secret, or what key was used. Returns connection status only — never the key. The assistant must not repeat keys from chat history.",
    {
      companyName: companyNameSchema.optional().describe(
        "Optional company context name. If omitted, summarises all contexts."
      ),
    },

    async ({ companyName }) => {
      await ensureCredentialsForCurrentSession(companyName);

      if (companyName) {
        try {
          const credential = getCredentialForCompany(companyName);
    
          return jsonResponse({
            companyName: companyName.trim(),
            connected: true,
            credentialType: credential.kind,
            apiKeyRetrievable: false,
            apiKeyMustNotBeRepeatedInChat: true,
            expiresAt: new Date(credential.expiresAt).toISOString(),
            message: API_KEY_REFUSAL_MESSAGE,
          });
        } catch {
          return jsonResponse({
            companyName: companyName.trim(),
            connected: false,
            apiKeyRetrievable: false,
            apiKeyMustNotBeRepeatedInChat: true,
            message: `This company is not connected in this session. ${API_KEY_REFUSAL_MESSAGE}`,
          });
        }
      }
    
      const companies = listConnectedCompanyNames().map((companyName) => {
        const credential = getCredentialForCompany(companyName);
    
        return {
          companyName,
          connected: credential.expiresAt >= Date.now(),
          credentialType: credential.kind,
          expiresAt: new Date(credential.expiresAt).toISOString(),
        };
      });
    
      return jsonResponse({
        count: companies.length,
        companies,
        apiKeyRetrievable: false,
        apiKeyMustNotBeRepeatedInChat: true,
        message: API_KEY_REFUSAL_MESSAGE,
      });
    }

  );

  /* FUTURE DEV: Remove this tool? once OAuth is implemented*/
  if(redServerConfig.allowDevMode) {
  server.tool(
    "brc_set_company_api_key",
    "Internal/dev-only fallback for storing a BRC API key in MCP server memory. Customer-facing deployments should use the secure Red connection page instead.",
      {
      companyName: companyNameSchema,
      apiKey: z.string().min(1).describe("BRC API key for this company."),
    },
    async ({ companyName, apiKey }) => {
      const cleanCompanyName = companyName.trim();
      const cleanApiKey = apiKey.trim();

      assertApiKeyAllowed(cleanApiKey);

      setApiKeyForCompany({
        companyName: cleanCompanyName,
        apiKey: cleanApiKey,
        expiresAt: Date.now() + getApiKeyExpirationMs(),
      });

      return jsonResponse({
        message: "Company API key stored in MCP server memory for this session.",
        companyName: cleanCompanyName,
        credentialStoredInMcpMemory: true,
        credentialType: "apiKey",
        apiKeyEnteredInChat: true,
        apiKeyReturned: false,
        apiKeyMustNotBeRepeatedInChat: true,
        expiresInMinutes: getApiKeyExpirationMs() / 60000,
        warning:
        "This is an internal/dev fallback. Customer-facing deployments should use the secure Red connection page so API keys are not typed into chat.",      });
    }
  );
}

  server.tool(
    "brc_list_company_contexts",
    "Lists company contexts currently connected in this MCP server session. Present the result to the user with the customerMessage text and the plain company names. Do not show technical fields such as credentialType or expiresAt to normal users unless they specifically ask. Connection credentials are never returned.",
    {},
    async () => {
      await ensureCredentialsForCurrentSession();

      const companies = listConnectedCompanyNames().map((companyName) => {
        const credential = getCredentialForCompany(companyName);

        return {
          companyName,
          connected: credential.expiresAt >= Date.now(),
          credentialType: credential.kind,
          expiresAt: new Date(credential.expiresAt).toISOString(),
        };
      });

      const connectedNames = companies
        .filter((company) => company.connected)
        .map((company) => company.companyName);

      const customerMessage =
        connectedNames.length === 0
          ? "No companies are connected in this session yet. Use the secure Red connection page to connect a company, then tell me which company you would like to work with."
          : [
              "You have the following companies connected in this session:",
              ...connectedNames.map((name) => `- ${name}`),
              "",
              "Tell me which company you would like to work with.",
            ].join("\n");

      return jsonResponse({
        count: companies.length,
        customerMessage,
        companyNames: connectedNames,
        presentationHint:
          "Show customerMessage and the company names. Only mention credentialType or expiresAt if the user asks for technical connection details.",
        companies,
      });
    }
  );

  server.tool(
    "brc_clear_company_api_key",
    "Clears the API key for a named company context from MCP server memory.",
    {
      companyName: companyNameSchema,
    },
    async ({ companyName }) => {
      const existed = clearCredentialForCompany(companyName);
      return jsonResponse({
        message: existed
          ? "Company connection cleared from MCP server memory."
          : "No matching company connection was found in MCP server memory.",
        companyName,
        connectionClearedFromMcpMemory: existed,
        connected: false,
      });
    }
  );

  server.tool(
    "brc_clear_all_company_api_keys",
    "Clears all connection credentials for all company contexts from MCP server memory.",
    {},
    async () => {
      const count = clearAllCompanyCredentials();
      return jsonResponse({
        message: "Cleared all connected company credentials from this MCP session.",
        clearedCompanyCount: count,
        connectedCompaniesStoredInMcpMemory: false,
      });
    }
  );

  if (redServerConfig.allowDevMode) {
    server.tool(
      "brc_get_connection_store_diagnostics",
      "Internal operator diagnostic for Red connection persistence. Returns store type, session/connection id presence, and connected company count. Never exposes connection credentials or secrets.",
      {},
      async () => {
        await ensureConnectionStoreInitialized();

        const diagnostics = await getConnectionStore().getDiagnostics({
          sessionId: getCurrentMcpSessionId(),
          connectionId: getCurrentConnectionId(),
        });

        return jsonResponse({
          message: "Red connection store diagnostics.",
          ...diagnostics,
          secretsReturned: false,
        });
      }
    );
  }
}
