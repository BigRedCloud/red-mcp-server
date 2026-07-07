import { ACTIVE_CONNECTION_STATUS } from "../read_connection_metadata.js";
export const COMPANY_NOT_CONNECTED_ERROR_TYPE = "company_not_connected";
export class CompanyNotConnectedError extends Error {
    errorType = COMPANY_NOT_CONNECTED_ERROR_TYPE;
    companyName;
    constructor(companyName) {
        const trimmedName = companyName.trim();
        super(`${trimmedName} is not connected because its credential could not be validated. Reconnect that company with a current API key.`);
        this.name = "CompanyNotConnectedError";
        this.companyName = trimmedName;
    }
}
export function buildCompanyNotConnectedResponse(companyName, options) {
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
export function isCompanyNotConnectedError(error) {
    return error instanceof CompanyNotConnectedError;
}
