import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function runConfigProbe(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const script = `
    const mod = await import("./build/config/server_config.js");

    const result = {
      sessionTtlMinutes: mod.redServerConfig.sessionTtlMinutes,
      apiKeyTtlMinutes: mod.redServerConfig.apiKeyTtlMinutes,
      maxBatchItems: mod.getMaxBatchItems(),
      allowDevMode: mod.redServerConfig.allowDevMode,
      allowDeleteSkills: mod.redServerConfig.allowDeleteSkills,
      readToolEnabled: mod.isToolEnabled("brc_get_customers"),
      deleteToolEnabled: mod.isToolEnabled("brc_delete_sales_invoice"),
      devToolEnabled: mod.isToolEnabled("brc_set_company_api_key"),
      deleteToolGroup: mod.getToolSkillGroup("brc_delete_sales_invoice"),
      updateToolGroup: mod.getToolSkillGroup("brc_create_customer"),
      batchToolGroup: mod.getToolSkillGroup("brc_batch_bank_accounts"),
      blacklisted: mod.isApiKeyBlacklisted("blocked-api-key"),
      publicBaseUrl: mod.getPublicBaseUrl()
    };

    console.log(JSON.stringify(result));
  `;

  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });

  assert.equal(child.status, 0, child.stderr);

  return JSON.parse(child.stdout.trim()) as Record<string, unknown>;
}

test("server config uses safe defaults", () => {
  const result = runConfigProbe({
    BRC_MCP_SESSION_TTL_MINUTES: "",
    BRC_API_KEY_TTL_MINUTES: "",
    BRC_ALLOW_DEV_MODE: "",
    BRC_ALLOW_DELETE_SKILLS: "",
    BRC_MAX_BATCH_ITEMS: "",
  });

  assert.equal(result.sessionTtlMinutes, 120);
  assert.equal(result.apiKeyTtlMinutes, 120);
  assert.equal(result.allowDevMode, false);
  assert.equal(result.readToolEnabled, true);
  assert.equal(result.devToolEnabled, false);
});

test("batch size is capped even when environment value is too high", () => {
  const result = runConfigProbe({
    BRC_MAX_BATCH_ITEMS: "999",
  });

  assert.equal(result.maxBatchItems, 100);
});

test("delete tools can be disabled by environment config", () => {
  const result = runConfigProbe({
    BRC_ALLOW_DELETE_SKILLS: "false",
  });

  assert.equal(result.allowDeleteSkills, false);
  assert.equal(result.deleteToolEnabled, false);
  assert.equal(result.deleteToolGroup, "delete");
});

test("tool classification identifies update and batch tools", () => {
  const result = runConfigProbe({});

  assert.equal(result.updateToolGroup, "update");
  assert.equal(result.batchToolGroup, "batch");
});

test("API key blacklist uses SHA-256 hashes, not raw keys", () => {
  const blockedHash = createHash("sha256")
    .update("blocked-api-key", "utf8")
    .digest("hex");

  const result = runConfigProbe({
    BRC_API_KEY_BLACKLIST_SHA256: blockedHash,
  });

  assert.equal(result.blacklisted, true);
});

test("public base URL trims trailing slash", () => {
  const result = runConfigProbe({
    BRC_PUBLIC_BASE_URL: "https://red.example.com/",
    BRC_CONNECT_PUBLIC_BASE_URL: "",
    BRC_DEPLOYMENT_ENV: "",
    WEBSITE_HOSTNAME: "",
    WEBSITE_SLOT_NAME: "",
  });

  assert.equal(result.publicBaseUrl, "https://red.example.com");
});

test("staging slot uses WEBSITE_HOSTNAME for connect URL even when BRC_PUBLIC_BASE_URL is production", () => {
  const result = runConfigProbe({
    BRC_PUBLIC_BASE_URL: "https://red.bigredcloud.com",
    BRC_CONNECT_PUBLIC_BASE_URL: "",
    BRC_DEPLOYMENT_ENV: "staging",
    WEBSITE_HOSTNAME: "brc-live-mcp-app-staging.azurewebsites.net",
    WEBSITE_SLOT_NAME: "staging",
  });

  assert.equal(
    result.publicBaseUrl,
    "https://brc-live-mcp-app-staging.azurewebsites.net"
  );
});

test("BRC_CONNECT_PUBLIC_BASE_URL overrides staging and production hosts", () => {
  const result = runConfigProbe({
    BRC_PUBLIC_BASE_URL: "https://red.bigredcloud.com",
    BRC_CONNECT_PUBLIC_BASE_URL: "https://connect-override.example.com/",
    BRC_DEPLOYMENT_ENV: "staging",
    WEBSITE_HOSTNAME: "brc-live-mcp-app-staging.azurewebsites.net",
    WEBSITE_SLOT_NAME: "staging",
  });

  assert.equal(result.publicBaseUrl, "https://connect-override.example.com");
});

test("production keeps configured BRC_PUBLIC_BASE_URL", () => {
  const result = runConfigProbe({
    BRC_PUBLIC_BASE_URL: "https://red.bigredcloud.com",
    BRC_CONNECT_PUBLIC_BASE_URL: "",
    BRC_DEPLOYMENT_ENV: "production",
    WEBSITE_HOSTNAME: "brc-live-mcp-app.azurewebsites.net",
    WEBSITE_SLOT_NAME: "production",
  });

  assert.equal(result.publicBaseUrl, "https://red.bigredcloud.com");
});
