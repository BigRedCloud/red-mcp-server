import assert from "node:assert/strict";
import test from "node:test";
import { getToolSkillGroup, isToolEnabled } from "../../config/server_config.js";
import { CONNECTION_REF_SCHEMA_EXEMPT_TOOLS, registerAllTools, } from "../../register_all_tools.js";
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
test("brc_find_help_resources does not require company credentials", () => {
    assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_find_help_resources"));
    const tool = registeredTools.get("brc_find_help_resources");
    assert.ok(tool);
    assert.ok(tool.schema);
    assert.ok(tool.schema.question);
    assert.equal(tool.schema.companyName, undefined);
    assert.ok(!tool.description.toLowerCase().includes("companyname"));
});
test("brc_find_help_resources is a session help tool that stays enabled", () => {
    assert.equal(getToolSkillGroup("brc_find_help_resources"), "session");
    assert.equal(isToolEnabled("brc_find_help_resources"), true);
});
