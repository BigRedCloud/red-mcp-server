import crypto from "node:crypto";
import { createPendingConnection as createPendingConnectionRecord, ensureConnectionStoreInitialized, getConnectionStore, } from "./connection_store.js";
const CONNECTION_CODE_TTL_MS = 10 * 60 * 1000;
/** @deprecated Use createPendingConnection(sessionId) from connection_store.js */
export async function createConnectionCode(connectionId) {
    await ensureConnectionStoreInitialized();
    const code = crypto.randomBytes(16).toString("hex");
    await getConnectionStore().createPendingConnection({
        code,
        connectionId,
        expiresAt: Date.now() + CONNECTION_CODE_TTL_MS,
    });
    return code;
}
export async function getPendingConnection(code) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().getPendingConnection(code);
    if (!pending)
        return null;
    return {
        code: pending.code,
        connectionId: pending.connectionId,
    };
}
export async function completeConnectionCode(code) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().completePendingConnection(code);
    if (!pending)
        return null;
    return {
        code: pending.code,
        connectionId: pending.connectionId,
    };
}
export async function getConnectionByCode(code) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().getConnectionByCode(code);
    if (!pending)
        return null;
    return {
        code: pending.code,
        connectionId: pending.connectionId,
        used: pending.used,
    };
}
export async function consumeConnectionCode(code) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().consumePendingConnection(code);
    if (!pending)
        return null;
    return {
        code: pending.code,
        connectionId: pending.connectionId,
    };
}
export { createPendingConnectionRecord as createPendingConnection };
