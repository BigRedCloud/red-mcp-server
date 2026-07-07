import { assertApiKeyAllowed } from "../config/server_config.js";
import type { FailedCompanyConnection } from "./connection_store_types.js";

const BRC_API_BASE_URL = (
  process.env.BRC_API_BASE_URL ?? "https://app.bigredcloud.com/api"
).replace(/\/$/, "");

/** Primary validation — same class of read access Red tools use. */
export const COMPANY_DATA_ACCESS_VALIDATION_PATH =
  "/v1/customers?page=1&pageSize=1";

/** Secondary validation — must also pass; not sufficient on its own. */
export const COMPANY_FINANCIAL_YEAR_VALIDATION_PATH =
  "/v1/companySetupConfig/getFinancialYear";

export type CompanyCredentialValidationReason =
  | "invalid_or_expired_api_key"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed";

export type CompanyCredentialValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason: CompanyCredentialValidationReason;
      message: string;
    };

export type CompanyCredentialValidator = (
  companyName: string,
  apiKey: string
) => Promise<CompanyCredentialValidationResult>;

type ValidationFetch = typeof fetch;

let validationFetch: ValidationFetch = fetch;

function validationDebugEnabled(): boolean {
  const configured =
    process.env.RED_CONNECT_CREDENTIAL_VALIDATION_DEBUG?.trim().toLowerCase();
  if (configured === "false") {
    return false;
  }

  if (configured === "true") {
    return true;
  }

  return process.env.RED_CONNECT_HTTP_MODE === "true";
}

export function logCompanyCredentialValidation(details: {
  companyName: string;
  validationPath: string;
  validationStatus: number;
  validationSucceeded: boolean;
  failureReason?: CompanyCredentialValidationReason;
}): void {
  if (!validationDebugEnabled()) {
    return;
  }

  console.info("Red company credential validation:", JSON.stringify(details));
}

export function setValidationFetch(fetchImpl: ValidationFetch): void {
  validationFetch = fetchImpl;
}

export function resetValidationFetch(): void {
  validationFetch = fetch;
}

export function buildApiKeyAuthorizationHeader(apiKey: string): string {
  const auth = Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${auth}`;
}

export function mapValidationHttpStatusToReason(
  status: number
): CompanyCredentialValidationReason {
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

export function responseBodyIndicatesInvalidCredential(text: string): boolean {
  if (!text.trim()) {
    return false;
  }

  return /unauthori[sz]ed|invalid.*api.*key|expired.*key|access.*denied|forbidden|authentication.*failed|api key.*invalid|credential.*invalid/i.test(
    text
  );
}

export function evaluateBrcCredentialResponse(
  status: number,
  bodyText: string
): CompanyCredentialValidationResult | { valid: true } {
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

export function buildFailedCompanyConnection(
  companyName: string,
  reason: CompanyCredentialValidationReason
): FailedCompanyConnection {
  const trimmedName = companyName.trim();

  return {
    companyName: trimmedName,
    connected: false,
    reason,
    message: `${trimmedName} was not connected because the credential could not be validated.`,
  };
}

let credentialValidator: CompanyCredentialValidator =
  validateCompanyApiKeyCredentialViaBrc;

export function setCompanyCredentialValidator(
  validator: CompanyCredentialValidator
): void {
  credentialValidator = validator;
}

export function resetCompanyCredentialValidator(): void {
  credentialValidator = validateCompanyApiKeyCredentialViaBrc;
}

export async function validateCompanyApiKeyCredential(
  companyName: string,
  apiKey: string
): Promise<CompanyCredentialValidationResult> {
  return credentialValidator(companyName, apiKey);
}

export function buildBrcReadRequestHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: buildApiKeyAuthorizationHeader(apiKey),
  };
}

async function validateApiKeyAgainstBrcPath(
  companyName: string,
  apiKey: string,
  path: string
): Promise<CompanyCredentialValidationResult> {
  const trimmedName = companyName.trim();
  const safePath = path.startsWith("/") ? path : `/${path}`;

  try {
    const response = await validationFetch(`${BRC_API_BASE_URL}${safePath}`, {
      method: "GET",
      headers: buildBrcReadRequestHeaders(apiKey),
    });

    const bodyText = await response.text();
    const evaluated = evaluateBrcCredentialResponse(response.status, bodyText);

    if (evaluated.valid) {
      logCompanyCredentialValidation({
        companyName: trimmedName,
        validationPath: safePath,
        validationStatus: response.status,
        validationSucceeded: true,
      });
      return { valid: true };
    }

    logCompanyCredentialValidation({
      companyName: trimmedName,
      validationPath: safePath,
      validationStatus: response.status,
      validationSucceeded: false,
      failureReason: evaluated.reason,
    });

    return {
      valid: false,
      reason: evaluated.reason,
      message: buildFailedCompanyConnection(trimmedName, evaluated.reason).message,
    };
  } catch {
    logCompanyCredentialValidation({
      companyName: trimmedName,
      validationPath: safePath,
      validationStatus: 0,
      validationSucceeded: false,
      failureReason: "validation_failed",
    });

    return {
      valid: false,
      reason: "validation_failed",
      message: buildFailedCompanyConnection(trimmedName, "validation_failed").message,
    };
  }
}

export async function validateCompanyApiKeyCredentialViaBrc(
  companyName: string,
  apiKey: string
): Promise<CompanyCredentialValidationResult> {
  const trimmedName = companyName.trim();
  const trimmedKey = apiKey.trim();

  if (!trimmedName || !trimmedKey) {
    return {
      valid: false,
      reason: "validation_failed",
      message: buildFailedCompanyConnection(
        trimmedName || companyName,
        "validation_failed"
      ).message,
    };
  }

  try {
    assertApiKeyAllowed(trimmedKey);
  } catch {
    return {
      valid: false,
      reason: "forbidden",
      message: buildFailedCompanyConnection(trimmedName, "forbidden").message,
    };
  }

  const dataAccessResult = await validateApiKeyAgainstBrcPath(
    trimmedName,
    trimmedKey,
    COMPANY_DATA_ACCESS_VALIDATION_PATH
  );

  if (!dataAccessResult.valid) {
    return dataAccessResult;
  }

  const financialYearResult = await validateApiKeyAgainstBrcPath(
    trimmedName,
    trimmedKey,
    COMPANY_FINANCIAL_YEAR_VALIDATION_PATH
  );

  if (!financialYearResult.valid) {
    return financialYearResult;
  }

  return { valid: true };
}

export async function partitionCompanyCredentials(
  companies: Array<{ companyName: string; apiKey: string }>
): Promise<{
  validated: Array<{ companyName: string; apiKey: string }>;
  failed: FailedCompanyConnection[];
}> {
  const validated: Array<{ companyName: string; apiKey: string }> = [];
  const failed: FailedCompanyConnection[] = [];

  for (const company of companies) {
    const result = await validateCompanyApiKeyCredential(
      company.companyName,
      company.apiKey
    );

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

export function isBrcCredentialHttpFailure(status: number): boolean {
  return status === 401 || status === 403;
}
