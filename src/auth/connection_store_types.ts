export type StoredCompanyCredential = {
  connectionId: string;
  companyName: string;
  credentialType: "apiKey";
  encryptedSecret: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
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
};

export type ConnectionStoreDiagnostics = {
  storeType: string;
  connectionIdPresent: boolean;
  connectionId?: string;
  sessionIdPresent: boolean;
  sessionId?: string;
  connectedCompanyCount: number;
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

  getDiagnostics(args: {
    connectionId?: string;
    sessionId?: string;
  }): Promise<ConnectionStoreDiagnostics>;
}
