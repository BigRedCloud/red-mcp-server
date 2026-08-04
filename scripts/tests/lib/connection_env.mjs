import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { redactString } from "./redact.mjs";

export const DEFAULT_TEST_SERVER_ENTRY =
  process.env.BRC_MCP_SERVER_ENTRY ||
  fileURLToPath(new URL("./stdio_test_server_entry.mjs", import.meta.url));

export function resolveTestCompanyName() {
  return (
    process.env.BRC_TEST_COMPANY?.trim() ||
    process.env.BRC_TEST_COMPANY_NAME?.trim() ||
    ""
  );
}

export function resolveTestApiKey() {
  return process.env.BRC_TEST_API_KEY?.trim() || "";
}

export function requireTestConnectionEnv({ label = "legacy regression" } = {}) {
  const companyName = resolveTestCompanyName();
  const apiKey = resolveTestApiKey();

  if (!companyName) {
    console.error(
      `Missing BRC_TEST_COMPANY (or BRC_TEST_COMPANY_NAME) for ${label}.`
    );
    process.exit(1);
  }

  if (!apiKey) {
    console.error(
      `Missing BRC_TEST_API_KEY for ${label}. Set it in your environment — it is never printed or logged by these scripts.`
    );
    process.exit(1);
  }

  return { companyName, apiKey };
}

export function requireEnvFlag(name, message) {
  if (process.env[name]?.trim().toLowerCase() !== "true") {
    console.error(message);
    process.exit(1);
  }
}

export function loadCompanyKeyMap() {
  const singleName = resolveTestCompanyName();
  const singleKey = resolveTestApiKey();

  let fromFile = {};
  if (process.env.BRC_COMPANY_KEYS_JSON) {
    fromFile = JSON.parse(process.env.BRC_COMPANY_KEYS_JSON);
  } else if (process.env.BRC_COMPANY_KEYS_FILE) {
    fromFile = JSON.parse(
      fs.readFileSync(process.env.BRC_COMPANY_KEYS_FILE, "utf8")
    );
  }

  if (singleName && singleKey) {
    return { [singleName]: singleKey };
  }

  if (singleName && fromFile[singleName]) {
    return { [singleName]: fromFile[singleName] };
  }

  if (Object.keys(fromFile).length > 0) {
    return fromFile;
  }

  throw new Error(
    "Set BRC_COMPANY_KEYS_FILE, BRC_COMPANY_KEYS_JSON, or BRC_TEST_COMPANY + BRC_TEST_API_KEY"
  );
}

export function describeConnectionSetup(companyName) {
  return {
    companyName,
    connectionMethod: "secure connection store (stdio test server entry)",
    apiKeyPresent: true,
    apiKeyLogged: false,
  };
}

export function formatErrorWithoutSecrets(error) {
  return redactString(error?.message || String(error));
}
