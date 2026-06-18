#!/usr/bin/env node
import "dotenv/config";
process.env.RED_CONNECT_HTTP_MODE = "true";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./register_all_tools.js";
import { createBrcMcpServer } from "./server.js";
import { ensureMcpSessionReady, runWithMcpSessionContext, runWithSessionKeyStore, } from "./shared.js";
import { consumeConnectionCode, getPendingConnection, } from "./auth/connection_code.js";
import { ensureConnectionStoreInitialized, getConnectionStore, } from "./auth/connection_store.js";
import { hydrateSessionKeyStoreFromConnectionStore } from "./auth/connection_persistence.js";
import { renderConnectPage, renderConnectionFailedPage, renderExpiredLinkPage, renderSuccessPage, } from "./auth/connection_page.js";
import { redServerConfig, getApiKeyExpirationMs, assertApiKeyAllowed } from "./config/server_config.js";
import multer from "multer";
import { parse } from "csv-parse/sync";
function createMcpServer() {
    const server = createBrcMcpServer();
    registerAllTools(server);
    return server;
}
const sessions = new Map();
function getSessionTtlMs() {
    return redServerConfig.sessionTtlMinutes * 60 * 1000;
}
function touchSession(session) {
    session.lastSeenAt = Date.now();
}
async function closeSession(sessionId, session) {
    await session.transport.close().catch(() => { });
    await session.server.close().catch(() => { });
    sessions.delete(sessionId);
}
async function cleanupExpiredSessions() {
    const now = Date.now();
    const ttlMs = getSessionTtlMs();
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastSeenAt > ttlMs) {
            await closeSession(sessionId, session);
        }
    }
}
setInterval(() => {
    cleanupExpiredSessions().catch(() => { });
}, 60 * 1000).unref();
async function handleMcpRequest(session, sessionId, req, res, body) {
    const context = await ensureMcpSessionReady(sessionId, session.keyStore);
    await runWithMcpSessionContext(context, async () => runWithSessionKeyStore(session.keyStore, async () => {
        if (body !== undefined) {
            await session.transport.handleRequest(req, res, body);
        }
        else {
            await session.transport.handleRequest(req, res);
        }
    }));
}
const app = createMcpExpressApp({ host: "0.0.0.0" });
app.set("trust proxy", true);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 1024 * 1024, // 1 MB
    },
});
const rateLimitBuckets = new Map();
function getClientIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim();
    }
    return req.ip || req.socket.remoteAddress || "unknown";
}
function rateLimitMiddleware(req, res, next) {
    const limit = redServerConfig.rateLimitRequestsPerMinute;
    if (!limit || limit <= 0) {
        next();
        return;
    }
    const now = Date.now();
    const windowMs = 60 * 1000;
    const ip = getClientIp(req);
    const current = rateLimitBuckets.get(ip);
    if (!current || now - current.windowStartedAt >= windowMs) {
        rateLimitBuckets.set(ip, {
            windowStartedAt: now,
            count: 1,
        });
        next();
        return;
    }
    current.count += 1;
    if (current.count > limit) {
        res.status(429).json({
            error: "Too many requests",
            message: `Rate limit exceeded. Please wait and try again. Limit is ${limit} requests per minute per IP address.`,
        });
        return;
    }
    next();
}
setInterval(() => {
    const now = Date.now();
    const windowMs = 60 * 1000;
    for (const [ip, bucket] of rateLimitBuckets.entries()) {
        if (now - bucket.windowStartedAt >= windowMs) {
            rateLimitBuckets.delete(ip);
        }
    }
}, 60 * 1000).unref();
app.use(rateLimitMiddleware);
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
function isInitializeRequest(body) {
    if (Array.isArray(body)) {
        return body.some((msg) => msg?.method === "initialize");
    }
    return body?.method === "initialize";
}
function toStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (value === undefined || value === null || value === "") {
        return [];
    }
    return [String(value).trim()];
}
function parseCompanyCsv(buffer) {
    const rows = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    });
    return rows
        .map((row) => ({
        companyName: String(row.companyName ??
            row.CompanyName ??
            row.company ??
            row.Company ??
            row["Company Name"] ??
            "").trim(),
        apiKey: String(row.apiKey ??
            row.ApiKey ??
            row.api_key ??
            row.APIKey ??
            row["API Key"] ??
            "").trim(),
    }))
        .filter((row) => row.companyName && row.apiKey);
}
app.post("/connect", upload.single("companyFile"), async (req, res) => {
    await ensureConnectionStoreInitialized();
    const code = String(req.body.code ?? "");
    let companies = [];
    if (req.file?.buffer) {
        companies = parseCompanyCsv(req.file.buffer);
    }
    else {
        const companyNames = toStringArray(req.body.companyName);
        const apiKeys = toStringArray(req.body.apiKey);
        if (companyNames.length !== apiKeys.length) {
            res.status(400).send("Each company name must have a matching API key.");
            return;
        }
        companies = companyNames.map((companyName, index) => ({
            companyName,
            apiKey: apiKeys[index],
        }));
    }
    if (!code || companies.length === 0) {
        res
            .status(400)
            .send("Missing connection code or no valid companies were provided.");
        return;
    }
    const pending = await consumeConnectionCode(code);
    if (!pending) {
        res.status(400).send(renderExpiredLinkPage());
        return;
    }
    try {
        for (const company of companies) {
            assertApiKeyAllowed(company.apiKey);
        }
        const expiresAt = Date.now() + getApiKeyExpirationMs();
        await getConnectionStore().saveConnectedCompanies(pending.connectionId, companies.map((company) => ({
            companyName: company.companyName,
            apiKey: company.apiKey,
            expiresAt,
        })));
        for (const session of sessions.values()) {
            const sessionId = session.transport.sessionId;
            if (!sessionId)
                continue;
            const boundConnectionId = await getConnectionStore().getConnectionIdForSession(sessionId);
            if (boundConnectionId === pending.connectionId) {
                await hydrateSessionKeyStoreFromConnectionStore(pending.connectionId, session.keyStore);
            }
        }
        const connectedNames = companies.map((company) => company.companyName);
        res.send(renderSuccessPage(connectedNames));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(400).send(renderConnectionFailedPage(message));
    }
});
app.post("/mcp", async (req, res) => {
    await ensureConnectionStoreInitialized();
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        touchSession(session);
        await handleMcpRequest(session, sessionId, req, res, req.body);
        return;
    }
    if (!isInitializeRequest(req.body)) {
        res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session. Send an initialize request first." },
            id: null,
        });
        return;
    }
    const keyStore = new Map();
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });
    transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid)
            sessions.delete(sid);
    };
    await server.connect(transport);
    const provisionalSession = {
        server,
        transport,
        keyStore,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
    };
    const sidAfterInit = transport.sessionId;
    if (sidAfterInit) {
        sessions.set(sidAfterInit, provisionalSession);
        await handleMcpRequest(provisionalSession, sidAfterInit, req, res, req.body);
        return;
    }
    await runWithSessionKeyStore(keyStore, async () => {
        await transport.handleRequest(req, res, req.body);
    });
    const sid = transport.sessionId;
    if (sid) {
        sessions.set(sid, provisionalSession);
        await ensureMcpSessionReady(sid, keyStore);
    }
});
app.get("/connect", async (req, res) => {
    await ensureConnectionStoreInitialized();
    const code = String(req.query.code ?? "");
    const pending = await getPendingConnection(code);
    if (!pending) {
        res.status(400).send(renderExpiredLinkPage());
        return;
    }
    res.send(renderConnectPage(code));
});
app.get("/mcp", async (req, res) => {
    await ensureConnectionStoreInitialized();
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        touchSession(session);
        await handleMcpRequest(session, sessionId, req, res);
        return;
    }
    res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session for GET." },
        id: null,
    });
});
app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
        const { server, transport } = sessions.get(sessionId);
        await transport.close();
        await server.close();
        sessions.delete(sessionId);
        res.status(200).json({ message: "Session terminated." });
        return;
    }
    res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found." },
        id: null,
    });
});
const PORT = parseInt(process.env.PORT || "3000", 10);
const httpServer = app.listen(PORT, async () => {
    try {
        await ensureConnectionStoreInitialized();
        const storeType = getConnectionStore().getStoreType();
        console.log(`BRC MCP server (Streamable HTTP) running at http://localhost:${PORT}/mcp`);
        console.log(`Red connection store: ${storeType}`);
    }
    catch (error) {
        console.error("Red connection store failed to initialize:", error instanceof Error ? error.message : error);
    }
});
const shutdown = () => {
    console.log("\nShutting down...");
    for (const { server, transport } of sessions.values()) {
        transport.close().catch(() => { });
        server.close().catch(() => { });
    }
    sessions.clear();
    httpServer.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
