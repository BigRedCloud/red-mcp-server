#!/usr/bin/env node

import "dotenv/config";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAllTools } from "./register_all_tools.js";
import { createBrcMcpServer } from "./server.js";
import { CompanyApiContext, runWithSessionKeyStore, setApiKeyForCompany, textResponse, } from "./shared.js";

import {
  consumeConnectionCode,
  getPendingConnection,
} from "./auth/connection_code.js";

import {
  renderConnectPage,
  renderConnectionFailedPage,
  renderExpiredLinkPage,
  renderSuccessPage,
} from "./auth/connection_page.js";

import { redServerConfig, getApiKeyExpirationMs, assertApiKeyAllowed } from "./config/server_config.js";

import multer from "multer";
import { parse } from "csv-parse/sync";

function createMcpServer(): McpServer {
  const server = createBrcMcpServer();
  registerAllTools(server);
  return server;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  keyStore: Map<string, CompanyApiContext>;
  createdAt: number;
  lastSeenAt: number;
}

const sessions = new Map<string, Session>();
function getSessionTtlMs(): number {
  return redServerConfig.sessionTtlMinutes * 60 * 1000;
}

function touchSession(session: Session): void {
  session.lastSeenAt = Date.now();
}

async function closeSession(sessionId: string, session: Session): Promise<void> {
  await session.transport.close().catch(() => {});
  await session.server.close().catch(() => {});
  sessions.delete(sessionId);
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  const ttlMs = getSessionTtlMs();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastSeenAt > ttlMs) {
      await closeSession(sessionId, session);
    }
  }
}

setInterval(() => {
  cleanupExpiredSessions().catch(() => {});
}, 60 * 1000).unref();
const app = createMcpExpressApp({ host: "0.0.0.0" });
app.set("trust proxy", true);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024, // 1 MB
  },
});

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

function rateLimitMiddleware(req: Request, res: Response, next: () => void) {
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

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((msg) => msg?.method === "initialize");
  }
  return (body as Record<string, unknown>)?.method === "initialize";
}

type UploadedCompanyCredential = {
  companyName: string;
  apiKey: string;
};

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [String(value).trim()];
}

function parseCompanyCsv(buffer: Buffer): UploadedCompanyCredential[] {
  const rows = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  return rows
    .map((row) => ({
      companyName: String(
        row.companyName ??
          row.CompanyName ??
          row.company ??
          row.Company ??
          row["Company Name"] ??
          ""
      ).trim(),
      apiKey: String(
        row.apiKey ??
          row.ApiKey ??
          row.api_key ??
          row.APIKey ??
          row["API Key"] ??
          ""
      ).trim(),
    }))
    .filter((row) => row.companyName && row.apiKey);
}

app.post("/connect", upload.single("companyFile"), async (req, res) => {
  const code = String(req.body.code ?? "");

  let companies: UploadedCompanyCredential[] = [];

  if (req.file?.buffer) {
    companies = parseCompanyCsv(req.file.buffer);
  } else {
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

  const pending = consumeConnectionCode(code);

  if (!pending) {
    res.status(400).send(renderExpiredLinkPage());
    return;
  }

  try {
    runWithSessionKeyStore(pending.sessionStore, () => {
      for (const company of companies) {
        assertApiKeyAllowed(company.apiKey);

        setApiKeyForCompany({
          companyName: company.companyName,
          apiKey: company.apiKey,
          expiresAt: Date.now() + getApiKeyExpirationMs(),
        });
      }
    });

    const connectedNames = companies.map((company) => company.companyName);

    res.send(renderSuccessPage(connectedNames));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    res.status(400).send(renderConnectionFailedPage(message));
  }
});

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    touchSession(session);
  
    await runWithSessionKeyStore(session.keyStore, () =>
      session.transport.handleRequest(req, res, req.body)
    );
  
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

  const keyStore = new Map<string, CompanyApiContext>();
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  await server.connect(transport);
  await runWithSessionKeyStore(keyStore, () =>
    transport.handleRequest(req, res, req.body)
  );

  const sid = transport.sessionId;
  if (sid) {
    sessions.set(sid, { server, transport, keyStore, createdAt: Date.now(), lastSeenAt: Date.now() });
  }
});


app.get("/connect", (req, res) => {
  const code = String(req.query.code ?? "");

  const pending = getPendingConnection(code);

  if (!pending) {
    res.status(400).send(renderExpiredLinkPage());
    return;
  }

  res.send(renderConnectPage(code));
});


app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await runWithSessionKeyStore(session.keyStore, () =>
      session.transport.handleRequest(req, res)
    );
    return;
  }
  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request: No valid session for GET." },
    id: null,
  });
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const { server, transport } = sessions.get(sessionId)!;
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
    transport.close().catch(() => {});
    server.close().catch(() => {});
  }
  sessions.clear();
  httpServer.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
