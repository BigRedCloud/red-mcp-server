import type { ContainerClient } from "@azure/storage-blob";

import { FreshdeskClient } from "./freshdesk-client.js";
import {
  createConfiguredFreshdeskIndexContainer,
  saveFreshdeskArticlesIndex,
} from "./freshdesk-index-store.js";
import {
  createFreshdeskImageContainer,
} from "./image-sync.js";
import {
  getFreshdeskKbImageContainerName,
  getFreshdeskKbStorageConnectionString,
} from "./freshdesk-kb-storage.js";
import {
  syncFreshdeskKnowledgeBase,
  type FreshdeskSyncClient,
} from "./freshdesk-sync-service.js";
import {
  mergeFreshdeskCatalogWithOverrides,
  summarizeFreshdeskEffectiveCatalog,
  toFreshdeskAdminArticle,
  upsertFreshdeskArticleOverride,
} from "./freshdesk-catalog-merge.js";
import {
  createConfiguredFreshdeskCatalogContainer,
  emptyFreshdeskSyncStatus,
  loadFreshdeskEffectiveCatalog,
  loadFreshdeskOverrides,
  loadFreshdeskRawArticles,
  loadFreshdeskSyncStatus,
  saveFreshdeskEffectiveCatalog,
  saveFreshdeskOverrides,
  saveFreshdeskSyncStatus,
  toSafeFreshdeskCatalogStorageError,
} from "./freshdesk-catalog-store.js";
import type {
  FreshdeskAdminArticle,
  FreshdeskCatalogArticle,
  FreshdeskEffectiveCatalog,
  FreshdeskSyncSource,
  FreshdeskSyncStatus,
} from "./freshdesk-catalog-types.js";
import { invalidateFreshdeskHelpIndexCache } from "./freshdesk-help-search.js";

export type FreshdeskAdminSyncDeps = {
  catalogContainer?: ContainerClient | null;
  imageContainer?: ContainerClient | null;
  client?: FreshdeskSyncClient | null;
  invalidateCache?: boolean;
  now?: Date;
};

export type FreshdeskAdminSyncSuccess = {
  ok: true;
  catalog: FreshdeskEffectiveCatalog;
  status: FreshdeskSyncStatus;
  counts: NonNullable<FreshdeskSyncStatus["lastCounts"]>;
  articles: FreshdeskAdminArticle[];
};

export type FreshdeskAdminSyncFailure = {
  ok: false;
  error: string;
  preservedPreviousCatalog: boolean;
  status: FreshdeskSyncStatus;
};

export type FreshdeskAdminSyncResult =
  | FreshdeskAdminSyncSuccess
  | FreshdeskAdminSyncFailure;

function getFreshdeskClientFromEnv(): FreshdeskClient | null {
  const apiKey = process.env.FRESHDESK_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl =
    process.env.FRESHDESK_BASE_URL?.trim() ||
    "https://bigredcloud.freshdesk.com";

  return new FreshdeskClient(baseUrl, apiKey);
}

function getImageContainerFromEnv(): ContainerClient | null {
  const connection = getFreshdeskKbStorageConnectionString();
  if (!connection) {
    return null;
  }

  return createFreshdeskImageContainer(
    connection,
    getFreshdeskKbImageContainerName(),
  );
}

export async function rebuildFreshdeskEffectiveCatalogFromStores(params: {
  container: ContainerClient;
  invalidateCache?: boolean;
  now?: Date;
}): Promise<FreshdeskEffectiveCatalog> {
  const now = params.now ?? new Date();
  const raw = await loadFreshdeskRawArticles(params.container);
  if (!raw) {
    throw new Error("No Freshdesk articles index is available to rebuild.");
  }

  const overridesLoad = await loadFreshdeskOverrides(params.container);
  const effective = mergeFreshdeskCatalogWithOverrides({
    articles: raw.articles,
    overrides: overridesLoad.document.overrides,
    generatedAt: now.toISOString(),
    lastSyncedAt: raw.generatedAt,
  });

  await saveFreshdeskEffectiveCatalog(params.container, effective);

  if (params.invalidateCache !== false) {
    invalidateFreshdeskHelpIndexCache();
  }

  return effective;
}

export async function runFreshdeskCatalogSync(
  source: FreshdeskSyncSource,
  deps: FreshdeskAdminSyncDeps = {},
): Promise<FreshdeskAdminSyncResult> {
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const catalogContainer =
    deps.catalogContainer === undefined
      ? createConfiguredFreshdeskCatalogContainer()
      : deps.catalogContainer;
  const imageContainer =
    deps.imageContainer === undefined
      ? getImageContainerFromEnv()
      : deps.imageContainer;
  const client =
    deps.client === undefined ? getFreshdeskClientFromEnv() : deps.client;
  const invalidateCache = deps.invalidateCache !== false;

  let status = catalogContainer
    ? await loadFreshdeskSyncStatus(catalogContainer)
    : emptyFreshdeskSyncStatus();

  status = {
    ...status,
    lastAttemptAt: nowIso,
    lastSource: source,
  };

  if (!catalogContainer) {
    return {
      ok: false,
      error: "BRC Edu upload storage is not configured.",
      preservedPreviousCatalog: true,
      status: {
        ...status,
        lastErrorSummary: "BRC Edu upload storage is not configured.",
      },
    };
  }

  if (!client) {
    const error =
      "Freshdesk sync is not configured. Set FRESHDESK_API_KEY.";
    status = { ...status, lastErrorSummary: error };
    await saveFreshdeskSyncStatus(catalogContainer, status);
    return {
      ok: false,
      error,
      preservedPreviousCatalog: true,
      status,
    };
  }

  if (!imageContainer) {
    const error =
      "Freshdesk image storage is not configured. Set BRC_EDU_KB_STORAGE_CONNECTION or BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING.";
    status = { ...status, lastErrorSummary: error };
    await saveFreshdeskSyncStatus(catalogContainer, status);
    return {
      ok: false,
      error,
      preservedPreviousCatalog: true,
      status,
    };
  }

  const previousCatalog = await loadFreshdeskEffectiveCatalog(catalogContainer);

  try {
    const syncResult = await syncFreshdeskKnowledgeBase(client, imageContainer);

    if (syncResult.articles.length === 0) {
      const error =
        "Freshdesk returned no published articles. The previous catalogue was preserved.";
      status = { ...status, lastErrorSummary: error };
      await saveFreshdeskSyncStatus(catalogContainer, status);
      return {
        ok: false,
        error,
        preservedPreviousCatalog: Boolean(previousCatalog),
        status,
      };
    }

    await saveFreshdeskArticlesIndex(catalogContainer, syncResult, {
      generatedAt: now,
    });

    const overridesLoad = await loadFreshdeskOverrides(catalogContainer);
    const effective = mergeFreshdeskCatalogWithOverrides({
      articles: syncResult.articles,
      overrides: overridesLoad.document.overrides,
      generatedAt: nowIso,
      lastSyncedAt: nowIso,
    });

    await saveFreshdeskEffectiveCatalog(catalogContainer, effective);

    if (invalidateCache) {
      invalidateFreshdeskHelpIndexCache();
    }

    const counts = summarizeFreshdeskEffectiveCatalog(effective);
    status = {
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      lastErrorSummary: null,
      lastSource: source,
      lastCounts: counts,
    };
    await saveFreshdeskSyncStatus(catalogContainer, status);

    return {
      ok: true,
      catalog: effective,
      status,
      counts,
      articles: effective.items.map(toFreshdeskAdminArticle),
    };
  } catch (error) {
    const message = toSafeFreshdeskCatalogStorageError(error);
    status = {
      ...status,
      lastErrorSummary: message,
    };
    try {
      await saveFreshdeskSyncStatus(catalogContainer, status);
    } catch {
      // Keep returning the sync failure even if status persistence fails.
    }

    return {
      ok: false,
      error: message,
      preservedPreviousCatalog: Boolean(previousCatalog),
      status,
    };
  }
}

export type FreshdeskVisibilityUpdateResult =
  | {
      ok: true;
      article: FreshdeskCatalogArticle;
      catalog: FreshdeskEffectiveCatalog;
      overridesEtag: string;
    }
  | {
      ok: false;
      status: 404 | 409 | 400 | 503;
      error: string;
    };

const MAX_EXCLUSION_REASON_LENGTH = 500;

export async function updateFreshdeskArticleVisibility(params: {
  articleId: string;
  excluded: boolean;
  reason?: string;
  excludedBy?: string;
  container?: ContainerClient | null;
  invalidateCache?: boolean;
  maxRetries?: number;
  now?: Date;
}): Promise<FreshdeskVisibilityUpdateResult> {
  const container =
    params.container === undefined
      ? createConfiguredFreshdeskCatalogContainer()
      : params.container;

  if (!container) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu upload storage is not configured.",
    };
  }

  const articleId = params.articleId.trim();
  if (!articleId || !/^\d+$/.test(articleId)) {
    return {
      ok: false,
      status: 400,
      error: "articleId must be a numeric Freshdesk article id.",
    };
  }

  if (
    params.reason != null &&
    params.reason.length > MAX_EXCLUSION_REASON_LENGTH
  ) {
    return {
      ok: false,
      status: 400,
      error: `Exclusion reason must be at most ${MAX_EXCLUSION_REASON_LENGTH} characters.`,
    };
  }

  const maxRetries = params.maxRetries ?? 3;
  const now = params.now ?? new Date();

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const overridesLoad = await loadFreshdeskOverrides(container);
    const raw = await loadFreshdeskRawArticles(container);
    if (!raw) {
      return {
        ok: false,
        status: 404,
        error: "No Freshdesk catalogue is available. Run a sync first.",
      };
    }

    const rawArticle = raw.articles.find(
      (item) => String(item.freshdeskArticleId) === articleId,
    );
    if (!rawArticle) {
      return {
        ok: false,
        status: 404,
        error: "Article was not found in the Freshdesk catalogue.",
      };
    }

    const nextOverrides = upsertFreshdeskArticleOverride(
      overridesLoad.document.overrides,
      articleId,
      {
        excluded: params.excluded,
        reason: params.reason,
        excludedBy: params.excludedBy,
        updatedAt: now.toISOString(),
      },
    );

    try {
      const saved = await saveFreshdeskOverrides({
        container,
        document: {
          updatedAt: now.toISOString(),
          overrides: nextOverrides,
        },
        ifMatch: overridesLoad.etag || undefined,
      });

      const catalog = await rebuildFreshdeskEffectiveCatalogFromStores({
        container,
        invalidateCache: params.invalidateCache,
        now,
      });

      const article = catalog.items.find((item) => item.articleId === articleId);
      if (!article) {
        return {
          ok: false,
          status: 404,
          error: "Article was not found after updating visibility.",
        };
      }

      return {
        ok: true,
        article,
        catalog,
        overridesEtag: saved.etag,
      };
    } catch (error) {
      const statusCode = (error as Error & { statusCode?: number }).statusCode;
      if (statusCode === 409 && attempt < maxRetries - 1) {
        continue;
      }

      if (statusCode === 409) {
        return {
          ok: false,
          status: 409,
          error:
            "Another administrator updated article visibility at the same time. Please retry.",
        };
      }

      return {
        ok: false,
        status: 503,
        error: toSafeFreshdeskCatalogStorageError(error),
      };
    }
  }

  return {
    ok: false,
    status: 409,
    error:
      "Another administrator updated article visibility at the same time. Please retry.",
  };
}

export type FreshdeskAdminArticlesPayload = {
  articles: FreshdeskAdminArticle[];
  status: FreshdeskSyncStatus;
  counts: { total: number; visible: number; excluded: number };
};

export async function loadFreshdeskArticlesForAdmin(
  container: ContainerClient | null = createConfiguredFreshdeskCatalogContainer(),
): Promise<
  | { ok: true; payload: FreshdeskAdminArticlesPayload }
  | { ok: false; status: 503; error: string }
> {
  if (!container) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu upload storage is not configured.",
    };
  }

  try {
    let catalog = await loadFreshdeskEffectiveCatalog(container);
    const status = await loadFreshdeskSyncStatus(container);

    if (!catalog) {
      const raw = await loadFreshdeskRawArticles(container);
      if (raw) {
        catalog = await rebuildFreshdeskEffectiveCatalogFromStores({
          container,
          invalidateCache: false,
        });
      }
    }

    const items = catalog?.items ?? [];
    const counts = catalog
      ? summarizeFreshdeskEffectiveCatalog(catalog)
      : { total: 0, visible: 0, excluded: 0 };

    return {
      ok: true,
      payload: {
        articles: items.map(toFreshdeskAdminArticle),
        status,
        counts,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: toSafeFreshdeskCatalogStorageError(error),
    };
  }
}

/** Re-export for callers that still use the index container helper. */
export { createConfiguredFreshdeskIndexContainer };
