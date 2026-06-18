import { CosmosClient } from "@azure/cosmos";
import { redServerConfig } from "../config/server_config.js";
import { encodeStoredApiKey } from "./credential_secret.js";
const PENDING_TTL_SECONDS = 600;
function normaliseCompanyName(companyName) {
    return companyName.trim().toLowerCase();
}
function sessionPartitionKey(sessionId) {
    return `session:${sessionId}`;
}
function pendingPartitionKey(code) {
    return `pending:${code}`;
}
function connectionPartitionKey(connectionId) {
    return `connection:${connectionId}`;
}
function companyDocumentId(normalisedName) {
    return `company:${normalisedName}`;
}
function apiKeyTtlSeconds() {
    return redServerConfig.apiKeyTtlMinutes * 60;
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
        const now = Date.now();
        const doc = {
            pk: pendingPartitionKey(args.code),
            id: "pending",
            type: "pendingConnection",
            code: args.code,
            connectionId: args.connectionId,
            createdAt: now,
            expiresAt: args.expiresAt,
            used: false,
            ttl: PENDING_TTL_SECONDS,
        };
        await this.getContainer().items.upsert(doc);
    }
    async readPendingConnectionDocument(code) {
        try {
            const { resource } = await this.getContainer()
                .item("pending", pendingPartitionKey(code))
                .read();
            if (!resource || resource.type !== "pendingConnection") {
                return null;
            }
            if (resource.expiresAt < Date.now()) {
                await this.getContainer()
                    .item("pending", pendingPartitionKey(code))
                    .delete()
                    .catch(() => { });
                return null;
            }
            return resource;
        }
        catch {
            return null;
        }
    }
    pendingRecordFromDocument(resource) {
        return {
            code: resource.code,
            connectionId: resource.connectionId,
            createdAt: resource.createdAt,
            expiresAt: resource.expiresAt,
            used: Boolean(resource.used),
        };
    }
    async getPendingConnection(code) {
        const resource = await this.readPendingConnectionDocument(code);
        if (!resource || resource.used) {
            return null;
        }
        return this.pendingRecordFromDocument(resource);
    }
    async getConnectionByCode(code) {
        const resource = await this.readPendingConnectionDocument(code);
        if (!resource) {
            return null;
        }
        return this.pendingRecordFromDocument(resource);
    }
    async completePendingConnection(code) {
        const resource = await this.readPendingConnectionDocument(code);
        if (!resource || resource.used) {
            return null;
        }
        const completed = {
            ...resource,
            used: true,
        };
        await this.getContainer().items.upsert(completed);
        return this.pendingRecordFromDocument(completed);
    }
    async consumePendingConnection(code) {
        const pending = await this.getPendingConnection(code);
        if (!pending)
            return null;
        await this.getContainer()
            .item("pending", pendingPartitionKey(code))
            .delete()
            .catch(() => { });
        return pending;
    }
    async bindSessionToConnection(sessionId, connectionId) {
        const now = Date.now();
        let createdAt = now;
        try {
            const { resource } = await this.getContainer()
                .item("binding", sessionPartitionKey(sessionId))
                .read();
            if (resource?.createdAt) {
                createdAt = resource.createdAt;
            }
        }
        catch {
            // new binding
        }
        const doc = {
            pk: sessionPartitionKey(sessionId),
            id: "binding",
            type: "sessionBinding",
            sessionId,
            connectionId,
            createdAt,
            updatedAt: now,
            ttl: apiKeyTtlSeconds(),
        };
        await this.getContainer().items.upsert(doc);
    }
    async getConnectionIdForSession(sessionId) {
        try {
            const { resource } = await this.getContainer()
                .item("binding", sessionPartitionKey(sessionId))
                .read();
            return resource?.connectionId ?? null;
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
