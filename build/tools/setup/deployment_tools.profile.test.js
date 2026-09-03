import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getCustomerDeploymentCapabilities } from "../../config/server_config.js";
import { registerAllTools } from "../../register_all_tools.js";
import { createBrcMcpServer } from "../../server.js";
async function createProfileClient(profile) {
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
function policyText(result) {
    const content = result.content;
    assert.ok(Array.isArray(content));
    return content
        .filter((entry) => typeof entry === "object" &&
        entry !== null &&
        entry.type === "text" &&
        typeof entry.text === "string")
        .map((entry) => entry.text)
        .join("\n");
}
test("deployment policy is captured independently by full and Copilot Full registrations", async () => {
    const [full, copilot] = await Promise.all([
        createProfileClient("full"),
        createProfileClient("copilot-full"),
    ]);
    try {
        const [fullResult, copilotResult] = await Promise.all([
            full.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
            copilot.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
        ]);
        const fullText = policyText(fullResult);
        const copilotText = policyText(copilotResult);
        const capabilities = getCustomerDeploymentCapabilities();
        const availability = (enabled) => enabled ? "available" : "not available";
        assert.match(fullText, /Current endpoint profile: full/);
        assert.match(fullText, /Registered tools: 159/);
        assert.match(fullText, /Read and connection operations: available/);
        assert.ok(fullText.includes(`Create operations: ${availability(capabilities.canCreateOrUpdateRecords)}`));
        assert.ok(fullText.includes(`Update operations: ${availability(capabilities.canCreateOrUpdateRecords)}`));
        assert.ok(fullText.includes(`Delete operations: ${availability(capabilities.canDeleteRecords)}`));
        assert.ok(fullText.includes(`Batch-write operations: ${availability(capabilities.canBatchProcessRecords)}`));
        assert.ok(fullText.includes(`Email operations: ${availability(capabilities.canSendEmails)}`));
        assert.match(fullText, /Route-request orchestration: available/);
        assert.match(copilotText, /Current endpoint profile: copilot-full/);
        assert.match(copilotText, /Registered tools: 80/);
        assert.match(copilotText, /Read-only accounting operations: available/);
        assert.match(copilotText, /Company connection operations: available/);
        for (const capability of [
            "Create operations",
            "Update operations",
            "Delete operations",
            "Post and allocate operations",
            "Batch-write operations",
            "Email operations",
            "Route-request orchestration",
        ]) {
            assert.ok(copilotText.includes(`${capability}: unavailable on this endpoint`));
        }
        assert.doesNotMatch(copilotText, /Creating or changing records: available/);
        assert.doesNotMatch(copilotText, /Supported email actions are/);
        const [fullAgain, copilotAgain] = await Promise.all([
            full.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
            copilot.client.callTool({ name: "brc_get_deployment_policy", arguments: {} }),
        ]);
        assert.match(policyText(fullAgain), /profile: full[\s\S]*Registered tools: 159/);
        assert.match(policyText(copilotAgain), /profile: copilot-full[\s\S]*Registered tools: 80/);
    }
    finally {
        await Promise.all([full.close(), copilot.close()]);
    }
});
