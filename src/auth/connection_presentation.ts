import { redServerConfig } from "../config/server_config.js";
import type { FailedCompanyConnection } from "./connection_store_types.js";

export const CONNECTION_REF_ASSISTANT_INSTRUCTION =
  "Use connectionRef/activeConnectionRef silently in tool calls. Do not show connectionRef, redconn_ values, session IDs, or diagnostic metadata to normal users. Only show them in dev mode or when explicitly asked for technical/debug details.";

export const CONNECTION_REF_SILENT_USE_INSTRUCTION =
  "Use activeConnectionRef silently as connectionRef on later Red tool calls. Do not mention it to normal users.";

export const CONNECTION_REF_PRESENTATION_HINT =
  "Keep connectionRef and activeConnectionRef in structured tool data for MCP clients. Do not display them in natural-language answers to normal users unless dev mode is enabled or the user explicitly asks for technical/debug details.";

export function isDevModeEnabled(): boolean {
  return redServerConfig.allowDevMode;
}

export function shouldShowDeveloperConnectionDetails(
  explicitlyRequested = false
): boolean {
  return isDevModeEnabled() || explicitlyRequested;
}

export function getCredentialTtlMinutes(): number {
  return redServerConfig.apiKeyTtlMinutes;
}

export function formatCredentialTtlForUser(
  minutes: number = getCredentialTtlMinutes()
): string {
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

export function getDisplayTimezone(): string {
  return redServerConfig.displayTimezone;
}

export function formatConnectionExpiryForUser(
  expiresAt: number,
  timeZone: string = getDisplayTimezone()
): string {
  try {
    return new Intl.DateTimeFormat("en-IE", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(expiresAt));
  } catch {
    return new Date(expiresAt).toISOString();
  }
}

export function formatCredentialExpiryPhrase(expiresAt?: number): string {
  if (expiresAt && Number.isFinite(expiresAt)) {
    return `until ${formatConnectionExpiryForUser(expiresAt)}`;
  }

  return `for ${formatCredentialTtlForUser()}`;
}

export function buildCompaniesStayConnectedUserMessage(
  expiresAt?: number,
  nowMs?: number
): string {
  return buildConnectionExpiryMetadata({
    earliestExpiresAtMs: expiresAt,
    nowMs,
  }).expiryMessage;
}

export function buildConnectionDurationUserAnswer(
  expiresAt?: number,
  nowMs?: number
): string {
  return buildCompaniesStayConnectedUserMessage(expiresAt, nowMs);
}

export function buildApiKeyRefusalMessage(): string {
  return [
    "BRC company API keys cannot be shown, retrieved, repeated, validated, or reconstructed.",
    `They are stored only in this MCP session memory for ${formatCredentialTtlForUser()} and are never returned by tools.`,
    "If you need to connect again, start a fresh company connection to generate a new secure Red connection link — do not reuse an old connection link.",
    "Do not paste API keys into chat.",
  ].join(" ");
}

export function buildSessionCredentialDurationPhrase(): string {
  return formatCredentialTtlForUser();
}

export const CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION =
  "For questions about how long the connection lasts, how much time is left, when companies disconnect, when the session expires, or what timezone the expiry is in, answer using connectionDurationText, timeRemainingText, expiryTimeWithTimezoneText, expiryTimezoneName, expiryTimezoneAbbreviation, and expiryUtcOffset from this response. Do not say you do not know the current time or that you do not have a live clock when timeRemainingText is present. Do not ask the user to check their device clock. Do not say local time on its own — include the timezone abbreviation and UTC offset.";

export type ConnectionExpiryMetadata = {
  connectionDurationMinutes: number;
  connectionDurationHours: number;
  connectionDurationText: string;
  expiresAt?: string;
  earliestExpiresAt?: string;
  expiryTimeText?: string;
  expiryTimezoneName?: string;
  expiryTimezoneAbbreviation?: string;
  expiryUtcOffset?: string;
  expiryTimeWithTimezoneText?: string;
  timeRemainingMinutes?: number;
  timeRemainingHours?: number;
  timeRemainingText?: string;
  expiryMessage: string;
  earliestExpiryApplies?: boolean;
  earliestExpiryNote?: string;
};

export type ExpiryTimezonePresentation = {
  expiryTimezoneName: string;
  expiryTimezoneAbbreviation: string;
  expiryUtcOffset: string;
  expiryTimeWithTimezoneText: string;
  expiryTimeText: string;
};

export type CompanyExpiryInput = {
  companyName: string;
  expiresAtMs: number;
  connected: boolean;
};

export function connectionDurationHoursFromMinutes(minutes: number): number {
  if (minutes % 60 === 0) {
    return minutes / 60;
  }

  return Math.round((minutes / 60) * 10) / 10;
}

function formatPartValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): string | undefined {
  return parts.find((part) => part.type === type)?.value;
}

export function formatUtcOffsetForTimezone(
  timeZone: string,
  date: Date
): string {
  try {
    const offsetPart = formatPartValue(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
      }).formatToParts(date),
      "timeZoneName"
    );

    if (!offsetPart) {
      return "UTC";
    }

    if (offsetPart === "GMT" || offsetPart === "UTC") {
      return "UTC+0";
    }

    const match = offsetPart.match(/^(?:GMT|UTC)([+-])(\d{2}):(\d{2})$/);
    if (!match) {
      return offsetPart.replace(/^GMT/, "UTC");
    }

    const sign = match[1];
    const hours = Number(match[2]);
    const minutes = Number(match[3]);

    if (minutes === 0) {
      return `UTC${sign}${hours}`;
    }

    return `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
  } catch {
    return "UTC";
  }
}

export function formatExpiryTimezonePresentation(
  expiresAtMs: number,
  timeZone: string = getDisplayTimezone()
): ExpiryTimezonePresentation {
  const date = new Date(expiresAtMs);

  const timeParts = new Intl.DateTimeFormat("en-IE", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);

  const hour = formatPartValue(timeParts, "hour") ?? "?";
  const minute = formatPartValue(timeParts, "minute") ?? "??";
  const dayPeriod = (
    formatPartValue(timeParts, "dayPeriod") ?? ""
  ).toUpperCase();
  const expiryTimezoneAbbreviation =
    formatPartValue(timeParts, "timeZoneName") ?? timeZone;
  const expiryUtcOffset = formatUtcOffsetForTimezone(timeZone, date);
  const expiryTimeWithTimezoneText = `${hour}:${minute} ${dayPeriod} ${expiryTimezoneAbbreviation} (${expiryUtcOffset})`;

  const dateText = new Intl.DateTimeFormat("en-IE", {
    timeZone,
    dateStyle: "medium",
  }).format(date);

  return {
    expiryTimezoneName: timeZone,
    expiryTimezoneAbbreviation,
    expiryUtcOffset,
    expiryTimeWithTimezoneText,
    expiryTimeText: `${dateText}, ${expiryTimeWithTimezoneText}`,
  };
}

export function formatExpiryTimeText(
  expiresAtMs: number,
  timeZone?: string
): string {
  return formatExpiryTimezonePresentation(expiresAtMs, timeZone).expiryTimeText;
}

export function formatTimeRemainingText(remainingMs: number): string {
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

export function selectEarliestCompanyExpiry(companies: CompanyExpiryInput[]): {
  earliestExpiresAtMs?: number;
  earliestCompanyName?: string;
  multipleDifferentExpiries: boolean;
} {
  const connected = companies.filter((company) => company.connected);
  if (connected.length === 0) {
    return { multipleDifferentExpiries: false };
  }

  const sorted = [...connected].sort((a, b) => a.expiresAtMs - b.expiresAtMs);
  const earliest = sorted[0];
  if (!earliest) {
    return { multipleDifferentExpiries: false };
  }

  const distinctExpiryTimes = new Set(
    connected.map((company) => company.expiresAtMs)
  );

  return {
    earliestExpiresAtMs: earliest.expiresAtMs,
    earliestCompanyName: earliest.companyName,
    multipleDifferentExpiries: distinctExpiryTimes.size > 1,
  };
}

export function buildConnectionExpiryMetadata(options: {
  earliestExpiresAtMs?: number;
  nowMs?: number;
  multipleDifferentExpiries?: boolean;
  earliestCompanyName?: string;
  /** Test override; production uses BRC_API_KEY_TTL_MINUTES. */
  durationMinutes?: number;
  /** Test override; production uses BRC_DISPLAY_TIMEZONE. */
  timeZone?: string;
}): ConnectionExpiryMetadata {
  const durationMinutes = options.durationMinutes ?? getCredentialTtlMinutes();
  const durationText = formatCredentialTtlForUser(durationMinutes);
  const durationHours = connectionDurationHoursFromMinutes(durationMinutes);
  const nowMs = options.nowMs ?? Date.now();

  const base: ConnectionExpiryMetadata = {
    connectionDurationMinutes: durationMinutes,
    connectionDurationHours: durationHours,
    connectionDurationText: durationText,
    expiryMessage: `Your connected companies stay connected for ${durationText} from confirmation, unless you start a new chat or reconnect.`,
  };

  if (!options.earliestExpiresAtMs || !Number.isFinite(options.earliestExpiresAtMs)) {
    return base;
  }

  const expiresAtMs = options.earliestExpiresAtMs;
  const timezonePresentation = formatExpiryTimezonePresentation(
    expiresAtMs,
    options.timeZone
  );
  const remainingMs = expiresAtMs - nowMs;
  const timeRemainingMinutes = Math.max(0, Math.ceil(remainingMs / 60_000));
  const timeRemainingHours =
    Math.round((timeRemainingMinutes / 60) * 10) / 10;
  const timeRemainingText = formatTimeRemainingText(remainingMs);
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  let expiryMessage = `Your connected companies stay connected for ${durationText} from confirmation, until ${timezonePresentation.expiryTimeWithTimezoneText}, unless you start a new chat or reconnect.`;
  if (timeRemainingText !== "expired") {
    expiryMessage += ` There ${timeRemainingText.startsWith("about 1 minute") ? "is" : "are"} ${timeRemainingText}.`;
  }

  const metadata: ConnectionExpiryMetadata = {
    ...base,
    expiresAt: expiresAtIso,
    earliestExpiresAt: expiresAtIso,
    expiryTimeText: timezonePresentation.expiryTimeText,
    expiryTimezoneName: timezonePresentation.expiryTimezoneName,
    expiryTimezoneAbbreviation: timezonePresentation.expiryTimezoneAbbreviation,
    expiryUtcOffset: timezonePresentation.expiryUtcOffset,
    expiryTimeWithTimezoneText: timezonePresentation.expiryTimeWithTimezoneText,
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

export function buildConnectionExpiryAssistantInstruction(): string {
  return CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION;
}

export function buildConnectionPresentationInstructions(): {
  assistantInstruction: string;
  presentationHint: string;
  connectionRefReminder: string;
} {
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

export function buildConnectionRefPresentationFields(): {
  assistantInstruction: string;
  presentationHint: string;
  connectionRefReminder: string;
} {
  return {
    assistantInstruction: CONNECTION_REF_ASSISTANT_INSTRUCTION,
    presentationHint: CONNECTION_REF_PRESENTATION_HINT,
    connectionRefReminder: CONNECTION_REF_SILENT_USE_INSTRUCTION,
  };
}

export function buildConfirmConnectionCustomerMessage(args: {
  connectedCompanies: string[];
  failedCompanies: FailedCompanyConnection[];
  connectionExpiresAt?: number;
  nowMs?: number;
}): string {
  const count = args.connectedCompanies.length;
  const summary =
    count === 1
      ? "1 company is now connected in this session:"
      : `${count} companies are now connected in this session:`;

  const expiryMetadata =
    count > 0
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
          ...args.failedCompanies.map(
            (failure) => `- ${failure.companyName}: ${failure.message}`
          ),
        ]
      : []),
    "",
    expiryMetadata?.expiryMessage ??
      buildCompaniesStayConnectedUserMessage(undefined, args.nowMs),
    "",
    "You can now ask for connected companies or work with your company records.",
  ].join("\n");
}

export function buildListCompanyContextsExpiryFields(
  companies: CompanyExpiryInput[],
  nowMs?: number
): ConnectionExpiryMetadata | undefined {
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

export function buildListCompanyContextsCustomerMessage(
  connectedNames: string[]
): string {
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

export function buildConnectionRefUserPresentationRules(): string {
  return [
    "Red connectionRef user presentation rules (mandatory):",
    "- connectionRef, activeConnectionRef, Red connection reference, redconn_ values, MCP session IDs, internal session IDs, and connection diagnostic metadata are for MCP tool arguments only.",
    "- Pass connectionRef silently on later tool calls. Never mention connectionRef, redconn_..., activeConnectionRef, or internal session identifiers in natural-language answers to normal users.",
    "- Only show technical connection details when dev mode is enabled or the user explicitly asks for technical/debug details.",
    `- When users ask how long companies stay connected, how much time is left, when companies disconnect, when the session expires, or what timezone the expiry is in, answer using connectionDurationText, timeRemainingText, expiryTimeWithTimezoneText, expiryTimezoneName, expiryTimezoneAbbreviation, expiryUtcOffset, and expiryMessage from brc_list_company_contexts or brc_confirm_company_connection — do not say you do not know the current time or that you lack a live clock when timeRemainingText is present.`,
  ].join("\n");
}
