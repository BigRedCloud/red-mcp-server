import crypto from "node:crypto";
import { z } from "zod";
import { getApiKeyExpirationMs } from "../config/server_config.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./connection_store.js";
export const CONNECTION_REF_PREFIX = "redconn_";
export const connectionRefSchema = z
    .string()
    .optional()
    .describe("Opaque Red connection reference returned by brc_confirm_company_connection. Pass this exact value on every later tool call when the MCP client rotates session ids (for example Vibe/Mistral). It is not an API key and does not contain credentials.");
export const CONNECTION_REF_INVALID_MESSAGE = [
    "The Red connection reference is missing, invalid, or has expired.",
    "If you just connected companies, run brc_confirm_company_connection again and pass the new connectionRef on subsequent tool calls.",
    "If the MCP client keeps rotating sessions without preserving connectionRef, explain that this platform cannot keep a stable Red MCP session and the user may need a client that preserves MCP sessions.",
].join(" ");
export function isConnectionRefFormat(value) {
    const trimmed = value.trim();
    return (trimmed.startsWith(CONNECTION_REF_PREFIX) &&
        trimmed.length === CONNECTION_REF_PREFIX.length + 48);
}
export function extractConnectionRefFromToolArgs(args) {
    const value = args.connectionRef;
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
export function prefixConnectionRef(value) {
    if (!value) {
        return undefined;
    }
    return value.slice(0, Math.min(16, value.length));
}
export async function issueConnectionRef(connectionId) {
    await ensureConnectionStoreInitialized();
    const connectionRef = `${CONNECTION_REF_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
    const expiresAt = Date.now() + getApiKeyExpirationMs();
    await getConnectionStore().createConnectionRef({
        ref: connectionRef,
        connectionId,
        expiresAt,
    });
    return { connectionRef, expiresAt };
}
export async function resolveConnectionIdFromRef(connectionRef) {
    if (!connectionRef?.trim()) {
        return null;
    }
    await ensureConnectionStoreInitialized();
    return getConnectionStore().getConnectionIdForRef(connectionRef.trim());
}
