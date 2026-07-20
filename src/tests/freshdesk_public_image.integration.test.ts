import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import net from "node:net";
import type { Readable } from "node:stream";

import { GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION } from "../tools/edu/help_resources_tools.js";

const SERVER_READY_LOG_MARKER = "BRC MCP server";
const SERVER_START_TIMEOUT_MS = 30_000;

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port."));
        return;
      }

      const port = address.port;
      server.close(() => resolve(port));
    });

    server.on("error", reject);
  });
}

async function probeServerHttpReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "GET",
      signal: AbortSignal.timeout(750),
    });

    return response.status === 400;
  } catch {
    return false;
  }
}

async function waitForServerReady(
  child: ChildProcessByStdio<null, Readable, Readable>,
  port: number,
  timeoutMs = SERVER_START_TIMEOUT_MS,
): Promise<void> {
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (output.includes(SERVER_READY_LOG_MARKER)) {
      return;
    }

    if (child.exitCode !== null) {
      throw new Error(`Server exited early:\n${output}`);
    }

    if (await probeServerHttpReady(port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Server did not start within ${timeoutMs}ms:\n${output}`);
}

async function startTestServer(t: TestContext, port: number) {
  const child = spawn(process.execPath, ["build/remote.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      RED_CONNECT_CONNECTION_STORE: "memory",
      RED_CONNECT_SESSION_DEBUG: "false",
      APPLICATIONINSIGHTS_CONNECTION_STRING: "",
      BRC_RATE_LIMIT_REQUESTS_PER_MINUTE: "1000",
      BRC_ALLOW_DEV_MODE: "false",
      BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET: "integration-test-secret",
      RED_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });

  await waitForServerReady(child, port);
  return child;
}

test("GET public Freshdesk image route rejects invalid token without Azure details", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(
    `http://127.0.0.1:${port}/public/brc-edu/freshdesk-images/1001/invalid.token.value`,
  );

  assert.equal(response.status, 404);
  const body = await response.text();
  assert.equal(body, "");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(body.includes("blob.core.windows.net"), false);
  assert.equal(body.includes("AccountKey="), false);
  assert.equal(body.includes("sig="), false);
});

test("HEAD public Freshdesk image route is available without company credentials", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(
    `http://127.0.0.1:${port}/public/brc-edu/freshdesk-images/1001/invalid.token.value`,
    { method: "HEAD" },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("help resource details tool guidance prefers Markdown links and prohibits Show Image", () => {
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /instructionBlocks/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /customerFacingScreenshotMarkdown/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /imagePresentation='links'/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /Never label screenshot links Show Image/i);
  assert.match(
    GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    /exact signed Markdown links/i,
  );
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /Do not merely describe the screenshots/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /bigredcloud\.freshdesk\.com/i);
  assert.doesNotMatch(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /View screenshot/i);
});
