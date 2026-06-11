#!/usr/bin/env node
import "dotenv/config";
import { randomUUID } from "node:crypto";
import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./register_all_tools.js";
import { createBrcMcpServer } from "./server.js";
import { runWithSessionKeyStore } from "./shared.js";
import { redServerConfig } from "./server_config.js";
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
const app = createMcpExpressApp({ host: "0.0.0.0" });
app.set("trust proxy", true);
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
function isInitializeRequest(body) {
    if (Array.isArray(body)) {
        return body.some((msg) => msg?.method === "initialize");
    }
    return body?.method === "initialize";
}
app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        touchSession(session);
        await runWithSessionKeyStore(session.keyStore, () => session.transport.handleRequest(req, res, req.body));
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
    await runWithSessionKeyStore(keyStore, () => transport.handleRequest(req, res, req.body));
    const sid = transport.sessionId;
    if (sid) {
        sessions.set(sid, { server, transport, keyStore, createdAt: Date.now(), lastSeenAt: Date.now() });
    }
});
app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        await runWithSessionKeyStore(session.keyStore, () => session.transport.handleRequest(req, res));
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
const httpServer = app.listen(PORT, () => {
    console.log(`BRC MCP server (Streamable HTTP) running at http://localhost:${PORT}/mcp`);
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
