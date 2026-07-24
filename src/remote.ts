#!/usr/bin/env node

import "dotenv/config";
process.env.RED_CONNECT_HTTP_MODE = "true";

import { randomUUID } from "node:crypto";
import cors from "cors";

import "./telemetry.js";
import express from "express";

import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAllTools } from "./register_all_tools.js";
import { createBrcMcpServer } from "./server.js";
import {
  type CompanyApiContext,
  ensureMcpSessionReady,
  registerHttpSessionKeyStore,
  reloadSessionCredentialsFromConnectionStore,
  runWithSessionKeyStore,
  unregisterHttpSessionKeyStore,
} from "./shared.js";
import {
  buildHttpClientKeyFromRequest,
  buildMcpSessionDiagnostic,
  logMcpSessionDiagnostic,
  prepareHttpToolSessionScope,
  resolveMcpSessionIdFromRequest,
  runWithHttpToolSession,
} from "./auth/mcp_http_session.js";
import {
  buildTelemetryClientIdSetCookie,
  runWithRedTelemetryContext,
} from "./telemetry.js";
import {
  activatePreparedTelemetry,
  buildRequestTelemetryContext,
  extractConnectionRefFromMcpBody,
  logTelemetryClientIdPathDiagnostics,
  prepareMcpTelemetryContext,
  resolveTelemetryClientIdFromRequest,
} from "./telemetry/context.js";

import {
  completeConnectionCode,
  getPendingConnection,
} from "./auth/connection_code.js";
import {
  ensureConnectionStoreInitialized,
  getConnectionStore,
} from "./auth/connection_store.js";
import { validateAndPersistConnectedCompanies } from "./auth/connection_persistence.js";

import {
  renderConnectPage,
  renderConnectionFailedPage,
  renderExpiredLinkPage,
  renderSuccessPage,
} from "./auth/connection_page.js";

import { redServerConfig, getApiKeyExpirationMs } from "./config/server_config.js";

import multer from "multer";
import { parse } from "csv-parse/sync";
import { redAssetsDirectory, RED_FAVICON_PATH } from "./auth/red_assets.js";
import {
  BRC_EDU_SYNC_SECRET_HEADER,
  handleBrcEduResourcesSyncRequest,
} from "./edu/brc_edu_synced_store.js";
import { invalidateEduResourcesCache } from "./edu/brc_edu_resources.js";
import {
  downloadWebinarWorkbookForAdmin,
  loadWebinarWorkbookForAdmin,
  saveWebinarWorkbookForAdmin,
  createConfiguredWorkbookBlobAccess,
} from "./edu/brc_edu_workbook_store.js";
import {
  authorizeBrcEduAdminRequest,
  BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE,
  getBrcEduAdminProtectedPath,
  type BrcEduAdminAuthResult,
} from "./edu/brc_edu_admin_auth.js";
import {
  BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY,
  BRC_EDU_UPLOAD_FIELD_NAME,
  BRC_EDU_UPLOAD_MAX_BYTES,
  createConfiguredBrcEduBlobUploader,
  handleBrcEduResourceUpload,
} from "./edu/brc_edu_upload_store.js";
import {
  renderBrcEduStaffDeniedPage,
  renderBrcEduUploadErrorPage,
  renderBrcEduUploadPage,
  renderBrcEduUploadPlainError,
  renderBrcEduUploadSuccessPage,
  type BrcEduAdminPageAuth,
  WORKBOOK_API_PATH,
  WORKBOOK_DOWNLOAD_PATH,
} from "./edu/brc_edu_upload_page.js";
import { registerFreshdeskPublicImageRoute } from "./brc-edu/freshdesk/freshdesk-public-image-route.js";

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
  unregisterHttpSessionKeyStore(sessionId);
  sessions.delete(sessionId);
}

function trackHttpSession(sessionId: string, keyStore: Map<string, CompanyApiContext>): void {
  registerHttpSessionKeyStore(sessionId, keyStore);
}

async function createResumedMcpSession(sessionId: string): Promise<Session> {
  const keyStore = new Map<string, CompanyApiContext>();
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  transport.onclose = () => {
    unregisterHttpSessionKeyStore(sessionId);
    sessions.delete(sessionId);
  };

  await server.connect(transport);

  return {
    server,
    transport,
    keyStore,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
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

async function handleMcpRequest(
  session: Session,
  sessionId: string,
  req: Request,
  res: Response,
  body?: unknown
): Promise<void> {
  const normalizedSessionId = sessionId.trim();
  const clientKey = buildHttpClientKeyFromRequest(req);
  registerHttpSessionKeyStore(normalizedSessionId, session.keyStore);

  const connectionRef = extractConnectionRefFromMcpBody(body ?? req.body);

  // Ordered: resolve connection → restore companies → load telemetry → count → context
  const prepared = await prepareMcpTelemetryContext({
    sessionId: normalizedSessionId,
    keyStore: session.keyStore,
    clientKey,
    connectionRef,
    headers: req.headers as Record<string, string | string[] | undefined>,
  });

  const scope = await prepareHttpToolSessionScope(
    normalizedSessionId,
    session.keyStore,
    clientKey,
    connectionRef
  );

  // Prefer the prepared connection id when scope resolution lagged behind rehydration.
  if (!scope.connectionId && prepared.connectionId) {
    scope.connectionId = prepared.connectionId;
  }

  return runWithRedTelemetryContext(prepared.context, () => {
    activatePreparedTelemetry(prepared);

    return runWithHttpToolSession(scope, async () => {
      const companiesLoaded = Array.from(session.keyStore.values()).map(
        (entry) => entry.companyName
      );

      logMcpSessionDiagnostic(
        buildMcpSessionDiagnostic({
          transportSessionId: normalizedSessionId,
          extra: {
            requestInfo: {
              headers: req.headers as Record<
                string,
                string | string[] | undefined
              >,
            },
          },
          resolution: scope.resolution,
          credentialCount: companiesLoaded.length,
          companiesLoaded,
        })
      );

      if (body !== undefined) {
        await session.transport.handleRequest(req, res, body);
      } else {
        await session.transport.handleRequest(req, res);
      }
    });
  });
}

const app = createMcpExpressApp({ host: "0.0.0.0" });
app.set("trust proxy", true);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024, // 1 MB
  },
});

const eduResourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: BRC_EDU_UPLOAD_MAX_BYTES,
  },
});

function getBrcEduAdminUploadSecretFromQuery(req: Request): string | undefined {
  const secret = req.query[BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY];
  if (Array.isArray(secret)) {
    return typeof secret[0] === "string" ? secret[0] : undefined;
  }

  return typeof secret === "string" ? secret : undefined;
}

function authorizeBrcEduAdminHttpRequest(req: Request): BrcEduAdminAuthResult {
  return authorizeBrcEduAdminRequest({
    headers: req.headers,
    providedSecret: getBrcEduAdminUploadSecretFromQuery(req),
    returnPath: req.originalUrl || getBrcEduAdminProtectedPath(),
  });
}

function brcEduAdminPageAuthFromResult(
  authResult: Extract<BrcEduAdminAuthResult, { ok: true }>,
  providedSecret: string | undefined,
): BrcEduAdminPageAuth {
  if (authResult.method === "secret" && providedSecret) {
    return { mode: "secret", secret: providedSecret };
  }

  return { mode: "session" };
}

function sendBrcEduAdminAuthFailure(
  res: Response,
  authResult: Extract<BrcEduAdminAuthResult, { ok: false }>,
  options: { asJson?: boolean } = {},
): void {
  if (authResult.redirectToLogin) {
    res.redirect(302, authResult.redirectToLogin);
    return;
  }

  if (options.asJson) {
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }

  if (authResult.status === 403) {
    res
      .status(403)
      .send(renderBrcEduStaffDeniedPage(authResult.error || BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE));
    return;
  }

  res.status(authResult.status).send(renderBrcEduUploadPlainError(authResult.error));
}

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
app.use(
  "/assets",
  express.static(redAssetsDirectory, {
    maxAge: "7d",
    immutable: true,
  })
);
app.get("/favicon.ico", (_req, res) => {
  res.type("png").sendFile(RED_FAVICON_PATH);
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

registerFreshdeskPublicImageRoute(app);

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
  await ensureConnectionStoreInitialized();

  const code = String(req.body.code ?? "");
  const resolvedClient = resolveTelemetryClientIdFromRequest(req);
  const telemetryClientId = resolvedClient.clientId;
  const secureCookie = req.secure || req.protocol === "https";
  res.setHeader(
    "Set-Cookie",
    buildTelemetryClientIdSetCookie(telemetryClientId, { secure: secureCookie })
  );

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

  const pending = await completeConnectionCode(code);

  if (!pending) {
    res.status(400).send(renderExpiredLinkPage());
    return;
  }

  const pathDiagnostics = {
    cookieClientIdPresent: resolvedClient.cookieClientIdPresent,
    localStorageClientIdSubmitted: resolvedClient.postClientIdPresent,
    postClientIdPresent: resolvedClient.postClientIdPresent,
    postClientIdValid: resolvedClient.postClientIdValid,
    saveTelemetryClientIdPresent: Boolean(telemetryClientId),
    persistedTelemetryClientIdPresent: false,
    loadedTelemetryClientIdPresent: false,
  };

  // Persist client id as soon as the pending code is claimed, before credential
  // validation, so a later session-id write cannot be the first (partial) upsert.
  try {
    await getConnectionStore().saveConnectionTelemetry(pending.connectionId, {
      telemetryClientId,
    });
    const persisted = await getConnectionStore().getConnectionTelemetry(
      pending.connectionId
    );
    pathDiagnostics.persistedTelemetryClientIdPresent = Boolean(
      persisted?.telemetryClientId
    );
    pathDiagnostics.loadedTelemetryClientIdPresent =
      pathDiagnostics.persistedTelemetryClientIdPresent;
  } catch (error) {
    console.error(
      "Red telemetry: failed to store telemetry client id:",
      error instanceof Error ? error.message : error
    );
  }
  logTelemetryClientIdPathDiagnostics(pathDiagnostics);

  const telemetryContext = buildRequestTelemetryContext({
    req,
    connectionId: pending.connectionId,
    telemetryClientId,
    connectedCompanyCount: companies.length,
  });

  return runWithRedTelemetryContext(telemetryContext, async () => {
    try {
      const outcome = await validateAndPersistConnectedCompanies({
        connectionId: pending.connectionId,
        companies,
        expiresAt: Date.now() + getApiKeyExpirationMs(),
      });

      if (outcome.connectedCompanies.length === 0) {
        const message =
          outcome.failedCompanies.length > 0
            ? outcome.failedCompanies.map((failure) => failure.message).join(" ")
            : "No companies could be connected because the submitted credentials could not be validated.";

        res.status(400).send(renderConnectionFailedPage(message));
        return;
      }

      for (const session of sessions.values()) {
        const sessionId = session.transport.sessionId;
        if (!sessionId) continue;

        const boundConnectionId =
          await getConnectionStore().getConnectionIdForSession(sessionId);

        if (boundConnectionId === pending.connectionId) {
          await reloadSessionCredentialsFromConnectionStore(
            sessionId,
            pending.connectionId
          );
        }
      }

      res.send(
        renderSuccessPage(
          outcome.connectedCompanies,
          code,
          outcome.failedCompanies
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      res.status(400).send(renderConnectionFailedPage(message));
    }
  });
});

app.post("/mcp", async (req: Request, res: Response) => {
  await ensureConnectionStoreInitialized();

  const sessionId = resolveMcpSessionIdFromRequest(req);
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    touchSession(session);

    await handleMcpRequest(session, sessionId, req, res, req.body);
    return;
  }

  if (sessionId && !isInitializeRequest(req.body)) {
    const resumed = await createResumedMcpSession(sessionId);
    sessions.set(sessionId, resumed);
    trackHttpSession(sessionId, resumed.keyStore);
    touchSession(resumed);
    await handleMcpRequest(resumed, sessionId, req, res, req.body);
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
    if (sid) {
      unregisterHttpSessionKeyStore(sid);
      sessions.delete(sid);
    }
  };

  await server.connect(transport);

  const provisionalSession: Session = {
    server,
    transport,
    keyStore,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  const sidAfterInit = transport.sessionId;
  if (sidAfterInit) {
    sessions.set(sidAfterInit, provisionalSession);
    trackHttpSession(sidAfterInit, keyStore);
    await handleMcpRequest(provisionalSession, sidAfterInit, req, res, req.body);
    return;
  }

  await runWithSessionKeyStore(keyStore, async () => {
    await transport.handleRequest(req, res, req.body);
  });

  const sid = transport.sessionId;
  if (sid) {
    sessions.set(sid, provisionalSession);
    trackHttpSession(sid, keyStore);
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

  const { clientId } = resolveTelemetryClientIdFromRequest(req);
  const secureCookie = req.secure || req.protocol === "https";
  res.setHeader(
    "Set-Cookie",
    buildTelemetryClientIdSetCookie(clientId, { secure: secureCookie })
  );

  const telemetryContext = buildRequestTelemetryContext({
    req,
    connectionId: pending.connectionId,
    telemetryClientId: clientId,
  });

  return runWithRedTelemetryContext(telemetryContext, () => {
    res.send(renderConnectPage(code, { telemetryClientId: clientId }));
  });
});


app.get("/mcp", async (req: Request, res: Response) => {
  await ensureConnectionStoreInitialized();

  const sessionId = resolveMcpSessionIdFromRequest(req);
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    touchSession(session);
    await handleMcpRequest(session, sessionId, req, res);
    return;
  }

  if (sessionId) {
    const resumed = await createResumedMcpSession(sessionId);
    sessions.set(sessionId, resumed);
    trackHttpSession(sessionId, resumed.keyStore);
    touchSession(resumed);
    await handleMcpRequest(resumed, sessionId, req, res);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request: No valid session for GET." },
    id: null,
  });
});

app.post("/internal/brc-edu/resources/sync", (req: Request, res: Response) => {
  const requestSecret = req.headers[BRC_EDU_SYNC_SECRET_HEADER];
  const normalizedSecret = Array.isArray(requestSecret) ? requestSecret[0] : requestSecret;
  const result = handleBrcEduResourcesSyncRequest(req.body, normalizedSecret);

  if (result.status === 200) {
    invalidateEduResourcesCache();
  }

  res.status(result.status).json(result.body);
});

app.get("/internal/brc-edu/resources/upload", (req: Request, res: Response) => {
  const providedSecret = getBrcEduAdminUploadSecretFromQuery(req);
  const authResult = authorizeBrcEduAdminHttpRequest(req);

  if (!authResult.ok) {
    sendBrcEduAdminAuthFailure(res, authResult);
    return;
  }

  const pageAuth = brcEduAdminPageAuthFromResult(authResult, providedSecret);
  res.send(renderBrcEduUploadPage(pageAuth));
});

app.get(WORKBOOK_API_PATH, async (req: Request, res: Response) => {
  const authResult = authorizeBrcEduAdminHttpRequest(req);

  if (!authResult.ok) {
    sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
    return;
  }

  const result = await loadWebinarWorkbookForAdmin(createConfiguredWorkbookBlobAccess());

  if (!result.ok) {
    if (result.status === 404) {
      res.status(200).json({
        rows: [],
        etag: "",
        lastModified: "",
        rowCount: 0,
      });
      return;
    }

    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json(result.payload);
});

app.get(WORKBOOK_DOWNLOAD_PATH, async (req: Request, res: Response) => {
  const authResult = authorizeBrcEduAdminHttpRequest(req);

  if (!authResult.ok) {
    sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
    return;
  }

  const result = await downloadWebinarWorkbookForAdmin(
    createConfiguredWorkbookBlobAccess(),
  );

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="webinar_video_routing_index.xlsx"',
  );
  res.send(result.buffer);
});

app.put(WORKBOOK_API_PATH, async (req: Request, res: Response) => {
  const authResult = authorizeBrcEduAdminHttpRequest(req);

  if (!authResult.ok) {
    sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
    return;
  }

  const body = req.body as {
    rows?: unknown;
    ifMatch?: unknown;
  };

  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows) {
    res.status(400).json({ error: "Workbook rows are required." });
    return;
  }

  const result = await saveWebinarWorkbookForAdmin(
    {
      rows,
      ifMatch: typeof body?.ifMatch === "string" ? body.ifMatch : undefined,
    },
    createConfiguredWorkbookBlobAccess(),
  );

  if (!result.ok) {
    res.status(result.status).json({
      error: result.error,
      errors: result.errors,
    });
    return;
  }

  invalidateEduResourcesCache();

  res.json({
    rows,
    etag: result.etag,
    lastModified: result.lastModified,
    rowCount: result.rowCount,
    latestBlob: result.latestBlob,
    archiveBlob: result.archiveBlob,
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  });
});

app.post("/internal/brc-edu/resources/upload", (req: Request, res: Response) => {
  const providedSecret = getBrcEduAdminUploadSecretFromQuery(req);
  const authResult = authorizeBrcEduAdminHttpRequest(req);

  if (!authResult.ok) {
    sendBrcEduAdminAuthFailure(res, authResult);
    return;
  }

  const pageAuth = brcEduAdminPageAuthFromResult(authResult, providedSecret);

  eduResourceUpload.single(BRC_EDU_UPLOAD_FIELD_NAME)(req, res, (uploadError) => {
    void (async () => {
      if (uploadError) {
        const message =
          uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE"
            ? "File exceeds the maximum size of 5 MB."
            : "Upload failed.";

        res.status(400).send(renderBrcEduUploadErrorPage(message, pageAuth));
        return;
      }

      const file = req.file
        ? {
            buffer: req.file.buffer,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
          }
        : undefined;

      const uploadResult = await handleBrcEduResourceUpload(
        file,
        createConfiguredBrcEduBlobUploader(),
      );

      if (!uploadResult.ok) {
        res
          .status(uploadResult.status)
          .send(renderBrcEduUploadErrorPage(uploadResult.error, pageAuth));
        return;
      }

      invalidateEduResourcesCache();

      res.send(
        renderBrcEduUploadSuccessPage(
          uploadResult.latestBlob,
          uploadResult.archiveBlob,
          pageAuth,
        ),
      );
    })().catch(() => {
      if (!res.headersSent) {
        res.status(500).send(renderBrcEduUploadErrorPage("Upload failed.", pageAuth));
      }
    });
  });
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = resolveMcpSessionIdFromRequest(req);
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

const httpServer = app.listen(PORT);

httpServer.on("listening", () => {
  console.log(
    `BRC MCP server (Streamable HTTP) running at http://localhost:${PORT}/mcp`
  );
});

void (async () => {
  try {
    await ensureConnectionStoreInitialized();
    const storeType = getConnectionStore().getStoreType();
    console.log(`Red connection store: ${storeType}`);
  } catch (error) {
    console.error(
      "Red connection store failed to initialize:",
      error instanceof Error ? error.message : error
    );
  }
})();

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
