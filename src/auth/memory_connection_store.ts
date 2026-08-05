import { encodeStoredApiKey } from "./credential_secret.js";
import { isPendingConnectionExpired } from "./connection_pending.js";
import { mergeConnectionTelemetryRecord } from "./connection_telemetry_merge.js";
import type {
  CompanyCredentialInput,
  ConnectionStore,
  ConnectionStoreDiagnostics,
  ConnectionSuccessPageRecord,
  ConnectionTelemetryRecord,
  FailedCompanyConnection,
  PendingActionRecord,
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
/** confirmationCode → connectToken */
const confirmationCodeIndex = new Map<string, string>();
const sessionBindings = new Map<string, SessionBinding>();
const companiesByConnection = new Map<string, Map<string, CompanyEntry>>();
const clientLastClaims = new Map<
  string,
  { connectionId: string; claimedAt: number }
>();
const connectionRefs = new Map<
  string,
  { connectionId: string; expiresAt: number }
>();
const failedValidationsByConnection = new Map<string, FailedCompanyConnection[]>();
const telemetryByConnection = new Map<string, ConnectionTelemetryRecord>();
const successPagesById = new Map<string, ConnectionSuccessPageRecord>();
/** `${connectionId}|${scopeKeyHash}` → pending action */
const pendingActionsByScope = new Map<string, PendingActionRecord>();

function pendingActionMapKey(
  connectionId: string,
  scopeKeyHash: string
): string {
  return `${connectionId.trim()}|${scopeKeyHash.trim()}`;
}

function resolveConnectTokenArg(args: {
  connectToken?: string;
  code?: string;
}): string {
  const token = (args.connectToken ?? args.code ?? "").trim();
  if (!token) {
    throw new Error("connectToken is required to create a pending connection.");
  }
  return token;
}

function clonePending(pending: PendingEntry): PendingConnectionRecord {
  return {
    connectToken: pending.connectToken,
    code: pending.connectToken,
    connectionId: pending.connectionId,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    used: pending.used,
    confirmationCode: pending.confirmationCode,
  };
}

function companyMapForConnection(connectionId: string): Map<string, CompanyEntry> {
  let map = companiesByConnection.get(connectionId);
  if (!map) {
    map = new Map();
    companiesByConnection.set(connectionId, map);
  }
  return map;
}

function cleanupExpiredPendingConnections(): void {
  for (const [connectToken, pending] of pendingConnections.entries()) {
    if (pending.used) {
      continue;
    }

    if (isPendingConnectionExpired(pending.expiresAt)) {
      if (pending.confirmationCode) {
        confirmationCodeIndex.delete(pending.confirmationCode);
      }
      pendingConnections.delete(connectToken);
    }
  }
}

function cleanupExpiredSuccessPages(now = Date.now()): void {
  for (const [successId, page] of successPagesById.entries()) {
    if (page.expiresAt <= now) {
      successPagesById.delete(successId);
    }
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  getStoreType(): string {
    return "memory";
  }

  async createPendingConnection(args: {
    connectToken?: string;
    code?: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void> {
    cleanupExpiredPendingConnections();

    const connectToken = resolveConnectTokenArg(args);

    pendingConnections.set(connectToken, {
      connectToken,
      code: connectToken,
      connectionId: args.connectionId,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      used: false,
    });
  }

  async getPendingConnection(
    connectToken: string
  ): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const pending = pendingConnections.get(connectToken.trim());
    if (
      !pending ||
      pending.used ||
      isPendingConnectionExpired(pending.expiresAt)
    ) {
      if (pending && !pending.used) {
        pendingConnections.delete(connectToken.trim());
      }
      return null;
    }

    return clonePending(pending);
  }

  async getConnectionByConnectToken(
    connectToken: string
  ): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const pending = pendingConnections.get(connectToken.trim());
    if (!pending || isPendingConnectionExpired(pending.expiresAt)) {
      if (pending) {
        if (pending.confirmationCode) {
          confirmationCodeIndex.delete(pending.confirmationCode);
        }
        pendingConnections.delete(connectToken.trim());
      }
      return null;
    }

    return clonePending(pending);
  }

  async getConnectionByConfirmationCode(
    confirmationCode: string
  ): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const trimmed = confirmationCode.trim();
    if (!trimmed) {
      return null;
    }

    const connectToken = confirmationCodeIndex.get(trimmed);
    if (!connectToken) {
      return null;
    }

    const pending = pendingConnections.get(connectToken);
    if (
      !pending ||
      pending.confirmationCode !== trimmed ||
      isPendingConnectionExpired(pending.expiresAt)
    ) {
      confirmationCodeIndex.delete(trimmed);
      if (pending && isPendingConnectionExpired(pending.expiresAt)) {
        pendingConnections.delete(connectToken);
      }
      return null;
    }

    return clonePending(pending);
  }

  async getConnectionByCode(
    code: string
  ): Promise<PendingConnectionRecord | null> {
    return this.getConnectionByConfirmationCode(code);
  }

  async completePendingConnection(
    connectToken: string
  ): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const pending = pendingConnections.get(connectToken.trim());
    if (
      !pending ||
      pending.used ||
      isPendingConnectionExpired(pending.expiresAt)
    ) {
      if (pending && !pending.used) {
        pendingConnections.delete(connectToken.trim());
      }
      return null;
    }

    pending.used = true;
    return clonePending(pending);
  }

  async issueConfirmationCode(
    connectToken: string,
    confirmationCode: string
  ): Promise<PendingConnectionRecord | null> {
    cleanupExpiredPendingConnections();

    const token = connectToken.trim();
    const confirm = confirmationCode.trim();
    if (!token || !confirm || confirm === token) {
      return null;
    }

    const pending = pendingConnections.get(token);
    if (
      !pending ||
      !pending.used ||
      isPendingConnectionExpired(pending.expiresAt)
    ) {
      return null;
    }

    if (pending.confirmationCode) {
      confirmationCodeIndex.delete(pending.confirmationCode);
    }

    pending.confirmationCode = confirm;
    confirmationCodeIndex.set(confirm, token);
    return clonePending(pending);
  }

  async consumeConfirmationCode(
    confirmationCode: string
  ): Promise<PendingConnectionRecord | null> {
    const pending = await this.getConnectionByConfirmationCode(confirmationCode);
    if (!pending) return null;

    confirmationCodeIndex.delete(pending.confirmationCode!);
    pendingConnections.delete(pending.connectToken);
    return pending;
  }

  async consumePendingConnection(
    code: string
  ): Promise<PendingConnectionRecord | null> {
    return this.consumeConfirmationCode(code);
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

  async createConnectionRef(args: {
    ref: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void> {
    connectionRefs.set(args.ref.trim(), {
      connectionId: args.connectionId,
      expiresAt: args.expiresAt,
    });
  }

  async getConnectionIdForRef(ref: string): Promise<string | null> {
    const entry = connectionRefs.get(ref.trim());
    if (!entry) {
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      connectionRefs.delete(ref.trim());
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
        credentialValidatedAt:
          company.credentialValidatedAt ?? existing?.credentialValidatedAt,
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

  async saveFailedCompanyValidations(
    connectionId: string,
    failures: FailedCompanyConnection[]
  ): Promise<void> {
    failedValidationsByConnection.set(
      connectionId,
      failures.map((failure) => ({ ...failure }))
    );
  }

  async listFailedCompanyValidations(
    connectionId: string
  ): Promise<FailedCompanyConnection[]> {
    return (failedValidationsByConnection.get(connectionId) ?? []).map(
      (failure) => ({ ...failure })
    );
  }

  async clearFailedCompanyValidations(connectionId: string): Promise<void> {
    failedValidationsByConnection.delete(connectionId);
  }

  async saveConnectionTelemetry(
    connectionId: string,
    patch: {
      telemetryClientId?: string;
      connectionSessionId?: string;
    }
  ): Promise<void> {
    const existing = telemetryByConnection.get(connectionId) ?? null;
    const merged = mergeConnectionTelemetryRecord(connectionId, existing, patch);
    telemetryByConnection.set(connectionId, merged);
  }

  async getConnectionTelemetry(
    connectionId: string
  ): Promise<ConnectionTelemetryRecord | null> {
    const record = telemetryByConnection.get(connectionId);
    return record ? { ...record } : null;
  }

  async saveConnectionSuccessPage(
    record: ConnectionSuccessPageRecord
  ): Promise<void> {
    cleanupExpiredSuccessPages();
    successPagesById.set(record.successId, {
      ...record,
      connectedNames: [...record.connectedNames],
      failedCompanies: record.failedCompanies.map((failure) => ({ ...failure })),
    });
  }

  async getConnectionSuccessPage(
    successId: string
  ): Promise<ConnectionSuccessPageRecord | null> {
    cleanupExpiredSuccessPages();
    const record = successPagesById.get(successId.trim());
    if (!record || record.expiresAt <= Date.now()) {
      if (record) {
        successPagesById.delete(successId.trim());
      }
      return null;
    }

    return {
      ...record,
      connectedNames: [...record.connectedNames],
      failedCompanies: record.failedCompanies.map((failure) => ({ ...failure })),
    };
  }

  async savePendingAction(record: PendingActionRecord): Promise<void> {
    pendingActionsByScope.set(
      pendingActionMapKey(record.connectionId, record.scopeKeyHash),
      {
        ...record,
        allowedTools: [...record.allowedTools],
      }
    );
  }

  async getPendingAction(
    connectionId: string,
    scopeKeyHash: string
  ): Promise<PendingActionRecord | null> {
    const key = pendingActionMapKey(connectionId, scopeKeyHash);
    const record = pendingActionsByScope.get(key);
    if (!record) {
      return null;
    }
    if (record.expiresAt <= Date.now()) {
      pendingActionsByScope.delete(key);
      return null;
    }
    return {
      ...record,
      allowedTools: [...record.allowedTools],
    };
  }

  async clearPendingAction(
    connectionId: string,
    scopeKeyHash: string
  ): Promise<void> {
    pendingActionsByScope.delete(
      pendingActionMapKey(connectionId, scopeKeyHash)
    );
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
