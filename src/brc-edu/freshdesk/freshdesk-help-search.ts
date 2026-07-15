import type { ContainerClient } from "@azure/storage-blob";

import {
  createConfiguredFreshdeskIndexContainer,
  loadFreshdeskArticlesIndex,
} from "./freshdesk-index-store.js";

import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";

export type HelpResourceResult = {
  title: string;
  url: string | null;
  helpRoutingCategory: string;
  description: string;
  contentType: string;
  source: string;
};

export const FRESHDESK_HELP_EXCERPT_MAX_LENGTH = 200;

type FreshdeskHelpIndexCache =
  | {
      articles: SyncedFreshdeskArticle[];
      expiresAt: number;
    }
  | {
      unavailable: true;
      expiresAt: number;
    };

let freshdeskHelpIndexCache: FreshdeskHelpIndexCache | null = null;

export function resetFreshdeskHelpIndexCacheForTests(): void {
  freshdeskHelpIndexCache = null;
}

function getFreshdeskHelpCacheTtlMs(): number {
  const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
  const minutes = rawMinutes ? Number(rawMinutes) : 5;

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60 * 1000;
  }

  return minutes * 60 * 1000;
}

function logFreshdeskIndexUnavailable(reason: "missing" | "load_failed"): void {
  if (reason === "missing") {
    console.warn(
      "Red BRC Edu: Freshdesk support articles index is not available; continuing with webinar resources only.",
    );
    return;
  }

  console.warn(
    "Red BRC Edu: Freshdesk support articles index could not be loaded; continuing with webinar resources only.",
  );
}

export type LoadFreshdeskArticlesForHelpSearchOptions = {
  now?: number;
  container?: ContainerClient | null;
  loadIndex?: (
    container: ContainerClient,
  ) => Promise<
    Awaited<ReturnType<typeof loadFreshdeskArticlesIndex>>
  >;
};

export async function loadFreshdeskArticlesForHelpSearch(
  options: LoadFreshdeskArticlesForHelpSearchOptions = {},
): Promise<SyncedFreshdeskArticle[] | null> {
  const now = options.now ?? Date.now();
  const ttlMs = getFreshdeskHelpCacheTtlMs();

  if (freshdeskHelpIndexCache && freshdeskHelpIndexCache.expiresAt > now) {
    if ("unavailable" in freshdeskHelpIndexCache) {
      return null;
    }

    return freshdeskHelpIndexCache.articles;
  }

  try {
    const container =
      options.container === undefined
        ? createConfiguredFreshdeskIndexContainer()
        : options.container;

    if (!container) {
      logFreshdeskIndexUnavailable("missing");
      freshdeskHelpIndexCache = {
        unavailable: true,
        expiresAt: now + ttlMs,
      };
      return null;
    }

    const loadIndex = options.loadIndex ?? loadFreshdeskArticlesIndex;
    const index = await loadIndex(container);

    if (!index) {
      logFreshdeskIndexUnavailable("missing");
      freshdeskHelpIndexCache = {
        unavailable: true,
        expiresAt: now + ttlMs,
      };
      return null;
    }

    freshdeskHelpIndexCache = {
      articles: index.articles,
      expiresAt: now + ttlMs,
    };

    return index.articles;
  } catch {
    logFreshdeskIndexUnavailable("load_failed");
    freshdeskHelpIndexCache = {
      unavailable: true,
      expiresAt: now + ttlMs,
    };
    return null;
  }
}

export function normaliseHelpSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function tokenizeHelpSearchQuestion(question: string): string[] {
  return normaliseHelpSearchText(question)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

export function createFreshdeskBodyExcerpt(
  bodyText: string,
  maxLength: number = FRESHDESK_HELP_EXCERPT_MAX_LENGTH,
): string {
  const normalized = bodyText.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function freshdeskArticleMatchesCategory(
  article: SyncedFreshdeskArticle,
  category?: string,
): boolean {
  if (!category) {
    return true;
  }

  const normalisedCategory = normaliseHelpSearchText(
    category.replace(/_/g, " "),
  );
  const normalisedFolder = normaliseHelpSearchText(article.folderName);

  return (
    normalisedFolder === normalisedCategory ||
    normalisedFolder.includes(normalisedCategory)
  );
}

export function scoreFreshdeskHelpArticle(
  article: SyncedFreshdeskArticle,
  question: string,
  questionTokens: string[],
  category?: string,
): number {
  if (!article.enabled) {
    return 0;
  }

  if (!freshdeskArticleMatchesCategory(article, category)) {
    return 0;
  }

  const query = normaliseHelpSearchText(question);
  const title = normaliseHelpSearchText(article.title);
  const bodyText = normaliseHelpSearchText(article.bodyText);
  const folderName = normaliseHelpSearchText(article.folderName);

  if (!query && questionTokens.length === 0) {
    return 0;
  }

  if (query && query === title) {
    return 1000;
  }

  if (query && title.includes(query)) {
    return 800;
  }

  if (
    questionTokens.length > 0 &&
    questionTokens.every((token) => title.includes(token))
  ) {
    return 600;
  }

  let score = 0;

  for (const token of questionTokens) {
    if (!token) {
      continue;
    }

    if (folderName.includes(token)) {
      score += 40;
    }

    if (bodyText.includes(token)) {
      score += 15;
    }
  }

  return score;
}

export function findFreshdeskHelpArticles(
  question: string,
  articles: SyncedFreshdeskArticle[],
  options?: {
    category?: string;
    maxResults?: number;
  },
): SyncedFreshdeskArticle[] {
  const questionTokens = tokenizeHelpSearchQuestion(question);
  const maxResults = options?.maxResults ?? 5;

  return articles
    .map((article) => ({
      article,
      score: scoreFreshdeskHelpArticle(
        article,
        question,
        questionTokens,
        options?.category,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.article.title.localeCompare(right.article.title),
    )
    .slice(0, maxResults)
    .map((entry) => entry.article);
}

export function toFreshdeskHelpResourceResult(
  article: SyncedFreshdeskArticle,
): HelpResourceResult {
  return {
    title: article.title,
    url: article.publicUrl,
    helpRoutingCategory: article.folderName,
    description: createFreshdeskBodyExcerpt(article.bodyText),
    contentType: "support",
    source: "freshdesk",
  };
}

export function freshdeskHelpResultDedupeKey(
  article: SyncedFreshdeskArticle,
): string {
  return `freshdesk:${article.id}`;
}
