import { CosmosClient } from "@azure/cosmos";
import { isPendingConnectionExpired } from "./connection_pending.js";
import { redServerConfig } from "../config/server_config.js";
import { encodeStoredApiKey } from "./credential_secret.js";
import { mergeConnectionTelemetryRecord, pickValidTelemetryUuid, } from "./connection_telemetry_merge.js";
import { isValidTelemetryUuid } from "../telemetry/identity.js";
const PENDING_CONNECTION_NO_COSMOS_TTL = -1;
function sessionTtlSeconds() {
    return redServerConfig.sessionTtlMinutes * 60;
}
function normaliseCompanyName(companyName) {
    return companyName.trim().toLowerCase();
}
function sessionPartitionKey(sessionId) {
    return `session:${sessionId}`;
}
function pendingPartitionKey(connectToken) {
    return `pending:${connectToken}`;
}
function confirmationPartitionKey(confirmationCode) {
    return `confirm:${confirmationCode}`;
}
function connectionPartitionKey(connectionId) {
    return `connection:${connectionId}`;
}
function clientPartitionKey(clientKey) {
    return `client:${clientKey}`;
}
function connectionRefPartitionKey(ref) {
    return `ref:${ref}`;
}
function successPagePartitionKey(successId) {
    return `success:${successId}`;
}
function pendingActionPartitionKey(connectionId, scopeKeyHash) {
    return `pendingAction:${connectionId}:${scopeKeyHash}`;
}
function companyDocumentId(normalisedName) {
    return `company:${normalisedName}`;
}
function failedValidationDocumentId(normalisedName) {
    return `failed:${normalisedName}`;
}
function apiKeyTtlSeconds() {
    return redServerConfig.apiKeyTtlMinutes * 60;
}
function isCosmosNotFoundError(error) {
    const statusCode = error && typeof error === "object" && "code" in error
        ? Number(error.code)
        : error && typeof error === "object" && "statusCode" in error
            ? Number(error.statusCode)
            : NaN;
    return statusCode === 404;
}
function buildConnectionTelemetryDocument(record, pk, ttl) {
    const doc = {
        pk,
        id: "telemetry",
        type: "connectionTelemetry",
        connectionId: record.connectionId,
        updatedAt: record.updatedAt,
        ttl,
    };
    if (record.telemetryClientId) {
        doc.telemetryClientId = record.telemetryClientId;
    }
    if (record.connectionSessionId) {
        doc.connectionSessionId = record.connectionSessionId;
    }
    return doc;
}
export class CosmosConnectionStore {
    client;
    databaseId;
    containerId;
    container = null;
    constructor(connectionString, databaseId, containerId) {
        this.client = new CosmosClient(connectionString);
        this.databaseId = databaseId;
        this.containerId = containerId;
    }
    getContainer() {
        if (!this.container) {
            throw new Error("Cosmos connection store has not been initialized.");
        }
        return this.container;
    }
    async initialize() {
        const { database } = await this.client.databases.createIfNotExists({
            id: this.databaseId,
        });
        const { container } = await database.containers.createIfNotExists({
            id: this.containerId,
            partitionKey: { paths: ["/pk"] },
            defaultTtl: -1,
        });
        this.container = container;
    }
    getStoreType() {
        return "cosmos";
    }
    async createPendingConnection(args) {
        const connectToken = (args.connectToken ?? args.code ?? "").trim();
        if (!connectToken) {
            throw new Error("connectToken is required to create a pending connection.");
        }
        const now = Date.now();
        const doc = {
            pk: pendingPartitionKey(connectToken),
            id: "pending",
            type: "pendingConnection",
            connectToken,
            code: connectToken,
            connectionId: args.connectionId,
            createdAt: now,
            expiresAt: args.expiresAt,
            used: false,
            ttl: PENDING_CONNECTION_NO_COSMOS_TTL,
        };
        await this.getContainer().items.upsert(doc);
    }
    async readPendingConnectionDocument(connectToken) {
        try {
            const { resource } = await this.getContainer()
                .item("pending", pendingPartitionKey(connectToken))
                .read();
            if (!resource || resource.type !== "pendingConnection") {
                return null;
            }
            if (isPendingConnectionExpired(resource.expiresAt)) {
                await this.getContainer()
                    .item("pending", pendingPartitionKey(connectToken))
                    .delete()
                    .catch(() => { });
                if (resource.confirmationCode) {
                    await this.getContainer()
                        .item("confirm", confirmationPartitionKey(resource.confirmationCode))
                        .delete()
                        .catch(() => { });
                }
                return null;
            }
            return resource;
        }
        catch {
            return null;
        }
    }
    pendingRecordFromDocument(resource) {
        const connectToken = (resource.connectToken ?? resource.code).trim();
        return {
            connectToken,
            code: connectToken,
            connectionId: resource.connectionId,
            createdAt: resource.createdAt,
            expiresAt: resource.expiresAt,
            used: Boolean(resource.used),
            confirmationCode: resource.confirmationCode?.trim() || undefined,
        };
    }
    async getPendingConnection(connectToken) {
        const resource = await this.readPendingConnectionDocument(connectToken.trim());
        if (!resource || resource.used) {
            return null;
        }
        return this.pendingRecordFromDocument(resource);
    }
    async getConnectionByConnectToken(connectToken) {
        const resource = await this.readPendingConnectionDocument(connectToken.trim());
        if (!resource) {
            return null;
        }
        return this.pendingRecordFromDocument(resource);
    }
    async getConnectionByConfirmationCode(confirmationCode) {
        const trimmed = confirmationCode.trim();
        if (!trimmed) {
            return null;
        }
        try {
            const { resource: index } = await this.getContainer()
                .item("confirm", confirmationPartitionKey(trimmed))
                .read();
            if (!index || index.type !== "confirmationCodeIndex") {
                return null;
            }
            if (isPendingConnectionExpired(index.expiresAt)) {
                await this.getContainer()
                    .item("confirm", confirmationPartitionKey(trimmed))
                    .delete()
                    .catch(() => { });
                return null;
            }
            const pending = await this.readPendingConnectionDocument(index.connectToken);
            if (!pending || pending.confirmationCode !== trimmed) {
                return null;
            }
            return this.pendingRecordFromDocument(pending);
        }
        catch {
            return null;
        }
    }
    async getConnectionByCode(code) {
        return this.getConnectionByConfirmationCode(code);
    }
    async completePendingConnection(connectToken) {
        const resource = await this.readPendingConnectionDocument(connectToken.trim());
        if (!resource || resource.used) {
            return null;
        }
        const token = (resource.connectToken ?? resource.code).trim();
        const completed = {
            ...resource,
            connectToken: token,
            code: token,
            used: true,
        };
        await this.getContainer().items.upsert(completed);
        return this.pendingRecordFromDocument(completed);
    }
    async issueConfirmationCode(connectToken, confirmationCode) {
        const token = connectToken.trim();
        const confirm = confirmationCode.trim();
        if (!token || !confirm || confirm === token) {
            return null;
        }
        const resource = await this.readPendingConnectionDocument(token);
        if (!resource || !resource.used) {
            return null;
        }
        if (resource.confirmationCode && resource.confirmationCode !== confirm) {
            await this.getContainer()
                .item("confirm", confirmationPartitionKey(resource.confirmationCode))
                .delete()
                .catch(() => { });
        }
        const updated = {
            ...resource,
            connectToken: token,
            code: token,
            confirmationCode: confirm,
            used: true,
        };
        await this.getContainer().items.upsert(updated);
        const indexDoc = {
            pk: confirmationPartitionKey(confirm),
            id: "confirm",
            type: "confirmationCodeIndex",
            confirmationCode: confirm,
            connectToken: token,
            connectionId: resource.connectionId,
            expiresAt: resource.expiresAt,
            ttl: resource.expiresAt >= Number.MAX_SAFE_INTEGER / 2
                ? PENDING_CONNECTION_NO_COSMOS_TTL
                : Math.max(60, Math.ceil((resource.expiresAt - Date.now()) / 1000)),
        };
        await this.getContainer().items.upsert(indexDoc);
        return this.pendingRecordFromDocument(updated);
    }
    async consumeConfirmationCode(confirmationCode) {
        const pending = await this.getConnectionByConfirmationCode(confirmationCode);
        if (!pending)
            return null;
        if (pending.confirmationCode) {
            await this.getContainer()
                .item("confirm", confirmationPartitionKey(pending.confirmationCode))
                .delete()
                .catch(() => { });
        }
        await this.getContainer()
            .item("pending", pendingPartitionKey(pending.connectToken))
            .delete()
            .catch(() => { });
        return pending;
    }
    async consumePendingConnection(code) {
        return this.consumeConfirmationCode(code);
    }
    async bindSessionToConnection(sessionId, connectionId) {
        const normalizedSessionId = sessionId.trim();
        const now = Date.now();
        let createdAt = now;
        // Query instead of point-read so a missing binding does not emit Cosmos 404
        // dependency telemetry (expected for first bind on a new session).
        const existing = await this.readSessionBinding(normalizedSessionId);
        if (existing?.createdAt) {
            createdAt = existing.createdAt;
        }
        const doc = {
            pk: sessionPartitionKey(normalizedSessionId),
            id: "binding",
            type: "sessionBinding",
            sessionId: normalizedSessionId,
            connectionId,
            createdAt,
            updatedAt: now,
            ttl: apiKeyTtlSeconds(),
        };
        await this.getContainer().items.upsert(doc);
    }
    async getConnectionIdForSession(sessionId) {
        const resource = await this.readSessionBinding(sessionId.trim());
        return resource?.connectionId ?? null;
    }
    /**
     * Partition-scoped query for a session binding. Returns null when absent —
     * avoids point-read 404s that Azure Monitor records as failed dependencies.
     */
    async readSessionBinding(sessionId) {
        const { resources } = await this.getContainer().items
            .query({
            query: "SELECT * FROM c WHERE c.id = @id AND c.type = @type",
            parameters: [
                { name: "@id", value: "binding" },
                { name: "@type", value: "sessionBinding" },
            ],
        }, { partitionKey: sessionPartitionKey(sessionId) })
            .fetchAll();
        return resources[0] ?? null;
    }
    async recordClientClaim(args) {
        const doc = {
            pk: clientPartitionKey(args.clientKey),
            id: "lastClaim",
            type: "clientLastClaim",
            clientKey: args.clientKey,
            connectionId: args.connectionId,
            claimedAt: args.claimedAt,
            ttl: sessionTtlSeconds(),
        };
        await this.getContainer().items.upsert(doc);
    }
    async getRecentClientClaim(clientKey, maxAgeMs) {
        // Query instead of point-read so a missing lastClaim is not a Cosmos 404.
        const { resources } = await this.getContainer().items
            .query({
            query: "SELECT * FROM c WHERE c.id = @id AND c.type = @type",
            parameters: [
                { name: "@id", value: "lastClaim" },
                { name: "@type", value: "clientLastClaim" },
            ],
        }, { partitionKey: clientPartitionKey(clientKey) })
            .fetchAll();
        const resource = resources[0];
        if (!resource || resource.type !== "clientLastClaim") {
            return null;
        }
        if (Date.now() - resource.claimedAt > maxAgeMs) {
            await this.getContainer()
                .item("lastClaim", clientPartitionKey(clientKey))
                .delete()
                .catch(() => { });
            return null;
        }
        return resource.connectionId;
    }
    async createConnectionRef(args) {
        const now = Date.now();
        const ttlSeconds = Math.max(60, Math.ceil((args.expiresAt - now) / 1000));
        const doc = {
            pk: connectionRefPartitionKey(args.ref),
            id: "handoff",
            type: "connectionRef",
            ref: args.ref,
            connectionId: args.connectionId,
            expiresAt: args.expiresAt,
            createdAt: now,
            ttl: ttlSeconds,
        };
        await this.getContainer().items.upsert(doc);
    }
    async getConnectionIdForRef(ref) {
        try {
            const { resource } = await this.getContainer()
                .item("handoff", connectionRefPartitionKey(ref.trim()))
                .read();
            if (!resource || resource.type !== "connectionRef") {
                return null;
            }
            if (resource.expiresAt < Date.now()) {
                await this.getContainer()
                    .item("handoff", connectionRefPartitionKey(ref.trim()))
                    .delete()
                    .catch(() => { });
                return null;
            }
            return resource.connectionId;
        }
        catch {
            return null;
        }
    }
    async saveConnectedCompanies(connectionId, companies) {
        const now = Date.now();
        for (const company of companies) {
            const normalised = normaliseCompanyName(company.companyName);
            let createdAt = now;
            try {
                const { resource } = await this.getContainer()
                    .item(companyDocumentId(normalised), connectionPartitionKey(connectionId))
                    .read();
                if (resource?.createdAt) {
                    createdAt = resource.createdAt;
                }
            }
            catch {
                // new company
            }
            const ttlSeconds = Math.max(60, Math.ceil((company.expiresAt - now) / 1000));
            const doc = {
                pk: connectionPartitionKey(connectionId),
                id: companyDocumentId(normalised),
                type: "companyCredential",
                connectionId,
                companyName: company.companyName.trim(),
                credentialType: "apiKey",
                apiKey: encodeStoredApiKey(company.apiKey),
                expiresAt: company.expiresAt,
                createdAt,
                updatedAt: now,
                credentialValidatedAt: company.credentialValidatedAt,
                ttl: ttlSeconds,
            };
            await this.getContainer().items.upsert(doc);
        }
    }
    async listConnectedCompanies(connectionId) {
        const query = {
            query: "SELECT * FROM c WHERE c.pk = @pk AND c.type = @type AND c.expiresAt >= @now",
            parameters: [
                { name: "@pk", value: connectionPartitionKey(connectionId) },
                { name: "@type", value: "companyCredential" },
                { name: "@now", value: Date.now() },
            ],
        };
        const { resources } = await this.getContainer()
            .items.query(query)
            .fetchAll();
        return resources.map((resource) => ({
            connectionId: resource.connectionId,
            companyName: resource.companyName,
            credentialType: "apiKey",
            encryptedSecret: resource.apiKey,
            expiresAt: resource.expiresAt,
            createdAt: resource.createdAt,
            updatedAt: resource.updatedAt,
            credentialValidatedAt: resource.credentialValidatedAt,
        }));
    }
    async getCredentialForCompany(connectionId, companyName) {
        const normalised = normaliseCompanyName(companyName);
        try {
            const { resource } = await this.getContainer()
                .item(companyDocumentId(normalised), connectionPartitionKey(connectionId))
                .read();
            if (!resource || resource.expiresAt < Date.now()) {
                return null;
            }
            return {
                connectionId: resource.connectionId,
                companyName: resource.companyName,
                credentialType: "apiKey",
                encryptedSecret: resource.apiKey,
                expiresAt: resource.expiresAt,
                createdAt: resource.createdAt,
                updatedAt: resource.updatedAt,
                credentialValidatedAt: resource.credentialValidatedAt,
            };
        }
        catch {
            return null;
        }
    }
    async clearConnectedCompany(connectionId, companyName) {
        try {
            await this.getContainer()
                .item(companyDocumentId(normaliseCompanyName(companyName)), connectionPartitionKey(connectionId))
                .delete();
            return true;
        }
        catch {
            return false;
        }
    }
    async clearAllConnectedCompanies(connectionId) {
        const companies = await this.listConnectedCompanies(connectionId);
        let count = 0;
        for (const company of companies) {
            const deleted = await this.clearConnectedCompany(connectionId, company.companyName);
            if (deleted)
                count += 1;
        }
        return count;
    }
    async saveFailedCompanyValidations(connectionId, failures) {
        const now = Date.now();
        const ttlSeconds = apiKeyTtlSeconds();
        for (const failure of failures) {
            const normalised = normaliseCompanyName(failure.companyName);
            const doc = {
                pk: connectionPartitionKey(connectionId),
                id: failedValidationDocumentId(normalised),
                type: "failedCompanyValidation",
                connectionId,
                companyName: failure.companyName.trim(),
                reason: failure.reason,
                message: failure.message,
                createdAt: now,
                ttl: ttlSeconds,
            };
            await this.getContainer().items.upsert(doc);
        }
    }
    async listFailedCompanyValidations(connectionId) {
        const query = {
            query: "SELECT * FROM c WHERE c.pk = @pk AND c.type = @type ORDER BY c.createdAt ASC",
            parameters: [
                { name: "@pk", value: connectionPartitionKey(connectionId) },
                { name: "@type", value: "failedCompanyValidation" },
            ],
        };
        const { resources } = await this.getContainer()
            .items.query(query)
            .fetchAll();
        return resources.map((resource) => ({
            companyName: resource.companyName,
            connected: false,
            reason: resource.reason,
            message: resource.message,
        }));
    }
    async clearFailedCompanyValidations(connectionId) {
        const failures = await this.listFailedCompanyValidations(connectionId);
        for (const failure of failures) {
            try {
                await this.getContainer()
                    .item(failedValidationDocumentId(normaliseCompanyName(failure.companyName)), connectionPartitionKey(connectionId))
                    .delete();
            }
            catch {
                // already removed
            }
        }
    }
    async saveConnectionTelemetry(connectionId, patch) {
        const pk = connectionPartitionKey(connectionId);
        const item = this.getContainer().item("telemetry", pk);
        const updatedAt = Date.now();
        const ttl = apiKeyTtlSeconds();
        // Patch-first: only set fields present in this call. A session-id update must
        // never replace the whole document (Cosmos upsert would drop omitted fields).
        const ops = [
            { op: "set", path: "/type", value: "connectionTelemetry" },
            { op: "set", path: "/connectionId", value: connectionId },
            { op: "set", path: "/updatedAt", value: updatedAt },
            { op: "set", path: "/ttl", value: ttl },
        ];
        const clientId = pickValidTelemetryUuid(patch.telemetryClientId);
        const sessionId = pickValidTelemetryUuid(patch.connectionSessionId);
        if (clientId) {
            ops.push({ op: "set", path: "/telemetryClientId", value: clientId });
        }
        if (sessionId) {
            ops.push({ op: "set", path: "/connectionSessionId", value: sessionId });
        }
        try {
            await item.patch(ops);
            return;
        }
        catch (error) {
            if (!isCosmosNotFoundError(error)) {
                // Document may exist but patch failed; merge-read then upsert only as
                // last resort, preserving any fields returned by a successful read.
                const existing = await this.getConnectionTelemetry(connectionId);
                if (existing) {
                    const merged = mergeConnectionTelemetryRecord(connectionId, existing, patch);
                    await this.getContainer().items.upsert(buildConnectionTelemetryDocument(merged, pk, ttl));
                    return;
                }
                throw error;
            }
        }
        // First write: create with only the fields supplied in this patch.
        const created = mergeConnectionTelemetryRecord(connectionId, null, patch);
        await this.getContainer().items.upsert(buildConnectionTelemetryDocument(created, pk, ttl));
    }
    async getConnectionTelemetry(connectionId) {
        try {
            const { resource } = await this.getContainer()
                .item("telemetry", connectionPartitionKey(connectionId))
                .read();
            if (!resource || resource.type !== "connectionTelemetry") {
                return null;
            }
            return {
                connectionId: resource.connectionId,
                telemetryClientId: isValidTelemetryUuid(resource.telemetryClientId)
                    ? resource.telemetryClientId.trim().toLowerCase()
                    : undefined,
                connectionSessionId: isValidTelemetryUuid(resource.connectionSessionId)
                    ? resource.connectionSessionId.trim().toLowerCase()
                    : undefined,
                updatedAt: resource.updatedAt,
            };
        }
        catch {
            return null;
        }
    }
    async saveConnectionSuccessPage(record) {
        const ttlSeconds = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000));
        const doc = {
            pk: successPagePartitionKey(record.successId),
            id: "success",
            type: "connectionSuccessPage",
            successId: record.successId,
            confirmationCode: record.confirmationCode,
            connectedNames: [...record.connectedNames],
            failedCompanies: record.failedCompanies.map((failure) => ({ ...failure })),
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
            ttl: ttlSeconds,
        };
        await this.getContainer().items.upsert(doc);
    }
    async getConnectionSuccessPage(successId) {
        const trimmed = successId.trim();
        if (!trimmed) {
            return null;
        }
        try {
            const { resource } = await this.getContainer()
                .item("success", successPagePartitionKey(trimmed))
                .read();
            if (!resource || resource.type !== "connectionSuccessPage") {
                return null;
            }
            if (resource.expiresAt <= Date.now()) {
                try {
                    await this.getContainer()
                        .item("success", successPagePartitionKey(trimmed))
                        .delete();
                }
                catch {
                    // already gone
                }
                return null;
            }
            return {
                successId: resource.successId,
                confirmationCode: resource.confirmationCode,
                connectedNames: [...(resource.connectedNames ?? [])],
                failedCompanies: (resource.failedCompanies ?? []).map((failure) => ({
                    ...failure,
                })),
                createdAt: resource.createdAt,
                expiresAt: resource.expiresAt,
            };
        }
        catch {
            return null;
        }
    }
    async savePendingAction(record) {
        const ttlSeconds = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000));
        const doc = {
            pk: pendingActionPartitionKey(record.connectionId, record.scopeKeyHash),
            id: "pendingAction",
            type: "pendingAction",
            connectionId: record.connectionId,
            scopeKeyHash: record.scopeKeyHash,
            workflowId: record.workflowId,
            allowedTools: [...record.allowedTools],
            routeToken: record.routeToken,
            originalMessage: record.originalMessage,
            messageHash: record.messageHash,
            expiresAt: record.expiresAt,
            status: record.status,
            targetRecordKey: record.targetRecordKey,
            previewedAt: record.previewedAt,
            updatedAt: record.updatedAt,
            ttl: ttlSeconds,
        };
        await this.getContainer().items.upsert(doc);
    }
    async getPendingAction(connectionId, scopeKeyHash) {
        const trimmedConnection = connectionId.trim();
        const trimmedScope = scopeKeyHash.trim();
        if (!trimmedConnection || !trimmedScope) {
            return null;
        }
        try {
            const { resource } = await this.getContainer()
                .item("pendingAction", pendingActionPartitionKey(trimmedConnection, trimmedScope))
                .read();
            if (!resource || resource.type !== "pendingAction") {
                return null;
            }
            if (resource.expiresAt <= Date.now()) {
                try {
                    await this.getContainer()
                        .item("pendingAction", pendingActionPartitionKey(trimmedConnection, trimmedScope))
                        .delete();
                }
                catch {
                    // ignore
                }
                return null;
            }
            return {
                connectionId: resource.connectionId,
                scopeKeyHash: resource.scopeKeyHash,
                workflowId: resource.workflowId,
                allowedTools: [...resource.allowedTools],
                routeToken: resource.routeToken,
                originalMessage: resource.originalMessage,
                messageHash: resource.messageHash,
                expiresAt: resource.expiresAt,
                status: resource.status,
                targetRecordKey: resource.targetRecordKey,
                previewedAt: resource.previewedAt,
                updatedAt: resource.updatedAt,
            };
        }
        catch (error) {
            if (isCosmosNotFoundError(error)) {
                return null;
            }
            throw error;
        }
    }
    async clearPendingAction(connectionId, scopeKeyHash) {
        const trimmedConnection = connectionId.trim();
        const trimmedScope = scopeKeyHash.trim();
        if (!trimmedConnection || !trimmedScope) {
            return;
        }
        try {
            await this.getContainer()
                .item("pendingAction", pendingActionPartitionKey(trimmedConnection, trimmedScope))
                .delete();
        }
        catch (error) {
            if (!isCosmosNotFoundError(error)) {
                throw error;
            }
        }
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
