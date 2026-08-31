import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllTools } from "./register_all_tools.js";
import { requiresRouteToken } from "./routing/route-token.js";
import { createBrcMcpServer } from "./server.js";
import { COPILOT_TOOL_ALLOWLIST, RED_MCP_TOOL_PROFILE_ENV, } from "./tool_profiles.js";
const ACCOUNTING_PLUS_ADDITIONS = [
    "brc_list_suppliers",
    "brc_get_supplier",
    "brc_list_supplier_account_trans",
    "brc_list_purchases",
    "brc_get_purchase",
    "brc_grouped_nominal_accounts_report",
];
async function listRegisteredTools(profile) {
    const previous = process.env[RED_MCP_TOOL_PROFILE_ENV];
    if (profile === undefined) {
        delete process.env[RED_MCP_TOOL_PROFILE_ENV];
    }
    else {
        process.env[RED_MCP_TOOL_PROFILE_ENV] = profile;
    }
    const server = createBrcMcpServer();
    const client = new Client({ name: "tool-profile-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        registerAllTools(server);
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return (await client.listTools()).tools;
    }
    finally {
        if (previous === undefined) {
            delete process.env[RED_MCP_TOOL_PROFILE_ENV];
        }
        else {
            process.env[RED_MCP_TOOL_PROFILE_ENV] = previous;
        }
        await client.close();
        await server.close();
        await clientTransport.close();
        await serverTransport.close();
    }
}
test("full, default, and Copilot profiles expose the expected descriptors", async () => {
    const defaultTools = await listRegisteredTools();
    const fullTools = await listRegisteredTools("full");
    const copilotTools = await listRegisteredTools("copilot");
    assert.equal(defaultTools.length, 159);
    assert.equal(fullTools.length, 159);
    assert.equal(copilotTools.length, 17);
    assert.deepEqual(fullTools, defaultTools, "explicit full profile must not change descriptors");
    const expectedNames = [...COPILOT_TOOL_ALLOWLIST].sort();
    const actualNames = copilotTools.map((tool) => tool.name).sort();
    assert.deepEqual(actualNames, expectedNames);
    assert.equal(new Set(actualNames).size, actualNames.length);
    assert.equal(actualNames.includes("brc_route_request"), false);
    assert.equal(actualNames.includes("brc_send_email_statement"), false);
    for (const excluded of [
        "brc_create_supplier",
        "brc_update_supplier",
        "brc_delete_supplier",
        "brc_create_purchase",
        "brc_batch_purchases",
        "brc_open_edu_admin",
    ]) {
        assert.equal(actualNames.includes(excluded), false, excluded);
    }
    for (const required of [
        "brc_start_company_connection",
        "brc_confirm_company_connection",
        "brc_list_company_contexts",
        "brc_get_company_api_key_status",
        "brc_list_customers",
        "brc_get_customer",
    ]) {
        assert.ok(actualNames.includes(required), required);
    }
    for (const addition of ACCOUNTING_PLUS_ADDITIONS) {
        assert.ok(actualNames.includes(addition), addition);
        assert.equal(requiresRouteToken(addition), false, `${addition}: route token`);
        const descriptor = copilotTools.find((tool) => tool.name === addition);
        assert.ok(descriptor, addition);
        assert.equal(descriptor.annotations?.readOnlyHint, true, `${addition}: read-only`);
        assert.equal(Object.hasOwn(descriptor.inputSchema.properties ?? {}, "routeToken"), false, `${addition}: routeToken schema field`);
    }
    const fullByName = new Map(fullTools.map((tool) => [tool.name, tool]));
    for (const tool of copilotTools) {
        const fullTool = fullByName.get(tool.name);
        assert.ok(fullTool, tool.name);
        assert.equal(tool.title, fullTool.title, `${tool.name}: title`);
        assert.equal(tool.description, fullTool.description, `${tool.name}: description`);
        assert.deepEqual(tool.inputSchema, fullTool.inputSchema, `${tool.name}: input schema`);
        assert.deepEqual(tool.annotations, fullTool.annotations, `${tool.name}: annotations`);
    }
});
test("unknown profile fails closed before any tool is registered", () => {
    const previous = process.env[RED_MCP_TOOL_PROFILE_ENV];
    process.env[RED_MCP_TOOL_PROFILE_ENV] = "unexpected";
    let registrations = 0;
    try {
        assert.throws(() => registerAllTools({
            registerTool() {
                registrations += 1;
            },
        }), /Invalid RED_MCP_TOOL_PROFILE value "unexpected".*"full" or "copilot"/);
        assert.equal(registrations, 0);
    }
    finally {
        if (previous === undefined) {
            delete process.env[RED_MCP_TOOL_PROFILE_ENV];
        }
        else {
            process.env[RED_MCP_TOOL_PROFILE_ENV] = previous;
        }
    }
});
test("an explicitly blank profile is rejected rather than treated as unset", () => {
    const previous = process.env[RED_MCP_TOOL_PROFILE_ENV];
    process.env[RED_MCP_TOOL_PROFILE_ENV] = "";
    try {
        assert.throws(() => registerAllTools({ registerTool() { } }), /Invalid RED_MCP_TOOL_PROFILE value ""/);
    }
    finally {
        if (previous === undefined) {
            delete process.env[RED_MCP_TOOL_PROFILE_ENV];
        }
        else {
            process.env[RED_MCP_TOOL_PROFILE_ENV] = previous;
        }
    }
});
