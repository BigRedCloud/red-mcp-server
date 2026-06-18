import { z } from "zod";
import { API_KEY_REFUSAL_MESSAGE } from "../../config/mcp_config.js";
import { companyNameSchema, setApiKeyForCompany, listConnectedCompanyNames, clearCredentialForCompany, clearAllCompanyCredentials, getCredentialForCompany, jsonResponse, textResponse, reloadSessionCredentialsFromConnectionStore, getCurrentMcpSessionId, getCurrentConnectionId, } from "../../shared.js";
import { redServerConfig, assertApiKeyAllowed, getApiKeyExpirationMs, getPublicBaseUrl, } from "../../config/server_config.js";
import { claimConnectionCodeForSession, ClaimConnectionError, createPendingConnection, ensureConnectionStoreInitialized, getConnectionStore, runWithMcpSessionContext, } from "../../auth/connection_store.js";
export function registerCompanyContextTools(server) {
    server.tool("brc_start_company_connection", "Starts the secure Red company connection flow. Use whenever the user wants to connect one or more companies. Returns a one-time connection page URL. On that page the user can enter a single company or upload a CSV for multiple companies — never in chat. Do not ask the user to type credentials into chat.", {}, async () => {
        await ensureConnectionStoreInitialized();
        const sessionId = getCurrentMcpSessionId();
        if (!sessionId) {
            return textResponse([
                "Red could not determine the current MCP session.",
                "",
                "Please try again from your MCP client. If the problem continues, restart the connection flow.",
            ].join("\n"));
        }
        const { code } = await createPendingConnection(sessionId);
        const url = `${getPublicBaseUrl()}/connect?code=${encodeURIComponent(code)}`;
        return textResponse([
            "To connect your Big Red Cloud companies, open this secure Red connection page:",
            "",
            url,
            "",
            "On that page you can connect one company using the form, or connect several at once by uploading a CSV file. Credentials are not sent through chat.",
            "",
            "The link expires in 10 minutes.",
            "",
            "After connecting, return here and ask: “Show my connected companies”.",
        ].join("\n"));
    });
    server.tool("brc_confirm_company_connection", "Claims a completed secure Red connection code for the current MCP session. Use after the user has submitted the secure connection page and returns with the connection code shown on the success page (for example in ChatGPT when the MCP session changed after opening the browser). Never exposes API keys.", {
        code: z
            .string()
            .min(1)
            .describe("The connection code from the secure Red connection page success message."),
    }, async ({ code }) => {
        await ensureConnectionStoreInitialized();
        const sessionId = getCurrentMcpSessionId();
        if (!sessionId) {
            return textResponse([
                "Red could not determine the current MCP session.",
                "",
                "Please try again from your MCP client. If the problem continues, restart the connection flow.",
            ].join("\n"));
        }
        try {
            const result = await claimConnectionCodeForSession(code, sessionId);
            await reloadSessionCredentialsFromConnectionStore(sessionId, result.connectionId);
            const count = result.companyNames.length;
            const summary = count === 1
                ? "1 company is now connected in this session:"
                : `${count} companies are now connected in this session:`;
            return runWithMcpSessionContext({ sessionId, connectionId: result.connectionId }, () => textResponse([
                "Connection confirmed.",
                "",
                summary,
                ...result.companyNames.map((name) => `- ${name}`),
                "",
                "You can now ask for connected companies or work with your company records.",
            ].join("\n")));
        }
        catch (error) {
            if (error instanceof ClaimConnectionError) {
                return textResponse(error.message);
            }
            throw error;
        }
    });
    server.tool("brc_get_company_api_key_status", "Use when the user asks for an API key, secret, or what key was used. Returns connection status only — never the key. The assistant must not repeat keys from chat history.", {
        companyName: companyNameSchema.optional().describe("Optional company context name. If omitted, summarises all contexts."),
    }, async ({ companyName }) => {
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
            }
            catch {
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
    });
    /* FUTURE DEV: Remove this tool? once OAuth is implemented*/
    if (redServerConfig.allowDevMode) {
        server.tool("brc_set_company_api_key", "Internal/dev-only fallback for storing a BRC API key in MCP server memory. Customer-facing deployments should use the secure Red connection page instead.", {
            companyName: companyNameSchema,
            apiKey: z.string().min(1).describe("BRC API key for this company."),
        }, async ({ companyName, apiKey }) => {
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
                warning: "This is an internal/dev fallback. Customer-facing deployments should use the secure Red connection page so API keys are not typed into chat.",
            });
        });
    }
    server.tool("brc_list_company_contexts", "Lists company contexts currently available in this MCP server session. API keys are never returned.", {}, async () => {
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
        });
    });
    server.tool("brc_clear_company_api_key", "Clears the API key for a named company context from MCP server memory.", {
        companyName: companyNameSchema,
    }, async ({ companyName }) => {
        const existed = clearCredentialForCompany(companyName);
        return jsonResponse({
            message: existed
                ? "Company connection cleared from MCP server memory."
                : "No matching company connection was found in MCP server memory.",
            companyName,
            connectionClearedFromMcpMemory: existed,
            connected: false,
        });
    });
    server.tool("brc_clear_all_company_api_keys", "Clears all API keys for all company contexts from MCP server memory.", {}, async () => {
        const count = clearAllCompanyCredentials();
        return jsonResponse({
            message: "Cleared all connected company credentials from this MCP session.",
            clearedCompanyCount: count,
            connectedCompaniesStoredInMcpMemory: false,
        });
    });
    if (redServerConfig.allowDevMode) {
        server.tool("brc_get_connection_store_diagnostics", "Internal operator diagnostic for Red connection persistence. Returns store type, session/connection id presence, and connected company count. Never exposes API keys or secrets.", {}, async () => {
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
        });
    }
}
