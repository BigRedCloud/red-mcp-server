import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertApiKeyAllowed, getMaxAuditEntries } from "./config/server_config.js";
import {
  clearAllCompaniesFromConnectionStore,
  clearCompanyFromConnectionStore,
  hydrateSessionKeyStoreFromConnectionStore,
  persistCompanyCredentialToConnectionStore,
} from "./auth/connection_persistence.js";
import {
  ensureConnectionIdForSession,
  getCurrentConnectionId,
  getCurrentMcpSessionId,
  runWithMcpSessionContext,
  type McpSessionContext,
} from "./auth/connection_store.js";

export type JsonRecord = Record<string, unknown>;

export type CompanyApiContext = {
  companyName: string;
  apiKey: string;
  expiresAt: number;
};
export type BrcCredential =
  | {
      kind: "apiKey";
      companyName: string;
      apiKey: string;
      expiresAt: number;
    }
  | {
      kind: "oauth";
      companyName: string;
      accessToken: string;
      expiresAt: number;
      refreshToken?: string;
    };

export interface CompanyCredentialProvider {
  getCredential(companyName: string): BrcCredential | null;
  setApiKeyCredential(args: {
    companyName: string;
    apiKey: string;
    expiresAt: number;
  }): void;
  listCompanyNames(): string[];
  clearCredential(companyName: string): boolean;
  clearAllCredentials(): number;
}

export const BRC_API_BASE_URL = (
  process.env.BRC_API_BASE_URL ?? "https://app.bigredcloud.com/api" ).replace(/\/$/, "");

const sessionKeyStorage = new AsyncLocalStorage<Map<string, CompanyApiContext>>();
const globalContexts = new Map<string, CompanyApiContext>();

/**
 * Returns the key store for the current session.
 * In remote (HTTP) mode, each session has its own isolated store.
 * In stdio mode, falls back to a shared global store (single user).
 */
export function getCompanyApiContexts(): Map<string, CompanyApiContext> {
  return sessionKeyStorage.getStore() ?? globalContexts;
}

/* class to get the credentials provider for the current session
* FUTURE DEV: Replace AzureSessionCredentialProvider with an OAuthCredentialProvider
*/
class SessionMemoryCredentialProvider implements CompanyCredentialProvider {
  getCredential(companyName: string): BrcCredential | null {
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

  setApiKeyCredential(args: {
    companyName: string;
    apiKey: string;
    expiresAt: number;
  }): void {
    const key = normaliseCompanyName(args.companyName);

    assertApiKeyAllowed(args.apiKey);

    getCompanyApiContexts().set(key, {
      companyName: args.companyName.trim(),
      apiKey: args.apiKey,
      expiresAt: args.expiresAt,
    });

    void persistCurrentCompanyCredential(args).catch((error) => {
      console.error(
        "Red: failed to persist company credential to connection store:",
        error instanceof Error ? error.message : error
      );
    });
  }

  listCompanyNames(): string[] {
    return Array.from(getCompanyApiContexts().values()).map(
      (context) => context.companyName
    );
  }

  clearCredential(companyName: string): boolean {
    const key = normaliseCompanyName(companyName);
    const deleted = getCompanyApiContexts().delete(key);

    if (deleted) {
      void clearPersistedCompanyCredential(companyName).catch((error) => {
        console.error(
          "Red: failed to clear company credential from connection store:",
          error instanceof Error ? error.message : error
        );
      });
    }

    return deleted;
  }

  clearAllCredentials(): number {
    const store = getCompanyApiContexts();
    const count = store.size;
    store.clear();

    void clearAllPersistedCompanyCredentials().catch((error) => {
      console.error(
        "Red: failed to clear all company credentials from connection store:",
        error instanceof Error ? error.message : error
      );
    });

    return count;
  }
}

let companyCredentialProvider: CompanyCredentialProvider =
  new SessionMemoryCredentialProvider();

export function setCompanyCredentialProvider(
  provider: CompanyCredentialProvider
): void {
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
export function runWithSessionKeyStore<T>(
  store: Map<string, CompanyApiContext>,
  fn: () => T
): T {
  return sessionKeyStorage.run(store, fn);
}

export { runWithMcpSessionContext, getCurrentConnectionId, getCurrentMcpSessionId };
export type { McpSessionContext };

export async function hydrateCurrentSessionFromConnectionStore(
  connectionId: string
): Promise<number> {
  return hydrateSessionKeyStoreFromConnectionStore(
    connectionId,
    getCompanyApiContexts()
  );
}

async function persistCurrentCompanyCredential(args: {
  companyName: string;
  apiKey: string;
  expiresAt: number;
}): Promise<void> {
  const connectionId = getCurrentConnectionId();
  if (!connectionId) return;

  await persistCompanyCredentialToConnectionStore({
    connectionId,
    ...args,
  });
}

async function clearPersistedCompanyCredential(companyName: string): Promise<void> {
  const connectionId = getCurrentConnectionId();
  if (!connectionId) return;

  await clearCompanyFromConnectionStore(connectionId, companyName);
}

async function clearAllPersistedCompanyCredentials(): Promise<void> {
  const connectionId = getCurrentConnectionId();
  if (!connectionId) return;

  await clearAllCompaniesFromConnectionStore(connectionId);
}

export async function ensureMcpSessionReady(
  sessionId: string,
  keyStore?: Map<string, CompanyApiContext>
): Promise<McpSessionContext> {
  const connectionId = await ensureConnectionIdForSession(sessionId);
  const context = { sessionId, connectionId };

  if (keyStore) {
    await hydrateSessionKeyStoreFromConnectionStore(connectionId, keyStore);
  }

  return context;
}

export const companyNameSchema = z
  .string()
  .min(1)
  .describe("Company context name, for example YOUR-COMPANY-NAME.");

export function normaliseCompanyName(companyName: string): string {
  return companyName.trim().toLowerCase();
}

export function getCredentialForCompany(companyName: string): BrcCredential {
  const credential = companyCredentialProvider.getCredential(companyName);

  if (!credential) {
    throw new Error(
      [
        `No company connection is currently stored for "${companyName}".`,
        "",
        "To continue, ask the user to connect the company using the secure Red connection page.",
      ].join("\n")
    );
  }

  if (credential.expiresAt < Date.now()) {
    throw new Error(
      [
        `The connection for "${companyName}" has expired.`,
        "",
        "To continue, ask the user to reconnect the company using the secure Red connection page. Do not ask the user to paste an API key into chat.",
      ].join("\n")
    );
  }

  if (credential.kind === "apiKey") {
    assertApiKeyAllowed(credential.apiKey);
  }

  return credential;
}

/**
 * Backward-compatible helper.
 * Keep this for any existing internal code that still expects a raw API key.
 * New code should prefer getAuthorizationHeaderForCompany().
 */
export function getApiKeyForCompany(companyName: string): string {
  const credential = getCredentialForCompany(companyName);

  if (credential.kind !== "apiKey") {
    throw new Error(
      `The connection for "${companyName}" is not API-key based. Use getAuthorizationHeaderForCompany() instead.`
    );
  }

  return credential.apiKey;
}

export function getAuthorizationHeaderForCompany(companyName: string): string {
  const credential = getCredentialForCompany(companyName);

  if (credential.kind === "apiKey") {
    const auth = Buffer.from(`${credential.apiKey}:`, "utf8").toString("base64");
    return `Basic ${auth}`;
  }

  return `Bearer ${credential.accessToken}`;
}

export function setApiKeyForCompany(args: {
  companyName: string;
  apiKey: string;
  expiresAt: number;
}): void {
  companyCredentialProvider.setApiKeyCredential(args);
}

export function listConnectedCompanyNames(): string[] {
  return companyCredentialProvider.listCompanyNames();
}

export function clearCredentialForCompany(companyName: string): boolean {
  return companyCredentialProvider.clearCredential(companyName);
}

export function clearAllCompanyCredentials(): number {
  return companyCredentialProvider.clearAllCredentials();
}

export function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

export function jsonResponse(data: unknown) {
  return textResponse(JSON.stringify(data, null, 2));
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTimestampFromRecord(record: JsonRecord, label: string): string {
  const timestamp =
    record.timestamp ??
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

function normalizeHttpMethod(init: RequestInit): string {
  return (init.method ?? "GET").toUpperCase();
}

function isWriteHttpMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function parseRequestBody(init: RequestInit): unknown {
  const body = init.body;
  if (typeof body !== "string" || !body.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export type RedAuditEntry = {
  id: number;
  timestamp: string;
  companyName: string;
  method: string;
  path: string;
  action: string;
  recordType: string;
  recordId?: string | number;
  summary: string;
  requestBody?: unknown;
  responseBody?: unknown;
};

const redAuditLog: RedAuditEntry[] = [];
let redAuditCounter = 1;

const RESOURCE_LABELS: Record<string, string> = {
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

const EMAIL_ACTION_LABELS: Record<string, string> = {
  sendSalesInvoice: "Sent sales invoice email",
  sendEmailStatement: "Sent customer statement email",
  sendQuote: "Sent quote email",
};

const PATH_SUBACTION_VERBS = new Set(["close", "reopen", "batch"]);

type ParsedAuditPath = {
  pathname: string;
  resourceKey: string;
  recordType: string;
  recordId?: string | number;
  subAction?: string;
};

function labelForResource(resourceKey: string): string {
  return RESOURCE_LABELS[resourceKey] ?? resourceKey.replace(/([A-Z])/g, " $1").trim();
}

function parseAuditPath(path: string): ParsedAuditPath {
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

function coalesceRecordId(...candidates: unknown[]): string | number | undefined {
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

function describeRecordHint(body: unknown, recordId?: string | number): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return recordId !== undefined ? String(recordId) : "";
  }

  const record = body as JsonRecord;
  const code = record.code ?? record.acCode ?? record.stockCode;
  const label =
    record.name ??
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

function resolveAuditAction(method: string, parsed: ParsedAuditPath): string {
  if (parsed.resourceKey === "email" && parsed.subAction) {
    return EMAIL_ACTION_LABELS[parsed.subAction] ?? "Sent email";
  }

  if (parsed.subAction === "close") return "Closed";
  if (parsed.subAction === "reopen") return "Reopened";
  if (parsed.subAction === "batch") return "Batch processed";

  if (parsed.subAction?.includes("create") && parsed.subAction.includes("Reference")) {
    return "Created";
  }

  if (method === "POST") return "Created";
  if (method === "DELETE") return "Deleted";
  if (method === "PUT" || method === "PATCH") return "Updated";

  return "Changed";
}

function buildAuditSummary(args: {
  companyName: string;
  method: string;
  path: string;
  requestBody?: unknown;
  responseBody?: unknown;
}): {
  action: string;
  recordType: string;
  recordId?: string | number;
  summary: string;
} {
  const parsed = parseAuditPath(args.path);
  const action = resolveAuditAction(args.method, parsed);

  const responseRecord =
    args.responseBody && typeof args.responseBody === "object" && !Array.isArray(args.responseBody)
      ? (args.responseBody as JsonRecord)
      : undefined;

  const requestRecord =
    args.requestBody && typeof args.requestBody === "object" && !Array.isArray(args.requestBody)
      ? (args.requestBody as JsonRecord)
      : undefined;

  const recordId = coalesceRecordId(
    parsed.recordId,
    responseRecord?.id,
    responseRecord?.Id,
    requestRecord?.quoteId,
    requestRecord?.salesInvoiceId,
    requestRecord?.customerId,
    requestRecord?.id
  );

  if (parsed.subAction === "batch" && Array.isArray(args.requestBody)) {
    const count = args.requestBody.length;
    const summary = `${action} ${count} ${parsed.recordType.toLowerCase()}${count === 1 ? "" : "s"} in ${args.companyName}.`;
    return { action, recordType: parsed.recordType, summary };
  }

  const hint = describeRecordHint(args.requestBody, recordId);
  const target = hint || (recordId !== undefined ? String(recordId) : parsed.recordType.toLowerCase());

  let summary: string;
  if (parsed.resourceKey === "email") {
    const emailTarget =
      recordId !== undefined
        ? String(recordId)
        : hint || "recipient";
    summary = `${action} for ${emailTarget} in ${args.companyName}.`;
  } else if (action === "Closed" || action === "Reopened") {
    summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
  } else if (action === "Created") {
    summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
  } else if (action === "Deleted") {
    summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
  } else if (action === "Updated") {
    summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
  } else if (action === "Batch processed") {
    summary = `${action} ${parsed.recordType.toLowerCase()} records in ${args.companyName}.`;
  } else {
    summary = `${action} ${parsed.recordType.toLowerCase()} ${target} in ${args.companyName}.`;
  }

  return {
    action,
    recordType: parsed.recordType,
    recordId,
    summary,
  };
}

export function recordRedAuditEntry(args: {
  companyName: string;
  method: string;
  path: string;
  requestBody?: unknown;
  responseBody?: unknown;
}): RedAuditEntry {
  const meta = buildAuditSummary(args);
  const pathname = args.path.split("?")[0] ?? args.path;

  const entry: RedAuditEntry = {
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

export async function brcFetch(
  companyName: string,
  path: string,
  init: RequestInit = {}
) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const method = normalizeHttpMethod(init);
  const requestBody = parseRequestBody(init);
  const authorization = getAuthorizationHeaderForCompany(companyName);

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
    throw new Error(
      `BRC API ${method} ${safePath} failed for "${companyName}": ${response.status} ${response.statusText}. ${text}`
    );
  }

  let parsedBody: unknown;

  if (!text.trim()) {
    parsedBody = {
      statusCode: response.status,
      statusText: response.statusText,
    };
  } else {
    try {
      parsedBody = JSON.parse(text);
    } catch {
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

export async function brcJsonRequest(
  companyName: string,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
) {
  return brcFetch(companyName, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function extractListItems(data: unknown): JsonRecord[] {
  if (Array.isArray(data)) {
    return data as JsonRecord[];
  }

  if (data && typeof data === "object") {
    const record = data as JsonRecord;
    const items = record.items ?? record.Items;
    if (Array.isArray(items)) {
      return items as JsonRecord[];
    }
  }

  return [];
}

export async function fetchAllNominalAccounts(companyName: string): Promise<JsonRecord[]> {
  const all: JsonRecord[] = [];

  for (let page = 1; page <= 100; page++) {
    const data = (await brcFetch(
      companyName,
      `/v1/nominalAccounts?page=${page}&pageSize=500`
    )) as JsonRecord;
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

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValues);
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, innerValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      const isSensitive = SENSITIVE_FIELD_NAMES.some(
        (sensitive) => sensitive.toLowerCase() === key.toLowerCase()
      );

      result[key] = isSensitive
        ? "<REDACTED>"
        : redactSensitiveValues(innerValue);
    }

    return result;
  }

  return value;
}

export function getRedAuditLog(options?: {
  includeTechnicalDetails?: boolean;
}): RedAuditEntry[] {
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

export function clearRedAuditLog(): number {
  const clearedCount = redAuditLog.length;
  redAuditLog.length = 0;
  return clearedCount;
}
//requested by SM
export function evidenceAnalysisResponse(args: {
  title?: string;
  dataAccessed: string[];
  calculationsOrAssumptions: string[];
  interpretation: string[];
  limitations: string[];
}) {
  return textResponse(
    [
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
      .join("\n")
  );
}
