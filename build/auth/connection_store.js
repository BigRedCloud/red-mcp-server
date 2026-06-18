import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { CosmosConnectionStore } from "./cosmos_connection_store.js";
import { MemoryConnectionStore } from "./memory_connection_store.js";
const CONNECTION_CODE_TTL_MS = 10 * 60 * 1000;
const mcpSessionContextStorage = new AsyncLocalStorage();
let connectionStore = null;
let connectionStoreInitPromise = null;
export function getConnectionStoreKind() {
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
function resolveCosmosConnectionString() {
    return process.env.RED_CONNECT_COSMOS_CONNECTION_STRING?.trim() || "";
}
function resolveCosmosDatabaseId() {
    return process.env.RED_CONNECT_COSMOS_DATABASE?.trim() || "red-connect";
}
function resolveCosmosContainerId() {
    return process.env.RED_CONNECT_COSMOS_CONTAINER?.trim() || "connections";
}
export function getConnectionStore() {
    if (connectionStore) {
        return connectionStore;
    }
    const kind = getConnectionStoreKind();
    if (kind === "cosmos") {
        const connectionString = resolveCosmosConnectionString();
        if (!connectionString) {
            throw new Error("RED_CONNECT_CONNECTION_STORE=cosmos requires RED_CONNECT_COSMOS_CONNECTION_STRING.");
        }
        connectionStore = new CosmosConnectionStore(connectionString, resolveCosmosDatabaseId(), resolveCosmosContainerId());
        return connectionStore;
    }
    connectionStore = new MemoryConnectionStore();
    return connectionStore;
}
export async function ensureConnectionStoreInitialized() {
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
export function runWithMcpSessionContext(context, fn) {
    return mcpSessionContextStorage.run(context, fn);
}
export function getMcpSessionContext() {
    return mcpSessionContextStorage.getStore();
}
export function getCurrentMcpSessionId() {
    const fromContext = getMcpSessionContext()?.sessionId;
    if (fromContext) {
        return fromContext;
    }
    if (!process.env.RED_CONNECT_HTTP_MODE) {
        return LOCAL_STDIO_SESSION_ID;
    }
    return undefined;
}
export function getCurrentConnectionId() {
    const fromContext = getMcpSessionContext()?.connectionId;
    if (fromContext) {
        return fromContext;
    }
    if (!process.env.RED_CONNECT_HTTP_MODE) {
        return LOCAL_STDIO_CONNECTION_ID;
    }
    return undefined;
}
export async function ensureConnectionIdForSession(sessionId) {
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const existing = await store.getConnectionIdForSession(sessionId);
    if (existing) {
        return existing;
    }
    const connectionId = randomUUID();
    await store.bindSessionToConnection(sessionId, connectionId);
    return connectionId;
}
export async function createPendingConnection(sessionId) {
    await ensureConnectionStoreInitialized();
    const connectionId = await ensureConnectionIdForSession(sessionId);
    const code = crypto.randomBytes(16).toString("hex");
    await getConnectionStore().createPendingConnection({
        code,
        connectionId,
        expiresAt: Date.now() + CONNECTION_CODE_TTL_MS,
    });
    return { code, connectionId };
}
export const LOCAL_STDIO_SESSION_ID = "local-stdio";
export const LOCAL_STDIO_CONNECTION_ID = "local-stdio";
export async function ensureLocalStdioSessionContext() {
    const store = getConnectionStore();
    await store.bindSessionToConnection(LOCAL_STDIO_SESSION_ID, LOCAL_STDIO_CONNECTION_ID);
    return {
        sessionId: LOCAL_STDIO_SESSION_ID,
        connectionId: LOCAL_STDIO_CONNECTION_ID,
    };
}
