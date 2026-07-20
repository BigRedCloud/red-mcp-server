import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";
import { BRC_EDU_SYNC_SECRET_HEADER } from "../edu/brc_edu_synced_store.js";
const SERVER_READY_LOG_MARKER = "BRC MCP server";
const SERVER_START_TIMEOUT_MS = 60_000;
const SYNC_PATH = "/internal/brc-edu/resources/sync";
const SUPPORT_CSV = [
    "Video Title,Video URL,Help-Routing Category",
    "Integration bank feeds,https://example.com/integration-bank-feeds,bank_feeds",
].join("\n");
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
async function probeServerHttpReady(port) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
            method: "GET",
            signal: AbortSignal.timeout(750),
        });
        return response.status === 400;
    }
    catch {
        return false;
    }
}
async function waitForServerReady(child, port, timeoutMs = SERVER_START_TIMEOUT_MS) {
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
async function startTestServer(t, port, envOverrides = {}) {
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
function createSyncFixture() {
    const baseDir = join(tmpdir(), `brc-edu-sync-http-${Date.now()}-${Math.random()}`);
    const syncedPath = join(baseDir, "synced-resources.json");
    mkdirSync(baseDir, { recursive: true });
    return {
        baseDir,
        syncedPath,
        cleanup() {
            rmSync(baseDir, { recursive: true, force: true });
        },
    };
}
test("POST /internal/brc-edu/resources/sync returns 503 when sync secret is not configured", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_SYNC_SECRET: "",
    });
    const response = await fetch(`http://127.0.0.1:${port}${SYNC_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [BRC_EDU_SYNC_SECRET_HEADER]: "any-secret",
        },
        body: JSON.stringify({ csvText: SUPPORT_CSV }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json());
    assert.equal(body.ok, false);
});
test("POST /internal/brc-edu/resources/sync returns 401 for missing or wrong secret", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_SYNC_SECRET: "configured-secret",
    });
    const missingSecretResponse = await fetch(`http://127.0.0.1:${port}${SYNC_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({ csvText: SUPPORT_CSV }),
    });
    const wrongSecretResponse = await fetch(`http://127.0.0.1:${port}${SYNC_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [BRC_EDU_SYNC_SECRET_HEADER]: "wrong-secret",
        },
        body: JSON.stringify({ csvText: SUPPORT_CSV }),
    });
    assert.equal(missingSecretResponse.status, 401);
    assert.equal(wrongSecretResponse.status, 401);
});
test("POST /internal/brc-edu/resources/sync stores enriched resources", async (t) => {
    const port = await getFreePort();
    const fixture = createSyncFixture();
    t.after(() => {
        fixture.cleanup();
    });
    await startTestServer(t, port, {
        BRC_EDU_SYNC_SECRET: "configured-secret",
        BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
    });
    const response = await fetch(`http://127.0.0.1:${port}${SYNC_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [BRC_EDU_SYNC_SECRET_HEADER]: "configured-secret",
        },
        body: JSON.stringify({ csvText: SUPPORT_CSV }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json());
    assert.equal(body.ok, true);
    assert.equal(body.rowsRead, 1);
    assert.equal(body.rowsEnriched, 1);
    assert.ok(body.storedAt);
    const stored = JSON.parse(readFileSync(fixture.syncedPath, "utf8"));
    assert.equal(stored.resources[0]?.title, "Integration bank feeds");
});
test("POST /internal/brc-edu/resources/sync does not log secrets in server output", async (t) => {
    const port = await getFreePort();
    const secret = "integration-sync-secret-value";
    const child = await startTestServer(t, port, {
        BRC_EDU_SYNC_SECRET: secret,
    });
    await fetch(`http://127.0.0.1:${port}${SYNC_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [BRC_EDU_SYNC_SECRET_HEADER]: secret,
        },
        body: JSON.stringify({ csvText: SUPPORT_CSV }),
    });
    await fetch(`http://127.0.0.1:${port}${SYNC_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [BRC_EDU_SYNC_SECRET_HEADER]: "wrong-secret",
        },
        body: JSON.stringify({ csvText: SUPPORT_CSV }),
    });
    const output = await new Promise((resolve) => {
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
    assert.equal(output.includes(BRC_EDU_SYNC_SECRET_HEADER), false);
});
