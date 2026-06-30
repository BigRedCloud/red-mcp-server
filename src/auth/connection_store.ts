import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { redServerConfig } from "../config/server_config.js";
import {
  isPendingConnectionExpired,
  PENDING_CONNECTION_NEVER_EXPIRES_AT,
} from "./connection_pending.js";
import { CosmosConnectionStore } from "./cosmos_connection_store.js";
import type { ConnectionStore } from "./connection_store_types.js";
import { MemoryConnectionStore } from "./memory_connection_store.js";

export type ConnectionStoreKind = "memory" | "cosmos";

export type McpSessionContext = {
  sessionId: string;
  connectionId: string;
};


const CLIENT_CLAIM_INHERIT_TTL_MS =
  redServerConfig.sessionTtlMinutes * 60 * 1000;

const mcpSessionContextStorage = new AsyncLocalStorage<McpSessionContext>();

let connectionStore: ConnectionStore | null = null;
let connectionStoreInitPromise: Promise<void> | null = null;

export function getConnectionStoreKind(): ConnectionStoreKind {
  const configured = process.env.RED_CONNECT_CONNECTION_STORE?.trim().toLowerCase();

  if (configured === "cosmos") {
    return "cosmos";
  }

  // Backward compatibility for older deployments.
  if (configured === "azure-table") {
    return "cosmos";
  }

  return "memory";
}

function resolveCosmosConnectionString(): string {
  return process.env.RED_CONNECT_COSMOS_CONNECTION_STRING?.trim() || "";
}

function resolveCosmosDatabaseId(): string {
  return process.env.RED_CONNECT_COSMOS_DATABASE?.trim() || "red-connect";
}

function resolveCosmosContainerId(): string {
  return process.env.RED_CONNECT_COSMOS_CONTAINER?.trim() || "connections";
}

export function getConnectionStore(): ConnectionStore {
  if (connectionStore) {
    return connectionStore;
  }

  const kind = getConnectionStoreKind();

  if (kind === "cosmos") {
    const connectionString = resolveCosmosConnectionString();
    if (!connectionString) {
      throw new Error(
        "RED_CONNECT_CONNECTION_STORE=cosmos requires RED_CONNECT_COSMOS_CONNECTION_STRING."
      );
    }

    connectionStore = new CosmosConnectionStore(
      connectionString,
      resolveCosmosDatabaseId(),
      resolveCosmosContainerId()
    );
    return connectionStore;
  }

  connectionStore = new MemoryConnectionStore();
  return connectionStore;
}

export async function ensureConnectionStoreInitialized(): Promise<void> {
  if (!connectionStoreInitPromise) {
    connectionStoreInitPromise = (async () => {
      const store = getConnectionStore();
      if (store instanceof CosmosConnectionStore) {
        await store.initialize();
      }
    })();
  }

  await connectionStoreInitPromise;
}

export function runWithMcpSessionContext<T>(
  context: McpSessionContext,
  fn: () => T
): T {
  return mcpSessionContextStorage.run(context, fn);
}

export function enterMcpSessionContext(context: McpSessionContext): void {
  mcpSessionContextStorage.enterWith(context);
}

export function getMcpSessionContext(): McpSessionContext | undefined {
  return mcpSessionContextStorage.getStore();
}

export function getCurrentMcpSessionId(): string | undefined {
  const fromContext = getMcpSessionContext()?.sessionId;
  if (fromContext) {
    return fromContext;
  }

  if (!process.env.RED_CONNECT_HTTP_MODE) {
    return LOCAL_STDIO_SESSION_ID;
  }

  return undefined;
}

export function getCurrentConnectionId(): string | undefined {
  const fromContext = getMcpSessionContext()?.connectionId;
  if (fromContext) {
    return fromContext;
  }

  if (!process.env.RED_CONNECT_HTTP_MODE) {
    return LOCAL_STDIO_CONNECTION_ID;
  }

  return undefined;
}

export async function getBoundConnectionIdForSession(
  sessionId: string
): Promise<string | null> {
  await ensureConnectionStoreInitialized();
  return getConnectionStore().getConnectionIdForSession(sessionId.trim());
}

/**
 * Resolves the connection id for credential loading. Uses the session binding
 * first, then inherits a recent claim from the same client (scoped by IP hash)
 * so hosted MCP clients that rotate MCP session ids can still access companies.
 */
export async function resolveConnectionIdForActiveSession(args: {
  sessionId: string;
  clientKey?: string;
}): Promise<string | null> {
  await ensureConnectionStoreInitialized();

  const normalizedSessionId = args.sessionId.trim();
  const store = getConnectionStore();
  const bound = await store.getConnectionIdForSession(normalizedSessionId);
  if (bound) {
    return bound;
  }

  if (!args.clientKey) {
    return null;
  }

  const inherited = await store.getRecentClientClaim(
    args.clientKey,
    CLIENT_CLAIM_INHERIT_TTL_MS
  );
  if (!inherited) {
    return null;
  }

  await store.bindSessionToConnection(normalizedSessionId, inherited);
  return inherited;
}

export async function ensureConnectionIdForSession(
  sessionId: string
): Promise<string> {
  await ensureConnectionStoreInitialized();

  const normalizedSessionId = sessionId.trim();
  const store = getConnectionStore();
  const existing = await store.getConnectionIdForSession(normalizedSessionId);
  if (existing) {
    return existing;
  }

  const connectionId = randomUUID();
  await store.bindSessionToConnection(normalizedSessionId, connectionId);
  return connectionId;
}

export type ClaimConnectionResult = {
  connectionId: string;
  companyNames: string[];
};

export class ClaimConnectionError extends Error {
  readonly reason: "not_found" | "not_completed" | "no_companies";

  constructor(
    message: string,
    reason: "not_found" | "not_completed" | "no_companies"
  ) {
    super(message);
    this.name = "ClaimConnectionError";
    this.reason = reason;
  }
}

export async function claimConnectionCodeForSession(
  code: string,
  sessionId: string,
  options?: { clientKey?: string }
): Promise<ClaimConnectionResult> {
  await ensureConnectionStoreInitialized();

  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new ClaimConnectionError(
      "A connection code is required. Please ask for a new secure Red connection link and try again.",
      "not_found"
    );
  }

  const store = getConnectionStore();
  const pending = await store.getConnectionByCode(trimmedCode);

  if (!pending) {
    throw new ClaimConnectionError(
      "That connection code is missing, incorrect, or has already been used. Please ask for a new secure Red connection link and try again.",
      "not_found"
    );
  }

  if (!pending.used) {
    throw new ClaimConnectionError(
      "That connection code has not been completed yet. Open the secure Red connection page, submit your company details, then return here and confirm the connection code.",
      "not_completed"
    );
  }

  const companies = await store.listConnectedCompanies(pending.connectionId);
  if (companies.length === 0) {
    throw new ClaimConnectionError(
      "No companies were found for that connection code. Please submit the secure Red connection page first, then confirm the connection code again.",
      "no_companies"
    );
  }

  const normalizedSessionId = sessionId.trim();
  await store.bindSessionToConnection(normalizedSessionId, pending.connectionId);

  const claimedAt = Date.now();
  if (options?.clientKey) {
    await store.recordClientClaim({
      clientKey: options.clientKey,
      connectionId: pending.connectionId,
      claimedAt,
    });
  }

  return {
    connectionId: pending.connectionId,
    companyNames: companies.map((company) => company.companyName),
  };
}

export async function createPendingConnection(
  sessionId: string
): Promise<{ code: string; connectionId: string }> {
  await ensureConnectionStoreInitialized();

  const connectionId = await ensureConnectionIdForSession(sessionId);
  const code = crypto.randomBytes(16).toString("hex");

  await getConnectionStore().createPendingConnection({
    code,
    connectionId,
    expiresAt: PENDING_CONNECTION_NEVER_EXPIRES_AT,
  });

  return { code, connectionId };
}

export const LOCAL_STDIO_SESSION_ID = "local-stdio";
export const LOCAL_STDIO_CONNECTION_ID = "local-stdio";

export async function ensureLocalStdioSessionContext(): Promise<McpSessionContext> {
  const store = getConnectionStore();
  await store.bindSessionToConnection(
    LOCAL_STDIO_SESSION_ID,
    LOCAL_STDIO_CONNECTION_ID
  );

  return {
    sessionId: LOCAL_STDIO_SESSION_ID,
    connectionId: LOCAL_STDIO_CONNECTION_ID,
  };
}
