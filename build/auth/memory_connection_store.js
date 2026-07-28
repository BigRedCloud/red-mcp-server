import { encodeStoredApiKey } from "./credential_secret.js";
import { isPendingConnectionExpired } from "./connection_pending.js";
import { mergeConnectionTelemetryRecord } from "./connection_telemetry_merge.js";
function normaliseCompanyName(companyName) {
    return companyName.trim().toLowerCase();
}
const pendingConnections = new Map();
const sessionBindings = new Map();
const companiesByConnection = new Map();
const clientLastClaims = new Map();
const connectionRefs = new Map();
const failedValidationsByConnection = new Map();
const telemetryByConnection = new Map();
function companyMapForConnection(connectionId) {
    let map = companiesByConnection.get(connectionId);
    if (!map) {
        map = new Map();
        companiesByConnection.set(connectionId, map);
    }
    return map;
}
function cleanupExpiredPendingConnections() {
    for (const [code, pending] of pendingConnections.entries()) {
        if (pending.used) {
            continue;
        }
        if (isPendingConnectionExpired(pending.expiresAt)) {
            pendingConnections.delete(code);
        }
    }
}
export class MemoryConnectionStore {
    getStoreType() {
        return "memory";
    }
    async createPendingConnection(args) {
        cleanupExpiredPendingConnections();
        pendingConnections.set(args.code, {
            code: args.code,
            connectionId: args.connectionId,
            createdAt: Date.now(),
            expiresAt: args.expiresAt,
            used: false,
        });
    }
    async getPendingConnection(code) {
        cleanupExpiredPendingConnections();
        const pending = pendingConnections.get(code);
        if (!pending ||
            pending.used ||
            isPendingConnectionExpired(pending.expiresAt)) {
            if (pending)
                pendingConnections.delete(code);
            return null;
        }
        return { ...pending };
    }
    async getConnectionByCode(code) {
        cleanupExpiredPendingConnections();
        const pending = pendingConnections.get(code);
        if (!pending || isPendingConnectionExpired(pending.expiresAt)) {
            if (pending)
                pendingConnections.delete(code);
            return null;
        }
        return { ...pending };
    }
    async completePendingConnection(code) {
        cleanupExpiredPendingConnections();
        const pending = pendingConnections.get(code);
        if (!pending ||
            pending.used ||
            isPendingConnectionExpired(pending.expiresAt)) {
            if (pending)
                pendingConnections.delete(code);
            return null;
        }
        pending.used = true;
        return { ...pending };
    }
    async consumePendingConnection(code) {
        const pending = await this.getPendingConnection(code);
        if (!pending)
            return null;
        pendingConnections.delete(code);
        return pending;
    }
    async bindSessionToConnection(sessionId, connectionId) {
        sessionBindings.set(sessionId.trim(), {
            sessionId: sessionId.trim(),
            connectionId,
            updatedAt: Date.now(),
        });
    }
    async getConnectionIdForSession(sessionId) {
        return sessionBindings.get(sessionId.trim())?.connectionId ?? null;
    }
    async recordClientClaim(args) {
        clientLastClaims.set(args.clientKey, {
            connectionId: args.connectionId,
            claimedAt: args.claimedAt,
        });
    }
    async getRecentClientClaim(clientKey, maxAgeMs) {
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
    async createConnectionRef(args) {
        connectionRefs.set(args.ref.trim(), {
            connectionId: args.connectionId,
            expiresAt: args.expiresAt,
        });
    }
    async getConnectionIdForRef(ref) {
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
    async saveConnectedCompanies(connectionId, companies) {
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
                credentialValidatedAt: company.credentialValidatedAt ?? existing?.credentialValidatedAt,
            });
        }
    }
    async listConnectedCompanies(connectionId) {
        const map = companiesByConnection.get(connectionId);
        if (!map)
            return [];
        const now = Date.now();
        return Array.from(map.values()).filter((entry) => entry.expiresAt >= now);
    }
    async getCredentialForCompany(connectionId, companyName) {
        const map = companiesByConnection.get(connectionId);
        if (!map)
            return null;
        const entry = map.get(normaliseCompanyName(companyName));
        if (!entry || entry.expiresAt < Date.now())
            return null;
        return { ...entry };
    }
    async clearConnectedCompany(connectionId, companyName) {
        const map = companiesByConnection.get(connectionId);
        if (!map)
            return false;
        return map.delete(normaliseCompanyName(companyName));
    }
    async clearAllConnectedCompanies(connectionId) {
        const map = companiesByConnection.get(connectionId);
        if (!map)
            return 0;
        const count = map.size;
        companiesByConnection.delete(connectionId);
        return count;
    }
    async saveFailedCompanyValidations(connectionId, failures) {
        failedValidationsByConnection.set(connectionId, failures.map((failure) => ({ ...failure })));
    }
    async listFailedCompanyValidations(connectionId) {
        return (failedValidationsByConnection.get(connectionId) ?? []).map((failure) => ({ ...failure }));
    }
    async clearFailedCompanyValidations(connectionId) {
        failedValidationsByConnection.delete(connectionId);
    }
    async saveConnectionTelemetry(connectionId, patch) {
        const existing = telemetryByConnection.get(connectionId) ?? null;
        const merged = mergeConnectionTelemetryRecord(connectionId, existing, patch);
        telemetryByConnection.set(connectionId, merged);
    }
    async getConnectionTelemetry(connectionId) {
        const record = telemetryByConnection.get(connectionId);
        return record ? { ...record } : null;
    }
    async getDiagnostics(args) {
        const connectionId = args.connectionId ??
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
