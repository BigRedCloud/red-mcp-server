export type StoredCompanyCredential = {
  connectionId: string;
  companyName: string;
  credentialType: "apiKey";
  encryptedSecret: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  /** Set when BRC validation succeeded before persistence (CSV / connect form). */
  credentialValidatedAt?: number;
};

export type PendingConnectionRecord = {
  code: string;
  connectionId: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

export type CompanyCredentialInput = {
  companyName: string;
  apiKey: string;
  expiresAt: number;
  credentialValidatedAt?: number;
};

export type FailedCompanyConnection = {
  companyName: string;
  connected: false;
  reason:
    | "invalid_or_expired_api_key"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "validation_failed";
  message: string;
};

export type ConnectionStoreDiagnostics = {
  storeType: string;
  connectionIdPresent: boolean;
  connectionId?: string;
  sessionIdPresent: boolean;
  sessionId?: string;
  connectedCompanyCount: number;
};

/** Anonymous telemetry IDs associated with a connection (never secrets). */
export type ConnectionTelemetryRecord = {
  connectionId: string;
  telemetryClientId?: string;
  connectionSessionId?: string;
  updatedAt: number;
};

export interface ConnectionStore {
  getStoreType(): string;

  createPendingConnection(args: {
    code: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void>;

  getPendingConnection(code: string): Promise<PendingConnectionRecord | null>;

  getConnectionByCode(code: string): Promise<PendingConnectionRecord | null>;

  completePendingConnection(code: string): Promise<PendingConnectionRecord | null>;

  consumePendingConnection(code: string): Promise<PendingConnectionRecord | null>;

  bindSessionToConnection(
    sessionId: string,
    connectionId: string
  ): Promise<void>;

  getConnectionIdForSession(sessionId: string): Promise<string | null>;

  recordClientClaim(args: {
    clientKey: string;
    connectionId: string;
    claimedAt: number;
  }): Promise<void>;

  getRecentClientClaim(
    clientKey: string,
    maxAgeMs: number
  ): Promise<string | null>;

  createConnectionRef(args: {
    ref: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void>;

  getConnectionIdForRef(ref: string): Promise<string | null>;

  saveConnectedCompanies(
    connectionId: string,
    companies: CompanyCredentialInput[]
  ): Promise<void>;

  listConnectedCompanies(
    connectionId: string
  ): Promise<StoredCompanyCredential[]>;

  getCredentialForCompany(
    connectionId: string,
    companyName: string
  ): Promise<StoredCompanyCredential | null>;

  clearConnectedCompany(
    connectionId: string,
    companyName: string
  ): Promise<boolean>;

  clearAllConnectedCompanies(connectionId: string): Promise<number>;

  saveFailedCompanyValidations(
    connectionId: string,
    failures: FailedCompanyConnection[]
  ): Promise<void>;

  listFailedCompanyValidations(
    connectionId: string
  ): Promise<FailedCompanyConnection[]>;

  clearFailedCompanyValidations(connectionId: string): Promise<void>;

  saveConnectionTelemetry(
    connectionId: string,
    patch: {
      telemetryClientId?: string;
      connectionSessionId?: string;
    }
  ): Promise<void>;

  getConnectionTelemetry(
    connectionId: string
  ): Promise<ConnectionTelemetryRecord | null>;

  getDiagnostics(args: {
    connectionId?: string;
    sessionId?: string;
  }): Promise<ConnectionStoreDiagnostics>;
}
