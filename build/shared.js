import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertApiKeyAllowed, getMaxAuditEntries } from "./config/server_config.js";
import { clearAllCompaniesFromConnectionStore, clearCompanyFromConnectionStore, hydrateSessionKeyStoreFromConnectionStore, persistCompanyCredentialToConnectionStore, } from "./auth/connection_persistence.js";
import { ensureConnectionStoreInitialized, resolveConnectionIdForActiveSession, getCurrentConnectionId, getCurrentMcpSessionId, getMcpSessionContext, LOCAL_STDIO_SESSION_ID, runWithMcpSessionContext, } from "./auth/connection_store.js";
export const BRC_API_BASE_URL = (process.env.BRC_API_BASE_URL ?? "https://app.bigredcloud.com/api").replace(/\/$/, "");
const sessionKeyStorage = new AsyncLocalStorage();
const httpRequestSessionIdStorage = new AsyncLocalStorage();
const httpClientKeyStorage = new AsyncLocalStorage();
const globalContexts = new Map();
const httpSessionKeyStores = new Map();
function credentialDebugEnabled() {
    return process.env.RED_CONNECT_CREDENTIAL_DEBUG?.trim().toLowerCase() === "true";
}
function logCredentialDebug(details) {
    if (!credentialDebugEnabled()) {
        return;
    }
    console.info("Red credential debug:", JSON.stringify(details));
}
/**
 * Binds the active HTTP MCP request to a stable session id for the duration of
 * the request. MCP tool handlers may not preserve other AsyncLocalStorage scopes.
 */
export function runWithHttpRequestSessionId(sessionId, fn) {
    return httpRequestSessionIdStorage.run(sessionId, fn);
}
export function enterHttpRequestSessionId(sessionId) {
    httpRequestSessionIdStorage.enterWith(sessionId);
}
export function enterHttpClientKey(clientKey) {
    httpClientKeyStorage.enterWith(clientKey);
}
export function resolveHttpClientKey() {
    return httpClientKeyStorage.getStore();
}
export function buildHttpClientKey(clientIp) {
    return createHash("sha256").update(clientIp.trim(), "utf8").digest("hex").slice(0, 16);
}
/**
 * Resolves the MCP session id for the current request.
 * Prefers the HTTP request scope, then MCP session context, then stdio fallback.
 */
export function resolveActiveMcpSessionId() {
    const fromHttpRequest = httpRequestSessionIdStorage.getStore();
    if (fromHttpRequest) {
        return fromHttpRequest;
    }
    const fromMcpContext = getMcpSessionContext()?.sessionId;
    if (fromMcpContext) {
        return fromMcpContext;
    }
    if (!process.env.RED_CONNECT_HTTP_MODE) {
        return LOCAL_STDIO_SESSION_ID;
    }
    return undefined;
}
/**
 * Returns the credential map for the active HTTP MCP session, creating and
 * registering one when needed so later tool calls share the same map.
 */
export function resolveSessionKeyStore(sessionId) {
    const registered = httpSessionKeyStores.get(sessionId);
    if (registered) {
        return registered;
    }
    const fromAsyncLocal = sessionKeyStorage.getStore();
    if (fromAsyncLocal) {
        httpSessionKeyStores.set(sessionId, fromAsyncLocal);
        return fromAsyncLocal;
    }
    const created = new Map();
    httpSessionKeyStores.set(sessionId, created);
    return created;
}
/**
 * Registers the in-memory credential map for an HTTP MCP session.
 * Used when AsyncLocalStorage does not propagate into MCP tool handlers.
 */
export function registerHttpSessionKeyStore(sessionId, keyStore) {
    httpSessionKeyStores.set(sessionId, keyStore);
}
export function unregisterHttpSessionKeyStore(sessionId) {
    httpSessionKeyStores.delete(sessionId);
}
export function getRegisteredHttpSessionKeyStore(sessionId) {
    return httpSessionKeyStores.get(sessionId);
}
/**
 * Returns the key store for the current session.
 * In remote (HTTP) mode, each session has its own isolated store.
 * In stdio mode, falls back to a shared global store (single user).
 */
export function getCompanyApiContexts() {
    const sessionId = resolveActiveMcpSessionId();
    if (sessionId) {
        return resolveSessionKeyStore(sessionId);
    }
    const fromAsyncLocal = sessionKeyStorage.getStore();
    if (fromAsyncLocal) {
        return fromAsyncLocal;
    }
    return globalContexts;
}
/* class to get the credentials provider for the current session
* FUTURE DEV: Replace AzureSessionCredentialProvider with an OAuthCredentialProvider
*/
class SessionMemoryCredentialProvider {
    getCredential(companyName) {
        const key = normaliseCompanyName(companyName);
        const context = getCompanyApiContexts().get(key);
        if (!context?.apiKey) {
            return null;
        }
        return {
            kind: "apiKey",
            companyName: context.companyName,
            apiKey: context.apiKey,
            expiresAt: context.expiresAt,
        };
    }
    setApiKeyCredential(args) {
        const key = normaliseCompanyName(args.companyName);
        assertApiKeyAllowed(args.apiKey);
        getCompanyApiContexts().set(key, {
            companyName: args.companyName.trim(),
            apiKey: args.apiKey,
            expiresAt: args.expiresAt,
        });
        void persistCurrentCompanyCredential(args).catch((error) => {
            console.error("Red: failed to persist company credential to connection store:", error instanceof Error ? error.message : error);
        });
    }
    listCompanyNames() {
        return Array.from(getCompanyApiContexts().values()).map((context) => context.companyName);
    }
    clearCredential(companyName) {
        const key = normaliseCompanyName(companyName);
        const deleted = getCompanyApiContexts().delete(key);
        if (deleted) {
            void clearPersistedCompanyCredential(companyName).catch((error) => {
                console.error("Red: failed to clear company credential from connection store:", error instanceof Error ? error.message : error);
            });
        }
        return deleted;
    }
    clearAllCredentials() {
        const store = getCompanyApiContexts();
        const count = store.size;
        store.clear();
        void clearAllPersistedCompanyCredentials().catch((error) => {
            console.error("Red: failed to clear all company credentials from connection store:", error instanceof Error ? error.message : error);
        });
        return count;
    }
}
let companyCredentialProvider = new SessionMemoryCredentialProvider();
export function setCompanyCredentialProvider(provider) {
    companyCredentialProvider = provider;
}
/** @deprecated Use getCompanyApiContexts() — kept for backward compatibility */
export const companyApiContexts = new Proxy(globalContexts, {
    get(_target, prop, receiver) {
        const store = sessionKeyStorage.getStore() ?? globalContexts;
        const value = Reflect.get(store, prop, receiver);
        return typeof value === "function" ? value.bind(store) : value;
    },
});
/**
 * Runs an async function with an isolated per-session key store.
 * Used by the remote HTTP server to scope API keys per session.
 */
export function runWithSessionKeyStore(store, fn) {
    return sessionKeyStorage.run(store, fn);
}
export function enterSessionKeyStore(store) {
    sessionKeyStorage.enterWith(store);
}
export { runWithMcpSessionContext, getCurrentConnectionId, getCurrentMcpSessionId };
export async function hydrateCurrentSessionFromConnectionStore(connectionId) {
    return reloadSessionCredentialsFromConnectionStore(getCurrentMcpSessionId(), connectionId);
}
/**
 * Clears and reloads decoded company credentials for an HTTP MCP session
 * from the active connection store (memory or Cosmos).
 */
export async function reloadSessionCredentialsFromConnectionStore(sessionId, connectionId) {
    const keyStore = sessionId
        ? resolveSessionKeyStore(sessionId)
        : getCompanyApiContexts();
    keyStore.clear();
    return hydrateSessionKeyStoreFromConnectionStore(connectionId, keyStore);
}
/**
 * Reloads decoded company credentials from the connection store into the
 * active session map when they are missing or stale. Safe to call before every
 * BRC API request in hosted MCP clients where in-memory context may be lost.
 */
export async function ensureCredentialsForCurrentSession(companyName) {
    const sessionId = resolveActiveMcpSessionId()?.trim();
    if (!sessionId) {
        logCredentialDebug({ step: "ensureCredentials", reason: "no_session_id" });
        return;
    }
    await ensureConnectionStoreInitialized();
    const connectionId = await resolveConnectionIdForActiveSession({
        sessionId,
        clientKey: resolveHttpClientKey(),
    });
    if (!connectionId) {
        logCredentialDebug({
            step: "ensureCredentials",
            sessionId,
            connectionId: null,
            clientKeyPresent: Boolean(resolveHttpClientKey()),
            reason: "no_bound_connection",
        });
        return;
    }
    const keyStore = resolveSessionKeyStore(sessionId);
    registerHttpSessionKeyStore(sessionId, keyStore);
    if (companyName) {
        const key = normaliseCompanyName(companyName);
        const existing = keyStore.get(key);
        if (existing?.apiKey && existing.expiresAt >= Date.now()) {
            logCredentialDebug({
                step: "ensureCredentials",
                sessionId,
                connectionId,
                loadedCompanyNames: listLoadedCompanyNames(keyStore),
                requestedCompany: companyName,
                requestedCompanyLoaded: true,
                reloaded: false,
            });
            return;
        }
    }
    else if (keyStore.size > 0) {
        const allValid = Array.from(keyStore.values()).every((entry) => entry.apiKey && entry.expiresAt >= Date.now());
        if (allValid) {
            logCredentialDebug({
                step: "ensureCredentials",
                sessionId,
                connectionId,
                loadedCompanyNames: listLoadedCompanyNames(keyStore),
                reloaded: false,
            });
            return;
        }
    }
    const loadedCount = await reloadSessionCredentialsFromConnectionStore(sessionId, connectionId);
    const requestedKey = companyName
        ? normaliseCompanyName(companyName)
        : undefined;
    logCredentialDebug({
        step: "ensureCredentials",
        sessionId,
        connectionId,
        loadedCount,
        loadedCompanyNames: listLoadedCompanyNames(keyStore),
        requestedCompany: companyName,
        requestedCompanyLoaded: requestedKey
            ? keyStore.has(requestedKey)
            : undefined,
        reloaded: true,
    });
}
function listLoadedCompanyNames(keyStore) {
    return Array.from(keyStore.values()).map((entry) => entry.companyName);
}
async function persistCurrentCompanyCredential(args) {
    const connectionId = getCurrentConnectionId();
    if (!connectionId)
        return;
    await persistCompanyCredentialToConnectionStore({
        connectionId,
        ...args,
    });
}
async function clearPersistedCompanyCredential(companyName) {
    const connectionId = getCurrentConnectionId();
    if (!connectionId)
        return;
    await clearCompanyFromConnectionStore(connectionId, companyName);
}
async function clearAllPersistedCompanyCredentials() {
    const connectionId = getCurrentConnectionId();
    if (!connectionId)
        return;
    await clearAllCompaniesFromConnectionStore(connectionId);
}
export async function ensureMcpSessionReady(sessionId, keyStore) {
    if (keyStore) {
        registerHttpSessionKeyStore(sessionId, keyStore);
    }
    const connectionId = (await resolveConnectionIdForActiveSession({
        sessionId,
        clientKey: resolveHttpClientKey(),
    })) ?? "";
    await ensureCredentialsForCurrentSession();
    return { sessionId, connectionId };
}
export const companyNameSchema = z
    .string()
    .min(1)
    .describe("Company context name, for example YOUR-COMPANY-NAME.");
export function normaliseCompanyName(companyName) {
    return companyName.trim().toLowerCase();
}
export async function getCredentialForCompanyAsync(companyName) {
    await ensureCredentialsForCurrentSession(companyName);
    return getCredentialForCompany(companyName);
}
export function getCredentialForCompany(companyName) {
    const credential = companyCredentialProvider.getCredential(companyName);
    if (!credential) {
        throw new Error([
            `No company connection is currently stored for "${companyName}".`,
            "",
            "To continue, ask the user to connect the company using the secure Red connection page.",
        ].join("\n"));
    }
    if (credential.expiresAt < Date.now()) {
        throw new Error([
            `The connection for "${companyName}" has expired.`,
            "",
            "To continue, ask the user to reconnect the company using the secure Red connection page. Do not ask the user to paste an API key into chat.",
        ].join("\n"));
    }
    if (credential.kind === "apiKey") {
        assertApiKeyAllowed(credential.apiKey);
    }
    return credential;
}
export async function getApiKeyForCompanyAsync(companyName) {
    const credential = await getCredentialForCompanyAsync(companyName);
    if (credential.kind !== "apiKey") {
        throw new Error(`The connection for "${companyName}" is not API-key based. Use getAuthorizationHeaderForCompany() instead.`);
    }
    return credential.apiKey;
}
/**
 * Backward-compatible helper.
 * Keep this for any existing internal code that still expects a raw API key.
 * New code should prefer getAuthorizationHeaderForCompanyAsync().
 */
export function getApiKeyForCompany(companyName) {
    const credential = getCredentialForCompany(companyName);
    if (credential.kind !== "apiKey") {
        throw new Error(`The connection for "${companyName}" is not API-key based. Use getAuthorizationHeaderForCompany() instead.`);
    }
    return credential.apiKey;
}
export async function getAuthorizationHeaderForCompanyAsync(companyName) {
    const credential = await getCredentialForCompanyAsync(companyName);
    if (credential.kind === "apiKey") {
        const auth = Buffer.from(`${credential.apiKey}:`, "utf8").toString("base64");
        return `Basic ${auth}`;
    }
    return `Bearer ${credential.accessToken}`;
}
export function getAuthorizationHeaderForCompany(companyName) {
    const credential = getCredentialForCompany(companyName);
    if (credential.kind === "apiKey") {
        const auth = Buffer.from(`${credential.apiKey}:`, "utf8").toString("base64");
        return `Basic ${auth}`;
    }
    return `Bearer ${credential.accessToken}`;
}
export function setApiKeyForCompany(args) {
    companyCredentialProvider.setApiKeyCredential(args);
}
export function listConnectedCompanyNames() {
    return companyCredentialProvider.listCompanyNames();
}
export function clearCredentialForCompany(companyName) {
    return companyCredentialProvider.clearCredential(companyName);
}
export function clearAllCompanyCredentials() {
    return companyCredentialProvider.clearAllCredentials();
}
export function textResponse(text) {
    return {
        content: [
            {
                type: "text",
                text,
            },
        ],
    };
}
export function jsonResponse(data) {
    return textResponse(JSON.stringify(data, null, 2));
}
export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
export function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
export function toNumber(value) {
    if (value === null || value === undefined || value === "")
        return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
export function getTimestampFromRecord(record, label) {
    const timestamp = record.timestamp ??
        record.Timestamp ??
        record.timeStamp ??
        record.TimeStamp ??
        record.rowVersion ??
        record.RowVersion;
    if (!timestamp || typeof timestamp !== "string") {
        throw new Error(`Could not read timestamp for ${label}.`);
    }
    return timestamp;
}
function normalizeHttpMethod(init) {
    return (init.method ?? "GET").toUpperCase();
}
function isWriteHttpMethod(method) {
    return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
function parseRequestBody(init) {
    const body = init.body;
    if (typeof body !== "string" || !body.trim()) {
        return undefined;
    }
    try {
        return JSON.parse(body);
    }
    catch {
        return body;
    }
}
const redAuditLog = [];
let redAuditCounter = 1;
const RESOURCE_LABELS = {
    accounts: "Account",
    accruals: "Accrual",
    allocationResolvers: "Allocation resolver",
    analysisCategories: "Analysis category",
    bankAccounts: "Bank account",
    bookTranTypes: "Book transaction type",
    cashPayments: "Cash payment",
    cashReceipts: "Cash receipt",
    categoryTypes: "Category type",
    customers: "Customer",
    email: "Email",
    nominalAccounts: "Nominal account",
    nominalJournalBatches: "Nominal journal batch",
    ownerTypeGroups: "Owner type group",
    ownerTypes: "Owner type",
    payments: "Payment",
    prepayments: "Prepayment",
    products: "Product",
    productTypes: "Product type",
    purchases: "Purchase",
    quotes: "Quote",
    salesCreditNotes: "Sales credit note",
    salesEntries: "Sales entry",
    salesInvoices: "Sales invoice",
    salesReps: "Sales rep",
    suppliers: "Supplier",
    userDefinedFields: "User defined field",
    vatAnalysisTypes: "VAT analysis type",
    vatCategories: "VAT category",
    vatRates: "VAT rate",
    vatTypes: "VAT type",
    companySettings: "Company setting",
};
const EMAIL_ACTION_LABELS = {
    sendSalesInvoice: "Sent sales invoice email",
    sendEmailStatement: "Sent customer statement email",
    sendQuote: "Sent quote email",
};
const PATH_SUBACTION_VERBS = new Set(["close", "reopen", "batch"]);
function labelForResource(resourceKey) {
    return RESOURCE_LABELS[resourceKey] ?? resourceKey.replace(/([A-Z])/g, " $1").trim();
}
function parseAuditPath(path) {
    const pathname = path.split("?")[0] ?? path;
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] !== "v1" || segments.length < 2) {
        return {
            pathname,
            resourceKey: "record",
            recordType: "Record",
        };
    }
    const resourceKey = segments[1];
    const rest = segments.slice(2);
    const recordType = labelForResource(resourceKey);
    if (rest.length === 0) {
        return { pathname, resourceKey, recordType };
    }
    const last = rest[rest.length - 1];
    const secondLast = rest.length >= 2 ? rest[rest.length - 2] : undefined;
    if (resourceKey === "email" && rest.length === 1) {
        return {
            pathname,
            resourceKey,
            recordType: "Email",
            subAction: rest[0],
        };
    }
    if (secondLast && PATH_SUBACTION_VERBS.has(secondLast)) {
        return {
            pathname,
            resourceKey,
            recordType,
            subAction: secondLast,
            recordId: last,
        };
    }
    if (rest.length === 1) {
        if (/^\d+$/.test(rest[0])) {
            return {
                pathname,
                resourceKey,
                recordType,
                recordId: rest[0],
            };
        }
        return {
            pathname,
            resourceKey,
            recordType,
            subAction: rest[0],
        };
    }
    if (/^\d+$/.test(last)) {
        return {
            pathname,
            resourceKey,
            recordType,
            recordId: last,
        };
    }
    return { pathname, resourceKey, recordType };
}
function coalesceRecordId(...candidates) {
    for (const candidate of candidates) {
        if (candidate === null || candidate === undefined || candidate === "") {
            continue;
        }
        if (typeof candidate === "string" || typeof candidate === "number") {
            return candidate;
        }
    }
    return undefined;
}
function describeRecordHint(body, recordId) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return recordId !== undefined ? String(recordId) : "";
    }
    const record = body;
    const code = record.code ?? record.acCode ?? record.stockCode;
    const label = record.name ??
        record.details ??
        record.accountName ??
        record.reference ??
        record.customerOwnerName;
    if (label && code) {
        return `${label} (${code})`;
    }
    if (label) {
        return String(label);
    }
    if (code) {
        return String(code);
    }
    return recordId !== undefined ? String(recordId) : "";
}
function resolveAuditAction(method, parsed) {
    if (parsed.resourceKey === "email" && parsed.subAction) {
        return EMAIL_ACTION_LABELS[parsed.subAction] ?? "Sent email";
    }
    if (parsed.subAction === "close")
        return "Closed";
    if (parsed.subAction === "reopen")
        return "Reopened";
    if (parsed.subAction === "batch")
        return "Batch processed";
    if (parsed.subAction?.includes("create") && parsed.subAction.includes("Reference")) {
        return "Created";
    }
    if (method === "POST")
        return "Created";
    if (method === "DELETE")
        return "Deleted";
    if (method === "PUT" || method === "PATCH")
        return "Updated";
    return "Changed";
}
function buildAuditSummary(args) {
    const parsed = parseAuditPath(args.path);
    const action = resolveAuditAction(args.method, parsed);
    const responseRecord = args.responseBody && typeof args.responseBody === "object" && !Array.isArray(args.responseBody)
        ? args.responseBody
        : undefined;
    const requestRecord = args.requestBody && typeof args.requestBody === "object" && !Array.isArray(args.requestBody)
        ? args.requestBody
        : undefined;
    const recordId = coalesceRecordId(parsed.recordId, responseRecord?.id, responseRecord?.Id, requestRecord?.quoteId, requestRecord?.salesInvoiceId, requestRecord?.customerId, requestRecord?.id);
    if (parsed.subAction === "batch" && Array.isArray(args.requestBody)) {
        const count = args.requestBody.length;
        const summary = `${action} ${count} ${parsed.recordType.toLowerCase()}${count === 1 ? "" : "s"} in ${args.companyName}.`;
        return { action, recordType: parsed.recordType, summary };
    }
    const hint = describeRecordHint(args.requestBody, recordId);
    const target = hint || (recordId !== undefined ? String(recordId) : parsed.recordType.toLowerCase());
    let summary;
    if (parsed.resourceKey === "email") {
        const emailTarget = recordId !== undefined
            ? String(recordId)
            : hint || "recipient";
        summary = `${action} for ${emailTarget} in ${args.companyName}.`;
    }
    else if (action === "Closed" || action === "Reopened") {
        summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
    }
    else if (action === "Created") {
        summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
    }
    else if (action === "Deleted") {
        summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
    }
    else if (action === "Updated") {
        summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
    }
    else if (action === "Batch processed") {
        summary = `${action} ${parsed.recordType.toLowerCase()} records in ${args.companyName}.`;
    }
    else {
        summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
    }
    return {
        action,
        recordType: parsed.recordType,
        recordId,
        summary,
    };
}
export function recordRedAuditEntry(args) {
    const meta = buildAuditSummary(args);
    const pathname = args.path.split("?")[0] ?? args.path;
    const entry = {
        id: redAuditCounter++,
        timestamp: new Date().toISOString(),
        companyName: args.companyName,
        method: args.method,
        path: pathname,
        action: meta.action,
        recordType: meta.recordType,
        recordId: meta.recordId,
        summary: meta.summary,
        requestBody: args.requestBody,
        responseBody: args.responseBody,
    };
    redAuditLog.push(entry);
    const maxAuditEntries = getMaxAuditEntries();
    if (redAuditLog.length > maxAuditEntries) {
        redAuditLog.splice(0, redAuditLog.length - maxAuditEntries);
    }
    return entry;
}
export async function brcFetch(companyName, path, init = {}) {
    const safePath = path.startsWith("/") ? path : `/${path}`;
    const method = normalizeHttpMethod(init);
    const requestBody = parseRequestBody(init);
    const authorization = await getAuthorizationHeaderForCompanyAsync(companyName);
    const response = await fetch(`${BRC_API_BASE_URL}${safePath}`, {
        ...init,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: authorization,
            ...(init.headers ?? {}),
        },
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`BRC API ${method} ${safePath} failed for "${companyName}": ${response.status} ${response.statusText}. ${text}`);
    }
    let parsedBody;
    if (!text.trim()) {
        parsedBody = {
            statusCode: response.status,
            statusText: response.statusText,
        };
    }
    else {
        try {
            parsedBody = JSON.parse(text);
        }
        catch {
            parsedBody = text;
        }
    }
    if (isWriteHttpMethod(method)) {
        recordRedAuditEntry({
            companyName,
            method,
            path: safePath,
            requestBody,
            responseBody: parsedBody,
        });
    }
    return parsedBody;
}
export async function brcJsonRequest(companyName, method, path, body) {
    return brcFetch(companyName, path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
export function extractListItems(data) {
    if (Array.isArray(data)) {
        return data;
    }
    if (data && typeof data === "object") {
        const record = data;
        const items = record.items ?? record.Items;
        if (Array.isArray(items)) {
            return items;
        }
    }
    return [];
}
export async function fetchAllNominalAccounts(companyName) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
        const data = (await brcFetch(companyName, `/v1/nominalAccounts?page=${page}&pageSize=500`));
        const items = extractListItems(data);
        all.push(...items);
        const nextPageLink = data.NextPageLink ?? data.nextPageLink;
        if (!nextPageLink || items.length < 500) {
            break;
        }
    }
    return all;
}
const SENSITIVE_FIELD_NAMES = [
    "apiKey",
    "api_key",
    "apikey",
    "key",
    "token",
    "accessToken",
    "refreshToken",
    "password",
    "secret",
    "authorization",
    "Authorization",
];
function redactSensitiveValues(value) {
    if (Array.isArray(value)) {
        return value.map(redactSensitiveValues);
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, innerValue] of Object.entries(value)) {
            const isSensitive = SENSITIVE_FIELD_NAMES.some((sensitive) => sensitive.toLowerCase() === key.toLowerCase());
            result[key] = isSensitive
                ? "<REDACTED>"
                : redactSensitiveValues(innerValue);
        }
        return result;
    }
    return value;
}
export function getRedAuditLog(options) {
    if (options?.includeTechnicalDetails) {
        return redAuditLog.map((entry) => ({
            ...entry,
            requestBody: redactSensitiveValues(entry.requestBody),
            responseBody: redactSensitiveValues(entry.responseBody),
        }));
    }
    return redAuditLog.map((entry) => ({
        id: entry.id,
        timestamp: entry.timestamp,
        companyName: entry.companyName,
        method: entry.method,
        action: entry.action,
        recordType: entry.recordType,
        recordId: entry.recordId,
        summary: entry.summary,
        path: entry.path,
    }));
}
export function clearRedAuditLog() {
    const clearedCount = redAuditLog.length;
    redAuditLog.length = 0;
    return clearedCount;
}
//requested by SM
export function evidenceAnalysisResponse(args) {
    return textResponse([
        args.title ? `# ${args.title}` : "",
        "## Data accessed",
        ...args.dataAccessed.map((x) => `- ${x}`),
        "",
        "## Calculations / assumptions",
        ...args.calculationsOrAssumptions.map((x) => `- ${x}`),
        "",
        "## Interpretation of data",
        ...args.interpretation.map((x) => `- ${x}`),
        "",
        "## Limitations / checks recommended",
        ...args.limitations.map((x) => `- ${x}`),
    ]
        .filter(Boolean)
        .join("\n"));
}
