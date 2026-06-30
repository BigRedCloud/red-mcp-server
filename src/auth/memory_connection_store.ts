import { encodeStoredApiKey } from "./credential_secret.js";
import { isPendingConnectionExpired } from "./connection_pending.js";
import type {
  CompanyCredentialInput,
  ConnectionStore,
  ConnectionStoreDiagnostics,
  PendingConnectionRecord,
  StoredCompanyCredential,
} from "./connection_store_types.js";

function normaliseCompanyName(companyName: string): string {
  return companyName.trim().toLowerCase();
}

type PendingEntry = PendingConnectionRecord;

type SessionBinding = {
  sessionId: string;
  connectionId: string;
  updatedAt: number;
};

type CompanyEntry = StoredCompanyCredential;

const pendingConnections = new Map<string, PendingEntry>();
const sessionBindings = new Map<string, SessionBinding>();
const companiesByConnection = new Map<string, Map<string, CompanyEntry>>();
const clientLastClaims = new Map<
  string,
  { connectionId: string; claimedAt: number }
>();

function companyMapForConnection(connectionId: string): Map<string, CompanyEntry> {
  let map = companiesByConnection.get(connectionId);
  if (!map) {
    map = new Map();
    companiesByConnection.set(connectionId, map);
  }
  return map;
}

function cleanupExpiredPendingConnections(): void {
  for (const [code, pending] of pendingConnections.entries()) {
    if (pending.used) {
      continue;
    }

    if (isPendingConnectionExpired(pending.expiresAt)) {
      pendingConnections.delete(code);
    }
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  getStoreType(): string {
    return "memory";
  }

  async createPendingConnection(args: {
    code: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void> {
    cleanupExpiredPendingConnections();

    pendingConnections.set(args.code, {
      code: args.code,
      connectionId: args.connectionId,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      used: false,
    });
  }

  async getPendingConnection(code: string): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const pending = pendingConnections.get(code);
    if (
      !pending ||
      pending.used ||
      isPendingConnectionExpired(pending.expiresAt)
    ) {
      if (pending) pendingConnections.delete(code);
      return null;
    }

    return { ...pending };
  }

  async getConnectionByCode(code: string): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const pending = pendingConnections.get(code);
    if (!pending || isPendingConnectionExpired(pending.expiresAt)) {
      if (pending) pendingConnections.delete(code);
      return null;
    }

    return { ...pending };
  }

  async completePendingConnection(code: string): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const pending = pendingConnections.get(code);
    if (
      !pending ||
      pending.used ||
      isPendingConnectionExpired(pending.expiresAt)
    ) {
      if (pending) pendingConnections.delete(code);
      return null;
    }

    pending.used = true;
    return { ...pending };
  }

  async consumePendingConnection(code: string): Promise<PendingConnectionRecord | null> {
    const pending = await this.getPendingConnection(code);
    if (!pending) return null;

    pendingConnections.delete(code);
    return pending;
  }

  async bindSessionToConnection(
    sessionId: string,
    connectionId: string
  ): Promise<void> {
    sessionBindings.set(sessionId.trim(), {
      sessionId: sessionId.trim(),
      connectionId,
      updatedAt: Date.now(),
    });
  }

  async getConnectionIdForSession(sessionId: string): Promise<string | null> {
    return sessionBindings.get(sessionId.trim())?.connectionId ?? null;
  }

  async recordClientClaim(args: {
    clientKey: string;
    connectionId: string;
    claimedAt: number;
  }): Promise<void> {
    clientLastClaims.set(args.clientKey, {
      connectionId: args.connectionId,
      claimedAt: args.claimedAt,
    });
  }

  async getRecentClientClaim(
    clientKey: string,
    maxAgeMs: number
  ): Promise<string | null> {
    const entry = clientLastClaims.get(clientKey);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.claimedAt > maxAgeMs) {
      clientLastClaims.delete(clientKey);
      return null;
    }

    return entry.connectionId;
  }

  async saveConnectedCompanies(
    connectionId: string,
    companies: CompanyCredentialInput[]
  ): Promise<void> {
    const map = companyMapForConnection(connectionId);
    const now = Date.now();

    for (const company of companies) {
      const key = normaliseCompanyName(company.companyName);
      const existing = map.get(key);

      map.set(key, {
        connectionId,
        companyName: company.companyName.trim(),
        credentialType: "apiKey",
        encryptedSecret: encodeStoredApiKey(company.apiKey),
        expiresAt: company.expiresAt,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  async listConnectedCompanies(
    connectionId: string
  ): Promise<StoredCompanyCredential[]> {
    const map = companiesByConnection.get(connectionId);
    if (!map) return [];

    const now = Date.now();
    return Array.from(map.values()).filter((entry) => entry.expiresAt >= now);
  }

  async getCredentialForCompany(
    connectionId: string,
    companyName: string
  ): Promise<StoredCompanyCredential | null> {
    const map = companiesByConnection.get(connectionId);
    if (!map) return null;

    const entry = map.get(normaliseCompanyName(companyName));
    if (!entry || entry.expiresAt < Date.now()) return null;

    return { ...entry };
  }

  async clearConnectedCompany(
    connectionId: string,
    companyName: string
  ): Promise<boolean> {
    const map = companiesByConnection.get(connectionId);
    if (!map) return false;

    return map.delete(normaliseCompanyName(companyName));
  }

  async clearAllConnectedCompanies(connectionId: string): Promise<number> {
    const map = companiesByConnection.get(connectionId);
    if (!map) return 0;

    const count = map.size;
    companiesByConnection.delete(connectionId);
    return count;
  }

  async getDiagnostics(args: {
    connectionId?: string;
    sessionId?: string;
  }): Promise<ConnectionStoreDiagnostics> {
    const connectionId =
      args.connectionId ??
      (args.sessionId
        ? await this.getConnectionIdForSession(args.sessionId)
        : undefined);

    const companies = connectionId
      ? await this.listConnectedCompanies(connectionId)
      : [];

    return {
      storeType: this.getStoreType(),
      connectionIdPresent: Boolean(connectionId),
      connectionId: connectionId ?? undefined,
      sessionIdPresent: Boolean(args.sessionId),
      sessionId: args.sessionId,
      connectedCompanyCount: companies.length,
    };
  }
}
