import { decodeStoredApiKey, encodeStoredApiKey } from "./credential_secret.js";
import {
  ensureConnectionStoreInitialized,
  getConnectionStore,
  getConnectionStoreKind,
} from "./connection_store.js";

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
