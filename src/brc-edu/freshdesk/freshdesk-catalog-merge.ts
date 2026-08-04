import { getSyncedFreshdeskArticlePublicUrl } from "./freshdesk-article-url.js";
import { resolveContentTopic } from "../content/content-topics.js";
import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";
import type {
  FreshdeskAdminArticle,
  FreshdeskArticleId,
  FreshdeskArticleOverride,
  FreshdeskArticleOverridesMap,
  FreshdeskCatalogArticle,
  FreshdeskEffectiveCatalog,
} from "./freshdesk-catalog-types.js";
import { freshdeskArticleIdFromNumber } from "./freshdesk-catalog-types.js";

const ADMIN_DESCRIPTION_MAX_LENGTH = 200;

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function excerptBodyText(bodyText: string): string {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  if (normalized.length <= ADMIN_DESCRIPTION_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, ADMIN_DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`;
}

export function applyOverrideToFreshdeskArticle(
  article: SyncedFreshdeskArticle,
  override: FreshdeskArticleOverride | undefined,
  lastSyncedAt: string,
): FreshdeskCatalogArticle {
  const articleId = freshdeskArticleIdFromNumber(article.freshdeskArticleId);
  const topicResolved = resolveContentTopic({
    title: article.title,
    folderName: article.folderName,
  });
  const url = getSyncedFreshdeskArticlePublicUrl(article);
  const description = excerptBodyText(article.bodyText);

  const base: FreshdeskCatalogArticle = {
    ...article,
    articleId,
    topic: topicResolved.topic,
    topicLabel: topicResolved.label,
    excluded: false,
    lastSyncedAt,
    description,
    url,
  };

  if (!override || !override.excluded) {
    return base;
  }

  return {
    ...base,
    excluded: true,
    excludedAt: asTrimmedString(override.excludedAt) || undefined,
    excludedBy: asTrimmedString(override.excludedBy) || undefined,
    exclusionReason: asTrimmedString(override.reason) || undefined,
  };
}

export function mergeFreshdeskCatalogWithOverrides(params: {
  articles: SyncedFreshdeskArticle[];
  overrides: FreshdeskArticleOverridesMap;
  generatedAt?: string;
  lastSyncedAt?: string;
}): FreshdeskEffectiveCatalog {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const lastSyncedAt = params.lastSyncedAt ?? generatedAt;

  const items = params.articles.map((article) => {
    const articleId = freshdeskArticleIdFromNumber(article.freshdeskArticleId);
    return applyOverrideToFreshdeskArticle(
      article,
      params.overrides[articleId],
      lastSyncedAt,
    );
  });

  const visibleCount = items.filter((item) => !item.excluded).length;

  return {
    generatedAt,
    itemCount: items.length,
    visibleCount,
    excludedCount: items.length - visibleCount,
    items,
  };
}

export function upsertFreshdeskArticleOverride(
  current: FreshdeskArticleOverridesMap,
  articleId: FreshdeskArticleId,
  next: {
    excluded: boolean;
    reason?: string;
    excludedBy?: string;
    updatedAt?: string;
  },
): FreshdeskArticleOverridesMap {
  const updatedAt = next.updatedAt ?? new Date().toISOString();
  const copy: FreshdeskArticleOverridesMap = { ...current };

  if (!next.excluded) {
    copy[articleId] = {
      excluded: false,
      reason: asTrimmedString(next.reason) || undefined,
      excludedBy: asTrimmedString(next.excludedBy) || undefined,
      updatedAt,
    };
    return copy;
  }

  copy[articleId] = {
    excluded: true,
    excludedAt: updatedAt,
    excludedBy: asTrimmedString(next.excludedBy) || undefined,
    reason: asTrimmedString(next.reason) || undefined,
    updatedAt,
  };

  return copy;
}

export function summarizeFreshdeskEffectiveCatalog(
  catalog: FreshdeskEffectiveCatalog,
): { total: number; visible: number; excluded: number } {
  return {
    total: catalog.itemCount,
    visible: catalog.visibleCount,
    excluded: catalog.excludedCount,
  };
}

export function toFreshdeskAdminArticle(
  article: FreshdeskCatalogArticle,
): FreshdeskAdminArticle {
  return {
    articleId: article.articleId,
    title: article.title,
    url: article.url ?? undefined,
    description: article.description,
    categoryName: article.categoryName,
    folderName: article.folderName,
    topic: article.topic,
    updatedAt: article.updatedAt,
    lastSyncedAt: article.lastSyncedAt,
    excluded: article.excluded,
    exclusionReason: article.exclusionReason,
  };
}

export function visibleFreshdeskArticlesFromEffective(
  catalog: FreshdeskEffectiveCatalog,
): SyncedFreshdeskArticle[] {
  return catalog.items
    .filter((item) => !item.excluded && item.enabled)
    .map((item) => {
      const {
        articleId: _articleId,
        topic: _topic,
        topicLabel: _topicLabel,
        excluded: _excluded,
        excludedAt: _excludedAt,
        excludedBy: _excludedBy,
        exclusionReason: _exclusionReason,
        lastSyncedAt: _lastSyncedAt,
        description: _description,
        url: _url,
        categoryName: _categoryName,
        ...synced
      } = item;
      return synced;
    });
}
