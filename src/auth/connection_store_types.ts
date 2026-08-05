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
  /**
   * Secure-page token used in `/connect?code=…` and the connect form.
   * Never accepted by `brc_confirm_company_connection`.
   */
  connectToken: string;
  /**
   * @deprecated Alias of `connectToken` for older call sites.
   * Equal to `connectToken`; not a confirmation code.
   */
  code: string;
  connectionId: string;
  createdAt: number;
  expiresAt: number;
  /** True after the connect form has been submitted (one-time link). */
  used: boolean;
  /**
   * Chat confirmation code — issued only after at least one company connects.
   * Distinct from `connectToken`. Absent on incomplete / legacy records.
   */
  confirmationCode?: string;
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

/** Short-lived success-page lookup — confirmation code is never used as the URL id. */
export type ConnectionSuccessPageRecord = {
  successId: string;
  confirmationCode: string;
  connectedNames: string[];
  failedCompanies: FailedCompanyConnection[];
  createdAt: number;
  expiresAt: number;
};

/**
 * Durable pending transactional action for confirmation continuation.
 * routeToken is opaque and must never be logged.
 */
export type PendingActionRecord = {
  connectionId: string;
  /** Hash of client/session scope — never a raw key or session id. */
  scopeKeyHash: string;
  workflowId: string;
  allowedTools: string[];
  routeToken: string;
  originalMessage: string;
  messageHash: string;
  expiresAt: number;
  status: "routed" | "previewed";
  targetRecordKey?: string;
  previewedAt?: number;
  updatedAt: number;
};

export interface ConnectionStore {
  getStoreType(): string;

  createPendingConnection(args: {
    /** Secure-page token (URL / form). Prefer this over deprecated `code`. */
    connectToken?: string;
    /** @deprecated Alias for `connectToken` — not a confirmation code. */
    code?: string;
    connectionId: string;
    expiresAt: number;
  }): Promise<void>;

  /** Unused connect-page token only. */
  getPendingConnection(connectToken: string): Promise<PendingConnectionRecord | null>;

  /** Connect-page token lookup (used or unused). Never matches confirmation codes. */
  getConnectionByConnectToken(
    connectToken: string
  ): Promise<PendingConnectionRecord | null>;

  /**
   * Confirmation-code lookup for claim.
   * Must not resolve a bare connectToken.
   */
  getConnectionByConfirmationCode(
    confirmationCode: string
  ): Promise<PendingConnectionRecord | null>;

  /**
   * @deprecated Use getConnectionByConfirmationCode.
   * Looks up by confirmation code only (never connectToken).
   */
  getConnectionByCode(code: string): Promise<PendingConnectionRecord | null>;

  completePendingConnection(
    connectToken: string
  ): Promise<PendingConnectionRecord | null>;

  /**
   * Attach a newly generated confirmation code after companies connect.
   * Fails if connectToken is missing/incomplete or confirmationCode equals connectToken.
   */
  issueConfirmationCode(
    connectToken: string,
    confirmationCode: string
  ): Promise<PendingConnectionRecord | null>;

  /** One-time consume after successful claim (by confirmation code). */
  consumeConfirmationCode(
    confirmationCode: string
  ): Promise<PendingConnectionRecord | null>;

  /**
   * @deprecated Use consumeConfirmationCode.
   * Consumes by confirmation code only.
   */
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

  saveConnectionSuccessPage(
    record: ConnectionSuccessPageRecord
  ): Promise<void>;

  getConnectionSuccessPage(
    successId: string
  ): Promise<ConnectionSuccessPageRecord | null>;

  savePendingAction(record: PendingActionRecord): Promise<void>;

  getPendingAction(
    connectionId: string,
    scopeKeyHash: string
  ): Promise<PendingActionRecord | null>;

  clearPendingAction(
    connectionId: string,
    scopeKeyHash: string
  ): Promise<void>;

  getDiagnostics(args: {
    connectionId?: string;
    sessionId?: string;
  }): Promise<ConnectionStoreDiagnostics>;
}
