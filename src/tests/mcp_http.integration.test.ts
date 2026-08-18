import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { getFreePort, startHttpTestServer } from "./http_test_server.js";

async function startTestServer(t: TestContext, port: number) {
  return startHttpTestServer(t, port);
}

test("POST /mcp without initialize returns a safe JSON-RPC error", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });

  assert.equal(response.status, 400);

  const body = await response.json() as {
    jsonrpc: string;
    error: {
      code: number;
      message: string;
    };
    id: null;
  };

  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error.code, -32000);
  assert.match(body.error.message, /initialize/i);
  assert.equal(body.id, null);
});

test("GET /mcp without a session returns a safe JSON-RPC error", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(`http://127.0.0.1:${port}/mcp`);

  assert.equal(response.status, 400);

  const body = await response.json() as {
    jsonrpc: string;
    error: {
      code: number;
      message: string;
    };
    id: null;
  };

  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error.code, -32000);
  assert.match(body.error.message, /No valid session/i);
});

test("GET /connect with invalid code returns expired-link page and no secrets", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(`http://127.0.0.1:${port}/connect?code=invalid-code`);

  assert.equal(response.status, 400);

  const body = await response.text();

  assert.match(body, /fresh company connection/i);
  assert.match(body, /do not reuse an old connection link/i);
  assert.equal(body.includes("RED_CONNECT_COSMOS_CONNECTION_STRING"), false);
  assert.equal(body.includes("RED_CONNECT_ENCRYPTION_KEY"), false);
  assert.equal(body.includes("apiKey"), false);
});
