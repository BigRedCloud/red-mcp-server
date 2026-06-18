import crypto from "node:crypto";
import {
  createPendingConnection as createPendingConnectionRecord,
  ensureConnectionStoreInitialized,
  getConnectionStore,
} from "./connection_store.js";

const CONNECTION_CODE_TTL_MS = 10 * 60 * 1000;

/** @deprecated Use createPendingConnection(sessionId) from connection_store.js */
export async function createConnectionCode(connectionId: string): Promise<string> {
  await ensureConnectionStoreInitialized();

  const code = crypto.randomBytes(16).toString("hex");
  await getConnectionStore().createPendingConnection({
    code,
    connectionId,
    expiresAt: Date.now() + CONNECTION_CODE_TTL_MS,
  });

  return code;
}

export async function getPendingConnection(
  code: string
): Promise<{ code: string; connectionId: string } | null> {
  await ensureConnectionStoreInitialized();

  const pending = await getConnectionStore().getPendingConnection(code);
  if (!pending) return null;

  return {
    code: pending.code,
    connectionId: pending.connectionId,
  };
}

export async function consumeConnectionCode(
  code: string
): Promise<{ code: string; connectionId: string } | null> {
  await ensureConnectionStoreInitialized();

  const pending = await getConnectionStore().consumePendingConnection(code);
  if (!pending) return null;

  return {
    code: pending.code,
    connectionId: pending.connectionId,
  };
}

export { createPendingConnectionRecord as createPendingConnection };
