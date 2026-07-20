import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createBrcMcpServer } from "../../server.js";
import {
  CONNECTION_REF_SCHEMA_EXEMPT_TOOLS,
  registerAllTools,
} from "../../register_all_tools.js";
import { isToolEnabled, getToolSkillGroup } from "../../config/server_config.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../../edu/brc_edu_upload_store.js";
import {
  OPEN_EDU_ADMIN_TOOL_DESCRIPTION,
  OPEN_EDU_ADMIN_TOOL_NAME,
  OPEN_EDU_ADMIN_TRIGGER_PHRASES,
  buildOpenEduAdminMarkdownLink,
  registerEduAdminTools,
  selectOpenEduAdminToolForUserMessage,
} from "./edu_admin_tools.js";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

type CapturedTool = {
  description: string;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

function captureTools(
  register: (server: ReturnType<typeof createBrcMcpServer>) => void,
): Map<string, CapturedTool> {
  const server = createBrcMcpServer();
  const registered = new Map<string, CapturedTool>();

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

  register(server);
  return registered;
}

test("brc_open_edu_admin description includes required trigger phrases", () => {
  for (const phrase of OPEN_EDU_ADMIN_TRIGGER_PHRASES) {
    assert.ok(
      OPEN_EDU_ADMIN_TOOL_DESCRIPTION.includes(phrase),
      `Description should include trigger phrase: ${phrase}`,
    );
  }

  assert.match(OPEN_EDU_ADMIN_TOOL_DESCRIPTION, /never a shared secret/i);
  assert.match(OPEN_EDU_ADMIN_TOOL_DESCRIPTION, /Does not bypass authentication/i);
  assert.match(OPEN_EDU_ADMIN_TOOL_DESCRIPTION, /BRC_EDU_ADMIN_UPLOAD_SECRET/);
  assert.match(
    OPEN_EDU_ADMIN_TOOL_DESCRIPTION,
    /Do not ask whether the user means Big Red Cloud website login or connecting a company/i,
  );
});

test("brc_open_edu_admin is selected for each required trigger phrase", () => {
  for (const phrase of OPEN_EDU_ADMIN_TRIGGER_PHRASES) {
    assert.equal(
      selectOpenEduAdminToolForUserMessage(phrase),
      OPEN_EDU_ADMIN_TOOL_NAME,
      `Expected selection for: ${phrase}`,
    );
  }

  assert.equal(
    selectOpenEduAdminToolForUserMessage("Open Red's admin page"),
    OPEN_EDU_ADMIN_TOOL_NAME,
  );
  assert.equal(
    selectOpenEduAdminToolForUserMessage("Please open the BRC Edu admin page now"),
    OPEN_EDU_ADMIN_TOOL_NAME,
  );
  assert.equal(
    selectOpenEduAdminToolForUserMessage("connect my company"),
    null,
  );
  assert.equal(
    selectOpenEduAdminToolForUserMessage("how do I add a customer?"),
    null,
  );
});

test("brc_open_edu_admin is registered, enabled, and discoverable via registerAllTools", () => {
  const registered = captureTools(registerAllTools);

  assert.ok(registered.has(OPEN_EDU_ADMIN_TOOL_NAME));
  assert.equal(isToolEnabled(OPEN_EDU_ADMIN_TOOL_NAME), true);
  assert.equal(getToolSkillGroup(OPEN_EDU_ADMIN_TOOL_NAME), "session");
  assert.ok(CONNECTION_REF_SCHEMA_EXEMPT_TOOLS.has(OPEN_EDU_ADMIN_TOOL_NAME));

  const tool = registered.get(OPEN_EDU_ADMIN_TOOL_NAME)!;
  for (const phrase of OPEN_EDU_ADMIN_TRIGGER_PHRASES) {
    assert.ok(tool.description.includes(phrase));
  }
});

test("brc_open_edu_admin stays enabled when read/update/delete/email/batch flags are off", () => {
  const script = `
    const mod = await import("./build/config/server_config.js");
    console.log(JSON.stringify({
      enabled: mod.isToolEnabled("brc_open_edu_admin"),
      group: mod.getToolSkillGroup("brc_open_edu_admin"),
    }));
  `;

  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRC_ALLOW_READ_SKILLS: "false",
      BRC_ALLOW_UPDATE_SKILLS: "false",
      BRC_ALLOW_DELETE_SKILLS: "false",
      BRC_ALLOW_EMAIL_SKILLS: "false",
      BRC_ALLOW_BATCH_SKILLS: "false",
      BRC_ALLOW_DEV_MODE: "false",
    },
    encoding: "utf8",
  });

  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim()) as {
    enabled: boolean;
    group: string;
  };
  assert.equal(result.group, "session");
  assert.equal(result.enabled, true);
});

test("brc_open_edu_admin returns only protected URL Markdown and never the admin secret", async () => {
  restoreEnv();
  process.env.BRC_EDU_ADMIN_PUBLIC_URL =
    "https://red.example.com/internal/brc-edu/resources/upload";
  process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "must-never-appear-in-mcp-output";

  const registered = captureTools(registerEduAdminTools);
  const tool = registered.get(OPEN_EDU_ADMIN_TOOL_NAME);
  assert.ok(tool);

  const result = (await tool!.handler({})) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = result.content.map((part) => part.text).join("\n").trim();
  const expected = buildOpenEduAdminMarkdownLink(
    "https://red.example.com/internal/brc-edu/resources/upload",
  );

  assert.equal(text, expected);
  assert.equal(text.includes("must-never-appear-in-mcp-output"), false);
  assert.equal(text.includes(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY), false);
  assert.equal(text.includes("?secret="), false);
  assert.equal(text.includes("{"), false);
});
