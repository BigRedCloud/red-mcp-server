import { existsSync, readFileSync } from "node:fs";

import { parse } from "csv-parse/sync";

import type { EnrichedEduResource } from "./brc_edu_enrichment.js";
import { getBrcEduEnrichedCsvPath } from "./brc_edu_paths.js";

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

export function loadEnrichedEduResources(baseDir: string = process.cwd()): EnrichedEduResource[] {
  const csvPath = getBrcEduEnrichedCsvPath(baseDir);
  if (!existsSync(csvPath)) {
    return [];
  }

  return parseEnrichedEduCsv(readFileSync(csvPath, "utf8"));
}

export const BRC_SUPPORT_FALLBACK_URL = "https://bigredcloud.com/support/";

export const HELP_RESOURCE_RESULT_FIELDS = [
  "title",
  "url",
  "helpRoutingCategory",
  "description",
  "contentType",
] as const;

function normaliseSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function scoreHelpResource(
  resource: EnrichedEduResource,
  questionTokens: string[],
  category?: string,
): number {
  if (
    category &&
    normaliseSearchText(resource.helpRoutingCategory) !== normaliseSearchText(category)
  ) {
    return 0;
  }

  const title = normaliseSearchText(resource.title);
  const helpRoutingCategory = normaliseSearchText(resource.helpRoutingCategory);
  const keywords = normaliseSearchText(resource.keywords);
  const description = normaliseSearchText(resource.description);

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

export function findHelpResources(
  question: string,
  options?: {
    category?: string;
    includeInactive?: boolean;
    maxResults?: number;
    resources?: EnrichedEduResource[];
  },
): EnrichedEduResource[] {
  const questionTokens = normaliseSearchText(question)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
  const resources = options?.resources ?? [];
  const includeInactive = options?.includeInactive ?? false;
  const maxResults = options?.maxResults ?? 5;

  return resources
    .filter((resource) => includeInactive || resource.isActive)
    .map((resource) => ({
      resource,
      score: scoreHelpResource(resource, questionTokens, options?.category),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.resource.title.localeCompare(right.resource.title),
    )
    .slice(0, maxResults)
    .map((entry) => entry.resource);
}

export function toHelpResourceResult(resource: EnrichedEduResource) {
  return {
    title: resource.title,
    url: resource.url,
    helpRoutingCategory: resource.helpRoutingCategory,
    description: resource.description,
    contentType: resource.contentType,
  };
}

export function buildFindHelpResourcesResponse(
  question: string,
  resources: EnrichedEduResource[],
  options?: { category?: string },
) {
  const matches = findHelpResources(question, {
    category: options?.category,
    resources,
    maxResults: 5,
  });

  return {
    question,
    category: options?.category ?? null,
    matchCount: matches.length,
    resources: matches.map(toHelpResourceResult),
    supportFallbackUrl: matches.length === 0 ? BRC_SUPPORT_FALLBACK_URL : null,
  };
}
