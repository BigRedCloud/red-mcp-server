import { existsSync, readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { enrichSupportEduRows, normaliseSupportEduRows, parseSupportEduCsv, } from "./brc_edu_enrichment.js";
import { downloadSupportCsvFromGraph, getBrcEduGraphConfig } from "./brc_edu_graph.js";
import { getBrcEduEnrichedCsvPath } from "./brc_edu_paths.js";
import { loadSyncedEduResources } from "./brc_edu_synced_store.js";
let eduResourcesCache = null;
export function resetEduResourcesCacheForTests() {
    eduResourcesCache = null;
}
export function invalidateEduResourcesCache() {
    eduResourcesCache = null;
}
export function getBrcEduSource() {
    const source = process.env.BRC_EDU_SOURCE?.trim().toLowerCase();
    return source === "graph" ? "graph" : "local";
}
export function getBrcEduCacheTtlMs() {
    const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
    const minutes = rawMinutes ? Number(rawMinutes) : 5;
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 5 * 60 * 1000;
    }
    return minutes * 60 * 1000;
}
function enrichSupportCsvText(csvText) {
    const rawRows = parseSupportEduCsv(csvText);
    const supportRows = normaliseSupportEduRows(rawRows);
    return enrichSupportEduRows(supportRows);
}
function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
function parseBooleanCsvValue(value, defaultValue) {
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
function pickField(record, names) {
    for (const name of names) {
        const direct = asTrimmedString(record[name]);
        if (direct) {
            return direct;
        }
        const match = Object.entries(record).find(([key]) => key.trim().toLowerCase() === name.toLowerCase());
        if (match) {
            const value = asTrimmedString(match[1]);
            if (value) {
                return value;
            }
        }
    }
    return "";
}
export function parseEnrichedEduCsvRow(record) {
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
        contentType: contentType,
        source,
        lastReviewed,
        generatedFrom,
        needsReview: parseBooleanCsvValue(record.needsReview, false),
    };
}
export function parseEnrichedEduCsv(csvText) {
    const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });
    return rows
        .map((row) => parseEnrichedEduCsvRow(row))
        .filter((row) => row != null);
}
export function loadLocalEnrichedEduResources(baseDir = process.cwd()) {
    const csvPath = getBrcEduEnrichedCsvPath(baseDir);
    if (!existsSync(csvPath)) {
        return [];
    }
    return parseEnrichedEduCsv(readFileSync(csvPath, "utf8"));
}
async function loadEnrichedEduResourcesFromGraph(baseDir, options) {
    const now = options?.now ?? Date.now();
    const ttlMs = getBrcEduCacheTtlMs();
    if (eduResourcesCache && eduResourcesCache.expiresAt > now) {
        return eduResourcesCache.resources;
    }
    const graphConfig = getBrcEduGraphConfig();
    if (!graphConfig) {
        console.warn("Red BRC Edu: Microsoft Graph configuration is incomplete; falling back to local enriched CSV.");
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
    }
    catch {
        console.warn("Red BRC Edu: Microsoft Graph load failed; falling back to local enriched CSV.");
        return loadLocalEnrichedEduResources(baseDir);
    }
}
function loadSyncedEduResourcesIfAvailable(baseDir) {
    const synced = loadSyncedEduResources(baseDir);
    if (synced && synced.length > 0) {
        return synced;
    }
    return null;
}
export async function loadEnrichedEduResources(baseDir = process.cwd(), options) {
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
];
function normaliseSearchText(value) {
    return value.trim().toLowerCase();
}
function scoreHelpResource(resource, questionTokens, category) {
    if (category &&
        normaliseSearchText(resource.helpRoutingCategory) !== normaliseSearchText(category)) {
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
export function findHelpResources(question, options) {
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
        .sort((left, right) => right.score - left.score || left.resource.title.localeCompare(right.resource.title))
        .slice(0, maxResults)
        .map((entry) => entry.resource);
}
export function toHelpResourceResult(resource) {
    return {
        title: resource.title,
        url: resource.url,
        helpRoutingCategory: resource.helpRoutingCategory,
        description: resource.description,
        contentType: resource.contentType,
    };
}
export function buildFindHelpResourcesResponse(question, resources, options) {
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
