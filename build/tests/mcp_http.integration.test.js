import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";
async function getFreePort() {
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
async function waitForServerReady(child, timeoutMs = 10_000) {
    let output = "";
    child.stdout.on("data", (chunk) => {
        output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
        output += chunk.toString();
    });
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (output.includes("BRC MCP server")) {
            return;
        }
        if (child.exitCode !== null) {
            throw new Error(`Server exited early:\n${output}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start within ${timeoutMs}ms:\n${output}`);
}
async function startTestServer(t, port) {
    const child = spawn(process.execPath, ["build/remote.js"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            PORT: String(port),
            RED_CONNECT_CONNECTION_STORE: "memory",
            BRC_RATE_LIMIT_REQUESTS_PER_MINUTE: "1000",
            BRC_ALLOW_DEV_MODE: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => {
        if (!child.killed) {
            child.kill("SIGTERM");
        }
    });
    await waitForServerReady(child);
    return child;
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
    const body = await response.json();
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
    const body = await response.json();
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
