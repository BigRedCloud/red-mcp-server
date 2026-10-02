import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { getCustomerDeploymentCapabilities } from "../../config/server_config.js";
import { registerAllTools } from "../../register_all_tools.js";
import { createBrcMcpServer } from "../../server.js";
import type { RedMcpToolProfile } from "../../tool_profiles.js";

async function createProfileClient(profile: RedMcpToolProfile) {
  const server = createBrcMcpServer();
  registerAllTools(server, { profile });
  const client = new Client({ name: `policy-${profile}`, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
      await clientTransport.close();
      await serverTransport.close();
    },
  };
}

function policyText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  assert.ok(Array.isArray(content));
  return content
    .filter(
      (entry: unknown): entry is { type: "text"; text: string } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === "text" &&
        typeof (entry as { text?: unknown }).text === "string",
    )
    .map((entry: { text: string }) => entry.text)
    .join("\n");
}

test("deployment policy is captured independently by full and read-only registrations", async () => {
  const [full, readOnly] = await Promise.all([
    createProfileClient("full"),
    createProfileClient("copilot-read-only"),
  ]);
  try {
    const [fullResult, readOnlyResult] = await Promise.all([
      full.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
      readOnly.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
    ]);
    const fullText = policyText(fullResult);
    const readOnlyText = policyText(readOnlyResult);
    const capabilities = getCustomerDeploymentCapabilities();
    const availability = (enabled: boolean) => enabled ? "available" : "not available";

    assert.match(fullText, /Current endpoint profile: full/);
    assert.match(fullText, /Registered tools: 159/);
    assert.match(fullText, /Read and connection operations: available/);
    assert.ok(fullText.includes(`Create operations: ${availability(capabilities.canCreateOrUpdateRecords)}`));
    assert.ok(fullText.includes(`Update operations: ${availability(capabilities.canCreateOrUpdateRecords)}`));
    assert.ok(fullText.includes(`Delete operations: ${availability(capabilities.canDeleteRecords)}`));
    assert.ok(fullText.includes(`Batch-write operations: ${availability(capabilities.canBatchProcessRecords)}`));
    assert.ok(fullText.includes(`Email operations: ${availability(capabilities.canSendEmails)}`));
    assert.match(fullText, /Route-request orchestration: available/);

    assert.match(readOnlyText, /Current endpoint profile: copilot-read-only/);
    assert.match(readOnlyText, /Registered tools: 80/);
    assert.match(readOnlyText, /Read-only accounting operations: available/);
    assert.match(readOnlyText, /Company connection operations: available/);
    for (const capability of [
      "Create operations",
      "Update operations",
      "Delete operations",
      "Post and allocate operations",
      "Batch-write operations",
      "Email operations",
      "Route-request orchestration",
    ]) {
      assert.ok(readOnlyText.includes(`${capability}: unavailable on this endpoint`));
    }
    assert.doesNotMatch(readOnlyText, /Creating or changing records: available/);
    assert.doesNotMatch(readOnlyText, /Supported email actions are/);

    const [fullAgain, readOnlyAgain] = await Promise.all([
      full.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
      readOnly.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
    ]);
    assert.match(policyText(fullAgain), /profile: full[\s\S]*Registered tools: 159/);
    assert.match(policyText(readOnlyAgain), /profile: copilot-read-only[\s\S]*Registered tools: 80/);
  } finally {
    await Promise.all([full.close(), readOnly.close()]);
  }
});
