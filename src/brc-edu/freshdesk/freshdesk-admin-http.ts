import { timingSafeEqual } from "node:crypto";

import { getBrcEduSyncSecret } from "../../edu/brc_edu_synced_store.js";
import {
  loadFreshdeskArticlesForAdmin,
  runFreshdeskCatalogSync,
  updateFreshdeskArticleVisibility,
} from "./freshdesk-admin-sync.js";
import { toFreshdeskAdminArticle } from "./freshdesk-catalog-merge.js";

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function authorizeFreshdeskServiceSyncSecret(
  providedSecret: string | undefined,
): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const configured = getBrcEduSyncSecret();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "Freshdesk service sync is not configured.",
    };
  }

  const normalized = providedSecret?.trim() ?? "";
  if (!normalized || !secretsMatch(configured, normalized)) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  return { ok: true };
}

export async function handleFreshdeskAdminListArticles(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await loadFreshdeskArticlesForAdmin();
  if (!result.ok) {
    return { status: result.status, body: { error: result.error } };
  }

  return {
    status: 200,
    body: {
      articles: result.payload.articles,
      status: result.payload.status,
      counts: result.payload.counts,
    },
  };
}

export async function handleFreshdeskAdminManualSync(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await runFreshdeskCatalogSync("manual");
  if (!result.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: result.error,
        preservedPreviousCatalog: result.preservedPreviousCatalog,
        status: result.status,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      counts: result.counts,
      status: result.status,
      articles: result.articles,
    },
  };
}

export async function handleFreshdeskServiceSync(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const result = await runFreshdeskCatalogSync("service");
  if (!result.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: result.error,
        preservedPreviousCatalog: result.preservedPreviousCatalog,
        status: result.status,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      counts: result.counts,
      status: result.status,
    },
  };
}

export async function handleFreshdeskVisibilityUpdate(params: {
  articleId: string;
  body: unknown;
  excludedBy?: string | null;
}): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const record =
    params.body && typeof params.body === "object"
      ? (params.body as Record<string, unknown>)
      : null;

  if (!record || typeof record.excluded !== "boolean") {
    return {
      status: 400,
      body: { error: 'Request body must include boolean "excluded".' },
    };
  }

  const reason =
    typeof record.reason === "string" ? record.reason.trim() : undefined;

  const result = await updateFreshdeskArticleVisibility({
    articleId: params.articleId,
    excluded: record.excluded,
    reason,
    excludedBy: params.excludedBy?.trim() || undefined,
  });

  if (!result.ok) {
    return {
      status: result.status,
      body: { error: result.error },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      article: toFreshdeskAdminArticle(result.article),
      counts: {
        total: result.catalog.itemCount,
        visible: result.catalog.visibleCount,
        excluded: result.catalog.excludedCount,
      },
    },
  };
}
