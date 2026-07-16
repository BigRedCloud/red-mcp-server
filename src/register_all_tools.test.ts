import assert from "node:assert/strict";
import test from "node:test";

import { isToolEnabled } from "./config/server_config.js";
import {
  CONNECTION_REF_SCHEMA_EXEMPT_TOOLS,
  registerAllTools,
} from "./register_all_tools.js";

type CapturedTool = {
  description: string;
  schema: Record<string, unknown> | null;
};

function captureRegisteredTools(): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();

  const recorder = {
    tool(name: string, description: string, schemaOrHandler: unknown, handler?: unknown) {
      if (typeof schemaOrHandler === "function") {
        tools.set(name, { description, schema: null });
        return;
      }

      tools.set(name, {
        description,
        schema: schemaOrHandler as Record<string, unknown>,
      });
      void handler;
    },
    resource() {},
    registerResource() {},
    prompt() {},
    registerPrompt() {},
  };

  registerAllTools(recorder as never);
  return tools;
}

const registeredTools = captureRegisteredTools();
const enabledToolCount = [...registeredTools.keys()].filter((toolName) =>
  isToolEnabled(toolName),
).length;

function schemaHasOptionalConnectionRef(schema: Record<string, unknown>): boolean {
  const field = schema.connectionRef as { isOptional?: () => boolean } | undefined;
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

test("register_all_tools includes brc_get_help_resource_details", () => {
  assert.ok(registeredTools.has("brc_get_help_resource_details"));
  assert.equal(isToolEnabled("brc_get_help_resource_details"), true);
});

test("brc_get_help_resource_details does not require company credentials", () => {
  assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_get_help_resource_details"));

  const tool = registeredTools.get("brc_get_help_resource_details");
  assert.ok(tool);
  assert.ok(tool.schema);
  assert.ok(tool.schema!.resourceId);
});

test("brc_find_help_resources description requests concise synthesized answers", () => {
  const tool = registeredTools.get("brc_find_help_resources");
  assert.ok(tool);
  assert.match(tool.description, /concise synthesized answer/i);
  assert.match(tool.description, /customer documentation/i);
  assert.match(tool.description, /support contact footer/i);
});

test("brc_find_help_resources does not require company credentials", () => {
  assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has("brc_find_help_resources"));

  const tool = registeredTools.get("brc_find_help_resources");
  assert.ok(tool);
  assert.ok(tool.schema);
  assert.ok(tool.schema!.question);
  assert.equal(tool.schema!.companyName, undefined);
});

test("adding brc_find_help_resources does not reduce registered enabled tools unexpectedly", () => {
  assert.ok(registeredTools.has("brc_start_company_connection"));
  assert.ok(registeredTools.has("brc_confirm_company_connection"));
  assert.ok(registeredTools.has("brc_list_company_contexts"));
  assert.ok(registeredTools.has("brc_clear_company_api_key"));
  assert.ok(registeredTools.has("brc_clear_all_company_api_keys"));
  assert.ok(registeredTools.has("brc_find_help_resources"));
  assert.ok(registeredTools.has("brc_get_help_resource_details"));
  assert.ok(enabledToolCount >= 150);
});

test("every enabled credential-requiring tool schema includes optional connectionRef", () => {
  const missing: string[] = [];

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

  assert.deepEqual(
    missing,
    [],
    `tools missing optional connectionRef in schema: ${missing.join(", ")}`
  );
});

test("credential-requiring tools include companyName or connection-oriented inputs", () => {
  const credentialTools = Array.from(registeredTools.entries()).filter(
    ([toolName]) =>
      isToolEnabled(toolName) && !CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has(toolName)
  );

  assert.ok(credentialTools.length > 0);

  for (const [toolName, tool] of credentialTools) {
    assert.ok(tool.schema, `expected ${toolName} to register with a schema`);
    assert.ok(
      schemaHasOptionalConnectionRef(tool.schema!),
      `expected ${toolName} to include optional connectionRef`
    );
  }
});
