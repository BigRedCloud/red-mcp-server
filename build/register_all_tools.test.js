import assert from "node:assert/strict";
import test from "node:test";
import { isToolEnabled } from "./config/server_config.js";
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
function schemaHasOptionalConnectionRef(schema) {
    const field = schema.connectionRef;
    if (!field) {
        return false;
    }
    return typeof field.isOptional === "function" ? field.isOptional() : true;
}
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
