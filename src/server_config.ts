import { createHash, timingSafeEqual } from "node:crypto";

/** Customer-safe suffix appended when a disabled skill blocker fires. */
export const RED_CONNECT_DISABLED_ACTION_USER_MESSAGE = [
  "",
  "You can still review data here, prepare a draft, or complete the action directly in Big Red Cloud if appropriate.",
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

const MAX_BATCH_ITEMS_CAP = 10;

export const redConnectServerConfig = {
  sessionTtlMinutes: envNumber("BRC_MCP_SESSION_TTL_MINUTES", 10),
  apiKeyTtlMinutes: envNumber("BRC_API_KEY_TTL_MINUTES", 10),

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
  return redConnectServerConfig.apiKeyTtlMinutes * 60 * 1000;
}

export function getMaxBatchItems(): number {
  return redConnectServerConfig.maxBatchItems;
}

export function getMaxAuditEntries(): number {
  return redConnectServerConfig.maxAuditEntries;
}

export type RedConnectSkillGroup =
  | "session"
  | "dev"
  | "read"
  | "update"
  | "delete"
  | "email"
  | "batch";

const SESSION_TOOL_NAMES = new Set([
  "brc_set_company_api_key",
  "brc_get_company_api_key_status",
  "brc_list_company_contexts",
  "brc_clear_company_api_key",
  "brc_clear_all_company_api_keys",
  "brc_getting_started",
  "brc_get_deployment_policy",
]);

const DEV_TOOL_NAMES = new Set<string>(["brc_get_dev_mode_details"]);

function classifyTool(toolName: string): RedConnectSkillGroup {
  if (SESSION_TOOL_NAMES.has(toolName)) return "session";
  if (DEV_TOOL_NAMES.has(toolName)) return "dev";

  if (toolName.startsWith("brc_delete_")) return "delete";
  if (toolName.startsWith("brc_batch_")) return "batch";
  if (toolName.startsWith("brc_send_")) return "email";

  if (
    toolName.startsWith("brc_create_") ||
    toolName.startsWith("brc_update_") ||
    toolName.includes("_gen_ref") ||
    toolName.includes("generate") ||
    toolName.includes("process") ||
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
      return redConnectServerConfig.allowDevMode;
    case "read":
      return redConnectServerConfig.allowReadSkills;
    case "update":
      return redConnectServerConfig.allowUpdateSkills;
    case "delete":
      return redConnectServerConfig.allowDeleteSkills;
    case "email":
      return redConnectServerConfig.allowEmailSkills;
    case "batch":
      return redConnectServerConfig.allowBatchSkills;
    default:
      return false;
  }
}

export function getToolSkillGroup(toolName: string): RedConnectSkillGroup {
  return classifyTool(toolName);
}

/** Customer-safe capability summary — no environment variable or config file names. */
export function getCustomerDeploymentCapabilities() {
  return {
    canReadCompanyData: redConnectServerConfig.allowReadSkills,
    canCreateOrUpdateRecords: redConnectServerConfig.allowUpdateSkills,
    canDeleteRecords: redConnectServerConfig.allowDeleteSkills,
    canSendEmails: redConnectServerConfig.allowEmailSkills,
    canBatchProcessRecords: redConnectServerConfig.allowBatchSkills,
    devModeActive: redConnectServerConfig.allowDevMode,
    apiKeyTtlMinutes: redConnectServerConfig.apiKeyTtlMinutes,
    maxBatchItems: redConnectServerConfig.maxBatchItems,
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

  return redConnectServerConfig.apiKeyBlacklistSha256.some((blockedHash) =>
    safeEqual(hash, blockedHash.toLowerCase())
  );
}

export function assertApiKeyAllowed(apiKey: string): void {
  if (isApiKeyBlacklisted(apiKey)) {
    throw new Error(
      "This company API key is blocked from being used with Red Connect. Please contact Big Red Cloud support or your administrator."
    );
  }
}

/*Blocked skills message*/
export function getDisabledSkillMessage(toolName: string): string {
    const group = getToolSkillGroup(toolName);
  
    if (group === "update") {
      return [
        "This action is not available in the current Red Connect deployment.",
        "",
        "Creating, updating, generating, closing, reopening, or processing records has been disabled by the server administrator.",
        "",
        "You can still use read-only tools to view records, check company readiness, or prepare details for review.",
        RED_CONNECT_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }
  
    if (group === "delete") {
      return [
        "This action is not available in the current Red Connect deployment.",
        "",
        "Deleting records has been disabled by the server administrator.",
        "",
        "You can still view the record and ask for the details to be summarised before deciding what to do outside Red Connect.",
        RED_CONNECT_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }

    if (group === "email") {
      return [
        "This action is not available in the current Red Connect deployment.",
        "",
        "Sending sales invoice, quote, or statement emails has been disabled by the server administrator.",
        "",
        "You can still view the document and prepare a draft message for review.",
        RED_CONNECT_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }

    if (group === "batch") {
      return [
        "This action is not available in the current Red Connect deployment.",
        "",
        "Batch processing has been disabled by the server administrator.",
        "",
        "You can still create or update records one at a time where that is enabled, or prepare batch details for review.",
        RED_CONNECT_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }

    if (group === "dev") {
      return [
        "Development diagnostics are not available in the current Red Connect deployment.",
        RED_CONNECT_DISABLED_ACTION_USER_MESSAGE,
      ].join("\n");
    }
  
    if (group === "read") {
      return [
        "Read-only tools are not available in the current Red Connect deployment.",
        "",
        "Please contact the Red Connect administrator.",
      ].join("\n");
    }
  
    return "This action is not available in the current Red Connect deployment.";
  }