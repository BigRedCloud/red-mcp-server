import { createHash, timingSafeEqual } from "node:crypto";

/** Customer-safe suffix appended when a disabled skill blocker fires. */
export const RED_DISABLED_ACTION_USER_MESSAGE = [
  "",
  "You can still review data here, review a preview before posting, or complete the action directly in Big Red Cloud if appropriate.",
].join("\n");

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) return defaultValue;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function envNumberCapped(
  name: string,
  defaultValue: number,
  maxValue: number
): number {
  return Math.min(envNumber(name, defaultValue), maxValue);
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const MAX_BATCH_ITEMS_CAP = 100;

function envTimezone(name: string, defaultValue: string): string {
  const fromNamed = process.env[name]?.trim();
  if (fromNamed) {
    return fromNamed;
  }

  const fromTz = process.env.TZ?.trim();
  if (fromTz) {
    return fromTz;
  }

  return defaultValue;
}

export const redServerConfig = {
  sessionTtlMinutes: envNumber("BRC_MCP_SESSION_TTL_MINUTES", 120),
  apiKeyTtlMinutes: envNumber("BRC_API_KEY_TTL_MINUTES", 120),
  /** IANA timezone for user-facing connection expiry wording (e.g. Europe/Dublin). */
  displayTimezone: envTimezone("BRC_DISPLAY_TIMEZONE", "Europe/Dublin"),

  rateLimitRequestsPerMinute: envNumber(
    "BRC_RATE_LIMIT_REQUESTS_PER_MINUTE",
    100
  ),

  maxBatchItems: envNumberCapped("BRC_MAX_BATCH_ITEMS", 5, MAX_BATCH_ITEMS_CAP),
  maxAuditEntries: envNumber("BRC_MAX_AUDIT_ENTRIES", 500),

  allowReadSkills: envFlag("BRC_ALLOW_READ_SKILLS", true),
  allowUpdateSkills: envFlag("BRC_ALLOW_UPDATE_SKILLS", true),
  allowDeleteSkills: envFlag("BRC_ALLOW_DELETE_SKILLS", true),
  allowEmailSkills: envFlag("BRC_ALLOW_EMAIL_SKILLS", true),
  allowBatchSkills: envFlag("BRC_ALLOW_BATCH_SKILLS", true),
  allowDevMode: envFlag("BRC_ALLOW_DEV_MODE", false),

  apiKeyBlacklistSha256: envList("BRC_API_KEY_BLACKLIST_SHA256"),
};

export function getApiKeyExpirationMs(): number {
  return redServerConfig.apiKeyTtlMinutes * 60 * 1000;
}

/**
 * Public base URL for the Red connection page.
 * Must match the MCP server instance (and connection store) the client is using.
 *
 * Resolution order:
 * 1. BRC_CONNECT_PUBLIC_BASE_URL — explicit connect-page override
 * 2. Non-production Azure slot / staging → https://WEBSITE_HOSTNAME
 *    (prevents staging MCP from sending users to production /connect)
 * 3. BRC_PUBLIC_BASE_URL — production / general hosted URL
 * 4. WEBSITE_HOSTNAME when present
 * 5. localhost for local dev
 *
 * There is no separate getConnectPublicBaseUrl — /connect links use getPublicBaseUrl().
 */
export type ConnectPublicBaseUrlSource =
  | "BRC_CONNECT_PUBLIC_BASE_URL"
  | "WEBSITE_HOSTNAME_NON_PRODUCTION_SLOT"
  | "BRC_PUBLIC_BASE_URL"
  | "WEBSITE_HOSTNAME"
  | "localhost";

function resolvePublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): { baseUrl: string; source: ConnectPublicBaseUrlSource } {
  const connectOverride = env.BRC_CONNECT_PUBLIC_BASE_URL?.trim();
  if (connectOverride) {
    return {
      baseUrl: connectOverride.replace(/\/$/, ""),
      source: "BRC_CONNECT_PUBLIC_BASE_URL",
    };
  }

  const websiteHostname = env.WEBSITE_HOSTNAME?.trim().toLowerCase();
  if (isNonProductionHostedSlot(env) && websiteHostname) {
    return {
      baseUrl: `https://${websiteHostname}`,
      source: "WEBSITE_HOSTNAME_NON_PRODUCTION_SLOT",
    };
  }

  const fromEnv = env.BRC_PUBLIC_BASE_URL?.trim();
  if (fromEnv) {
    return {
      baseUrl: fromEnv.replace(/\/$/, ""),
      source: "BRC_PUBLIC_BASE_URL",
    };
  }

  if (websiteHostname) {
    return {
      baseUrl: `https://${websiteHostname}`,
      source: "WEBSITE_HOSTNAME",
    };
  }

  const port = env.PORT ?? "3000";
  return {
    baseUrl: `http://localhost:${port}`,
    source: "localhost",
  };
}

export function getPublicBaseUrl(): string {
  return resolvePublicBaseUrl().baseUrl;
}

/**
 * Safe connect-URL diagnostics for operators — hostname and which setting won only.
 * Never includes full URLs with tokens, API keys, connection strings, or Cosmos ids.
 */
export function getConnectPublicBaseUrlDiagnostics(
  env: NodeJS.ProcessEnv = process.env
): {
  resolvedHost: string;
  source: ConnectPublicBaseUrlSource;
  connectOverridePresent: boolean;
  publicBaseUrlPresent: boolean;
  websiteHostnamePresent: boolean;
  deploymentEnvPresent: boolean;
  nonProductionSlot: boolean;
} {
  const { baseUrl, source } = resolvePublicBaseUrl(env);
  let resolvedHost = "";
  try {
    resolvedHost = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    resolvedHost = "";
  }

  return {
    resolvedHost,
    source,
    connectOverridePresent: Boolean(env.BRC_CONNECT_PUBLIC_BASE_URL?.trim()),
    publicBaseUrlPresent: Boolean(env.BRC_PUBLIC_BASE_URL?.trim()),
    websiteHostnamePresent: Boolean(env.WEBSITE_HOSTNAME?.trim()),
    deploymentEnvPresent: Boolean(env.BRC_DEPLOYMENT_ENV?.trim()),
    nonProductionSlot: isNonProductionHostedSlot(env),
  };
}

/**
 * True when this process is a non-production Azure slot or staging deployment.
 * Staging must serve its own /connect page so telemetryClientId is written to
 * the same store staging MCP later reads.
 */
export function isNonProductionHostedSlot(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const slotName = env.WEBSITE_SLOT_NAME?.trim().toLowerCase();
  if (slotName && slotName !== "production") {
    return true;
  }

  const deploymentEnv = env.BRC_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (deploymentEnv === "staging") {
    return true;
  }

  const hostname = env.WEBSITE_HOSTNAME?.trim().toLowerCase() ?? "";
  return hostname.includes("-staging.") || hostname.endsWith("-staging.azurewebsites.net");
}

/** Safe host comparison for connect-URL vs instance diagnostics (no secrets). */
export function getConnectUrlHostMismatch(): {
  configuredPublicBaseHostPresent: boolean;
  resolvedConnectHostPresent: boolean;
  hostsMatch: boolean;
  usingSlotHostname: boolean;
  resolvedHost: string;
  source: ConnectPublicBaseUrlSource;
} {
  const configured = process.env.BRC_PUBLIC_BASE_URL?.trim();
  let configuredHost = "";
  if (configured) {
    try {
      configuredHost = new URL(configured).hostname.toLowerCase();
    } catch {
      configuredHost = "";
    }
  }

  const diagnostics = getConnectPublicBaseUrlDiagnostics();
  const resolvedHost = diagnostics.resolvedHost;

  const websiteHostname = process.env.WEBSITE_HOSTNAME?.trim().toLowerCase() ?? "";
  const usingSlotHostname =
    Boolean(websiteHostname) && resolvedHost === websiteHostname;

  return {
    configuredPublicBaseHostPresent: Boolean(configuredHost),
    resolvedConnectHostPresent: Boolean(resolvedHost),
    hostsMatch: Boolean(
      configuredHost && resolvedHost && configuredHost === resolvedHost
    ),
    usingSlotHostname,
    resolvedHost,
    source: diagnostics.source,
  };
}

export function getMaxBatchItems(): number {
  return redServerConfig.maxBatchItems;
}

export function getMaxAuditEntries(): number {
  return redServerConfig.maxAuditEntries;
}

export type RedSkillGroup =
  | "session"
  | "dev"
  | "read"
  | "update"
  | "delete"
  | "email"
  | "batch";

const SESSION_TOOL_NAMES = new Set([
  "brc_start_company_connection",
  "brc_confirm_company_connection",
  "brc_get_company_api_key_status",
  "brc_list_company_contexts",
  "brc_clear_company_api_key",
  "brc_clear_all_company_api_keys",
  "brc_getting_started",
  "brc_get_deployment_policy",
  "brc_route_request",
  "brc_red_help",
  "brc_find_help_resources",
  "brc_get_help_resource_details",
  "brc_open_edu_admin",
  "brc_generate_support_report",
]);

const DEV_TOOL_NAMES = new Set<string>([
  "brc_set_company_api_key",
  "brc_get_dev_mode_details",
  "brc_dev_diagnose_company_processing_settings",
  "brc_get_connection_store_diagnostics",
]);

/** Read-only tools that must not match broader update/write name patterns. */
const READ_ONLY_TOOL_NAMES = new Set<string>([
  "brc_get_company_processing_settings",
  "brc_get_company_reference_settings",
  "brc_check_transaction_settings",
]);

function classifyTool(toolName: string): RedSkillGroup {
  if (SESSION_TOOL_NAMES.has(toolName)) return "session";
  if (DEV_TOOL_NAMES.has(toolName)) return "dev";
  if (READ_ONLY_TOOL_NAMES.has(toolName)) return "read";

  if (toolName.startsWith("brc_delete_")) return "delete";
  if (toolName.startsWith("brc_batch_")) return "batch";
  if (toolName.startsWith("brc_send_")) return "email";

  if (
    toolName.startsWith("brc_create_") ||
    toolName.startsWith("brc_update_") ||
    toolName.startsWith("brc_process_") ||
    toolName.includes("_gen_ref") ||
    toolName.includes("generate") ||
    toolName.includes("close") ||
    toolName.includes("reopen")
  ) {
    return "update";
  }

  return "read";
}

export function isToolEnabled(toolName: string): boolean {
  const group = classifyTool(toolName);

  switch (group) {
    case "session":
      return true;
    case "dev":
      return redServerConfig.allowDevMode;
    case "read":
      return redServerConfig.allowReadSkills;
    case "update":
      return redServerConfig.allowUpdateSkills;
    case "delete":
      return redServerConfig.allowDeleteSkills;
    case "email":
      return redServerConfig.allowEmailSkills;
    case "batch":
      return redServerConfig.allowBatchSkills;
    default:
      return false;
  }
}

export function getToolSkillGroup(toolName: string): RedSkillGroup {
  return classifyTool(toolName);
}

/** Customer-safe capability summary — no environment variable or config file names. */
export function getCustomerDeploymentCapabilities() {
  return {
    canReadCompanyData: redServerConfig.allowReadSkills,
    canCreateOrUpdateRecords: redServerConfig.allowUpdateSkills,
    canDeleteRecords: redServerConfig.allowDeleteSkills,
    canSendEmails: redServerConfig.allowEmailSkills,
    canBatchProcessRecords: redServerConfig.allowBatchSkills,
    devModeActive: redServerConfig.allowDevMode,
    apiKeyTtlMinutes: redServerConfig.apiKeyTtlMinutes,
    maxBatchItems: redServerConfig.maxBatchItems,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) return false;

  return timingSafeEqual(aBuffer, bBuffer);
}

export function isApiKeyBlacklisted(apiKey: string): boolean {
  const hash = sha256Hex(apiKey.trim());

  return redServerConfig.apiKeyBlacklistSha256.some((blockedHash) =>
    safeEqual(hash, blockedHash.toLowerCase())
  );
}

export function assertApiKeyAllowed(apiKey: string): void {
  if (isApiKeyBlacklisted(apiKey)) {
    throw new Error(
      "This company API key is blocked from being used with Red. Please contact Big Red Cloud support or your administrator."
    );
  }
}

/*Blocked skills message*/
export function getDisabledSkillMessage(toolName: string): string {
    const group = getToolSkillGroup(toolName);
  
    if (group === "update") {
      return [
        "This action is not available in the current Red deployment.",
        "",
        "Creating, updating, generating, closing, reopening, or processing records has been disabled by the server administrator.",
        "",
        "You can still use read-only tools to view records, check company readiness, or prepare details for review.",
        RED_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }
  
    if (group === "delete") {
      return [
        "This action is not available in the current Red deployment.",
        "",
        "Deleting records has been disabled by the server administrator.",
        "",
        "You can still view the record and ask for the details to be summarised before deciding what to do outside Red.",
        RED_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }

    if (group === "email") {
      return [
        "This action is not available in the current Red deployment.",
        "",
        "Sending sales invoice, quote, or statement emails has been disabled by the server administrator.",
        "",
        "You can still view the document and prepare an email preview for review.",
        RED_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }

    if (group === "batch") {
      return [
        "This action is not available in the current Red deployment.",
        "",
        "Batch processing has been disabled by the server administrator.",
        "",
        "You can still create or update records one at a time where that is enabled, or prepare batch details for review.",
        RED_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }

    if (group === "dev") {
      return [
        "Development diagnostics are not available in the current Red deployment.",
        RED_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }
  
    if (group === "read") {
      return [
        "Read-only tools are not available in the current Red deployment.",
        "",
        "Please contact the Red administrator.",
      ].join("\n");
    }
  
    return "This action is not available in the current Red deployment.";
  }