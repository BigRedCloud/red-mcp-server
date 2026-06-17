import crypto from "node:crypto";
const pendingConnections = new Map();
const CONNECTION_CODE_TTL_MS = 10 * 60 * 1000;
export function createConnectionCode(sessionStore) {
    cleanupExpiredConnectionCodes();
    const code = crypto.randomBytes(16).toString("hex");
    pendingConnections.set(code, {
        code,
        sessionStore,
        createdAt: Date.now(),
        expiresAt: Date.now() + CONNECTION_CODE_TTL_MS,
        used: false,
    });
    return code;
}
export function getPendingConnection(code) {
    const pending = pendingConnections.get(code);
    if (!pending)
        return null;
    if (pending.used || pending.expiresAt < Date.now()) {
        pendingConnections.delete(code);
        return null;
    }
    return pending;
}
export function consumeConnectionCode(code) {
    const pending = getPendingConnection(code);
    if (!pending)
        return null;
    pending.used = true;
    pendingConnections.delete(code);
    return pending;
}
export function cleanupExpiredConnectionCodes() {
    const now = Date.now();
    for (const [code, pending] of pendingConnections.entries()) {
        if (pending.used || pending.expiresAt < now) {
            pendingConnections.delete(code);
        }
    }
}
