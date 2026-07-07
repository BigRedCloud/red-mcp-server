import { assertApiKeyAllowed } from "../config/server_config.js";
import type { FailedCompanyConnection } from "./connection_store_types.js";

const BRC_API_BASE_URL = (
  process.env.BRC_API_BASE_URL ?? "https://app.bigredcloud.com/api"
).replace(/\/$/, "");

export const COMPANY_CREDENTIAL_VALIDATION_PATH =
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
      message: buildFailedCompanyConnection(trimmedName || companyName, "validation_failed")
        .message,
    };
  }

  try {
    assertApiKeyAllowed(trimmedKey);
  } catch (error) {
    return {
      valid: false,
      reason: "forbidden",
      message: buildFailedCompanyConnection(trimmedName, "forbidden").message,
    };
  }

  const safePath = COMPANY_CREDENTIAL_VALIDATION_PATH.startsWith("/")
    ? COMPANY_CREDENTIAL_VALIDATION_PATH
    : `/${COMPANY_CREDENTIAL_VALIDATION_PATH}`;

  try {
    const response = await fetch(`${BRC_API_BASE_URL}${safePath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildApiKeyAuthorizationHeader(trimmedKey),
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    const reason = mapValidationHttpStatusToReason(response.status);
    return {
      valid: false,
      reason,
      message: buildFailedCompanyConnection(trimmedName, reason).message,
    };
  } catch {
    return {
      valid: false,
      reason: "validation_failed",
      message: buildFailedCompanyConnection(trimmedName, "validation_failed").message,
    };
  }
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
