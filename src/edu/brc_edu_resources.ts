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

function normaliseSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function scoreHelpResource(
  resource: EnrichedEduResource,
  queryTokens: string[],
  category?: string,
): number {
  if (category && normaliseSearchText(resource.helpRoutingCategory) !== normaliseSearchText(category)) {
    return 0;
  }

  const haystack = normaliseSearchText(
    [
      resource.title,
      resource.helpRoutingCategory,
      resource.keywords,
      resource.description,
      resource.contentType,
    ].join(" "),
  );

  let score = 0;
  for (const token of queryTokens) {
    if (!token) {
      continue;
    }
    if (normaliseSearchText(resource.title).includes(token)) {
      score += 4;
    }
    if (normaliseSearchText(resource.helpRoutingCategory).includes(token)) {
      score += 3;
    }
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export function findHelpResources(
  query: string,
  options?: {
    category?: string;
    includeInactive?: boolean;
    maxResults?: number;
    resources?: EnrichedEduResource[];
  },
): EnrichedEduResource[] {
  const queryTokens = normaliseSearchText(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
  const resources = options?.resources ?? [];
  const includeInactive = options?.includeInactive ?? false;
  const maxResults = options?.maxResults ?? 5;

  const ranked = resources
    .filter((resource) => includeInactive || resource.isActive)
    .map((resource) => ({
      resource,
      score: scoreHelpResource(resource, queryTokens, options?.category),
    }))
    .filter((entry) => entry.score > 0 || queryTokens.length === 0)
    .sort((left, right) => right.score - left.score || left.resource.title.localeCompare(right.resource.title))
    .slice(0, maxResults)
    .map((entry) => entry.resource);

  if (queryTokens.length === 0 && ranked.length === 0) {
    return resources
      .filter((resource) => includeInactive || resource.isActive)
      .slice(0, maxResults);
  }

  return ranked;
}
