import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import net from "node:net";
import test, { type TestContext } from "node:test";
import type { Readable } from "node:stream";

import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../edu/brc_edu_upload_store.js";

const SERVER_READY_LOG_MARKER = "BRC MCP server";
const SERVER_START_TIMEOUT_MS = 30_000;
const UPLOAD_PATH = "/internal/brc-edu/resources/upload";
const WORKBOOK_PATH = `${UPLOAD_PATH}/workbook`;
const WORKBOOK_DOWNLOAD_PATH = `${UPLOAD_PATH}/workbook/download`;

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

async function startTestServer(
  t: TestContext,
  port: number,
  envOverrides: Record<string, string | undefined> = {},
) {
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
  });

  t.after(() => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });

  await waitForServerReady(child, port);

  return child;
}

function uploadUrl(port: number, secret?: string): string {
  const base = `http://127.0.0.1:${port}${UPLOAD_PATH}`;
  if (!secret) {
    return base;
  }

  return `${base}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}

function workbookUrl(port: number, secret?: string): string {
  const base = `http://127.0.0.1:${port}${WORKBOOK_PATH}`;
  if (!secret) {
    return base;
  }

  return `${base}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}

function workbookDownloadUrl(port: number, secret?: string): string {
  const base = `http://127.0.0.1:${port}${WORKBOOK_DOWNLOAD_PATH}`;
  if (!secret) {
    return base;
  }

  return `${base}?${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}

function buildMultipartBody(
  fieldName: string,
  filename: string,
  content: Buffer,
  contentType: string,
): { body: Buffer; contentType: string } {
  const boundary = `----brc-edu-upload-${Date.now()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    body: Buffer.concat([preamble, content, closing]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function toFetchBody(buffer: Buffer, contentType: string): Blob {
  return new Blob([Uint8Array.from(buffer)], { type: contentType });
}

test("GET /internal/brc-edu/resources/upload returns 503 when admin secret is not configured", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "",
  });

  const response = await fetch(uploadUrl(port, "any-secret"));
  assert.equal(response.status, 503);
});

test("GET /internal/brc-edu/resources/upload returns 401 for missing or wrong secret", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
  });

  const missingSecretResponse = await fetch(uploadUrl(port));
  const wrongSecretResponse = await fetch(uploadUrl(port, "wrong-secret"));

  assert.equal(missingSecretResponse.status, 401);
  assert.equal(wrongSecretResponse.status, 401);
});

test("GET /internal/brc-edu/resources/upload returns form with correct secret", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
  });

  const response = await fetch(uploadUrl(port, "configured-secret"));
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /BRC Edu webinar resources/i);
  assert.match(html, /Refresh from Azure/i);
  assert.match(html, /Save &amp; Publish/i);
  assert.match(html, /multipart\/form-data/i);
  assert.match(html, /\.xlsx/);
  assert.match(html, /\.csv/);
  assert.match(html, /5 MB/);
  assert.match(html, /name="file"/);
});

test("workbook admin endpoints require admin secret", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
  });

  const missingGet = await fetch(workbookUrl(port));
  const wrongGet = await fetch(workbookUrl(port, "wrong-secret"));
  const missingDownload = await fetch(workbookDownloadUrl(port));
  const wrongDownload = await fetch(workbookDownloadUrl(port, "wrong-secret"));
  const missingPut = await fetch(workbookUrl(port), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: [] }),
  });
  const wrongPut = await fetch(workbookUrl(port, "wrong-secret"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: [] }),
  });

  assert.equal(missingGet.status, 401);
  assert.equal(wrongGet.status, 401);
  assert.equal(missingDownload.status, 401);
  assert.equal(wrongDownload.status, 401);
  assert.equal(missingPut.status, 401);
  assert.equal(wrongPut.status, 401);
});

test("GET workbook returns 503 when upload storage is not configured", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
  });

  const response = await fetch(workbookUrl(port, "configured-secret"));
  assert.equal(response.status, 503);

  const body = (await response.json()) as { error: string };
  assert.match(body.error, /not configured/i);
  assert.equal(body.error.includes("configured-secret"), false);
});

test("POST /internal/brc-edu/resources/upload rejects missing or wrong secret", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
  });

  const csv = Buffer.from("Video Title,Video URL,Help-Routing Category\n");
  const multipart = buildMultipartBody("file", "webinar_video_routing_index.csv", csv, "text/csv");

  const missingSecretResponse = await fetch(uploadUrl(port), {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
    },
    body: toFetchBody(multipart.body, multipart.contentType),
  });

  const wrongSecretResponse = await fetch(uploadUrl(port, "wrong-secret"), {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
    },
    body: toFetchBody(multipart.body, multipart.contentType),
  });

  assert.equal(missingSecretResponse.status, 401);
  assert.equal(wrongSecretResponse.status, 401);
});

test("POST /internal/brc-edu/resources/upload rejects missing file", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
  });

  const boundary = "----brc-edu-empty";
  const response = await fetch(uploadUrl(port, "configured-secret"), {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body: `--${boundary}--\r\n`,
  });

  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /required/i);
});

test("POST /internal/brc-edu/resources/upload rejects invalid file type", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
    BRC_EDU_UPLOAD_CONTAINER: "brc-edu-uploads",
  });

  const multipart = buildMultipartBody(
    "file",
    "notes.txt",
    Buffer.from("hello"),
    "text/plain",
  );

  const response = await fetch(uploadUrl(port, "configured-secret"), {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
    },
    body: toFetchBody(multipart.body, multipart.contentType),
  });

  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /\.xlsx and \.csv/i);
});

test("POST /internal/brc-edu/resources/upload rejects file over 5MB", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
    BRC_EDU_UPLOAD_CONTAINER: "brc-edu-uploads",
  });

  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
  const multipart = buildMultipartBody(
    "file",
    "webinar_video_routing_index.csv",
    oversized,
    "text/csv",
  );

  const response = await fetch(uploadUrl(port, "configured-secret"), {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
    },
    body: toFetchBody(multipart.body, multipart.contentType),
  });

  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /5 MB/i);
});

test("GET and POST /internal/brc-edu/resources/upload do not log secrets in server output", async (t) => {
  const port = await getFreePort();
  const secret = "integration-upload-secret-value";

  const child = await startTestServer(t, port, {
    BRC_EDU_ADMIN_UPLOAD_SECRET: secret,
  });

  await fetch(uploadUrl(port, secret));
  await fetch(uploadUrl(port, "wrong-secret"));

  const csv = Buffer.from("Video Title,Video URL,Help-Routing Category\n");
  const multipart = buildMultipartBody("file", "webinar_video_routing_index.csv", csv, "text/csv");

  await fetch(uploadUrl(port, secret), {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
    },
    body: toFetchBody(multipart.body, multipart.contentType),
  });

  await fetch(uploadUrl(port, "wrong-secret"), {
    method: "POST",
    headers: {
      "content-type": multipart.contentType,
    },
    body: toFetchBody(multipart.body, multipart.contentType),
  });

  const output = await new Promise<string>((resolve) => {
    let combined = "";
    child.stdout.on("data", (chunk) => {
      combined += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      combined += chunk.toString();
    });
    setTimeout(() => resolve(combined), 250);
  });

  assert.equal(output.includes(secret), false);
  assert.equal(output.includes(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY), false);
});
