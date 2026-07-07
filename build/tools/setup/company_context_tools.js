import { z } from "zod";
import { buildConfirmConnectionCustomerMessage, buildConnectionPresentationInstructions, buildConnectionExpiryMetadata, buildListCompanyContextsCustomerMessage, buildListCompanyContextsExpiryFields, } from "../../auth/connection_presentation.js";
import { getApiKeyRefusalMessage } from "../../config/mcp_config.js";
import { companyNameSchema, setApiKeyForCompany, listConnectedCompanyNames, clearCredentialForCompany, clearAllCompanyCredentials, getCredentialForCompany, jsonResponse, textResponse, ensureCredentialsForCurrentSession, resolveActiveMcpSessionId, resolveHttpClientKey, getCurrentMcpSessionId, getCurrentConnectionId, } from "../../shared.js";
import { redServerConfig, assertApiKeyAllowed, getApiKeyExpirationMs, getPublicBaseUrl, } from "../../config/server_config.js";
import { claimConnectionCodeForSession, ClaimConnectionError, createPendingConnection, ensureConnectionStoreInitialized, getConnectionStore, enterMcpSessionContext, } from "../../auth/connection_store.js";
import { buildCompanyNotConnectedResponse } from "../../auth/company_connection_errors.js";
import { formatStartConnectionResponse, START_COMPANY_CONNECTION_TOOL_DESCRIPTION, CONFIRM_COMPANY_CONNECTION_TOOL_DESCRIPTION, LIST_COMPANY_CONTEXTS_TOOL_DESCRIPTION, } from "../../auth/connection_wording.js";
export function registerCompanyContextTools(server) {
    server.tool("brc_start_company_connection", START_COMPANY_CONNECTION_TOOL_DESCRIPTION, {}, async () => {
        await ensureConnectionStoreInitialized();
        const sessionId = resolveActiveMcpSessionId();
        if (!sessionId) {
            return textResponse([
                "Red could not determine the current MCP session.",
                "",
                "Please try again from your MCP client. If the problem continues, start a fresh company connection to generate a new secure Red connection link.",
            ].join("\n"));
        }
        const { code } = await createPendingConnection(sessionId);
        const url = `${getPublicBaseUrl()}/connect?code=${encodeURIComponent(code)}`;
        return textResponse(formatStartConnectionResponse(url));
    });
    server.tool("brc_confirm_company_connection", CONFIRM_COMPANY_CONNECTION_TOOL_DESCRIPTION, {
        code: z
            .string()
            .min(1)
            .describe("The connection code from the secure Red connection page success message."),
    }, async ({ code }) => {
        await ensureConnectionStoreInitialized();
        const sessionId = resolveActiveMcpSessionId();
        if (!sessionId) {
            return textResponse([
                "Red could not determine the current MCP session.",
                "",
                "Please try again from your MCP client. If the problem continues, start a fresh company connection to generate a new secure Red connection link.",
            ].join("\n"));
        }
        try {
            const result = await claimConnectionCodeForSession(code, sessionId, {
                clientKey: resolveHttpClientKey(),
            });
            await ensureCredentialsForCurrentSession();
            enterMcpSessionContext({ sessionId, connectionId: result.connectionId });
            const customerMessage = buildConfirmConnectionCustomerMessage({
                connectedCompanies: result.connectedCompanies,
                failedCompanies: result.failedCompanies,
                connectionExpiresAt: result.connectionRefExpiresAt,
            });
            const presentation = buildConnectionPresentationInstructions();
            const expiryMetadata = buildConnectionExpiryMetadata({
                earliestExpiresAtMs: result.connectionRefExpiresAt,
            });
            return jsonResponse({
                message: "Connection confirmed.",
                connectedCompanies: result.connectedCompanies,
                failedCompanies: result.failedCompanies,
                connectionRef: result.connectionRef,
                ...expiryMetadata,
                connectionRefReminder: presentation.connectionRefReminder,
                assistantInstruction: presentation.assistantInstruction,
                presentationHint: presentation.presentationHint,
                customerMessage,
            });
        }
        catch (error) {
            if (error instanceof ClaimConnectionError) {
                return textResponse(error.message);
            }
            throw error;
        }
    });
    server.tool("brc_get_company_api_key_status", "Use when the user asks for an API key, secret, or what key was used. Also use for connection duration or time-left questions when listing all companies. Returns connection status only — never the key. The assistant must not repeat keys from chat history.", {
        companyName: companyNameSchema.optional().describe("Optional company context name. If omitted, summarises all contexts."),
    }, async ({ companyName }) => {
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
                    message: getApiKeyRefusalMessage(),
                });
            }
            catch (error) {
                const connectedNames = listConnectedCompanyNames();
                if (connectedNames.length > 0) {
                    return jsonResponse({
                        ...buildCompanyNotConnectedResponse(companyName, {
                            otherCompaniesConnected: true,
                        }),
                    });
                }
                return jsonResponse({
                    companyName: companyName.trim(),
                    connected: false,
                    apiKeyRetrievable: false,
                    apiKeyMustNotBeRepeatedInChat: true,
                    message: `This company is not connected in this session. ${getApiKeyRefusalMessage()}`,
                });
            }
        }
        const companyExpiryInputs = listConnectedCompanyNames().map((name) => {
            const credential = getCredentialForCompany(name);
            return {
                companyName: name,
                connected: credential.expiresAt >= Date.now(),
                credentialType: credential.kind,
                expiresAt: new Date(credential.expiresAt).toISOString(),
                expiresAtMs: credential.expiresAt,
            };
        });
        const expiryMetadata = buildListCompanyContextsExpiryFields(companyExpiryInputs);
        return jsonResponse({
            count: companyExpiryInputs.length,
            companies: companyExpiryInputs.map(({ expiresAtMs: _expiresAtMs, ...company }) => company),
            apiKeyRetrievable: false,
            apiKeyMustNotBeRepeatedInChat: true,
            message: getApiKeyRefusalMessage(),
            ...(expiryMetadata ?? {}),
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
    server.tool("brc_list_company_contexts", LIST_COMPANY_CONTEXTS_TOOL_DESCRIPTION, {}, async () => {
        await ensureCredentialsForCurrentSession();
        const companyExpiryInputs = listConnectedCompanyNames().map((companyName) => {
            const credential = getCredentialForCompany(companyName);
            return {
                companyName,
                connected: credential.expiresAt >= Date.now(),
                credentialType: credential.kind,
                expiresAt: new Date(credential.expiresAt).toISOString(),
                expiresAtMs: credential.expiresAt,
            };
        });
        const companies = companyExpiryInputs.map(({ expiresAtMs: _expiresAtMs, ...company }) => company);
        const connectedNames = companyExpiryInputs
            .filter((company) => company.connected)
            .map((company) => company.companyName);
        const customerMessage = buildListCompanyContextsCustomerMessage(connectedNames);
        const presentation = buildConnectionPresentationInstructions();
        const expiryMetadata = buildListCompanyContextsExpiryFields(companyExpiryInputs);
        return jsonResponse({
            count: companies.length,
            customerMessage,
            companyNames: connectedNames,
            presentationHint: [
                "Show customerMessage and the company names.",
                presentation.presentationHint,
                "For connection duration, time-left, disconnect-time, or timezone questions, use connectionDurationText, timeRemainingText, expiryTimeWithTimezoneText, expiryTimezoneName, expiryTimezoneAbbreviation, expiryUtcOffset, and expiryMessage from this response. Do not say you lack a live clock when timeRemainingText is present.",
            ].join(" "),
            assistantInstruction: presentation.assistantInstruction,
            companies,
            ...(expiryMetadata ?? {}),
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
    server.tool("brc_clear_all_company_api_keys", "Clears all connection credentials for all company contexts from MCP server memory.", {}, async () => {
        const count = clearAllCompanyCredentials();
        return jsonResponse({
            message: "Cleared all connected company credentials from this MCP session.",
            clearedCompanyCount: count,
            connectedCompaniesStoredInMcpMemory: false,
        });
    });
    if (redServerConfig.allowDevMode) {
        server.tool("brc_get_connection_store_diagnostics", "Internal operator diagnostic for Red connection persistence. Returns store type, session/connection id presence, and connected company count. Never exposes connection credentials or secrets.", {}, async () => {
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
