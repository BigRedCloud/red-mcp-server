import { z } from "zod";
import { API_KEY_REFUSAL_MESSAGE } from "../mcp_config.js";
import { companyNameSchema, getCompanyApiContexts, normaliseCompanyName, jsonResponse, } from "../shared.js";
import { assertApiKeyAllowed, getApiKeyExpirationMs } from "../server_config.js";
export function registerCompanyContextTools(server) {
    server.tool("brc_get_company_api_key_status", "Use when the user asks for an API key, secret, or what key was used. Returns connection status only — never the key. The assistant must not repeat keys from chat history.", {
        companyName: companyNameSchema.optional().describe("Optional company context name. If omitted, summarises all contexts."),
    }, async ({ companyName }) => {
        const store = getCompanyApiContexts();
        if (companyName) {
            const key = normaliseCompanyName(companyName);
            const context = store.get(key);
            const connected = Boolean(context?.apiKey && context.expiresAt >= Date.now());
            return jsonResponse({
                companyName: companyName.trim(),
                apiKeyStoredInMcpMemory: connected,
                apiKeyRetrievable: false,
                apiKeyMustNotBeRepeatedInChat: true,
                message: connected
                    ? API_KEY_REFUSAL_MESSAGE
                    : `No API key is stored for "${companyName.trim()}" in this session. ${API_KEY_REFUSAL_MESSAGE}`,
            });
        }
        const companies = [...store.values()].map((context) => ({
            companyName: context.companyName,
            apiKeyStoredInMcpMemory: context.expiresAt >= Date.now(),
            expiresAt: new Date(context.expiresAt).toISOString(),
        }));
        return jsonResponse({
            count: companies.length,
            companies,
            apiKeyRetrievable: false,
            apiKeyMustNotBeRepeatedInChat: true,
            message: API_KEY_REFUSAL_MESSAGE,
        });
    });
    server.tool("brc_set_company_api_key", "Stores a BRC API key for a named company context in MCP server memory for this session. API keys are not returned in responses. The assistant must never echo or confirm the key value in chat after storing it.", {
        companyName: companyNameSchema,
        apiKey: z.string().min(1).describe("BRC API key for this company."),
    }, async ({ companyName, apiKey }) => {
        const cleanCompanyName = companyName.trim();
        const key = normaliseCompanyName(cleanCompanyName);
        const cleanApiKey = apiKey.trim();
        assertApiKeyAllowed(cleanApiKey);
        getCompanyApiContexts().set(key, {
            companyName: cleanCompanyName,
            apiKey: cleanApiKey,
            expiresAt: Date.now() + getApiKeyExpirationMs(),
        });
        return jsonResponse({
            message: "Company API key stored in MCP server memory for this session.",
            companyName: cleanCompanyName,
            apiKeyStoredInMcpMemory: true,
            apiKeyEnteredInChat: true,
            apiKeyReturned: false,
            apiKeyMustNotBeRepeatedInChat: true,
            expiresInMinutes: getApiKeyExpirationMs() / 60000,
            warning: "This API key is stored only in MCP server memory and is not returned by MCP responses. Assistants must never display or repeat the key in chat, including from earlier user messages.",
        });
    });
    server.tool("brc_list_company_contexts", "Lists company contexts currently available in this MCP server session. API keys are never returned.", {}, async () => {
        const companies = [...getCompanyApiContexts().values()].map((context) => ({
            companyName: context.companyName,
            apiKeyStoredInMcpMemory: true,
            expiresAt: new Date(context.expiresAt).toISOString(),
        }));
        return jsonResponse({
            count: companies.length,
            companies,
        });
    });
    server.tool("brc_clear_company_api_key", "Clears the API key for a named company context from MCP server memory.", {
        companyName: companyNameSchema,
    }, async ({ companyName }) => {
        const key = normaliseCompanyName(companyName);
        const existed = getCompanyApiContexts().delete(key);
        return jsonResponse({
            message: existed
                ? "Company API key cleared from MCP server memory."
                : "No matching company API key was found in MCP server memory.",
            companyName,
            apiKeyClearedFromMcpMemory: existed,
            apiKeyStoredInMcpMemory: false,
            importantNote: "This clears the API key from MCP server memory. If the key was typed into the AI chat, it may still exist in the host chat history.",
        });
    });
    server.tool("brc_clear_all_company_api_keys", "Clears all API keys for all company contexts from MCP server memory.", {}, async () => {
        const store = getCompanyApiContexts();
        const count = store.size;
        store.clear();
        return jsonResponse({
            message: "Cleared all connected company API keys from this MCP session.",
            clearedCompanyCount: count,
            apiKeysStoredInMcpMemory: false,
            importantNote: "This clears all API keys from MCP server memory. If keys were typed into the AI chat, they may still exist in the host chat history.",
        });
    });
}
