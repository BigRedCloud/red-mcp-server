import { RED_BRC_EDU_SYNC_SECRET_HEADER } from "./constants.js";
export function getRedBrcEduSyncEndpoint() {
    const endpoint = process.env.RED_BRC_EDU_SYNC_ENDPOINT?.trim();
    return endpoint || null;
}
export function getRedBrcEduSyncSecret() {
    const secret = process.env.RED_BRC_EDU_SYNC_SECRET?.trim();
    return secret || null;
}
export async function postCsvTextToRed(csvText, endpoint, secret, fetchFn = fetch) {
    const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            [RED_BRC_EDU_SYNC_SECRET_HEADER]: secret,
        },
        body: JSON.stringify({ csvText }),
    });
    let body = {};
    try {
        body = await response.json();
    }
    catch {
        body = {};
    }
    return {
        ok: response.ok,
        status: response.status,
        body,
    };
}
export function formatRedSyncFailureMessage(result) {
    const body = result.body;
    const errorMessage = body && typeof body === "object" && "error" in body
        ? String(body.error)
        : "Unknown error";
    return `Red sync failed with status ${result.status}: ${errorMessage}`;
}
