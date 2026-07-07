import { decodeStoredApiKey, encodeStoredApiKey } from "./credential_secret.js";
import { partitionCompanyCredentials } from "./credential_validation.js";
import {
  ensureConnectionStoreInitialized,
  getConnectionStore,
  getConnectionStoreKind,
} from "./connection_store.js";
import type { FailedCompanyConnection } from "./connection_store_types.js";

type SessionCompanyContext = {
  companyName: string;
  apiKey: string;
  expiresAt: number;
};

export async function hydrateSessionKeyStoreFromConnectionStore(
  connectionId: string,
  keyStore: Map<string, SessionCompanyContext>
): Promise<number> {
  await ensureConnectionStoreInitialized();

  const store = getConnectionStore();
  const companies = await store.listConnectedCompanies(connectionId);

  for (const company of companies) {
    const key = company.companyName.trim().toLowerCase();

    keyStore.set(key, {
      companyName: company.companyName,
      apiKey: decodeStoredApiKey(company.encryptedSecret),
      expiresAt: company.expiresAt,
    });
  }

  return companies.length;
}

export async function persistCompanyCredentialToConnectionStore(args: {
  connectionId: string;
  companyName: string;
  apiKey: string;
  expiresAt: number;
}): Promise<void> {
  await ensureConnectionStoreInitialized();

  await getConnectionStore().saveConnectedCompanies(args.connectionId, [
    {
      companyName: args.companyName,
      apiKey: args.apiKey,
      expiresAt: args.expiresAt,
    },
  ]);
}

export async function validateAndPersistConnectedCompanies(args: {
  connectionId: string;
  companies: Array<{ companyName: string; apiKey: string }>;
  expiresAt: number;
}): Promise<{
  connectedCompanies: string[];
  failedCompanies: FailedCompanyConnection[];
}> {
  await ensureConnectionStoreInitialized();

  const store = getConnectionStore();
  const { validated, failed } = await partitionCompanyCredentials(args.companies);

  if (validated.length > 0) {
    await store.saveConnectedCompanies(
      args.connectionId,
      validated.map((company) => ({
        companyName: company.companyName,
        apiKey: company.apiKey,
        expiresAt: args.expiresAt,
      }))
    );
  }

  await store.clearFailedCompanyValidations(args.connectionId);

  if (failed.length > 0) {
    await store.saveFailedCompanyValidations(args.connectionId, failed);
  }

  return {
    connectedCompanies: validated.map((company) => company.companyName),
    failedCompanies: failed,
  };
}

export async function clearCompanyFromConnectionStore(
  connectionId: string,
  companyName: string
): Promise<boolean> {
  await ensureConnectionStoreInitialized();
  return getConnectionStore().clearConnectedCompany(connectionId, companyName);
}

export async function clearAllCompaniesFromConnectionStore(
  connectionId: string
): Promise<number> {
  await ensureConnectionStoreInitialized();
  return getConnectionStore().clearAllConnectedCompanies(connectionId);
}

export function isPersistentConnectionStoreEnabled(): boolean {
  return getConnectionStoreKind() === "cosmos";
}

export { encodeStoredApiKey, decodeStoredApiKey };
