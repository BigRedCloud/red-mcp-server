import { CosmosClient, type Container } from "@azure/cosmos";
import { isPendingConnectionExpired } from "./connection_pending.js";
import { redServerConfig } from "../config/server_config.js";
import { encodeStoredApiKey } from "./credential_secret.js";
import {
  mergeConnectionTelemetryRecord,
  pickValidTelemetryUuid,
} from "./connection_telemetry_merge.js";
import { isValidTelemetryUuid } from "../telemetry/identity.js";
import type {
  CompanyCredentialInput,
  ConnectionStore,
  ConnectionStoreDiagnostics,
  ConnectionSuccessPageRecord,
  ConnectionTelemetryRecord,
  FailedCompanyConnection,
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

function connectionRefPartitionKey(ref: string): string {
  return `ref:${ref}`;
}

function successPagePartitionKey(successId: string): string {
  return `success:${successId}`;
}

function companyDocumentId(normalisedName: string): string {
  return `company:${normalisedName}`;
}

function failedValidationDocumentId(normalisedName: string): string {
  return `failed:${normalisedName}`;
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
  credentialValidatedAt?: number;
  ttl: number;
};

type ClientLastClaimDocument = CosmosRecord & {
  type: "clientLastClaim";
  clientKey: string;
  connectionId: string;
  claimedAt: number;
  ttl: number;
};

type ConnectionRefDocument = CosmosRecord & {
  type: "connectionRef";
  ref: string;
  connectionId: string;
  expiresAt: number;
  createdAt: number;
  ttl: number;
};

type FailedCompanyValidationDocument = CosmosRecord & {
  type: "failedCompanyValidation";
  connectionId: string;
  companyName: string;
  reason: FailedCompanyConnection["reason"];
  message: string;
  createdAt: number;
  ttl: number;
};

type ConnectionTelemetryDocument = CosmosRecord & {
  type: "connectionTelemetry";
  connectionId: string;
  telemetryClientId?: string;
  connectionSessionId?: string;
  updatedAt: number;
  ttl: number;
};

type ConnectionSuccessPageDocument = CosmosRecord & {
  type: "connectionSuccessPage";
  successId: string;
  confirmationCode: string;
  connectedNames: string[];
  failedCompanies: FailedCompanyConnection[];
  createdAt: number;
  expiresAt: number;
  ttl: number;
};

function isCosmosNotFoundError(error: unknown): boolean {
  const statusCode =
    error && typeof error === "object" && "code" in error
      ? Number((error as { code?: unknown }).code)
      : error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : NaN;
  return statusCode === 404;
}

function buildConnectionTelemetryDocument(
  record: ConnectionTelemetryRecord,
  pk: string,
  ttl: number
): ConnectionTelemetryDocument {
  const doc: ConnectionTelemetryDocument = {
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
    const pending = await this.getConnectionByCode(code);
    if (!pending) return null;

    await this.getContainer()
      .item("pending", pendingPartitionKey(pending.code))
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

  async createConnectionRef(args: {
    ref: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void> {
    const now = Date.now();
    const ttlSeconds = Math.max(60, Math.ceil((args.expiresAt - now) / 1000));

    const doc: ConnectionRefDocument = {
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

  async getConnectionIdForRef(ref: string): Promise<string | null> {
    try {
      const { resource } = await this.getContainer()
        .item("handoff", connectionRefPartitionKey(ref.trim()))
        .read<ConnectionRefDocument>();

      if (!resource || resource.type !== "connectionRef") {
        return null;
      }

      if (resource.expiresAt < Date.now()) {
        await this.getContainer()
          .item("handoff", connectionRefPartitionKey(ref.trim()))
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
        credentialValidatedAt: company.credentialValidatedAt,
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
      credentialValidatedAt: resource.credentialValidatedAt,
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
        credentialValidatedAt: resource.credentialValidatedAt,
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

  async saveFailedCompanyValidations(
    connectionId: string,
    failures: FailedCompanyConnection[]
  ): Promise<void> {
    const now = Date.now();
    const ttlSeconds = apiKeyTtlSeconds();

    for (const failure of failures) {
      const normalised = normaliseCompanyName(failure.companyName);
      const doc: FailedCompanyValidationDocument = {
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

  async listFailedCompanyValidations(
    connectionId: string
  ): Promise<FailedCompanyConnection[]> {
    const query = {
      query:
        "SELECT * FROM c WHERE c.pk = @pk AND c.type = @type ORDER BY c.createdAt ASC",
      parameters: [
        { name: "@pk", value: connectionPartitionKey(connectionId) },
        { name: "@type", value: "failedCompanyValidation" },
      ],
    };

    const { resources } = await this.getContainer()
      .items.query<FailedCompanyValidationDocument>(query)
      .fetchAll();

    return resources.map((resource) => ({
      companyName: resource.companyName,
      connected: false as const,
      reason: resource.reason,
      message: resource.message,
    }));
  }

  async clearFailedCompanyValidations(connectionId: string): Promise<void> {
    const failures = await this.listFailedCompanyValidations(connectionId);

    for (const failure of failures) {
      try {
        await this.getContainer()
          .item(
            failedValidationDocumentId(normaliseCompanyName(failure.companyName)),
            connectionPartitionKey(connectionId)
          )
          .delete();
      } catch {
        // already removed
      }
    }
  }

  async saveConnectionTelemetry(
    connectionId: string,
    patch: {
      telemetryClientId?: string;
      connectionSessionId?: string;
    }
  ): Promise<void> {
    const pk = connectionPartitionKey(connectionId);
    const item = this.getContainer().item("telemetry", pk);
    const updatedAt = Date.now();
    const ttl = apiKeyTtlSeconds();

    // Patch-first: only set fields present in this call. A session-id update must
    // never replace the whole document (Cosmos upsert would drop omitted fields).
    const ops: Array<{ op: "set"; path: string; value: string | number }> = [
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
    } catch (error) {
      if (!isCosmosNotFoundError(error)) {
        // Document may exist but patch failed; merge-read then upsert only as
        // last resort, preserving any fields returned by a successful read.
        const existing = await this.getConnectionTelemetry(connectionId);
        if (existing) {
          const merged = mergeConnectionTelemetryRecord(
            connectionId,
            existing,
            patch
          );
          await this.getContainer().items.upsert(
            buildConnectionTelemetryDocument(merged, pk, ttl)
          );
          return;
        }
        throw error;
      }
    }

    // First write: create with only the fields supplied in this patch.
    const created = mergeConnectionTelemetryRecord(connectionId, null, patch);
    await this.getContainer().items.upsert(
      buildConnectionTelemetryDocument(created, pk, ttl)
    );
  }

  async getConnectionTelemetry(
    connectionId: string
  ): Promise<ConnectionTelemetryRecord | null> {
    try {
      const { resource } = await this.getContainer()
        .item("telemetry", connectionPartitionKey(connectionId))
        .read<ConnectionTelemetryDocument>();

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
    } catch {
      return null;
    }
  }

  async saveConnectionSuccessPage(
    record: ConnectionSuccessPageRecord
  ): Promise<void> {
    const ttlSeconds = Math.max(
      60,
      Math.ceil((record.expiresAt - Date.now()) / 1000)
    );

    const doc: ConnectionSuccessPageDocument = {
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

  async getConnectionSuccessPage(
    successId: string
  ): Promise<ConnectionSuccessPageRecord | null> {
    const trimmed = successId.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const { resource } = await this.getContainer()
        .item("success", successPagePartitionKey(trimmed))
        .read<ConnectionSuccessPageDocument>();

      if (!resource || resource.type !== "connectionSuccessPage") {
        return null;
      }

      if (resource.expiresAt <= Date.now()) {
        try {
          await this.getContainer()
            .item("success", successPagePartitionKey(trimmed))
            .delete();
        } catch {
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
    } catch {
      return null;
    }
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
