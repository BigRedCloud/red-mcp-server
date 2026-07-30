#!/usr/bin/env node
import "dotenv/config";
process.env.RED_CONNECT_HTTP_MODE = "true";
import { randomUUID } from "node:crypto";
import cors from "cors";
import "./telemetry.js";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./register_all_tools.js";
import { createBrcMcpServer } from "./server.js";
import { ensureMcpSessionReady, registerHttpSessionKeyStore, reloadSessionCredentialsFromConnectionStore, runWithSessionKeyStore, unregisterHttpSessionKeyStore, } from "./shared.js";
import { buildHttpClientKeyFromRequest, buildMcpSessionDiagnostic, logMcpSessionDiagnostic, prepareHttpToolSessionScope, resolveMcpSessionIdFromRequest, runWithHttpToolSession, } from "./auth/mcp_http_session.js";
import { buildTelemetryClientIdSetCookie, isValidTelemetryUuid, runWithRedTelemetryContext, } from "./telemetry.js";
import { activatePreparedTelemetry, buildConnectTelemetryFlowDiagnostics, buildRequestTelemetryContext, extractConnectionRefFromMcpBody, logConnectTelemetryFlowDiagnostics, logTelemetryClientIdPathDiagnostics, prepareMcpTelemetryContext, resolveAndPersistConnectTelemetryClientId, resolveTelemetryClientIdFromRequest, } from "./telemetry/context.js";
import { clearSessionPlatform, extractMcpInitializeClientInfo, getStoredSessionPlatform, logPlatformDetectionDiagnostics, resolveClientPlatform, storeSessionPlatform, toPlatformDetectionDiagnostics, } from "./telemetry/platform.js";
import { completeConnectionCode, getPendingConnection, issueConfirmationCodeForConnectToken, } from "./auth/connection_code.js";
import { ensureConnectionStoreInitialized, getConnectionStore, getConnectionStoreTargetName, getDeploymentEnvironmentLabel, } from "./auth/connection_store.js";
import { validateAndPersistConnectedCompanies } from "./auth/connection_persistence.js";
import { applyConnectionSuccessPageHeaders, renderConnectPage, renderConnectionFailedPage, renderExpiredLinkPage, renderSuccessPage, } from "./auth/connection_page.js";
import { createConnectionSuccessPage, getConnectionSuccessPage, } from "./auth/connection_success_session.js";
import { redServerConfig, getApiKeyExpirationMs } from "./config/server_config.js";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { redAssetsDirectory, RED_FAVICON_PATH } from "./auth/red_assets.js";
import { BRC_EDU_SYNC_SECRET_HEADER, handleBrcEduResourcesSyncRequest, } from "./edu/brc_edu_synced_store.js";
import { invalidateEduResourcesCache } from "./edu/brc_edu_resources.js";
import { authorizeBrcEduAdminRequest, BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE, getBrcEduAdminProtectedPath, } from "./edu/brc_edu_admin_auth.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "./edu/brc_edu_upload_store.js";
import { renderBrcEduStaffDeniedPage, renderBrcEduUploadPage, renderBrcEduUploadPlainError, parseBrcEduAdminView, BRC_EDU_ADMIN_PATH, } from "./edu/brc_edu_upload_page.js";
import { registerFreshdeskPublicImageRoute } from "./brc-edu/freshdesk/freshdesk-public-image-route.js";
import { authorizeYouTubeServiceSyncSecret, handleYouTubeAdminListVideos, handleYouTubeAdminManualSync, handleYouTubeServiceSync, handleYouTubeVisibilityUpdate, handleYouTubeWebhookRequest, } from "./brc-edu/youtube/youtube-admin-http.js";
import { authorizeFreshdeskServiceSyncSecret, handleFreshdeskAdminListArticles, handleFreshdeskAdminManualSync, handleFreshdeskServiceSync, handleFreshdeskVisibilityUpdate, } from "./brc-edu/freshdesk/freshdesk-admin-http.js";
import { handleContentOverview } from "./brc-edu/content/content-overview-http.js";
import { CONTENT_OVERVIEW_API_PATH } from "./brc-edu/content/content-overview-service.js";
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
    unregisterHttpSessionKeyStore(sessionId);
    clearSessionPlatform(sessionId);
    sessions.delete(sessionId);
}
function rememberSessionPlatform(session, sessionId, platform) {
    if (!platform || platform === "unknown") {
        return;
    }
    session.clientPlatform = platform;
    storeSessionPlatform(sessionId, platform);
}
function restoreSessionPlatform(session, sessionId) {
    if (session.clientPlatform && session.clientPlatform !== "unknown") {
        storeSessionPlatform(sessionId, session.clientPlatform);
        return session.clientPlatform;
    }
    const stored = getStoredSessionPlatform(sessionId);
    if (stored) {
        session.clientPlatform = stored;
        return stored;
    }
    return undefined;
}
function trackHttpSession(sessionId, keyStore) {
    registerHttpSessionKeyStore(sessionId, keyStore);
}
async function createResumedMcpSession(sessionId) {
    const keyStore = new Map();
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
    });
    transport.onclose = () => {
        unregisterHttpSessionKeyStore(sessionId);
        // Keep stored platform so a later resume of the same MCP session id can
        // restore it before telemetry context is built.
        sessions.delete(sessionId);
    };
    await server.connect(transport);
    const clientPlatform = getStoredSessionPlatform(sessionId);
    return {
        server,
        transport,
        keyStore,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        clientPlatform,
    };
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
    const normalizedSessionId = sessionId.trim();
    const clientKey = buildHttpClientKeyFromRequest(req);
    registerHttpSessionKeyStore(normalizedSessionId, session.keyStore);
    const requestBody = body ?? req.body;
    const connectionRef = extractConnectionRefFromMcpBody(requestBody);
    const clientInfo = isInitializeRequest(requestBody)
        ? extractMcpInitializeClientInfo(requestBody)
        : undefined;
    // Restore stored platform before telemetry context is created (rehydration).
    const storedPlatform = restoreSessionPlatform(session, normalizedSessionId);
    // Ordered: resolve connection → restore companies → load telemetry → count → context
    const prepared = await prepareMcpTelemetryContext({
        sessionId: normalizedSessionId,
        keyStore: session.keyStore,
        clientKey,
        connectionRef,
        headers: req.headers,
        clientInfo,
        storedPlatform,
    });
    rememberSessionPlatform(session, normalizedSessionId, prepared.platformDetection.platform);
    const scope = await prepareHttpToolSessionScope(normalizedSessionId, session.keyStore, clientKey, connectionRef);
    // Prefer the prepared connection id when scope resolution lagged behind rehydration.
    if (!scope.connectionId && prepared.connectionId) {
        scope.connectionId = prepared.connectionId;
    }
    return runWithRedTelemetryContext(prepared.context, () => {
        activatePreparedTelemetry(prepared);
        return runWithHttpToolSession(scope, async () => {
            const companiesLoaded = Array.from(session.keyStore.values()).map((entry) => entry.companyName);
            logMcpSessionDiagnostic(buildMcpSessionDiagnostic({
                transportSessionId: normalizedSessionId,
                extra: {
                    requestInfo: {
                        headers: req.headers,
                    },
                },
                resolution: scope.resolution,
                credentialCount: companiesLoaded.length,
                companiesLoaded,
            }));
            if (body !== undefined) {
                await session.transport.handleRequest(req, res, body);
            }
            else {
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
function getBrcEduAdminUploadSecretFromQuery(req) {
    const secret = req.query[BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY];
    if (Array.isArray(secret)) {
        return typeof secret[0] === "string" ? secret[0] : undefined;
    }
    return typeof secret === "string" ? secret : undefined;
}
function authorizeBrcEduAdminHttpRequest(req) {
    return authorizeBrcEduAdminRequest({
        headers: req.headers,
        providedSecret: getBrcEduAdminUploadSecretFromQuery(req),
        returnPath: req.originalUrl || getBrcEduAdminProtectedPath(),
    });
}
function brcEduAdminPageAuthFromResult(authResult, providedSecret) {
    if (authResult.method === "secret" && providedSecret) {
        return { mode: "secret", secret: providedSecret };
    }
    return { mode: "session" };
}
function sendBrcEduAdminAuthFailure(res, authResult, options = {}) {
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
app.use("/assets", express.static(redAssetsDirectory, {
    maxAge: "7d",
    immutable: true,
}));
app.get("/favicon.ico", (_req, res) => {
    res.type("png").sendFile(RED_FAVICON_PATH);
});
app.use(express.urlencoded({ extended: false }));
app.use("/internal/brc-edu/youtube/webhook", express.text({ type: ["application/atom+xml", "application/xml", "text/xml", "text/plain", "*/*"], limit: "1mb" }));
app.use(express.json());
registerFreshdeskPublicImageRoute(app);
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
    const pendingEarly = code ? await getPendingConnection(code) : null;
    // Prefer connection-scoped seed so cookie-less Mistral POSTs do not mint a
    // second fallback after GET already assigned one.
    const resolvedClient = pendingEarly
        ? await resolveAndPersistConnectTelemetryClientId({
            connectionId: pendingEarly.connectionId,
            headers: req.headers,
            body: req.body,
        })
        : resolveTelemetryClientIdFromRequest(req);
    const telemetryClientId = resolvedClient.clientId;
    const secureCookie = req.secure || req.protocol === "https";
    res.setHeader("Set-Cookie", buildTelemetryClientIdSetCookie(telemetryClientId, { secure: secureCookie }));
    const lsFlag = String(req.body.telemetryClientIdLsPresent ?? "");
    logConnectTelemetryFlowDiagnostics(buildConnectTelemetryFlowDiagnostics({
        resolution: resolvedClient,
        code,
        req,
        localStorageIdPresent: lsFlag === "1" || lsFlag === "true",
    }));
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
    try {
        console.info("Red telemetry client id save:", JSON.stringify({
            telemetryClientIdPresent: Boolean(telemetryClientId),
            telemetryClientIdValid: isValidTelemetryUuid(telemetryClientId),
            fallbackGenerated: resolvedClient.fallbackGenerated,
            source: resolvedClient.source,
            targetEnvironment: getDeploymentEnvironmentLabel(),
            targetStoreName: getConnectionStoreTargetName(),
        }));
    }
    catch {
        // ignore
    }
    // Persist client id as soon as the pending code is claimed, before credential
    // validation, so a later session-id write cannot be the first (partial) upsert.
    try {
        await getConnectionStore().saveConnectionTelemetry(pending.connectionId, {
            telemetryClientId,
        });
        const persisted = await getConnectionStore().getConnectionTelemetry(pending.connectionId);
        pathDiagnostics.persistedTelemetryClientIdPresent = Boolean(persisted?.telemetryClientId);
        pathDiagnostics.loadedTelemetryClientIdPresent =
            pathDiagnostics.persistedTelemetryClientIdPresent;
    }
    catch (error) {
        console.error("Red telemetry: failed to store telemetry client id:", error instanceof Error ? error.message : error);
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
                const message = outcome.failedCompanies.length > 0
                    ? outcome.failedCompanies.map((failure) => failure.message).join(" ")
                    : "No companies could be connected because the submitted credentials could not be validated.";
                res.status(400).send(renderConnectionFailedPage(message));
                return;
            }
            for (const session of sessions.values()) {
                const sessionId = session.transport.sessionId;
                if (!sessionId)
                    continue;
                const boundConnectionId = await getConnectionStore().getConnectionIdForSession(sessionId);
                if (boundConnectionId === pending.connectionId) {
                    await reloadSessionCredentialsFromConnectionStore(sessionId, pending.connectionId);
                }
            }
            const issued = await issueConfirmationCodeForConnectToken(code);
            if (!issued) {
                res
                    .status(400)
                    .send(renderConnectionFailedPage("Your companies were connected, but Red could not create a confirmation code. Return to chat and ask Red to start a fresh company connection."));
                return;
            }
            const { path: successPath } = await createConnectionSuccessPage({
                confirmationCode: issued.confirmationCode,
                connectedNames: outcome.connectedCompanies,
                failedCompanies: outcome.failedCompanies,
            });
            applyConnectionSuccessPageHeaders(res);
            // PRG: opaque success id only — confirmation code stays server-side / page body.
            res.redirect(303, successPath);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            res.status(400).send(renderConnectionFailedPage(message));
        }
    });
});
app.post("/mcp", async (req, res) => {
    await ensureConnectionStoreInitialized();
    const sessionId = resolveMcpSessionIdFromRequest(req);
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
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
    const initializeClientInfo = extractMcpInitializeClientInfo(req.body);
    const initializePlatform = resolveClientPlatform({
        clientInfo: initializeClientInfo,
        headers: req.headers,
    });
    logPlatformDetectionDiagnostics(toPlatformDetectionDiagnostics(initializePlatform));
    const keyStore = new Map();
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });
    transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
            unregisterHttpSessionKeyStore(sid);
            // Keep stored platform for same-session resume / rehydration.
            sessions.delete(sid);
        }
    };
    await server.connect(transport);
    const provisionalSession = {
        server,
        transport,
        keyStore,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        clientPlatform: initializePlatform.platform !== "unknown"
            ? initializePlatform.platform
            : undefined,
    };
    const sidAfterInit = transport.sessionId;
    if (sidAfterInit) {
        sessions.set(sidAfterInit, provisionalSession);
        trackHttpSession(sidAfterInit, keyStore);
        rememberSessionPlatform(provisionalSession, sidAfterInit, initializePlatform.platform);
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
        rememberSessionPlatform(provisionalSession, sid, initializePlatform.platform);
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
    // Persist on first GET so duplicate cookie-less opens (Mistral webview /
    // link previews) reuse one canonical id instead of minting another fallback.
    const resolvedClient = await resolveAndPersistConnectTelemetryClientId({
        connectionId: pending.connectionId,
        headers: req.headers,
        body: undefined,
    });
    const clientId = resolvedClient.clientId;
    const secureCookie = req.secure || req.protocol === "https";
    res.setHeader("Set-Cookie", buildTelemetryClientIdSetCookie(clientId, { secure: secureCookie }));
    logConnectTelemetryFlowDiagnostics(buildConnectTelemetryFlowDiagnostics({
        resolution: resolvedClient,
        code,
        req,
        localStorageIdPresent: false,
    }));
    const telemetryContext = buildRequestTelemetryContext({
        req,
        connectionId: pending.connectionId,
        telemetryClientId: clientId,
    });
    return runWithRedTelemetryContext(telemetryContext, () => {
        res.send(renderConnectPage(code, { telemetryClientId: clientId }));
    });
});
app.get("/connect/success/:successId", async (req, res) => {
    await ensureConnectionStoreInitialized();
    applyConnectionSuccessPageHeaders(res);
    const successId = String(req.params.successId ?? "");
    const successPage = await getConnectionSuccessPage(successId);
    if (!successPage) {
        res.status(400).send(renderExpiredLinkPage());
        return;
    }
    // Do not log confirmationCode — it must not appear in access/App Insights URLs.
    res
        .type("html")
        .send(renderSuccessPage(successPage.connectedNames, successPage.confirmationCode, successPage.failedCompanies));
});
app.get("/mcp", async (req, res) => {
    await ensureConnectionStoreInitialized();
    const sessionId = resolveMcpSessionIdFromRequest(req);
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
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
app.post("/internal/brc-edu/resources/sync", (req, res) => {
    const requestSecret = req.headers[BRC_EDU_SYNC_SECRET_HEADER];
    const normalizedSecret = Array.isArray(requestSecret) ? requestSecret[0] : requestSecret;
    const result = handleBrcEduResourcesSyncRequest(req.body, normalizedSecret);
    if (result.status === 200) {
        invalidateEduResourcesCache();
    }
    res.status(result.status).json(result.body);
});
app.get(BRC_EDU_ADMIN_PATH, (req, res) => {
    const providedSecret = getBrcEduAdminUploadSecretFromQuery(req);
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult);
        return;
    }
    const pageAuth = brcEduAdminPageAuthFromResult(authResult, providedSecret);
    const view = parseBrcEduAdminView(req.query.view);
    res.send(renderBrcEduUploadPage(pageAuth, view));
});
app.get("/internal/brc-edu/resources/upload", (req, res) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") {
            query.set(key, value);
        }
        else if (Array.isArray(value) && typeof value[0] === "string") {
            query.set(key, value[0]);
        }
    }
    if (!query.has("view")) {
        query.set("view", "overview");
    }
    const suffix = query.toString();
    res.redirect(302, `${BRC_EDU_ADMIN_PATH}${suffix ? `?${suffix}` : ""}`);
});
app.get("/internal/brc-edu/resources/upload/workbook", (_req, res) => {
    res.status(404).json({ error: "Workbook editing has been removed. Use YouTube video management." });
});
app.put("/internal/brc-edu/resources/upload/workbook", (_req, res) => {
    res.status(404).json({ error: "Workbook editing has been removed. Use YouTube video management." });
});
app.get("/internal/brc-edu/resources/upload/workbook/download", (_req, res) => {
    res
        .status(404)
        .json({ error: "Workbook download has been removed. Use YouTube video management." });
});
app.post("/internal/brc-edu/resources/upload", (_req, res) => {
    res.status(404).json({ error: "Excel/CSV upload has been removed. Use YouTube video management." });
});
app.get(CONTENT_OVERVIEW_API_PATH, async (req, res) => {
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleContentOverview();
    res.status(result.status).json(result.body);
});
app.get("/internal/brc-edu/freshdesk/articles", async (req, res) => {
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleFreshdeskAdminListArticles();
    res.status(result.status).json(result.body);
});
app.post("/internal/brc-edu/freshdesk/sync", async (req, res) => {
    const requestSecret = req.headers[BRC_EDU_SYNC_SECRET_HEADER];
    const normalizedSecret = Array.isArray(requestSecret)
        ? requestSecret[0]
        : requestSecret;
    const serviceAuth = authorizeFreshdeskServiceSyncSecret(typeof normalizedSecret === "string" ? normalizedSecret : undefined);
    if (serviceAuth.ok) {
        const result = await handleFreshdeskServiceSync();
        res.status(result.status).json(result.body);
        return;
    }
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleFreshdeskAdminManualSync();
    res.status(result.status).json(result.body);
});
app.post("/internal/brc-edu/freshdesk/articles/:articleId/visibility", async (req, res) => {
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleFreshdeskVisibilityUpdate({
        articleId: String(req.params.articleId ?? ""),
        body: req.body,
        excludedBy: authResult.identity,
    });
    res.status(result.status).json(result.body);
});
app.get("/internal/brc-edu/youtube/videos", async (req, res) => {
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleYouTubeAdminListVideos();
    res.status(result.status).json(result.body);
});
app.post("/internal/brc-edu/youtube/sync", async (req, res) => {
    const requestSecret = req.headers[BRC_EDU_SYNC_SECRET_HEADER];
    const normalizedSecret = Array.isArray(requestSecret)
        ? requestSecret[0]
        : requestSecret;
    const serviceAuth = authorizeYouTubeServiceSyncSecret(typeof normalizedSecret === "string" ? normalizedSecret : undefined);
    if (serviceAuth.ok) {
        const sourceHeader = req.headers["x-red-youtube-sync-source"];
        const sourceValue = Array.isArray(sourceHeader) ? sourceHeader[0] : sourceHeader;
        const source = sourceValue === "webhook" || sourceValue === "timer" ? sourceValue : "timer";
        const result = await handleYouTubeServiceSync(source);
        res.status(result.status).json(result.body);
        return;
    }
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleYouTubeAdminManualSync();
    res.status(result.status).json(result.body);
});
app.post("/internal/brc-edu/youtube/videos/:videoId/visibility", async (req, res) => {
    const authResult = authorizeBrcEduAdminHttpRequest(req);
    if (!authResult.ok) {
        sendBrcEduAdminAuthFailure(res, authResult, { asJson: true });
        return;
    }
    const result = await handleYouTubeVisibilityUpdate({
        videoId: String(req.params.videoId ?? ""),
        body: req.body,
        excludedBy: authResult.identity,
    });
    res.status(result.status).json(result.body);
});
app.all("/internal/brc-edu/youtube/webhook", async (req, res) => {
    const configuredSecret = process.env.BRC_YOUTUBE_WEBHOOK_SECRET?.trim();
    if (configuredSecret) {
        const headerSecret = req.headers["x-red-youtube-webhook-secret"];
        const provided = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
        const querySecret = typeof req.query.token === "string" ? req.query.token : undefined;
        const candidate = (provided || querySecret || "").trim();
        if (candidate !== configuredSecret) {
            // For hub verification GET, allow hub.verify_token path inside handler.
            if (req.method.toUpperCase() !== "GET") {
                res.status(401).send("Unauthorized.");
                return;
            }
        }
    }
    const handled = handleYouTubeWebhookRequest(req);
    if (handled.contentType) {
        res.setHeader("Content-Type", handled.contentType);
    }
    if (handled.shouldSync) {
        void handleYouTubeServiceSync("webhook").catch(() => {
            // Webhook acknowledgements should not fail the publisher; timer sync recovers.
        });
    }
    if (handled.status === 204) {
        res.status(204).end();
        return;
    }
    res.status(handled.status).send(handled.body ?? "");
});
app.delete("/mcp", async (req, res) => {
    const sessionId = resolveMcpSessionIdFromRequest(req);
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
const httpServer = app.listen(PORT);
httpServer.on("listening", () => {
    console.log(`BRC MCP server (Streamable HTTP) running at http://localhost:${PORT}/mcp`);
});
void (async () => {
    try {
        await ensureConnectionStoreInitialized();
        const storeType = getConnectionStore().getStoreType();
        console.log(`Red connection store: ${storeType}`);
    }
    catch (error) {
        console.error("Red connection store failed to initialize:", error instanceof Error ? error.message : error);
    }
})();
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
