/**
 * Test helper: create a completed connection with a confirmation code ready to claim.
 * connectToken and confirmationCode are always distinct.
 */
export async function seedClaimableConnection(store, args) {
    if (args.connectToken === args.confirmationCode) {
        throw new Error("connectToken and confirmationCode must differ in tests.");
    }
    await store.createPendingConnection({
        connectToken: args.connectToken,
        connectionId: args.connectionId,
        expiresAt: args.expiresAt ?? Date.now() + 60_000,
    });
    await store.completePendingConnection(args.connectToken);
    await store.saveConnectedCompanies(args.connectionId, args.companies.map((company) => ({
        companyName: company.companyName,
        apiKey: company.apiKey,
        expiresAt: company.expiresAt ?? Date.now() + 60_000,
        credentialValidatedAt: Date.now(),
    })));
    const issued = await store.issueConfirmationCode(args.connectToken, args.confirmationCode);
    if (!issued?.confirmationCode) {
        throw new Error("Failed to issue confirmation code in test seed.");
    }
    return {
        connectToken: args.connectToken,
        confirmationCode: args.confirmationCode,
    };
}
