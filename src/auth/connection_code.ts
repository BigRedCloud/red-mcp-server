import crypto from "node:crypto";
import type { CompanyApiContext } from "../shared.js";

type PendingConnection = {
  code: string;
  sessionStore: Map<string, CompanyApiContext>;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

const pendingConnections = new Map<string, PendingConnection>();

const CONNECTION_CODE_TTL_MS = 10 * 60 * 1000;

export function createConnectionCode(
  sessionStore: Map<string, CompanyApiContext>
): string {
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

export function getPendingConnection(code: string): PendingConnection | null {
  const pending = pendingConnections.get(code);

  if (!pending) return null;

  if (pending.used || pending.expiresAt < Date.now()) {
    pendingConnections.delete(code);
    return null;
  }

  return pending;
}

export function consumeConnectionCode(code: string): PendingConnection | null {
  const pending = getPendingConnection(code);

  if (!pending) return null;

  pending.used = true;
  pendingConnections.delete(code);

  return pending;
}

export function cleanupExpiredConnectionCodes(): void {
  const now = Date.now();

  for (const [code, pending] of pendingConnections.entries()) {
    if (pending.used || pending.expiresAt < now) {
      pendingConnections.delete(code);
    }
  }
}