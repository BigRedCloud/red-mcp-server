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
export function buildCompaniesStayConnectedUserMessage(expiresAt, nowMs) {
    return buildConnectionExpiryMetadata({
        earliestExpiresAtMs: expiresAt,
        nowMs,
    }).expiryMessage;
}
export function buildConnectionDurationUserAnswer(expiresAt, nowMs) {
    return buildCompaniesStayConnectedUserMessage(expiresAt, nowMs);
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
export const CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION = "For questions about how long the connection lasts, how much time is left, when companies disconnect, or when the session expires, answer using connectionDurationText, timeRemainingText, and expiryTimeText from this response. Do not say you do not know the current time.";
export function connectionDurationHoursFromMinutes(minutes) {
    if (minutes % 60 === 0) {
        return minutes / 60;
    }
    return Math.round((minutes / 60) * 10) / 10;
}
export function formatExpiryTimeText(expiresAtMs) {
    return `${formatConnectionExpiryForUser(expiresAtMs)} local time`;
}
export function formatTimeRemainingText(remainingMs) {
    if (remainingMs <= 0) {
        return "expired";
    }
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) {
        return `about ${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
    }
    if (minutes === 0) {
        return `about ${hours} hour${hours === 1 ? "" : "s"} remaining`;
    }
    return `about ${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
}
export function selectEarliestCompanyExpiry(companies) {
    const connected = companies.filter((company) => company.connected);
    if (connected.length === 0) {
        return { multipleDifferentExpiries: false };
    }
    const sorted = [...connected].sort((a, b) => a.expiresAtMs - b.expiresAtMs);
    const earliest = sorted[0];
    if (!earliest) {
        return { multipleDifferentExpiries: false };
    }
    const distinctExpiryTimes = new Set(connected.map((company) => company.expiresAtMs));
    return {
        earliestExpiresAtMs: earliest.expiresAtMs,
        earliestCompanyName: earliest.companyName,
        multipleDifferentExpiries: distinctExpiryTimes.size > 1,
    };
}
export function buildConnectionExpiryMetadata(options) {
    const durationMinutes = options.durationMinutes ?? getCredentialTtlMinutes();
    const durationText = formatCredentialTtlForUser(durationMinutes);
    const durationHours = connectionDurationHoursFromMinutes(durationMinutes);
    const nowMs = options.nowMs ?? Date.now();
    const base = {
        connectionDurationMinutes: durationMinutes,
        connectionDurationHours: durationHours,
        connectionDurationText: durationText,
        expiryMessage: `Your connected companies stay connected for ${durationText} from confirmation, unless you start a new chat or reconnect.`,
    };
    if (!options.earliestExpiresAtMs || !Number.isFinite(options.earliestExpiresAtMs)) {
        return base;
    }
    const expiresAtMs = options.earliestExpiresAtMs;
    const expiryTimeText = formatExpiryTimeText(expiresAtMs);
    const remainingMs = expiresAtMs - nowMs;
    const timeRemainingMinutes = Math.max(0, Math.ceil(remainingMs / 60_000));
    const timeRemainingHours = Math.round((timeRemainingMinutes / 60) * 10) / 10;
    const timeRemainingText = formatTimeRemainingText(remainingMs);
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    let expiryMessage = `Your connected companies stay connected for ${durationText} from confirmation, until ${expiryTimeText}, unless you start a new chat or reconnect.`;
    if (timeRemainingText !== "expired") {
        expiryMessage += ` There ${timeRemainingText.startsWith("about 1 minute") ? "is" : "are"} ${timeRemainingText}.`;
    }
    const metadata = {
        ...base,
        expiresAt: expiresAtIso,
        earliestExpiresAt: expiresAtIso,
        expiryTimeText,
        timeRemainingMinutes,
        timeRemainingHours,
        timeRemainingText,
        expiryMessage,
    };
    if (options.multipleDifferentExpiries && options.earliestCompanyName) {
        metadata.earliestExpiryApplies = true;
        metadata.earliestExpiryNote = `The disconnect time below is based on the earliest company expiry (${options.earliestCompanyName}).`;
    }
    return metadata;
}
export function buildConnectionExpiryAssistantInstruction() {
    return CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION;
}
export function buildConnectionPresentationInstructions() {
    const presentation = buildConnectionRefPresentationFields();
    return {
        assistantInstruction: [
            presentation.assistantInstruction,
            CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION,
        ].join(" "),
        presentationHint: [
            presentation.presentationHint,
            CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION,
        ].join(" "),
        connectionRefReminder: presentation.connectionRefReminder,
    };
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
    const expiryMetadata = count > 0
        ? buildConnectionExpiryMetadata({
            earliestExpiresAtMs: args.connectionExpiresAt,
            nowMs: args.nowMs,
        })
        : undefined;
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
        expiryMetadata?.expiryMessage ??
            buildCompaniesStayConnectedUserMessage(undefined, args.nowMs),
        "",
        "You can now ask for connected companies or work with your company records.",
    ].join("\n");
}
export function buildListCompanyContextsExpiryFields(companies, nowMs) {
    const connected = companies.filter((company) => company.connected);
    if (connected.length === 0) {
        return undefined;
    }
    const selection = selectEarliestCompanyExpiry(companies);
    if (!selection.earliestExpiresAtMs) {
        return undefined;
    }
    return buildConnectionExpiryMetadata({
        earliestExpiresAtMs: selection.earliestExpiresAtMs,
        nowMs,
        multipleDifferentExpiries: selection.multipleDifferentExpiries,
        earliestCompanyName: selection.earliestCompanyName,
    });
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
        `- When users ask how long companies stay connected, how much time is left, when companies disconnect, or when the session expires, answer using connectionDurationText, timeRemainingText, expiryTimeText, and expiryMessage from brc_list_company_contexts or brc_confirm_company_connection — do not say you do not know the current time.`,
    ].join("\n");
}
