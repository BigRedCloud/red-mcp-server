import crypto from "node:crypto";
import { PENDING_CONNECTION_NEVER_EXPIRES_AT } from "./connection_pending.js";
import {
  createPendingConnection as createPendingConnectionRecord,
  ensureConnectionStoreInitialized,
  getConnectionStore,
} from "./connection_store.js";

/** @deprecated Use createPendingConnection(sessionId) from connection_store.js */
export async function createConnectionCode(connectionId: string): Promise<string> {
  await ensureConnectionStoreInitialized();

  const code = crypto.randomBytes(16).toString("hex");
  await getConnectionStore().createPendingConnection({
    code,
    connectionId,
    expiresAt: PENDING_CONNECTION_NEVER_EXPIRES_AT,
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

export async function completeConnectionCode(
  code: string
): Promise<{ code: string; connectionId: string } | null> {
  await ensureConnectionStoreInitialized();

  const pending = await getConnectionStore().completePendingConnection(code);
  if (!pending) return null;

  return {
    code: pending.code,
    connectionId: pending.connectionId,
  };
}

export async function getConnectionByCode(
  code: string
): Promise<{ code: string; connectionId: string; used: boolean } | null> {
  await ensureConnectionStoreInitialized();

  const pending = await getConnectionStore().getConnectionByCode(code);
  if (!pending) return null;

  return {
    code: pending.code,
    connectionId: pending.connectionId,
    used: pending.used,
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
