import { existsSync, readFileSync } from "node:fs";

import { parse } from "csv-parse/sync";

import type { EnrichedEduResource } from "./brc_edu_enrichment.js";
import {
  enrichSupportEduRows,
  normaliseSupportEduRows,
  parseSupportEduCsv,
} from "./brc_edu_enrichment.js";
import { downloadSupportCsvFromGraph, getBrcEduGraphConfig, type FetchLike } from "./brc_edu_graph.js";
import { getBrcEduEnrichedCsvPath } from "./brc_edu_paths.js";
import { loadSyncedEduResources } from "./brc_edu_synced_store.js";

import {
  freshdeskHelpResultDedupeKey,
  normaliseHelpSearchText,
  scoreFreshdeskHelpArticle,
  toFreshdeskHelpResourceResult,
  tokenizeHelpSearchQuestion,
  type HelpResourceResult,
} from "../brc-edu/freshdesk/freshdesk-help-search.js";

import type { SyncedFreshdeskArticle } from "../brc-edu/freshdesk/freshdesk-sync-service.js";

export type BrcEduSource = "local" | "graph";

type EduResourcesCache = {
  resources: EnrichedEduResource[];
  expiresAt: number;
};

let eduResourcesCache: EduResourcesCache | null = null;

export function resetEduResourcesCacheForTests(): void {
  eduResourcesCache = null;
}

export function invalidateEduResourcesCache(): void {
  eduResourcesCache = null;
}

export function getBrcEduSource(): BrcEduSource {
  const source = process.env.BRC_EDU_SOURCE?.trim().toLowerCase();
  return source === "graph" ? "graph" : "local";
}

export function getBrcEduCacheTtlMs(): number {
  const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
  const minutes = rawMinutes ? Number(rawMinutes) : 5;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60 * 1000;
  }
  return minutes * 60 * 1000;
}

function enrichSupportCsvText(csvText: string): EnrichedEduResource[] {
  const rawRows = parseSupportEduCsv(csvText);
  const supportRows = normaliseSupportEduRows(rawRows);
  return enrichSupportEduRows(supportRows);
}

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function parseBooleanCsvValue(value: unknown, defaultValue: boolean): boolean {
  if (value == null || value === "") {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function pickField(record: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const direct = asTrimmedString(record[name]);
    if (direct) {
      return direct;
    }
    const match = Object.entries(record).find(
      ([key]) => key.trim().toLowerCase() === name.toLowerCase(),
    );
    if (match) {
      const value = asTrimmedString(match[1]);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

export function parseEnrichedEduCsvRow(record: Record<string, unknown>): EnrichedEduResource | null {
  const title = pickField(record, ["title"]);
  const url = pickField(record, ["url"]);
  if (!title || !url) {
    return null;
  }

  const helpRoutingCategory = pickField(record, ["helpRoutingCategory", "help_routing_category"]);
  const keywords = pickField(record, ["keywords"]);
  const description = pickField(record, ["description"]);
  const contentType = pickField(record, ["contentType", "content_type"]) || "video";
  const source = pickField(record, ["source"]) || "Big Red Cloud";
  const lastReviewed = pickField(record, ["lastReviewed", "last_reviewed"]);
  const generatedFrom = pickField(record, ["generatedFrom", "generated_from"]);

  return {
    title,
    url,
    helpRoutingCategory: helpRoutingCategory || "general_help",
    keywords,
    description,
    isActive: parseBooleanCsvValue(record.isActive ?? record.active, true),
    contentType: contentType as EnrichedEduResource["contentType"],
    source,
    lastReviewed,
    generatedFrom,
    needsReview: parseBooleanCsvValue(record.needsReview, false),
  };
}

export function parseEnrichedEduCsv(csvText: string): EnrichedEduResource[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, unknown>[];

  return rows
    .map((row) => parseEnrichedEduCsvRow(row))
    .filter((row): row is EnrichedEduResource => row != null);
}

export function loadLocalEnrichedEduResources(baseDir: string = process.cwd()): EnrichedEduResource[] {
  const csvPath = getBrcEduEnrichedCsvPath(baseDir);
  if (!existsSync(csvPath)) {
    return [];
  }

  return parseEnrichedEduCsv(readFileSync(csvPath, "utf8"));
}

export type LoadEnrichedEduResourcesOptions = {
  now?: number;
  fetchImpl?: FetchLike;
};

async function loadEnrichedEduResourcesFromGraph(
  baseDir: string,
  options?: LoadEnrichedEduResourcesOptions,
): Promise<EnrichedEduResource[]> {
  const now = options?.now ?? Date.now();
  const ttlMs = getBrcEduCacheTtlMs();

  if (eduResourcesCache && eduResourcesCache.expiresAt > now) {
    return eduResourcesCache.resources;
  }

  const graphConfig = getBrcEduGraphConfig();
  if (!graphConfig) {
    console.warn(
      "Red BRC Edu: Microsoft Graph configuration is incomplete; falling back to local enriched CSV.",
    );
    return loadLocalEnrichedEduResources(baseDir);
  }

  try {
    const csvText = await downloadSupportCsvFromGraph(graphConfig, options?.fetchImpl);
    const resources = enrichSupportCsvText(csvText);
    eduResourcesCache = {
      resources,
      expiresAt: now + ttlMs,
    };
    return resources;
  } catch {
    console.warn("Red BRC Edu: Microsoft Graph load failed; falling back to local enriched CSV.");
    return loadLocalEnrichedEduResources(baseDir);
  }
}

function loadSyncedEduResourcesIfAvailable(baseDir: string): EnrichedEduResource[] | null {
  const synced = loadSyncedEduResources(baseDir);
  if (synced && synced.length > 0) {
    return synced;
  }
  return null;
}

export async function loadEnrichedEduResources(
  baseDir: string = process.cwd(),
  options?: LoadEnrichedEduResourcesOptions,
): Promise<EnrichedEduResource[]> {
  const synced = loadSyncedEduResourcesIfAvailable(baseDir);
  if (synced) {
    return synced;
  }

  if (getBrcEduSource() === "graph") {
    return loadEnrichedEduResourcesFromGraph(baseDir, options);
  }

  return loadLocalEnrichedEduResources(baseDir);
}

export const BRC_SUPPORT_FALLBACK_URL = "https://bigredcloud.com/support/";

export const HELP_RESOURCE_RESULT_FIELDS = [
  "title",
  "url",
  "helpRoutingCategory",
  "description",
  "contentType",
  "source",
] as const;

export type { HelpResourceResult };

function scoreHelpResource(
  resource: EnrichedEduResource,
  question: string,
  questionTokens: string[],
  category?: string,
): number {
  if (
    category &&
    normaliseHelpSearchText(resource.helpRoutingCategory) !==
      normaliseHelpSearchText(category)
  ) {
    return 0;
  }

  const query = normaliseHelpSearchText(question);
  const title = normaliseHelpSearchText(resource.title);
  const helpRoutingCategory = normaliseHelpSearchText(
    resource.helpRoutingCategory,
  );
  const keywords = normaliseHelpSearchText(resource.keywords);
  const description = normaliseHelpSearchText(resource.description);

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
    if (title.includes(token)) {
      score += 4;
    }
    if (helpRoutingCategory.includes(token)) {
      score += 3;
    }
    if (keywords.includes(token)) {
      score += 3;
    }
    if (description.includes(token)) {
      score += 2;
    }
  }

  return score;
}

export function mergeHelpSearchResults(
  question: string,
  resources: EnrichedEduResource[],
  freshdeskArticles: SyncedFreshdeskArticle[],
  options?: {
    category?: string;
    maxResults?: number;
    includeInactive?: boolean;
  },
): HelpResourceResult[] {
  const questionTokens = tokenizeHelpSearchQuestion(question);
  const maxResults = options?.maxResults ?? 5;
  const includeInactive = options?.includeInactive ?? false;

  const entries: Array<{
    score: number;
    result: HelpResourceResult;
    dedupeKey: string;
  }> = [];

  for (const resource of resources) {
    if (!includeInactive && !resource.isActive) {
      continue;
    }

    const score = scoreHelpResource(
      resource,
      question,
      questionTokens,
      options?.category,
    );

    if (score > 0) {
      entries.push({
        score,
        result: toHelpResourceResult(resource),
        dedupeKey: `webinar:${resource.url}`,
      });
    }
  }

  for (const article of freshdeskArticles) {
    const score = scoreFreshdeskHelpArticle(
      article,
      question,
      questionTokens,
      options?.category,
    );

    if (score > 0) {
      entries.push({
        score,
        result: toFreshdeskHelpResourceResult(article),
        dedupeKey: freshdeskHelpResultDedupeKey(article),
      });
    }
  }

  const seenDedupeKeys = new Set<string>();
  const seenTitles = new Set<string>();

  return entries
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.result.title.localeCompare(right.result.title),
    )
    .filter((entry) => {
      if (seenDedupeKeys.has(entry.dedupeKey)) {
        return false;
      }

      const titleKey = normaliseHelpSearchText(entry.result.title);
      if (seenTitles.has(titleKey)) {
        return false;
      }

      seenDedupeKeys.add(entry.dedupeKey);
      seenTitles.add(titleKey);
      return true;
    })
    .slice(0, maxResults)
    .map((entry) => entry.result);
}

export function findHelpResources(
  question: string,
  options?: {
    category?: string;
    includeInactive?: boolean;
    maxResults?: number;
    resources?: EnrichedEduResource[];
  },
): EnrichedEduResource[] {
  const questionTokens = tokenizeHelpSearchQuestion(question);
  const resources = options?.resources ?? [];
  const includeInactive = options?.includeInactive ?? false;
  const maxResults = options?.maxResults ?? 5;

  return resources
    .filter((resource) => includeInactive || resource.isActive)
    .map((resource) => ({
      resource,
      score: scoreHelpResource(
        resource,
        question,
        questionTokens,
        options?.category,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.resource.title.localeCompare(right.resource.title),
    )
    .slice(0, maxResults)
    .map((entry) => entry.resource);
}

export function toHelpResourceResult(
  resource: EnrichedEduResource,
): HelpResourceResult {
  return {
    title: resource.title,
    url: resource.url,
    helpRoutingCategory: resource.helpRoutingCategory,
    description: resource.description,
    contentType: resource.contentType,
    source: resource.source,
  };
}

export function buildFindHelpResourcesResponse(
  question: string,
  resources: EnrichedEduResource[],
  options?: {
    category?: string;
    freshdeskArticles?: SyncedFreshdeskArticle[];
  },
) {
  const matches = mergeHelpSearchResults(
    question,
    resources,
    options?.freshdeskArticles ?? [],
    {
      category: options?.category,
      maxResults: 5,
    },
  );

  return {
    question,
    category: options?.category ?? null,
    matchCount: matches.length,
    resources: matches,
    supportFallbackUrl: matches.length === 0 ? BRC_SUPPORT_FALLBACK_URL : null,
  };
}
