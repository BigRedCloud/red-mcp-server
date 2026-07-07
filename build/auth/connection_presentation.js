import { redServerConfig } from "../config/server_config.js";
export const CONNECTION_REF_ASSISTANT_INSTRUCTION = "Use connectionRef/activeConnectionRef silently in tool calls. Do not show connectionRef, redconn_ values, session IDs, or diagnostic metadata to normal users. Only show them in dev mode or when explicitly asked for technical/debug details.";
export const CONNECTION_REF_SILENT_USE_INSTRUCTION = "Use activeConnectionRef silently as connectionRef on later Red tool calls. Do not mention it to normal users.";
export const CONNECTION_REF_PRESENTATION_HINT = "Keep connectionRef and activeConnectionRef in structured tool data for MCP clients. Do not display them in natural-language answers to normal users unless dev mode is enabled or the user explicitly asks for technical/debug details.";
export function isDevModeEnabled() {
    return redServerConfig.allowDevMode;
}
export function shouldShowDeveloperConnectionDetails(explicitlyRequested = false) {
    return isDevModeEnabled() || explicitlyRequested;
}
export function getCredentialTtlMinutes() {
    return redServerConfig.apiKeyTtlMinutes;
}
export function formatCredentialTtlForUser(minutes = getCredentialTtlMinutes()) {
    if (minutes < 60) {
        return `about ${minutes} minutes`;
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
    }
    const hours = Math.round((minutes / 60) * 10) / 10;
    return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
}
export function formatConnectionExpiryForUser(expiresAt) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date(expiresAt));
    }
    catch {
        return new Date(expiresAt).toISOString();
    }
}
export function formatCredentialExpiryPhrase(expiresAt) {
    if (expiresAt && Number.isFinite(expiresAt)) {
        return `until ${formatConnectionExpiryForUser(expiresAt)}`;
    }
    return `for ${formatCredentialTtlForUser()}`;
}
export function buildCompaniesStayConnectedUserMessage(expiresAt) {
    if (expiresAt && Number.isFinite(expiresAt)) {
        return `Your companies stay connected ${formatCredentialExpiryPhrase(expiresAt)}, unless you start a new chat or reconnect.`;
    }
    return `Your companies stay connected for ${formatCredentialTtlForUser()} from confirmation, unless you start a new chat or reconnect.`;
}
export function buildConnectionDurationUserAnswer(expiresAt) {
    return buildCompaniesStayConnectedUserMessage(expiresAt);
}
export function buildApiKeyRefusalMessage() {
    return [
        "BRC company API keys cannot be shown, retrieved, repeated, validated, or reconstructed.",
        `They are stored only in this MCP session memory for ${formatCredentialTtlForUser()} and are never returned by tools.`,
        "If you need to connect again, start a fresh company connection to generate a new secure Red connection link — do not reuse an old connection link.",
        "Do not paste API keys into chat.",
    ].join(" ");
}
export function buildSessionCredentialDurationPhrase() {
    return formatCredentialTtlForUser();
}
export function buildConnectionRefPresentationFields() {
    return {
        assistantInstruction: CONNECTION_REF_ASSISTANT_INSTRUCTION,
        presentationHint: CONNECTION_REF_PRESENTATION_HINT,
        connectionRefReminder: CONNECTION_REF_SILENT_USE_INSTRUCTION,
    };
}
export function buildConfirmConnectionCustomerMessage(args) {
    const count = args.connectedCompanies.length;
    const summary = count === 1
        ? "1 company is now connected in this session:"
        : `${count} companies are now connected in this session:`;
    return [
        "Connection confirmed.",
        "",
        summary,
        ...args.connectedCompanies.map((name) => `- ${name}`),
        ...(args.failedCompanies.length > 0
            ? [
                "",
                "These companies were not connected:",
                ...args.failedCompanies.map((failure) => `- ${failure.companyName}: ${failure.message}`),
            ]
            : []),
        "",
        buildCompaniesStayConnectedUserMessage(args.connectionExpiresAt),
        "",
        "You can now ask for connected companies or work with your company records.",
    ].join("\n");
}
export function buildListCompanyContextsCustomerMessage(connectedNames) {
    if (connectedNames.length === 0) {
        return "No companies are connected in this session yet. Start a fresh company connection to connect your companies, then tell me which company you would like to work with.";
    }
    return [
        "You have the following companies connected in this session:",
        ...connectedNames.map((name) => `- ${name}`),
        "",
        "Tell me which company you would like to work with.",
    ].join("\n");
}
export function buildConnectionRefUserPresentationRules() {
    return [
        "Red connectionRef user presentation rules (mandatory):",
        "- connectionRef, activeConnectionRef, Red connection reference, redconn_ values, MCP session IDs, internal session IDs, and connection diagnostic metadata are for MCP tool arguments only.",
        "- Pass connectionRef silently on later tool calls. Never mention connectionRef, redconn_..., activeConnectionRef, or internal session identifiers in natural-language answers to normal users.",
        "- Only show technical connection details when dev mode is enabled or the user explicitly asks for technical/debug details.",
        `- When users ask how long companies stay connected, answer using the configured session duration (${formatCredentialTtlForUser()}) or the connected companies' expiresAt values — do not hardcode a different duration.`,
    ].join("\n");
}
