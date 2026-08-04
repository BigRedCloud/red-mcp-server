export class BrcEduGraphError extends Error {
    constructor(message) {
        super(message);
        this.name = "BrcEduGraphError";
    }
}
async function runGraphRequest(operation, failureMessage) {
    try {
        return await operation();
    }
    catch (error) {
        if (error instanceof BrcEduGraphError) {
            throw error;
        }
        throw new BrcEduGraphError(failureMessage);
    }
}
export function getBrcEduGraphConfig() {
    const tenantId = process.env.BRC_EDU_GRAPH_TENANT_ID?.trim();
    const clientId = process.env.BRC_EDU_GRAPH_CLIENT_ID?.trim();
    const clientSecret = process.env.BRC_EDU_GRAPH_CLIENT_SECRET?.trim();
    const driveId = process.env.BRC_EDU_GRAPH_DRIVE_ID?.trim();
    const itemId = process.env.BRC_EDU_GRAPH_ITEM_ID?.trim();
    if (!tenantId || !clientId || !clientSecret || !driveId || !itemId) {
        return null;
    }
    return { tenantId, clientId, clientSecret, driveId, itemId };
}
export async function fetchGraphAccessToken(config, fetchImpl = fetch) {
    return runGraphRequest(async () => {
        const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
        const body = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            scope: "https://graph.microsoft.com/.default",
            grant_type: "client_credentials",
        });
        const response = await fetchImpl(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        if (!response.ok) {
            throw new BrcEduGraphError("Microsoft Graph BRC Edu token request failed.");
        }
        const payload = (await response.json());
        if (!payload.access_token) {
            throw new BrcEduGraphError("Microsoft Graph BRC Edu token response was invalid.");
        }
        return payload.access_token;
    }, "Microsoft Graph BRC Edu token request failed.");
}
export async function downloadSupportCsvFromGraph(config, fetchImpl = fetch) {
    return runGraphRequest(async () => {
        const accessToken = await fetchGraphAccessToken(config, fetchImpl);
        const contentUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(config.driveId)}/items/${encodeURIComponent(config.itemId)}/content`;
        const response = await fetchImpl(contentUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) {
            throw new BrcEduGraphError("Microsoft Graph BRC Edu download failed.");
        }
        return response.text();
    }, "Microsoft Graph BRC Edu download failed.");
}
