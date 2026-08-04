import assert from "node:assert/strict";
import test from "node:test";

import { createBrcMcpServer } from "../../server.js";
import { registerAllTools } from "../../register_all_tools.js";
import {
  OPEN_EDU_ADMIN_TOOL_DESCRIPTION,
  registerEduAdminTools,
} from "./edu_admin_tools.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../../edu/brc_edu_upload_store.js";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

test("brc_open_edu_admin description forbids exposing the admin secret", () => {
  assert.match(OPEN_EDU_ADMIN_TOOL_DESCRIPTION, /never a shared secret/i);
  assert.match(OPEN_EDU_ADMIN_TOOL_DESCRIPTION, /Does not bypass authentication/i);
  assert.match(OPEN_EDU_ADMIN_TOOL_DESCRIPTION, /BRC_EDU_ADMIN_UPLOAD_SECRET/);
});

test("brc_open_edu_admin only returns the protected URL without secrets", async () => {
  restoreEnv();
  process.env.BRC_EDU_ADMIN_PUBLIC_URL =
    "https://red.example.com/internal/brc-edu/admin";
  process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "must-never-appear-in-mcp-output";

  const server = createBrcMcpServer();
  const registered = new Map<
    string,
    {
      description: string;
      handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
    }
  >();

  const originalTool = server.tool.bind(server) as (...args: any[]) => unknown;
  (server as { tool: (...args: any[]) => unknown }).tool = (
    toolName: string,
    ...args: unknown[]
  ) => {
    if (args.length === 2) {
      const [description, handler] = args as [
        string,
        (toolArgs: Record<string, unknown>) => Promise<unknown> | unknown,
      ];
      registered.set(toolName, { description, handler });
    } else if (args.length >= 3) {
      const [description, , handler] = args as [
        string,
        Record<string, unknown>,
        (toolArgs: Record<string, unknown>) => Promise<unknown> | unknown,
      ];
      registered.set(toolName, { description, handler });
    }

    return originalTool(toolName, ...args);
  };

  registerEduAdminTools(server as never);

  const tool = registered.get("brc_open_edu_admin");
  assert.ok(tool);

  const result = (await tool!.handler({})) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = result.content.map((part) => part.text).join("\n");
  const parsed = JSON.parse(text) as {
    adminUrl: string;
    protectedPath: string;
    customerFacingMarkdown: string;
  };

  assert.equal(
    parsed.adminUrl,
    "https://red.example.com/internal/brc-edu/admin",
  );
  assert.equal(parsed.protectedPath, "/internal/brc-edu/admin");
  assert.match(parsed.customerFacingMarkdown, /\[Open Red's BRC Edu admin page\]/);
  assert.equal(text.includes("must-never-appear-in-mcp-output"), false);
  assert.equal(text.includes(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY), false);
  assert.equal(text.includes("?secret="), false);
});

test("registerAllTools includes brc_open_edu_admin", () => {
  const server = createBrcMcpServer();
  const names = new Set<string>();

  const originalTool = server.tool.bind(server) as (...args: any[]) => unknown;
  (server as { tool: (...args: any[]) => unknown }).tool = (
    toolName: string,
    ...args: unknown[]
  ) => {
    names.add(toolName);
    return originalTool(toolName, ...args);
  };

  registerAllTools(server);
  assert.equal(names.has("brc_open_edu_admin"), true);
});
