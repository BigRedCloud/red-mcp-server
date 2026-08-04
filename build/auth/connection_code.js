import crypto from "node:crypto";
import { PENDING_CONNECTION_NEVER_EXPIRES_AT } from "./connection_pending.js";
import { createPendingConnection as createPendingConnectionRecord, ensureConnectionStoreInitialized, getConnectionStore, issueConfirmationCodeForConnectToken, } from "./connection_store.js";
/** @deprecated Use createPendingConnection(sessionId) from connection_store.js */
export async function createConnectionCode(connectionId) {
    await ensureConnectionStoreInitialized();
    const connectToken = crypto.randomBytes(16).toString("hex");
    await getConnectionStore().createPendingConnection({
        connectToken,
        connectionId,
        expiresAt: PENDING_CONNECTION_NEVER_EXPIRES_AT,
    });
    return connectToken;
}
export async function getPendingConnection(connectToken) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().getPendingConnection(connectToken);
    if (!pending)
        return null;
    return {
        code: pending.connectToken,
        connectToken: pending.connectToken,
        connectionId: pending.connectionId,
    };
}
export async function completeConnectionCode(connectToken) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().completePendingConnection(connectToken);
    if (!pending)
        return null;
    return {
        code: pending.connectToken,
        connectToken: pending.connectToken,
        connectionId: pending.connectionId,
    };
}
export async function getConnectionByCode(confirmationCode) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().getConnectionByConfirmationCode(confirmationCode);
    if (!pending)
        return null;
    return {
        code: pending.connectToken,
        connectToken: pending.connectToken,
        confirmationCode: pending.confirmationCode,
        connectionId: pending.connectionId,
        used: pending.used,
    };
}
export async function consumeConnectionCode(confirmationCode) {
    await ensureConnectionStoreInitialized();
    const pending = await getConnectionStore().consumeConfirmationCode(confirmationCode);
    if (!pending)
        return null;
    return {
        code: pending.connectToken,
        connectToken: pending.connectToken,
        connectionId: pending.connectionId,
    };
}
export { createPendingConnectionRecord as createPendingConnection };
export { issueConfirmationCodeForConnectToken };
