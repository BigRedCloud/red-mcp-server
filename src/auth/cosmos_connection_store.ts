import { CosmosClient, type Container } from "@azure/cosmos";
import { isPendingConnectionExpired } from "./connection_pending.js";
import { redServerConfig } from "../config/server_config.js";
import { encodeStoredApiKey } from "./credential_secret.js";
import type {
  CompanyCredentialInput,
  ConnectionStore,
  ConnectionStoreDiagnostics,
  PendingConnectionRecord,
  StoredCompanyCredential,
} from "./connection_store_types.js";

const PENDING_CONNECTION_NO_COSMOS_TTL = -1;

function sessionTtlSeconds(): number {
  return redServerConfig.sessionTtlMinutes * 60;
}

function normaliseCompanyName(companyName: string): string {
  return companyName.trim().toLowerCase();
}

function sessionPartitionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function pendingPartitionKey(code: string): string {
  return `pending:${code}`;
}

function connectionPartitionKey(connectionId: string): string {
  return `connection:${connectionId}`;
}

function clientPartitionKey(clientKey: string): string {
  return `client:${clientKey}`;
}

function companyDocumentId(normalisedName: string): string {
  return `company:${normalisedName}`;
}

function apiKeyTtlSeconds(): number {
  return redServerConfig.apiKeyTtlMinutes * 60;
}

type CosmosRecord = {
  pk: string;
  id: string;
  type: string;
  [key: string]: unknown;
};

type SessionBindingRecord = CosmosRecord & {
  type: "sessionBinding";
  sessionId: string;
  connectionId: string;
  createdAt: number;
  updatedAt: number;
  ttl: number;
};

type PendingConnectionDocument = CosmosRecord & {
  type: "pendingConnection";
  code: string;
  connectionId: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  ttl: number;
};

type CompanyCredentialDocument = CosmosRecord & {
  type: "companyCredential";
  connectionId: string;
  companyName: string;
  credentialType: "apiKey";
  apiKey: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  ttl: number;
};

type ClientLastClaimDocument = CosmosRecord & {
  type: "clientLastClaim";
  clientKey: string;
  connectionId: string;
  claimedAt: number;
  ttl: number;
};

export class CosmosConnectionStore implements ConnectionStore {
  private readonly client: CosmosClient;
  private readonly databaseId: string;
  private readonly containerId: string;
  private container: Container | null = null;

  constructor(connectionString: string, databaseId: string, containerId: string) {
    this.client = new CosmosClient(connectionString);
    this.databaseId = databaseId;
    this.containerId = containerId;
  }

  private getContainer(): Container {
    if (!this.container) {
      throw new Error("Cosmos connection store has not been initialized.");
    }

    return this.container;
  }

  async initialize(): Promise<void> {
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

  getStoreType(): string {
    return "cosmos";
  }

  async createPendingConnection(args: {
    code: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void> {
    const now = Date.now();
    const doc: PendingConnectionDocument = {
      pk: pendingPartitionKey(args.code),
      id: "pending",
      type: "pendingConnection",
      code: args.code,
      connectionId: args.connectionId,
      createdAt: now,
      expiresAt: args.expiresAt,
      used: false,
      ttl: PENDING_CONNECTION_NO_COSMOS_TTL,
    };

    await this.getContainer().items.upsert(doc);
  }

  private async readPendingConnectionDocument(
    code: string
  ): Promise<PendingConnectionDocument | null> {
    try {
      const { resource } = await this.getContainer()
        .item("pending", pendingPartitionKey(code))
        .read<PendingConnectionDocument>();

      if (!resource || resource.type !== "pendingConnection") {
        return null;
      }

      if (isPendingConnectionExpired(resource.expiresAt)) {
        await this.getContainer()
          .item("pending", pendingPartitionKey(code))
          .delete()
          .catch(() => {});
        return null;
      }

      return resource;
    } catch {
      return null;
    }
  }

  private pendingRecordFromDocument(
    resource: PendingConnectionDocument
  ): PendingConnectionRecord {
    return {
      code: resource.code,
      connectionId: resource.connectionId,
      createdAt: resource.createdAt,
      expiresAt: resource.expiresAt,
      used: Boolean(resource.used),
    };
  }

  async getPendingConnection(code: string): Promise<PendingConnectionRecord | null> {
    const resource = await this.readPendingConnectionDocument(code);
    if (!resource || resource.used) {
      return null;
    }

    return this.pendingRecordFromDocument(resource);
  }

  async getConnectionByCode(code: string): Promise<PendingConnectionRecord | null> {
    const resource = await this.readPendingConnectionDocument(code);
    if (!resource) {
      return null;
    }

    return this.pendingRecordFromDocument(resource);
  }

  async completePendingConnection(code: string): Promise<PendingConnectionRecord | null> {
    const resource = await this.readPendingConnectionDocument(code);
    if (!resource || resource.used) {
      return null;
    }

    const completed: PendingConnectionDocument = {
      ...resource,
      used: true,
    };

    await this.getContainer().items.upsert(completed);
    return this.pendingRecordFromDocument(completed);
  }

  async consumePendingConnection(code: string): Promise<PendingConnectionRecord | null> {
    const pending = await this.getPendingConnection(code);
    if (!pending) return null;

    await this.getContainer()
      .item("pending", pendingPartitionKey(code))
      .delete()
      .catch(() => {});

    return pending;
  }

  async bindSessionToConnection(
    sessionId: string,
    connectionId: string
  ): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    const now = Date.now();
    let createdAt = now;

    try {
      const { resource } = await this.getContainer()
        .item("binding", sessionPartitionKey(normalizedSessionId))
        .read<SessionBindingRecord>();
      if (resource?.createdAt) {
        createdAt = resource.createdAt;
      }
    } catch {
      // new binding
    }

    const doc: SessionBindingRecord = {
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

  async getConnectionIdForSession(sessionId: string): Promise<string | null> {
    try {
      const { resource } = await this.getContainer()
        .item("binding", sessionPartitionKey(sessionId.trim()))
        .read<SessionBindingRecord>();

      return resource?.connectionId ?? null;
    } catch {
      return null;
    }
  }

  async recordClientClaim(args: {
    clientKey: string;
    connectionId: string;
    claimedAt: number;
  }): Promise<void> {
    const doc: ClientLastClaimDocument = {
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

  async getRecentClientClaim(
    clientKey: string,
    maxAgeMs: number
  ): Promise<string | null> {
    try {
      const { resource } = await this.getContainer()
        .item("lastClaim", clientPartitionKey(clientKey))
        .read<ClientLastClaimDocument>();

      if (!resource || resource.type !== "clientLastClaim") {
        return null;
      }

      if (Date.now() - resource.claimedAt > maxAgeMs) {
        await this.getContainer()
          .item("lastClaim", clientPartitionKey(clientKey))
          .delete()
          .catch(() => {});
        return null;
      }

      return resource.connectionId;
    } catch {
      return null;
    }
  }

  async saveConnectedCompanies(
    connectionId: string,
    companies: CompanyCredentialInput[]
  ): Promise<void> {
    const now = Date.now();

    for (const company of companies) {
      const normalised = normaliseCompanyName(company.companyName);
      let createdAt = now;

      try {
        const { resource } = await this.getContainer()
          .item(companyDocumentId(normalised), connectionPartitionKey(connectionId))
          .read<CompanyCredentialDocument>();
        if (resource?.createdAt) {
          createdAt = resource.createdAt;
        }
      } catch {
        // new company
      }

      const ttlSeconds = Math.max(
        60,
        Math.ceil((company.expiresAt - now) / 1000)
      );

      const doc: CompanyCredentialDocument = {
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

  async listConnectedCompanies(
    connectionId: string
  ): Promise<StoredCompanyCredential[]> {
    const query = {
      query:
        "SELECT * FROM c WHERE c.pk = @pk AND c.type = @type AND c.expiresAt >= @now",
      parameters: [
        { name: "@pk", value: connectionPartitionKey(connectionId) },
        { name: "@type", value: "companyCredential" },
        { name: "@now", value: Date.now() },
      ],
    };

    const { resources } = await this.getContainer()
      .items.query<CompanyCredentialDocument>(query)
      .fetchAll();

    return resources.map((resource) => ({
      connectionId: resource.connectionId,
      companyName: resource.companyName,
      credentialType: "apiKey" as const,
      encryptedSecret: resource.apiKey,
      expiresAt: resource.expiresAt,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    }));
  }

  async getCredentialForCompany(
    connectionId: string,
    companyName: string
  ): Promise<StoredCompanyCredential | null> {
    const normalised = normaliseCompanyName(companyName);

    try {
      const { resource } = await this.getContainer()
        .item(companyDocumentId(normalised), connectionPartitionKey(connectionId))
        .read<CompanyCredentialDocument>();

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
    } catch {
      return null;
    }
  }

  async clearConnectedCompany(
    connectionId: string,
    companyName: string
  ): Promise<boolean> {
    try {
      await this.getContainer()
        .item(
          companyDocumentId(normaliseCompanyName(companyName)),
          connectionPartitionKey(connectionId)
        )
        .delete();
      return true;
    } catch {
      return false;
    }
  }

  async clearAllConnectedCompanies(connectionId: string): Promise<number> {
    const companies = await this.listConnectedCompanies(connectionId);
    let count = 0;

    for (const company of companies) {
      const deleted = await this.clearConnectedCompany(
        connectionId,
        company.companyName
      );
      if (deleted) count += 1;
    }

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
