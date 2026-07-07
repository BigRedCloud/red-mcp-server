import { ACTIVE_CONNECTION_STATUS } from "../read_connection_metadata.js";

export const COMPANY_NOT_CONNECTED_ERROR_TYPE = "company_not_connected" as const;

export class CompanyNotConnectedError extends Error {
  readonly errorType = COMPANY_NOT_CONNECTED_ERROR_TYPE;
  readonly companyName: string;

  constructor(companyName: string) {
    const trimmedName = companyName.trim();
    super(
      `${trimmedName} is not connected because its credential could not be validated. Reconnect that company with a current API key.`
    );
    this.name = "CompanyNotConnectedError";
    this.companyName = trimmedName;
  }
}

export function buildCompanyNotConnectedResponse(
  companyName: string,
  options?: { otherCompaniesConnected?: boolean }
): Record<string, unknown> {
  const trimmedName = companyName.trim();

  return {
    connectionStatus: ACTIVE_CONNECTION_STATUS,
    shouldReconnect: false,
    companyConnected: false,
    companyName: trimmedName,
    errorType: COMPANY_NOT_CONNECTED_ERROR_TYPE,
    message: `${trimmedName} is not connected because its credential could not be validated. Reconnect that company with a current API key.`,
    ...(options?.otherCompaniesConnected === false
      ? { otherCompaniesConnected: false }
      : options?.otherCompaniesConnected
        ? { otherCompaniesConnected: true }
        : {}),
  };
}

export function isCompanyNotConnectedError(
  error: unknown
): error is CompanyNotConnectedError {
  return error instanceof CompanyNotConnectedError;
}
