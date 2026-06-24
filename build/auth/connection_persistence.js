import { decodeStoredApiKey, encodeStoredApiKey } from "./credential_secret.js";
import { ensureConnectionStoreInitialized, getConnectionStore, getConnectionStoreKind, } from "./connection_store.js";
export async function hydrateSessionKeyStoreFromConnectionStore(connectionId, keyStore) {
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
export async function persistCompanyCredentialToConnectionStore(args) {
    await ensureConnectionStoreInitialized();
    await getConnectionStore().saveConnectedCompanies(args.connectionId, [
        {
            companyName: args.companyName,
            apiKey: args.apiKey,
            expiresAt: args.expiresAt,
        },
    ]);
}
export async function clearCompanyFromConnectionStore(connectionId, companyName) {
    await ensureConnectionStoreInitialized();
    return getConnectionStore().clearConnectedCompany(connectionId, companyName);
}
export async function clearAllCompaniesFromConnectionStore(connectionId) {
    await ensureConnectionStoreInitialized();
    return getConnectionStore().clearAllConnectedCompanies(connectionId);
}
export function isPersistentConnectionStoreEnabled() {
    return getConnectionStoreKind() === "cosmos";
}
export { encodeStoredApiKey, decodeStoredApiKey };
