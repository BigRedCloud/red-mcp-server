import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { redServerConfig } from "../config/server_config.js";
import { PENDING_CONNECTION_NEVER_EXPIRES_AT, } from "./connection_pending.js";
import { CosmosConnectionStore } from "./cosmos_connection_store.js";
import { MemoryConnectionStore } from "./memory_connection_store.js";
import { FRESH_CONNECTION_LINK_CLAIM_GUIDANCE } from "./connection_wording.js";
import { issueConnectionRef } from "./connection_ref.js";
import { revalidateStoredConnectionCompanies } from "./connection_persistence.js";
import { generateConnectionSessionId } from "../telemetry/identity.js";
const CLIENT_CLAIM_INHERIT_TTL_MS = redServerConfig.sessionTtlMinutes * 60 * 1000;
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
/**
 * Safe store label for diagnostics (kind + db/container names only — never the
 * connection string). Example: `cosmos:red-connect/connections` or `memory`.
 */
export function getConnectionStoreTargetName() {
    const kind = getConnectionStoreKind();
    if (kind === "cosmos") {
        return `cosmos:${resolveCosmosDatabaseId()}/${resolveCosmosContainerId()}`;
    }
    return "memory";
}
export function getDeploymentEnvironmentLabel() {
    const configured = process.env.BRC_DEPLOYMENT_ENV?.trim().toLowerCase();
    if (configured) {
        return configured;
    }
    const slot = process.env.WEBSITE_SLOT_NAME?.trim().toLowerCase();
    if (slot) {
        return slot;
    }
    return "unknown";
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
export function enterMcpSessionContext(context) {
    mcpSessionContextStorage.enterWith(context);
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
export async function getBoundConnectionIdForSession(sessionId) {
    await ensureConnectionStoreInitialized();
    return getConnectionStore().getConnectionIdForSession(sessionId.trim());
}
/**
 * Resolves the connection id for credential loading. Uses the session binding
 * first, then inherits a recent claim from the same client (scoped by IP hash)
 * so hosted MCP clients that rotate MCP session ids can still access companies.
 */
export async function resolveConnectionIdForActiveSession(args) {
    const result = await resolveConnectionIdForActiveSessionWithMeta(args);
    return result.connectionId;
}
export async function resolveConnectionIdForActiveSessionWithMeta(args) {
    await ensureConnectionStoreInitialized();
    const normalizedSessionId = args.sessionId.trim();
    const store = getConnectionStore();
    if (args.connectionRef?.trim()) {
        const fromRef = await store.getConnectionIdForRef(args.connectionRef.trim());
        if (!fromRef) {
            return {
                connectionId: null,
                sessionBindingFound: false,
                clientClaimInherited: false,
                connectionRefResolved: false,
                connectionRefInvalid: true,
            };
        }
        await store.bindSessionToConnection(normalizedSessionId, fromRef);
        return {
            connectionId: fromRef,
            sessionBindingFound: false,
            clientClaimInherited: false,
            connectionRefResolved: true,
            connectionRefInvalid: false,
        };
    }
    const bound = await store.getConnectionIdForSession(normalizedSessionId);
    if (bound) {
        return {
            connectionId: bound,
            sessionBindingFound: true,
            clientClaimInherited: false,
            connectionRefResolved: false,
            connectionRefInvalid: false,
        };
    }
    if (!args.clientKey) {
        return {
            connectionId: null,
            sessionBindingFound: false,
            clientClaimInherited: false,
            connectionRefResolved: false,
            connectionRefInvalid: false,
        };
    }
    const inherited = await store.getRecentClientClaim(args.clientKey, CLIENT_CLAIM_INHERIT_TTL_MS);
    if (!inherited) {
        return {
            connectionId: null,
            sessionBindingFound: false,
            clientClaimInherited: false,
            connectionRefResolved: false,
            connectionRefInvalid: false,
        };
    }
    await store.bindSessionToConnection(normalizedSessionId, inherited);
    return {
        connectionId: inherited,
        sessionBindingFound: false,
        clientClaimInherited: true,
        connectionRefResolved: false,
        connectionRefInvalid: false,
    };
}
export async function ensureConnectionIdForSession(sessionId) {
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
export class ClaimConnectionError extends Error {
    reason;
    constructor(message, reason) {
        super(message);
        this.name = "ClaimConnectionError";
        this.reason = reason;
    }
}
export async function claimConnectionCodeForSession(code, sessionId, options) {
    await ensureConnectionStoreInitialized();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
        throw new ClaimConnectionError(`A connection code is required. ${FRESH_CONNECTION_LINK_CLAIM_GUIDANCE}`, "not_found");
    }
    const store = getConnectionStore();
    // Connect-page tokens must never be accepted as confirmation codes.
    const connectTokenHit = await store.getConnectionByConnectToken(trimmedCode);
    if (connectTokenHit &&
        connectTokenHit.connectToken === trimmedCode &&
        connectTokenHit.confirmationCode !== trimmedCode) {
        throw new ClaimConnectionError(`That value is the secure connection link token, not the confirmation code. After connecting on the secure page, copy the confirmation code from the success page (or use Copy message for chat), then confirm here. ${FRESH_CONNECTION_LINK_CLAIM_GUIDANCE}`, "not_found");
    }
    const pending = await store.getConnectionByConfirmationCode(trimmedCode);
    if (!pending || !pending.confirmationCode) {
        throw new ClaimConnectionError(`That connection code is missing, incorrect, or has already been used. ${FRESH_CONNECTION_LINK_CLAIM_GUIDANCE}`, "not_found");
    }
    if (!pending.used) {
        throw new ClaimConnectionError("That connection code has not been completed yet. Open the secure Red connection page from your current fresh connection link, submit your company details, then return here and confirm the confirmation code. If that link no longer works, start a fresh company connection to generate a new secure Red connection link.", "not_completed");
    }
    const { connectedCompanies, failedCompanies } = await revalidateStoredConnectionCompanies(pending.connectionId);
    if (connectedCompanies.length === 0) {
        throw new ClaimConnectionError(failedCompanies.length > 0
            ? "No companies could be connected because every submitted credential failed validation. Reconnect with current API keys on a fresh secure Red connection link, then confirm the confirmation code again."
            : `No companies were found for that connection code. Submit the secure Red connection page from a fresh connection link first, then confirm the confirmation code again. ${FRESH_CONNECTION_LINK_CLAIM_GUIDANCE}`, "no_companies");
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
    const { connectionRef, expiresAt: connectionRefExpiresAt } = await issueConnectionRef(pending.connectionId);
    const connectionSessionId = generateConnectionSessionId();
    try {
        // Merge session id into the existing telemetry record (client id from POST
        // /connect). Never replace the whole record with a session-only object.
        await store.saveConnectionTelemetry(pending.connectionId, {
            connectionSessionId,
        });
    }
    catch (error) {
        console.error("Red telemetry: failed to store connection session id:", error instanceof Error ? error.message : error);
    }
    const connectedCompaniesList = connectedCompanies;
    // Confirmation codes are one-time use after a successful claim.
    await store.consumeConfirmationCode(trimmedCode);
    return {
        connectionId: pending.connectionId,
        connectedCompanies: connectedCompaniesList,
        failedCompanies,
        companyNames: connectedCompaniesList,
        connectionRef,
        connectionRefExpiresAt,
        connectionSessionId,
    };
}
/**
 * Generate and attach a confirmation code for a completed connect-page token.
 * The confirmation code is always distinct from the connectToken.
 */
export async function issueConfirmationCodeForConnectToken(connectToken) {
    await ensureConnectionStoreInitialized();
    const token = connectToken.trim();
    if (!token) {
        return null;
    }
    let confirmationCode = crypto.randomBytes(16).toString("hex");
    while (confirmationCode === token) {
        confirmationCode = crypto.randomBytes(16).toString("hex");
    }
    const pending = await getConnectionStore().issueConfirmationCode(token, confirmationCode);
    if (!pending?.confirmationCode) {
        return null;
    }
    return {
        confirmationCode: pending.confirmationCode,
        connectionId: pending.connectionId,
    };
}
export async function createPendingConnection(sessionId) {
    await ensureConnectionStoreInitialized();
    const connectionId = await ensureConnectionIdForSession(sessionId);
    const connectToken = crypto.randomBytes(16).toString("hex");
    await getConnectionStore().createPendingConnection({
        connectToken,
        connectionId,
        expiresAt: PENDING_CONNECTION_NEVER_EXPIRES_AT,
    });
    return { code: connectToken, connectToken, connectionId };
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
