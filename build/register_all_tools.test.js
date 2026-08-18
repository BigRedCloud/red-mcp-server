import assert from "node:assert/strict";
import test from "node:test";
import { isToolEnabled, getToolSkillGroup } from "./config/server_config.js";
import { CONNECTION_REF_SCHEMA_EXEMPT_TOOLS, registerAllTools, } from "./register_all_tools.js";
function captureRegisteredTools() {
    const tools = new Map();
    const recorder = {
        tool(name, description, schemaOrHandler, handler) {
            if (typeof schemaOrHandler === "function") {
                tools.set(name, { description, schema: null });
                return;
            }
            tools.set(name, {
                description,
                schema: schemaOrHandler,
            });
            void handler;
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
    assert.match(tool.description, /never a shared secret/i);
});
test("brc_get_help_resource_details does not require company credentials", () => {
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_get_help_resource_details"));
    const tool = registeredTools.get("brc_get_help_resource_details");
    assert.ok(tool);
    assert.ok(tool.schema);
    assert.ok(tool.schema.resourceId);
});
test("brc_find_help_resources description requests concise synthesized answers", () => {
    const tool = registeredTools.get("brc_find_help_resources");
    assert.ok(tool);
    assert.match(tool.description, /concise synthesized answer/i);
    assert.match(tool.description, /customer documentation/i);
    assert.match(tool.description, /includeImages=true/i);
    assert.match(tool.description, /Sources section/i);
    assert.match(tool.description, /Still need help/i);
    assert.match(tool.description, /Articles/i);
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
    assertGatewayOutranksNewestTools("connect my companies to Red", "brc_start_company_connection");
    assertGatewayOutranksNewestTools("Use brc_start_company_connection", "brc_start_company_connection");
    assertGatewayOutranksNewestTools("confirm company connection", "brc_confirm_company_connection");
    assertGatewayOutranksNewestTools("finish connection", "brc_confirm_company_connection");
    assertGatewayOutranksNewestTools("which companies are connected", "brc_list_company_contexts");
    assertGatewayOutranksNewestTools("show connected companies", "brc_list_company_contexts");
    assertGatewayOutranksNewestTools("check existing Red company connections", "brc_list_company_contexts");
    assertGatewayOutranksNewestTools("create a sales invoice", "brc_route_request");
    assertGatewayOutranksNewestTools("how do I add a customer", "brc_red_help");
});
test("brc_start_company_connection description contains strong deferred-search wording", () => {
    const tool = registeredTools.get("brc_start_company_connection");
    assert.ok(tool);
    assert.match(tool.description, /MANDATORY FIRST TOOL/i);
    assert.match(tool.description, /connect my companies to Red/i);
    assert.match(tool.description, /works before any company is connected/i);
    assert.match(tool.description, /does not require companyName or connectionRef/i);
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
