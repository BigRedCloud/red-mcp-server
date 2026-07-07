import { decodeStoredApiKey, encodeStoredApiKey } from "./credential_secret.js";
import { partitionCompanyCredentials, validateCompanyApiKeyCredential, } from "./credential_validation.js";
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
export async function validateAndPersistConnectedCompanies(args) {
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    for (const company of args.companies) {
        await store.clearConnectedCompany(args.connectionId, company.companyName);
    }
    const { validated, failed } = await partitionCompanyCredentials(args.companies);
    if (validated.length > 0) {
        const validatedAt = Date.now();
        await store.saveConnectedCompanies(args.connectionId, validated.map((company) => ({
            companyName: company.companyName,
            apiKey: company.apiKey,
            expiresAt: args.expiresAt,
            credentialValidatedAt: validatedAt,
        })));
    }
    const existingFailed = await store.listFailedCompanyValidations(args.connectionId);
    const failedByName = new Map(existingFailed.map((entry) => [entry.companyName.trim().toLowerCase(), entry]));
    for (const failure of failed) {
        failedByName.set(failure.companyName.trim().toLowerCase(), failure);
    }
    for (const company of validated) {
        failedByName.delete(company.companyName.trim().toLowerCase());
    }
    const mergedFailed = Array.from(failedByName.values());
    await store.clearFailedCompanyValidations(args.connectionId);
    if (mergedFailed.length > 0) {
        await store.saveFailedCompanyValidations(args.connectionId, mergedFailed);
    }
    return {
        connectedCompanies: validated.map((company) => company.companyName),
        failedCompanies: mergedFailed,
    };
}
/**
 * Re-validates stored credentials before MCP confirm. Removes companies whose
 * keys no longer pass BRC read validation (for example stale store entries).
 */
export async function revalidateStoredConnectionCompanies(connectionId) {
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore();
    const stored = await store.listConnectedCompanies(connectionId);
    const existingFailed = await store.listFailedCompanyValidations(connectionId);
    const failedByName = new Map(existingFailed.map((entry) => [entry.companyName.trim().toLowerCase(), entry]));
    const connectedCompanies = [];
    for (const company of stored) {
        if (company.credentialValidatedAt) {
            connectedCompanies.push(company.companyName);
            failedByName.delete(company.companyName.trim().toLowerCase());
            continue;
        }
        const apiKey = decodeStoredApiKey(company.encryptedSecret);
        const result = await validateCompanyApiKeyCredential(company.companyName, apiKey);
        if (result.valid) {
            connectedCompanies.push(company.companyName);
            failedByName.delete(company.companyName.trim().toLowerCase());
            continue;
        }
        await store.clearConnectedCompany(connectionId, company.companyName);
        failedByName.set(company.companyName.trim().toLowerCase(), {
            companyName: company.companyName,
            connected: false,
            reason: result.reason,
            message: result.message,
        });
    }
    const failedCompanies = Array.from(failedByName.values());
    await store.clearFailedCompanyValidations(connectionId);
    if (failedCompanies.length > 0) {
        await store.saveFailedCompanyValidations(connectionId, failedCompanies);
    }
    return {
        connectedCompanies,
        failedCompanies,
    };
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
