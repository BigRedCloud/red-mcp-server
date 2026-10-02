import { resolveRedMcpToolProfile, isToolAllowedByProfile } from "./tool_profiles.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFilteredServer, registerAllTools } from "./register_all_tools.js";
import { requiresRouteToken } from "./routing/route-token.js";
import { createBrcMcpServer } from "./server.js";
import { COPILOT_TOOL_ALLOWLIST, COPILOT_READ_ONLY_TOOL_ALLOWLIST, RED_MCP_TOOL_PROFILE_ENV, } from "./tool_profiles.js";
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
test("Copilot Read Only exposes the audited 80-tool catalogue without changing descriptors", async () => {
    const fullTools = await listRegisteredTools("full");
    const copilotTools = await listRegisteredTools("copilot");
    const copilotReadOnlyTools = await listRegisteredTools("copilot-read-only");
    assert.equal(fullTools.length, 159);
    assert.equal(copilotTools.length, 17);
    assert.equal(COPILOT_READ_ONLY_TOOL_ALLOWLIST.length, 80);
    assert.equal(copilotReadOnlyTools.length, 80);
    const fullNames = fullTools.map((tool) => tool.name).sort();
    const auditedCatalogueHash = createHash("sha256")
        .update(fullNames.join("\n"))
        .digest("hex");
    assert.equal(auditedCatalogueHash, "11820efba083f309fce8029d8310e178c5f84fd7d7d903b5379590f4a0dd9fdb", "the 159-tool production catalogue changed; revisit the tool catalogue audit");
    const expectedNames = [...COPILOT_READ_ONLY_TOOL_ALLOWLIST].sort();
    const actualNames = copilotReadOnlyTools.map((tool) => tool.name).sort();
    const actualNameSet = new Set(actualNames);
    assert.deepEqual(actualNames, expectedNames);
    assert.equal(new Set(actualNames).size, 80);
    assert.ok(COPILOT_TOOL_ALLOWLIST.every((name) => actualNameSet.has(name)));
    assert.ok(expectedNames.every((name) => fullNames.includes(name)));
    const routeDependentNames = fullTools
        .map((tool) => tool.name)
        .filter((name) => requiresRouteToken(name));
    assert.equal(routeDependentNames.length, 73);
    assert.ok(routeDependentNames.every((name) => !actualNameSet.has(name)));
    const separatelyClassifiedRouteTools = new Set([
        "brc_close_quote",
        "brc_reopen_quote",
        "brc_send_email_statement",
        "brc_send_quote_email",
        "brc_send_sales_invoice_email",
    ]);
    assert.equal(routeDependentNames.filter((name) => !separatelyClassifiedRouteTools.has(name)).length, 68);
    for (const excluded of [
        "brc_route_request",
        "brc_clear_all_company_api_keys",
        "brc_clear_company_api_key",
        "brc_clear_audit_log",
        "brc_list_audit_log",
        "brc_open_edu_admin",
        "brc_create_customer",
        "brc_update_customer",
        "brc_delete_customer",
        "brc_batch_customers",
        "brc_process_vat_category_rates",
        "brc_send_sales_invoice_email",
    ]) {
        assert.equal(actualNameSet.has(excluded), false, excluded);
    }
    for (const required of [
        "brc_start_company_connection",
        "brc_confirm_company_connection",
        "brc_list_customers",
        "brc_list_suppliers",
        "brc_list_sales_invoices",
        "brc_list_purchases",
        "brc_list_nominal_accounts",
        "brc_list_bank_accounts",
        "brc_list_vat_rates",
    ]) {
        assert.ok(actualNameSet.has(required), required);
    }
    const connectionExceptions = new Set([
        "brc_start_company_connection",
        "brc_confirm_company_connection",
    ]);
    for (const tool of copilotReadOnlyTools) {
        assert.equal(requiresRouteToken(tool.name), false, `${tool.name}: route token`);
        assert.equal(tool.annotations?.destructiveHint, false, `${tool.name}: destructive`);
        assert.equal(tool.annotations?.openWorldHint, false, `${tool.name}: open world`);
        if (!connectionExceptions.has(tool.name)) {
            assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name}: read-only`);
        }
    }
    const fullByName = new Map(fullTools.map((tool) => [tool.name, tool]));
    for (const tool of copilotReadOnlyTools) {
        assert.deepEqual(tool, fullByName.get(tool.name), `${tool.name}: descriptor`);
    }
});
test("obsolete write-capable Copilot profile is rejected", () => {
    assert.throws(() => resolveRedMcpToolProfile({ RED_MCP_TOOL_PROFILE: "copilot-full" }), /Invalid RED_MCP_TOOL_PROFILE/);
    assert.equal(isToolAllowedByProfile("brc_list_customers", "copilot-full"), false);
});
test("Copilot Read Only filtering prevents excluded tools from reaching SDK registration", () => {
    let registrations = 0;
    const filtered = createFilteredServer({
        registerTool() {
            registrations += 1;
        },
    }, { profile: "copilot-read-only" });
    const result = filtered.tool("brc_route_request", "excluded", () => undefined);
    assert.equal(result, undefined);
    assert.equal(registrations, 0);
});
test("an explicit registration profile does not depend on the environment fallback", () => {
    const previous = process.env[RED_MCP_TOOL_PROFILE_ENV];
    process.env[RED_MCP_TOOL_PROFILE_ENV] = "unexpected";
    const names = [];
    try {
        registerAllTools({
            registerTool(name) {
                names.push(name);
            },
            registerResource() { },
            registerPrompt() { },
        }, { profile: "copilot-read-only" });
        assert.deepEqual(names.sort(), [...COPILOT_READ_ONLY_TOOL_ALLOWLIST].sort());
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
test("unknown profile fails closed before any tool is registered", () => {
    const previous = process.env[RED_MCP_TOOL_PROFILE_ENV];
    process.env[RED_MCP_TOOL_PROFILE_ENV] = "unexpected";
    let registrations = 0;
    try {
        assert.throws(() => registerAllTools({
            registerTool() {
                registrations += 1;
            },
        }), /Invalid RED_MCP_TOOL_PROFILE value "unexpected".*"copilot-read-only"/);
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
