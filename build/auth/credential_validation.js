import { assertApiKeyAllowed } from "../config/server_config.js";
const BRC_API_BASE_URL = (process.env.BRC_API_BASE_URL ?? "https://app.bigredcloud.com/api").replace(/\/$/, "");
/** Primary validation — same class of read access Red tools use. */
export const COMPANY_DATA_ACCESS_VALIDATION_PATH = "/v1/customers?page=1&pageSize=1";
/** Secondary validation — must also pass; not sufficient on its own. */
export const COMPANY_FINANCIAL_YEAR_VALIDATION_PATH = "/v1/companySetupConfig/getFinancialYear";
let validationFetch = fetch;
export function setValidationFetch(fetchImpl) {
    validationFetch = fetchImpl;
}
export function resetValidationFetch() {
    validationFetch = fetch;
}
export function buildApiKeyAuthorizationHeader(apiKey) {
    const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
    return `Basic ${auth}`;
}
export function mapValidationHttpStatusToReason(status) {
    if (status === 401) {
        return "invalid_or_expired_api_key";
    }
    if (status === 403) {
        return "forbidden";
    }
    if (status === 404) {
        return "not_found";
    }
    return "validation_failed";
}
export function responseBodyIndicatesInvalidCredential(text) {
    if (!text.trim()) {
        return false;
    }
    return /unauthori[sz]ed|invalid.*api.*key|expired.*key|access.*denied|forbidden|authentication.*failed|api key.*invalid|credential.*invalid/i.test(text);
}
export function evaluateBrcCredentialResponse(status, bodyText) {
    if (status >= 200 && status < 300) {
        if (responseBodyIndicatesInvalidCredential(bodyText)) {
            return {
                valid: false,
                reason: "invalid_or_expired_api_key",
                message: "",
            };
        }
        return { valid: true };
    }
    if (responseBodyIndicatesInvalidCredential(bodyText)) {
        return {
            valid: false,
            reason: mapValidationHttpStatusToReason(status === 404 ? 401 : status),
            message: "",
        };
    }
    const reason = mapValidationHttpStatusToReason(status);
    return {
        valid: false,
        reason,
        message: "",
    };
}
export function buildFailedCompanyConnection(companyName, reason) {
    const trimmedName = companyName.trim();
    return {
        companyName: trimmedName,
        connected: false,
        reason,
        message: `${trimmedName} was not connected because the credential could not be validated.`,
    };
}
let credentialValidator = validateCompanyApiKeyCredentialViaBrc;
export function setCompanyCredentialValidator(validator) {
    credentialValidator = validator;
}
export function resetCompanyCredentialValidator() {
    credentialValidator = validateCompanyApiKeyCredentialViaBrc;
}
export async function validateCompanyApiKeyCredential(companyName, apiKey) {
    return credentialValidator(companyName, apiKey);
}
async function validateApiKeyAgainstBrcPath(companyName, apiKey, path) {
    const trimmedName = companyName.trim();
    const safePath = path.startsWith("/") ? path : `/${path}`;
    try {
        const response = await validationFetch(`${BRC_API_BASE_URL}${safePath}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: buildApiKeyAuthorizationHeader(apiKey),
            },
        });
        const bodyText = await response.text();
        const evaluated = evaluateBrcCredentialResponse(response.status, bodyText);
        if (evaluated.valid) {
            return { valid: true };
        }
        const reason = evaluated.reason;
        return {
            valid: false,
            reason,
            message: buildFailedCompanyConnection(trimmedName, reason).message,
        };
    }
    catch {
        return {
            valid: false,
            reason: "validation_failed",
            message: buildFailedCompanyConnection(trimmedName, "validation_failed").message,
        };
    }
}
export async function validateCompanyApiKeyCredentialViaBrc(companyName, apiKey) {
    const trimmedName = companyName.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedName || !trimmedKey) {
        return {
            valid: false,
            reason: "validation_failed",
            message: buildFailedCompanyConnection(trimmedName || companyName, "validation_failed").message,
        };
    }
    try {
        assertApiKeyAllowed(trimmedKey);
    }
    catch {
        return {
            valid: false,
            reason: "forbidden",
            message: buildFailedCompanyConnection(trimmedName, "forbidden").message,
        };
    }
    const dataAccessResult = await validateApiKeyAgainstBrcPath(trimmedName, trimmedKey, COMPANY_DATA_ACCESS_VALIDATION_PATH);
    if (!dataAccessResult.valid) {
        return dataAccessResult;
    }
    const financialYearResult = await validateApiKeyAgainstBrcPath(trimmedName, trimmedKey, COMPANY_FINANCIAL_YEAR_VALIDATION_PATH);
    if (!financialYearResult.valid) {
        return financialYearResult;
    }
    return { valid: true };
}
export async function partitionCompanyCredentials(companies) {
    const validated = [];
    const failed = [];
    for (const company of companies) {
        const result = await validateCompanyApiKeyCredential(company.companyName, company.apiKey);
        if (result.valid) {
            validated.push({
                companyName: company.companyName.trim(),
                apiKey: company.apiKey.trim(),
            });
            continue;
        }
        failed.push({
            companyName: company.companyName.trim(),
            connected: false,
            reason: result.reason,
            message: result.message,
        });
    }
    return { validated, failed };
}
export function isBrcCredentialHttpFailure(status) {
    return status === 401 || status === 403;
}
