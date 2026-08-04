import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../edu/brc_edu_upload_store.js";
import { EASY_AUTH_CLIENT_PRINCIPAL_HEADER, } from "../edu/brc_edu_admin_auth.js";
const SERVER_READY_LOG_MARKER = "BRC MCP server";
const SERVER_START_TIMEOUT_MS = 60_000;
const ADMIN_PATH = "/internal/brc-edu/admin";
const LEGACY_UPLOAD_PATH = "/internal/brc-edu/resources/upload";
const WORKBOOK_PATH = `${LEGACY_UPLOAD_PATH}/workbook`;
const WORKBOOK_DOWNLOAD_PATH = `${LEGACY_UPLOAD_PATH}/workbook/download`;
function encodePrincipal(principal) {
    return Buffer.from(JSON.stringify(principal), "utf8").toString("base64");
}
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
            BRC_EDU_ADMIN_ENTRA_TENANT_ID: "",
            BRC_EDU_ADMIN_ENTRA_GROUP_ID: "",
            BRC_EDU_ADMIN_ENTRA_APP_ROLE: "",
            BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK: "true",
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
function withSecret(path, port, secret) {
    const base = `http://127.0.0.1:${port}${path}`;
    if (!secret) {
        return base;
    }
    const separator = path.includes("?") ? "&" : "?";
    return `${base}${separator}${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}
function adminUrl(port, secret, view) {
    const path = view ? `${ADMIN_PATH}?view=${encodeURIComponent(view)}` : ADMIN_PATH;
    return withSecret(path, port, secret);
}
function legacyUploadUrl(port, secret) {
    return withSecret(LEGACY_UPLOAD_PATH, port, secret);
}
function workbookUrl(port, secret) {
    return withSecret(WORKBOOK_PATH, port, secret);
}
function workbookDownloadUrl(port, secret) {
    return withSecret(WORKBOOK_DOWNLOAD_PATH, port, secret);
}
test("GET /internal/brc-edu/admin returns 503 when admin secret is not configured", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "",
    });
    const response = await fetch(adminUrl(port, "any-secret"));
    assert.equal(response.status, 503);
});
test("GET /internal/brc-edu/admin returns 401 for missing or wrong secret", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const missing = await fetch(adminUrl(port));
    const wrong = await fetch(adminUrl(port, "wrong-secret"));
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
});
test("GET /internal/brc-edu/admin defaults to content overview", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const response = await fetch(adminUrl(port, "configured-secret"));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Red content administration/i);
    assert.match(html, /Content overview/i);
    assert.match(html, /Visible content by topic/i);
    assert.match(html, /Freshdesk articles/i);
    assert.match(html, /YouTube videos/i);
    assert.equal(html.includes("Upload Excel"), false);
});
test("GET /internal/brc-edu/admin?view=youtube loads YouTube management", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const response = await fetch(adminUrl(port, "configured-secret", "youtube"));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /YouTube video management/i);
    assert.match(html, /Recorded webinars/i);
});
test("GET /internal/brc-edu/resources/upload redirects to the admin page", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const response = await fetch(legacyUploadUrl(port, "configured-secret"), {
        redirect: "manual",
    });
    assert.equal(response.status, 302);
    const location = response.headers.get("location") ?? "";
    assert.match(location, /\/internal\/brc-edu\/admin/);
    assert.match(location, /secret=configured-secret/);
});
test("removed workbook upload and download routes return 404", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const getWorkbook = await fetch(workbookUrl(port, "configured-secret"));
    const putWorkbook = await fetch(workbookUrl(port, "configured-secret"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: [] }),
    });
    const download = await fetch(workbookDownloadUrl(port, "configured-secret"));
    const postUpload = await fetch(legacyUploadUrl(port, "configured-secret"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        redirect: "manual",
    });
    assert.equal(getWorkbook.status, 404);
    assert.equal(putWorkbook.status, 404);
    assert.equal(download.status, 404);
    assert.equal(postUpload.status, 404);
});
test("Freshdesk and overview APIs require admin authentication", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const overview = await fetch(`http://127.0.0.1:${port}/internal/brc-edu/content/overview`);
    const articles = await fetch(`http://127.0.0.1:${port}/internal/brc-edu/freshdesk/articles`);
    const visibility = await fetch(`http://127.0.0.1:${port}/internal/brc-edu/freshdesk/articles/1/visibility`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excluded: true }),
    });
    assert.equal(overview.status, 401);
    assert.equal(articles.status, 401);
    assert.equal(visibility.status, 401);
});
test("GET /internal/brc-edu/admin allows approved Entra staff without a secret", async (t) => {
    const port = await getFreePort();
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const groupId = "22222222-2222-2222-2222-222222222222";
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "",
        BRC_EDU_ADMIN_ENTRA_TENANT_ID: tenantId,
        BRC_EDU_ADMIN_ENTRA_GROUP_ID: groupId,
        BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK: "false",
    });
    const principal = encodePrincipal({
        auth_typ: "aad",
        claims: [
            { typ: "tid", val: tenantId },
            { typ: "groups", val: groupId },
            { typ: "preferred_username", val: "staff@example.com" },
        ],
    });
    const response = await fetch(adminUrl(port), {
        headers: {
            [EASY_AUTH_CLIENT_PRINCIPAL_HEADER]: principal,
        },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Red content administration/i);
    assert.match(html, /Content overview/i);
});
