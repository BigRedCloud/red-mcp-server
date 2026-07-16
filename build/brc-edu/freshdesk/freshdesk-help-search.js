import { createConfiguredFreshdeskIndexContainer, loadFreshdeskArticlesIndex, } from "./freshdesk-index-store.js";
import { getSyncedFreshdeskArticlePublicUrl } from "./freshdesk-article-url.js";
export const FRESHDESK_HELP_EXCERPT_MAX_LENGTH = 200;
let freshdeskHelpIndexCache = null;
export function resetFreshdeskHelpIndexCacheForTests() {
    freshdeskHelpIndexCache = null;
}
function getFreshdeskHelpCacheTtlMs() {
    const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
    const minutes = rawMinutes ? Number(rawMinutes) : 5;
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 5 * 60 * 1000;
    }
    return minutes * 60 * 1000;
}
function logFreshdeskIndexUnavailable(reason) {
    if (reason === "missing") {
        console.warn("Red BRC Edu: Freshdesk support articles index is not available; continuing with webinar resources only.");
        return;
    }
    console.warn("Red BRC Edu: Freshdesk support articles index could not be loaded; continuing with webinar resources only.");
}
export async function loadFreshdeskArticlesForHelpSearch(options = {}) {
    const now = options.now ?? Date.now();
    const ttlMs = getFreshdeskHelpCacheTtlMs();
    if (freshdeskHelpIndexCache && freshdeskHelpIndexCache.expiresAt > now) {
        if ("unavailable" in freshdeskHelpIndexCache) {
            return null;
        }
        return freshdeskHelpIndexCache.articles;
    }
    try {
        const container = options.container === undefined
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
    }
    catch {
        logFreshdeskIndexUnavailable("load_failed");
        freshdeskHelpIndexCache = {
            unavailable: true,
            expiresAt: now + ttlMs,
        };
        return null;
    }
}
export function normaliseHelpSearchText(value) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}
export function tokenizeHelpSearchQuestion(question) {
    return normaliseHelpSearchText(question)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2);
}
export function createFreshdeskBodyExcerpt(bodyText, maxLength = FRESHDESK_HELP_EXCERPT_MAX_LENGTH) {
    const normalized = bodyText.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
function freshdeskArticleMatchesCategory(article, category) {
    if (!category) {
        return true;
    }
    const normalisedCategory = normaliseHelpSearchText(category.replace(/_/g, " "));
    const normalisedFolder = normaliseHelpSearchText(article.folderName);
    return (normalisedFolder === normalisedCategory ||
        normalisedFolder.includes(normalisedCategory));
}
export function scoreFreshdeskHelpArticle(article, question, questionTokens, category) {
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
    if (questionTokens.length > 0 &&
        questionTokens.every((token) => title.includes(token))) {
        return adjustLegacyFreshdeskTitleScore(question, article.title, 600);
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
    return adjustLegacyFreshdeskTitleScore(question, article.title, score);
}
const OPENING_BALANCE_QUERY_PATTERN = /\b(opening\s+balance|outstanding\s+balance|existing\s+balance|amount\s+already\s+owed)\b/i;
const OPENING_BALANCE_TITLE_PATTERN = /\bopening\s+balance\b/i;
function adjustLegacyFreshdeskTitleScore(question, title, baseScore) {
    if (baseScore <= 0) {
        return 0;
    }
    let score = baseScore;
    const queryMentionsOpeningBalance = OPENING_BALANCE_QUERY_PATTERN.test(question);
    const titleIsOpeningBalance = OPENING_BALANCE_TITLE_PATTERN.test(title);
    if (titleIsOpeningBalance) {
        if (queryMentionsOpeningBalance) {
            score += 120;
        }
        else {
            score -= 220;
        }
    }
    return Math.max(0, score);
}
export function findFreshdeskHelpArticles(question, articles, options) {
    const questionTokens = tokenizeHelpSearchQuestion(question);
    const maxResults = options?.maxResults ?? 5;
    return articles
        .map((article) => ({
        article,
        score: scoreFreshdeskHelpArticle(article, question, questionTokens, options?.category),
    }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score ||
        left.article.title.localeCompare(right.article.title))
        .slice(0, maxResults)
        .map((entry) => entry.article);
}
export function toFreshdeskHelpResourceResult(article) {
    return {
        title: article.title,
        url: getSyncedFreshdeskArticlePublicUrl(article),
        helpRoutingCategory: article.folderName,
        description: createFreshdeskBodyExcerpt(article.bodyText),
        contentType: "support",
        source: "freshdesk",
    };
}
export function freshdeskHelpResultDedupeKey(article) {
    return `freshdesk:${article.id}`;
}
