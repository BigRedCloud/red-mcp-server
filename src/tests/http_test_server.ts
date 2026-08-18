/**
 * Shared HTTP test-server helper for spawned `build/remote.js` integration tests.
 * Test-only — does not change production HTTP behaviour.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import net from "node:net";
import type { TestContext } from "node:test";
import type { Readable } from "node:stream";

const SERVER_READY_LOG_MARKER = "BRC MCP server";
const DEFAULT_SERVER_START_TIMEOUT_MS = 30_000;
const CHILD_STOP_TIMEOUT_MS = 3_000;

export type HttpTestServerChild = ChildProcessByStdio<null, Readable, Readable>;

export async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
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

function formatCapturedOutput(stdout: string, stderr: string): string {
  return [
    "--- stdout ---",
    stdout.trim() ? stdout : "(empty)",
    "--- stderr ---",
    stderr.trim() ? stderr : "(empty)",
  ].join("\n");
}

function stopChildProcess(child: HttpTestServerChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };

    child.once("exit", finish);

    const forceTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already gone.
      }
      finish();
    }, CHILD_STOP_TIMEOUT_MS);

    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

async function waitForServerReady(
  child: HttpTestServerChild,
  port: number,
  timeoutMs: number,
  stdoutRef: { text: string },
  stderrRef: { text: string },
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (stdoutRef.text.includes(SERVER_READY_LOG_MARKER) || stderrRef.text.includes(SERVER_READY_LOG_MARKER)) {
      return;
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        [
          `Server exited early (pid ${child.pid}, port ${port}, exitCode ${String(child.exitCode)}, signal ${String(child.signalCode)}).`,
          formatCapturedOutput(stdoutRef.text, stderrRef.text),
        ].join("\n"),
      );
    }

    if (await probeServerHttpReady(port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    [
      `Server did not start within ${timeoutMs}ms (pid ${child.pid}, port ${port}, exitCode ${String(child.exitCode)}).`,
      formatCapturedOutput(stdoutRef.text, stderrRef.text),
    ].join("\n"),
  );
}

export async function startHttpTestServer(
  t: TestContext,
  port: number,
  envOverrides: Record<string, string | undefined> = {},
  timeoutMs = DEFAULT_SERVER_START_TIMEOUT_MS,
): Promise<HttpTestServerChild> {
  const stdoutRef = { text: "" };
  const stderrRef = { text: "" };

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
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutRef.text += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderrRef.text += chunk;
  });
  child.on("error", (error) => {
    stderrRef.text += `\n[spawn error] ${error.message}\n`;
  });

  const spawnError = await new Promise<Error | null>((resolve) => {
    child.once("error", (error) => resolve(error));
    child.once("spawn", () => resolve(null));
  });

  t.after(async () => {
    await stopChildProcess(child);
  });

  if (spawnError) {
    throw new Error(
      [
        `Failed to spawn test server (port ${port}): ${spawnError.message}`,
        formatCapturedOutput(stdoutRef.text, stderrRef.text),
      ].join("\n"),
    );
  }

  try {
    await waitForServerReady(child, port, timeoutMs, stdoutRef, stderrRef);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return child;
}
