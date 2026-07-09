import { RED_BRC_EDU_SYNC_SECRET_HEADER } from "./constants.js";

export type RedBrcEduSyncResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

export function getRedBrcEduSyncEndpoint(): string | null {
  const endpoint = process.env.RED_BRC_EDU_SYNC_ENDPOINT?.trim();
  return endpoint || null;
}

export function getRedBrcEduSyncSecret(): string | null {
  const secret = process.env.RED_BRC_EDU_SYNC_SECRET?.trim();
  return secret || null;
}

export async function postCsvTextToRed(
  csvText: string,
  endpoint: string,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<RedBrcEduSyncResult> {
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [RED_BRC_EDU_SYNC_SECRET_HEADER]: secret,
    },
    body: JSON.stringify({ csvText }),
  });

  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

export function formatRedSyncFailureMessage(result: RedBrcEduSyncResult): string {
  const body = result.body;
  const errorMessage =
    body && typeof body === "object" && "error" in body
      ? String((body as Record<string, unknown>).error)
      : "Unknown error";

  return `Red sync failed with status ${result.status}: ${errorMessage}`;
}
