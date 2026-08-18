import assert from "node:assert/strict";
import test from "node:test";
import { getBrcMcpServerInstructions, } from "../../config/mcp_config.js";
import { registerAllTools } from "../../register_all_tools.js";
import { buildUnifiedFindHelpResourcesResponse } from "./unified-help-search.js";
import { ensureRedHelpQueryForUnifiedSearch, RED_HELP_TOOL_DESCRIPTION, RED_HELP_TOOL_TITLE, } from "../../tools/edu/help_resources_tools.js";
import { isTransactionalAccountingToolName, simulateRedHelpToolSelection, } from "./red-help-tool-selection.js";
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
const instructions = getBrcMcpServerInstructions(50, false);
const discoverableTools = [...registeredTools.entries()].map(([name, tool]) => ({
    name,
    description: tool.description,
}));
test("brc_red_help is registered with red-help discovery metadata", () => {
    assert.ok(registeredTools.has("brc_red_help"));
    const tool = registeredTools.get("brc_red_help");
    assert.match(tool.description, /red-help/i);
    assert.match(tool.description, /^MANDATORY FOR RED-HELP COMMANDS:/);
    assert.match(tool.description, /Red Help — Manual Instructions and Resources/);
    assert.equal(tool.description, RED_HELP_TOOL_DESCRIPTION);
    assert.match(RED_HELP_TOOL_TITLE, /Red Help/);
});
test("brc_red_help description includes sales invoice, customer, and manual-help terms", () => {
    const tool = registeredTools.get("brc_red_help");
    assert.match(tool.description, /sales invoice/i);
    assert.match(tool.description, /customer/i);
    assert.match(tool.description, /manual instructions/i);
    assert.match(tool.description, /help article/i);
    assert.match(tool.description, /tutorial/i);
    assert.match(tool.description, /screenshots/i);
    assert.match(tool.description, /bank reconciliation/i);
    assert.match(tool.description, /purchase invoice/i);
    assert.match(tool.description, /supplier/i);
    assert.match(tool.description, /credit note/i);
    assert.match(tool.description, /payment/i);
    assert.match(tool.description, /receipt/i);
    assert.match(tool.description, /VAT/i);
    assert.match(tool.description, /reports/i);
    assert.match(tool.description, /company setup/i);
    assert.match(tool.description, /Freshdesk/i);
    assert.match(tool.description, /YouTube/i);
    assert.match(tool.description, /BRC Edu/i);
    assert.match(tool.description, /webinars/i);
    assert.match(tool.description, /Big Red Cloud help/i);
    assert.match(tool.description, /how-to questions/i);
    assert.match(tool.description, /never replace a red-help request with create, update, delete or post tools/i);
    assert.match(tool.description, /brc_red_help\(\{ query: "how do I add a sales invoice" \}\)/);
});
test("brc_red_help schema only requires query", () => {
    const tool = registeredTools.get("brc_red_help");
    assert.ok(tool.schema);
    assert.deepEqual(Object.keys(tool.schema), ["query"]);
    assert.equal(tool.schema.companyName, undefined);
    assert.equal(tool.schema.connectionRef, undefined);
    assert.equal(tool.schema.question, undefined);
});
test("brc_find_help_resources remains registered as compatibility alias", () => {
    assert.ok(registeredTools.has("brc_find_help_resources"));
    const tool = registeredTools.get("brc_find_help_resources");
    assert.match(tool.description, /prefer brc_red_help/i);
    assert.match(tool.description, /backward compatibility/i);
});
test("MCP server instructions begin with request routing override", () => {
    assert.ok(instructions.startsWith("MANDATORY ROUTING:"));
    assert.match(instructions, /REQUEST ROUTING \(mandatory\)/i);
    assert.match(instructions, /RED-HELP SHORTCUT/i);
    assert.match(instructions, /brc_route_request/i);
    assert.match(instructions, /brc_red_help/i);
    assert.match(instructions, /routeToken/i);
    assert.match(instructions, /Do not let add\/create\/post\/update force action mode/i);
    assert.match(instructions, /classifiers alone cannot force tool selection|MCP clients select/i);
});
test("ensureRedHelpQueryForUnifiedSearch forces help mode for cleaned non-how-to queries", () => {
    // Cleaned text after red-help (no how-to phrase) must still enter help mode.
    assert.equal(ensureRedHelpQueryForUnifiedSearch("add a customer manually"), "red-help add a customer manually");
    // How-to wording is already help mode — no red-help prefix required.
    assert.equal(ensureRedHelpQueryForUnifiedSearch("how do I add a sales invoice"), "how do I add a sales invoice");
    assert.equal(ensureRedHelpQueryForUnifiedSearch("red-help how do I add a customer"), "red-help how do I add a customer");
});
test("brc_red_help delegates to unified help pipeline with blockTransactionalTools", () => {
    const question = ensureRedHelpQueryForUnifiedSearch("how do I add a sales invoice");
    const response = buildUnifiedFindHelpResourcesResponse(question, { freshdeskArticles: [] }, { maxResults: 5 });
    assert.equal(response.helpMode, true);
    assert.equal(response.blockTransactionalTools, true);
    assert.equal(response.question, "how do I add a sales invoice");
});
test("tool-selection harness: red-help how do I add a sales invoice → brc_red_help", () => {
    const selected = simulateRedHelpToolSelection("red-help how do I add a sales invoice", discoverableTools, instructions);
    assert.equal(selected, "brc_red_help");
    assert.equal(isTransactionalAccountingToolName(selected), false);
    const createInvoice = discoverableTools.find((tool) => /create.*sales.*invoice|sales_invoice/i.test(tool.name));
    assert.ok(createInvoice, "expected a transactional sales invoice tool to exist for contrast");
    assert.notEqual(selected, createInvoice.name);
});
test("tool-selection harness: RED-HELP: how do I add a customer → brc_red_help", () => {
    const selected = simulateRedHelpToolSelection("RED-HELP: how do I add a customer", discoverableTools, instructions);
    assert.equal(selected, "brc_red_help");
});
test("tool-selection harness: /red-help reconcile my bank → brc_red_help", () => {
    const selected = simulateRedHelpToolSelection("/red-help reconcile my bank", discoverableTools, instructions);
    assert.equal(selected, "brc_red_help");
});
test("tool-selection harness does not select help tool for ordinary create requests", () => {
    assert.equal(simulateRedHelpToolSelection("create a sales invoice", discoverableTools, instructions), null);
});
