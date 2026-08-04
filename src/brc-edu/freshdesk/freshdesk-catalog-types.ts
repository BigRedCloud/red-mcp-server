import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";

export const DEFAULT_BRC_FRESHDESK_OVERRIDES_BLOB =
  "brc-edu/freshdesk/article-overrides.json";

export const DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB =
  "brc-edu/freshdesk/effective-article-catalog.json";

export const DEFAULT_BRC_FRESHDESK_SYNC_STATUS_BLOB =
  "brc-edu/freshdesk/sync-status.json";

/** Stable override / admin key — numeric Freshdesk article id as a string. */
export type FreshdeskArticleId = string;

export function freshdeskArticleIdFromNumber(id: number): FreshdeskArticleId {
  return String(id);
}

/** Normalise article ids so "1001" and 1001 compare equal. */
export function normalizeFreshdeskArticleId(
  value: string | number | null | undefined,
): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

export function freshdeskArticleIdsMatch(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  const a = normalizeFreshdeskArticleId(left);
  const b = normalizeFreshdeskArticleId(right);
  return Boolean(a) && a === b;
}

export type FreshdeskArticleOverride = {
  excluded: boolean;
  excludedAt?: string;
  excludedBy?: string;
  reason?: string;
  updatedAt: string;
};

export type FreshdeskArticleOverridesMap = Record<
  FreshdeskArticleId,
  FreshdeskArticleOverride
>;

export type FreshdeskOverridesDocument = {
  updatedAt: string;
  overrides: FreshdeskArticleOverridesMap;
};

/** Effective catalogue article: synced article + visibility + topic metadata. */
export type FreshdeskCatalogArticle = SyncedFreshdeskArticle & {
  articleId: FreshdeskArticleId;
  topic: string;
  topicLabel: string;
  excluded: boolean;
  excludedAt?: string;
  excludedBy?: string;
  exclusionReason?: string;
  lastSyncedAt: string;
  description?: string;
  url?: string | null;
  categoryName?: string;
};

export type FreshdeskEffectiveCatalog = {
  generatedAt: string;
  itemCount: number;
  visibleCount: number;
  excludedCount: number;
  items: FreshdeskCatalogArticle[];
};

export type FreshdeskSyncStatus = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorSummary: string | null;
  lastSource: "manual" | "service" | "unknown" | null;
  lastCounts: {
    total: number;
    visible: number;
    excluded: number;
  } | null;
};

export type FreshdeskSyncSource = NonNullable<FreshdeskSyncStatus["lastSource"]>;

/** Admin list DTO returned by Freshdesk admin APIs. */
export type FreshdeskAdminArticle = {
  articleId: string;
  title: string;
  url?: string;
  description?: string;
  categoryName?: string;
  folderName?: string;
  topic?: string;
  updatedAt?: string;
  lastSyncedAt?: string;
  excluded: boolean;
  exclusionReason?: string;
};
