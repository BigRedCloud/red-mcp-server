import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { isToolEnabled, getToolSkillGroup, redServerConfig } from "./config/server_config.js";
import { CONNECTION_REF_SCHEMA_EXEMPT_TOOLS, createFilteredServer, registerAllTools, } from "./register_all_tools.js";
import { getToolMetadata, TOOL_ANNOTATIONS, TOOL_TITLES, } from "./tool_annotations.js";
import { createBrcMcpServer } from "./server.js";
import { TOOL_DESCRIPTION_POLICY_PATTERNS } from "./tool_description_policy.js";
function captureRegisteredTools() {
    const tools = new Map();
    const recorder = {
        registerTool(name, config) {
            assert.ok(config.annotations, `${name} must have explicit annotations`);
            assert.equal(tools.has(name), false, `duplicate tool registration: ${name}`);
            tools.set(name, {
                title: config.title ?? "",
                description: config.description ?? "",
                schema: config.inputSchema ?? null,
                annotations: config.annotations,
            });
        },
        resource() { },
        registerResource() { },
        prompt() { },
        registerPrompt() { },
    };
    registerAllTools(recorder);
    return tools;
}
const registeredTools = captureRegisteredTools();
const enabledToolCount = [...registeredTools.keys()].filter((toolName) => isToolEnabled(toolName)).length;
function schemaHasOptionalConnectionRef(schema) {
    const field = schema.connectionRef;
    if (!field) {
        return false;
    }
    return typeof field.isOptional === "function" ? field.isOptional() : true;
}
test("register_all_tools includes brc_start_company_connection", () => {
    assert.ok(registeredTools.has("brc_start_company_connection"));
    assert.equal(isToolEnabled("brc_start_company_connection"), true);
});
test("register_all_tools includes brc_confirm_company_connection", () => {
    assert.ok(registeredTools.has("brc_confirm_company_connection"));
    assert.equal(isToolEnabled("brc_confirm_company_connection"), true);
});
test("register_all_tools includes brc_list_company_contexts", () => {
    assert.ok(registeredTools.has("brc_list_company_contexts"));
    assert.equal(isToolEnabled("brc_list_company_contexts"), true);
});
test("register_all_tools includes brc_find_help_resources", () => {
    assert.ok(registeredTools.has("brc_find_help_resources"));
    assert.equal(isToolEnabled("brc_find_help_resources"), true);
});
test("register_all_tools includes brc_red_help", () => {
    assert.ok(registeredTools.has("brc_red_help"));
    assert.equal(isToolEnabled("brc_red_help"), true);
});
test("register_all_tools includes brc_route_request", () => {
    assert.ok(registeredTools.has("brc_route_request"));
    assert.equal(isToolEnabled("brc_route_request"), true);
    // Remains credential-exempt, but accepts optional connectionRef so connected
    // sessions can embed a stable connectionBinding in the routeToken.
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_route_request"));
    const tool = registeredTools.get("brc_route_request");
    assert.ok(tool);
    assert.match(tool.description, /how do I/i);
    assert.match(tool.description, /add a customer/i);
    assert.match(tool.description, /routeToken/i);
    assert.match(tool.description, /\bread\b/i);
    assert.match(tool.description, /\bcreate\b/i);
    assert.match(tool.description, /\bupdate\b/i);
    assert.match(tool.description, /\bdelete\b/i);
    assert.match(tool.description, /\bcorrect\b/i);
    assert.match(tool.description, /\bundo\b/i);
    assert.match(tool.description, /\breverse\b/i);
    assert.match(tool.description, /\bemail\b/i);
    assert.match(tool.description, /\bbatch actions\b/i);
    assert.ok(tool.schema.message);
    assert.equal(schemaHasOptionalConnectionRef(tool.schema), true);
});
test("register_all_tools includes read-only brc_generate_support_report", () => {
    assert.ok(registeredTools.has("brc_generate_support_report"));
    assert.equal(isToolEnabled("brc_generate_support_report"), true);
    assert.equal(getToolSkillGroup("brc_generate_support_report"), "session");
    const tool = registeredTools.get("brc_generate_support_report");
    assert.ok(tool);
    assert.equal(tool.schema.routeToken, undefined);
    assert.ok(tool.schema.companyName);
    assert.match(tool.description, /downloadable|diagnostic/i);
    assert.equal(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_generate_support_report"), false);
});
test("register_all_tools includes brc_resolve_book_transaction_type", () => {
    assert.ok(registeredTools.has("brc_resolve_book_transaction_type"));
    assert.equal(isToolEnabled("brc_resolve_book_transaction_type"), true);
    const tool = registeredTools.get("brc_resolve_book_transaction_type");
    assert.ok(tool);
    assert.match(tool.description, /bookTranTypeId/i);
});
test("transactional tools require routeToken in registered schema", () => {
    const createCustomer = registeredTools.get("brc_create_customer");
    assert.ok(createCustomer?.schema?.routeToken);
    assert.match(createCustomer.description, /routeToken/i);
    const createInvoice = registeredTools.get("brc_create_sales_invoice");
    assert.ok(createInvoice?.schema?.routeToken);
    const help = registeredTools.get("brc_red_help");
    assert.equal(help?.schema?.routeToken, undefined);
    const connect = registeredTools.get("brc_start_company_connection");
    assert.equal(connect?.schema?.routeToken, undefined);
});
test("brc_red_help does not require company credentials", () => {
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_red_help"));
    const tool = registeredTools.get("brc_red_help");
    assert.ok(tool);
    assert.ok(tool.schema);
    assert.ok(tool.schema.query);
    assert.equal(tool.schema.companyName, undefined);
    assert.equal(tool.schema.connectionRef, undefined);
});
test("register_all_tools includes brc_get_help_resource_details", () => {
    assert.ok(registeredTools.has("brc_get_help_resource_details"));
    assert.equal(isToolEnabled("brc_get_help_resource_details"), true);
});
test("register_all_tools includes brc_open_edu_admin", () => {
    assert.ok(registeredTools.has("brc_open_edu_admin"));
    assert.equal(isToolEnabled("brc_open_edu_admin"), true);
});
test("brc_open_edu_admin does not require company credentials", () => {
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_open_edu_admin"));
    const tool = registeredTools.get("brc_open_edu_admin");
    assert.ok(tool);
    assert.match(tool.description, /Does not bypass authentication/i);
    assert.match(tool.description, /Microsoft Entra sign-in/i);
});
test("brc_get_help_resource_details does not require company credentials", () => {
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_get_help_resource_details"));
    const tool = registeredTools.get("brc_get_help_resource_details");
    assert.ok(tool);
    assert.ok(tool.schema);
    assert.ok(tool.schema.resourceId);
});
test("brc_find_help_resources description remains factual and discoverable", () => {
    const tool = registeredTools.get("brc_find_help_resources");
    assert.ok(tool);
    assert.match(tool.description, /customer documentation/i);
    assert.match(tool.description, /Freshdesk support articles/i);
    assert.match(tool.description, /recorded webinar videos/i);
});
test("brc_find_help_resources does not require company credentials", () => {
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_find_help_resources"));
    const tool = registeredTools.get("brc_find_help_resources");
    assert.ok(tool);
    assert.ok(tool.schema);
    assert.ok(tool.schema.question);
    assert.equal(tool.schema.companyName, undefined);
});
test("adding brc_find_help_resources does not reduce registered enabled tools unexpectedly", () => {
    assert.ok(registeredTools.has("brc_start_company_connection"));
    assert.ok(registeredTools.has("brc_confirm_company_connection"));
    assert.ok(registeredTools.has("brc_list_company_contexts"));
    assert.ok(registeredTools.has("brc_clear_company_api_key"));
    assert.ok(registeredTools.has("brc_clear_all_company_api_keys"));
    assert.ok(registeredTools.has("brc_find_help_resources"));
    assert.ok(registeredTools.has("brc_red_help"));
    assert.ok(registeredTools.has("brc_get_help_resource_details"));
    assert.ok(registeredTools.has("brc_generate_support_report"));
    assert.ok(registeredTools.has("brc_resolve_book_transaction_type"));
    assert.equal(enabledToolCount, 159);
});
test("every registered production tool has all three explicit safety hints", () => {
    assert.equal(registeredTools.size, 159);
    for (const [name, tool] of registeredTools) {
        assert.equal(typeof tool.annotations.readOnlyHint, "boolean", name);
        assert.equal(typeof tool.annotations.openWorldHint, "boolean", name);
        assert.equal(typeof tool.annotations.destructiveHint, "boolean", name);
    }
});
test("every registered production tool has a non-empty unique human-readable title", () => {
    assert.equal(registeredTools.size, 159);
    const titles = new Set();
    for (const [name, tool] of registeredTools) {
        assert.equal(tool.title, tool.title.trim(), name);
        assert.match(tool.title, /^[A-Z][A-Za-z0-9 -]*$/, name);
        assert.ok(tool.title.length > 0, name);
        assert.equal(tool.title.includes("_"), false, name);
        assert.equal(tool.annotations.title, tool.title, name);
        assert.ok(tool.annotations.title.trim().length > 0, name);
        assert.equal(titles.has(tool.title), false, `${name}: duplicate title ${tool.title}`);
        titles.add(tool.title);
    }
});
test("development-only tools have explicit annotation entries", () => {
    for (const name of [
        "brc_get_dev_mode_details",
        "brc_dev_diagnose_company_processing_settings",
        "brc_set_company_api_key",
        "brc_get_connection_store_diagnostics",
    ]) {
        assert.ok(TOOL_ANNOTATIONS[name], name);
        assert.ok(TOOL_TITLES[name]?.trim(), name);
        const metadata = getToolMetadata(name);
        assert.equal(metadata.annotations.title, metadata.title, name);
    }
});
test("development-only tools receive annotation titles through the real registration path", () => {
    const previous = redServerConfig.allowDevMode;
    try {
        redServerConfig.allowDevMode = true;
        const developmentTools = captureRegisteredTools();
        assert.equal(developmentTools.size, 163);
        for (const name of [
            "brc_get_dev_mode_details",
            "brc_dev_diagnose_company_processing_settings",
            "brc_set_company_api_key",
            "brc_get_connection_store_diagnostics",
        ]) {
            const tool = developmentTools.get(name);
            assert.ok(tool, name);
            assert.equal(tool.annotations.title, tool.title, name);
            assert.ok(tool.annotations.title.trim(), name);
        }
    }
    finally {
        redServerConfig.allowDevMode = previous;
    }
});
test("central metadata registry covers every production and dev-exposable tool", () => {
    const annotationNames = Object.keys(TOOL_ANNOTATIONS).sort();
    const titleNames = Object.keys(TOOL_TITLES).sort();
    assert.equal(annotationNames.length, 163);
    assert.deepEqual(titleNames, annotationNames);
    const titles = new Set();
    for (const name of annotationNames) {
        const title = TOOL_TITLES[name];
        const annotations = TOOL_ANNOTATIONS[name];
        assert.ok(title.trim(), name);
        assert.equal(titles.has(title), false, `${name}: duplicate title ${title}`);
        assert.equal(typeof annotations.readOnlyHint, "boolean", name);
        assert.equal(typeof annotations.openWorldHint, "boolean", name);
        assert.equal(typeof annotations.destructiveHint, "boolean", name);
        const metadata = getToolMetadata(name);
        assert.equal(metadata.annotations.title, title, name);
        titles.add(title);
    }
});
test("registered annotations retain the central safety hints exactly", () => {
    for (const [name, tool] of registeredTools) {
        const { title: _annotationTitle, ...emittedHints } = tool.annotations;
        assert.deepEqual(emittedHints, TOOL_ANNOTATIONS[name], name);
    }
});
test("real MCP tools/list serializes titles inside annotations for representative tools", async () => {
    const mcpServer = createBrcMcpServer();
    registerAllTools(mcpServer);
    const client = new Client({ name: "annotation-tools-list-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        await mcpServer.connect(serverTransport);
        await client.connect(clientTransport);
        const response = await client.listTools();
        assert.equal(response.tools.length, 159);
        const representativeNames = [
            "brc_list_customers",
            "brc_create_customer",
            "brc_delete_customer",
            "brc_send_sales_invoice_email",
        ];
        const serialized = JSON.stringify(response.tools.filter((tool) => representativeNames.includes(tool.name)));
        const representatives = JSON.parse(serialized);
        assert.equal(representatives.length, representativeNames.length);
        for (const name of representativeNames) {
            const tool = representatives.find((candidate) => candidate.name === name);
            assert.ok(tool, name);
            assert.equal(tool.title, TOOL_TITLES[name], name);
            assert.equal(tool.annotations?.title, TOOL_TITLES[name], name);
            assert.deepEqual({
                readOnlyHint: tool.annotations?.readOnlyHint,
                openWorldHint: tool.annotations?.openWorldHint,
                destructiveHint: tool.annotations?.destructiveHint,
            }, TOOL_ANNOTATIONS[name], name);
        }
    }
    finally {
        await client.close();
        await mcpServer.close();
        await clientTransport.close();
        await serverTransport.close();
    }
});
test("real production tools/list emits policy-neutral factual descriptions", async () => {
    const mcpServer = createBrcMcpServer();
    registerAllTools(mcpServer);
    const client = new Client({ name: "description-policy-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
        await mcpServer.connect(serverTransport);
        await client.connect(clientTransport);
        const response = await client.listTools();
        assert.equal(response.tools.length, 159);
        assert.equal(new Set(response.tools.map((tool) => tool.name)).size, 159);
        for (const tool of response.tools) {
            const description = tool.description ?? "";
            assert.ok(description.trim(), `${tool.name}: empty description`);
            assert.doesNotMatch(description, TOOL_DESCRIPTION_POLICY_PATTERNS.behaviouralInstruction, `${tool.name}: model-directed instruction`);
            assert.doesNotMatch(description, TOOL_DESCRIPTION_POLICY_PATTERNS.crossToolInstruction, `${tool.name}: cross-tool instruction`);
            for (const sentence of description.split(/(?<=[.!?])\s+/u)) {
                assert.doesNotMatch(sentence, TOOL_DESCRIPTION_POLICY_PATTERNS.imperativeSentence, `${tool.name}: imperative sentence`);
                assert.doesNotMatch(sentence, TOOL_DESCRIPTION_POLICY_PATTERNS.directiveClause, `${tool.name}: directive clause`);
            }
            assert.doesNotMatch(description, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u);
            assert.doesNotMatch(description, /(?:[A-Za-z0-9+/]{80,}={0,2}|(?:\\u[0-9a-fA-F]{4}){4,})/u);
        }
        const createInvoice = response.tools.find((tool) => tool.name === "brc_create_sales_invoice");
        assert.ok(createInvoice?.description?.includes("Requires a valid routeToken"));
        assert.ok(createInvoice?.description?.includes("A call without confirmWrite"));
        assert.ok(createInvoice?.description?.includes("Requires confirmCounterpartyExplicit: true; confirmation is scoped"));
        const createSupplier = response.tools.find((tool) => tool.name === "brc_create_supplier");
        assert.ok(createSupplier?.description?.includes("Opening-balance fields are not posted by this tool; supplier opening balances are entered directly in Big Red Cloud."));
        assert.doesNotMatch(createSupplier?.description ?? "", /warn them|if the user/i);
        const updateBankAccount = response.tools.find((tool) => tool.name === "brc_update_bank_account");
        assert.ok(updateBankAccount?.description?.includes("An unconfirmed call returns a plain-English change preview. Explicit confirmation is required before the update is applied."));
        assert.doesNotMatch(updateBankAccount?.description ?? "", /before calling this tool|show the user|ask for explicit confirmation/i);
    }
    finally {
        await client.close();
        await mcpServer.close();
        await clientTransport.close();
        await serverTransport.close();
    }
});
test("representative tool annotations match audited behavior", () => {
    assert.deepEqual(TOOL_ANNOTATIONS.brc_list_customers, {
        readOnlyHint: true, openWorldHint: false, destructiveHint: false,
    });
    assert.deepEqual(TOOL_ANNOTATIONS.brc_create_customer, {
        readOnlyHint: false, openWorldHint: false, destructiveHint: false,
    });
    assert.deepEqual(TOOL_ANNOTATIONS.brc_update_customer, {
        readOnlyHint: false, openWorldHint: false, destructiveHint: true,
    });
    assert.deepEqual(TOOL_ANNOTATIONS.brc_delete_customer, {
        readOnlyHint: false, openWorldHint: false, destructiveHint: true,
    });
    assert.deepEqual(TOOL_ANNOTATIONS.brc_clear_all_company_api_keys, {
        readOnlyHint: false, openWorldHint: false, destructiveHint: true,
    });
    assert.deepEqual(TOOL_ANNOTATIONS.brc_send_sales_invoice_email, {
        readOnlyHint: false, openWorldHint: true, destructiveHint: true,
    });
});
test("registration fails closed when a tool has no annotation entry", () => {
    const filtered = createFilteredServer({
        registerTool() { },
    });
    assert.throws(() => filtered.tool("brc_unannotated_test_tool", "test", async () => ({ content: [] })), /no complete metadata entry/i);
});
test("Claude catalogue omits redundant getting_started and company_options tools", () => {
    assert.equal(registeredTools.has("brc_getting_started"), false);
    assert.equal(registeredTools.has("brc_get_company_options"), false);
    assert.ok(registeredTools.has("brc_start_company_connection"));
    assert.ok(registeredTools.has("brc_confirm_company_connection"));
    assert.ok(registeredTools.has("brc_list_company_contexts"));
    assert.ok(registeredTools.has("brc_route_request"));
    assert.ok(registeredTools.has("brc_red_help"));
    assert.ok(registeredTools.has("brc_find_help_resources"));
    assert.ok(registeredTools.has("brc_resolve_book_transaction_type"));
    assert.ok(registeredTools.has("brc_generate_support_report"));
    assert.equal(enabledToolCount, 159);
});
function deferredSearchScore(description, query) {
    const haystack = description.toLowerCase();
    const needle = query.toLowerCase().trim();
    let score = 0;
    if (haystack.includes(needle)) {
        score += 100;
    }
    const tokens = needle.split(/[^a-z0-9_]+/i).filter((token) => token.length > 1);
    for (const token of tokens) {
        if (haystack.includes(token.toLowerCase())) {
            score += 2;
        }
    }
    return score;
}
function assertGatewayOutranksNewestTools(query, gatewayTool) {
    const gateway = registeredTools.get(gatewayTool);
    const support = registeredTools.get("brc_generate_support_report");
    const bookType = registeredTools.get("brc_resolve_book_transaction_type");
    assert.ok(gateway, `expected ${gatewayTool} to be registered`);
    assert.ok(support, "expected brc_generate_support_report to remain registered");
    assert.ok(bookType, "expected brc_resolve_book_transaction_type to remain registered");
    const gatewayScore = deferredSearchScore(gateway.description, query);
    const supportScore = deferredSearchScore(support.description, query);
    const bookTypeScore = deferredSearchScore(bookType.description, query);
    assert.ok(gatewayScore > supportScore, `${gatewayTool} should outrank brc_generate_support_report for "${query}" (${gatewayScore} vs ${supportScore})`);
    assert.ok(gatewayScore > bookTypeScore, `${gatewayTool} should outrank brc_resolve_book_transaction_type for "${query}" (${gatewayScore} vs ${bookTypeScore})`);
}
test("gateway tool descriptions outrank newest tools for Claude deferred connection queries", () => {
    assertGatewayOutranksNewestTools("connect my companies", "brc_start_company_connection");
    assertGatewayOutranksNewestTools("secure Red connection flow", "brc_start_company_connection");
    assertGatewayOutranksNewestTools("confirm company connection", "brc_confirm_company_connection");
    assertGatewayOutranksNewestTools("finish connection", "brc_confirm_company_connection");
    assertGatewayOutranksNewestTools("which companies are connected", "brc_list_company_contexts");
    assertGatewayOutranksNewestTools("show connected companies", "brc_list_company_contexts");
    assertGatewayOutranksNewestTools("connected-company contexts", "brc_list_company_contexts");
    assertGatewayOutranksNewestTools("create a sales invoice", "brc_route_request");
    assertGatewayOutranksNewestTools("how do I add a customer", "brc_red_help");
});
test("brc_start_company_connection description contains factual deferred-search wording", () => {
    const tool = registeredTools.get("brc_start_company_connection");
    assert.ok(tool);
    assert.match(tool.description, /secure Red \/ Big Red Cloud connection flow/i);
    assert.match(tool.description, /one or multiple companies/i);
    assert.match(tool.description, /one-time connection page URL/i);
    assert.equal(tool.schema.companyName, undefined);
});
test("brc_red_help description is discoverable for Big Red Cloud how-to questions", () => {
    const tool = registeredTools.get("brc_red_help");
    assert.ok(tool);
    assert.match(tool.description, /Big Red Cloud help/i);
    assert.match(tool.description, /how-to questions/i);
    assert.match(tool.description, /how do I/i);
    assert.match(tool.description, /tutorial/i);
});
test("every enabled credential-requiring tool schema includes optional connectionRef", () => {
    const missing = [];
    for (const [toolName, tool] of registeredTools) {
        if (!isToolEnabled(toolName)) {
            continue;
        }
        if (CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has(toolName)) {
            continue;
        }
        if (!tool.schema) {
            missing.push(`${toolName} (no schema — 2-arg registration)`);
            continue;
        }
        if (!schemaHasOptionalConnectionRef(tool.schema)) {
            missing.push(toolName);
        }
    }
    assert.deepEqual(missing, [], `tools missing optional connectionRef in schema: ${missing.join(", ")}`);
});
test("credential-requiring tools include companyName or connection-oriented inputs", () => {
    const credentialTools = Array.from(registeredTools.entries()).filter(([toolName]) => isToolEnabled(toolName) && !CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has(toolName));
    assert.ok(credentialTools.length > 0);
    for (const [toolName, tool] of credentialTools) {
        assert.ok(tool.schema, `expected ${toolName} to register with a schema`);
        assert.ok(schemaHasOptionalConnectionRef(tool.schema), `expected ${toolName} to include optional connectionRef`);
    }
});
