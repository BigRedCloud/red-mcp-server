import { createHash } from "node:crypto";
import { normaliseHelpSearchText, tokenizeHelpSearchQuestion, } from "../freshdesk/freshdesk-help-search.js";
import { getSyncedFreshdeskArticlePublicUrl, FRESHDESK_LINK_RESPONSE_GUIDANCE, isFreshdeskPublicArticleUrl, } from "../freshdesk/freshdesk-article-url.js";
import { getNormalizedFreshdeskSyncedImages } from "../freshdesk/freshdesk-image-load.js";
import { isPublicHttpsUrl } from "./help-resource-types.js";
export const DEFAULT_HELP_SEARCH_MAX_RESULTS = 5;
export const SUPPORT_CONTACT_FOOTER_URL = "https://bigredcloud.com/contact/";
export const SUPPORT_FOOTER_GUIDANCE = "For advice specific to your company, or for more specialised assistance, please contact the Big Red Cloud support team: https://bigredcloud.com/contact/";
const TRAINING_QUERY_PATTERN = /\b(training|onboarding|webinar|live assistance|demonstration|demo|q\s*&\s*a|learn(?:ing)?|walkthrough|session)\b/i;
export function isTrainingOrLiveHelpQuery(question) {
    return TRAINING_QUERY_PATTERN.test(question);
}
function scoreTextMatch(question, questionTokens, fields) {
    const query = normaliseHelpSearchText(question);
    const combined = normaliseHelpSearchText(fields.join(" "));
    const title = normaliseHelpSearchText(fields[0] ?? "");
    if (query && query === title) {
        return 1000;
    }
    if (query && title.includes(query)) {
        return 850;
    }
    if (questionTokens.length > 0 &&
        questionTokens.every((token) => title.includes(token))) {
        return 650;
    }
    let score = 0;
    for (const token of questionTokens) {
        if (!token) {
            continue;
        }
        if (title.includes(token)) {
            score += 5;
        }
        if (combined.includes(token)) {
            score += 2;
        }
    }
    return score;
}
function sourceBoost(source, question, baseScore) {
    if (baseScore <= 0) {
        return 0;
    }
    if (source === "customer_docs") {
        return baseScore + 25;
    }
    if (source === "freshdesk") {
        return baseScore + 15;
    }
    if (source === "recorded_webinar") {
        if (/\b(video|webinar|recording|watch)\b/i.test(question)) {
            return baseScore + 20;
        }
        return baseScore + 5;
    }
    if (source === "upcoming_webinar") {
        if (isTrainingOrLiveHelpQuery(question)) {
            return baseScore + 18;
        }
        return Math.max(0, baseScore - 15);
    }
    return baseScore;
}
function fromCustomerDocsResource(resource) {
    return resource;
}
function fromUpcomingWebinarResource(resource) {
    return resource;
}
function fromRecordedWebinarResource(resource, syncedAt) {
    return {
        resourceId: `recorded_webinar:${createHash("sha256").update(resource.url).digest("hex").slice(0, 16)}`,
        source: "recorded_webinar",
        title: resource.title,
        summary: resource.description || resource.title,
        bodyText: resource.description,
        url: resource.url,
        category: resource.helpRoutingCategory,
        topics: resource.keywords
            .split(/[,;]+/)
            .map((topic) => topic.trim())
            .filter(Boolean),
        imageBlobNames: [],
        enabled: resource.isActive,
        lastSyncedAt: syncedAt,
    };
}
function fromFreshdeskResource(article) {
    const syncedImages = getNormalizedFreshdeskSyncedImages(article);
    return {
        resourceId: `freshdesk:${article.freshdeskArticleId}`,
        source: "freshdesk",
        title: article.title,
        summary: article.bodyText.slice(0, 220),
        bodyText: article.bodyText,
        url: getSyncedFreshdeskArticlePublicUrl(article) ?? "",
        category: article.folderName,
        topics: [article.folderName],
        imageBlobNames: syncedImages.map((image) => image.blobName),
        enabled: article.enabled,
        lastSyncedAt: article.updatedAt,
    };
}
export function toHelpSearchResult(resource, relevanceScore) {
    const publicUrl = resource.source === "freshdesk"
        ? resource.url && isFreshdeskPublicArticleUrl(resource.url)
            ? resource.url
            : null
        : resource.url && isPublicHttpsUrl(resource.url)
            ? resource.url
            : null;
    return {
        resourceId: resource.resourceId,
        source: resource.source,
        title: resource.title,
        summary: resource.summary,
        publicUrl,
        registrationUrl: resource.registrationUrl && isPublicHttpsUrl(resource.registrationUrl)
            ? resource.registrationUrl
            : undefined,
        category: resource.category,
        relevanceScore,
        imageAvailable: resource.source === "freshdesk" && resource.imageBlobNames.length > 0,
        eventDay: resource.eventDay,
    };
}
function dedupeSearchResults(entries) {
    const seenKeys = new Set();
    const seenTitles = new Set();
    const seenUrls = new Set();
    return entries
        .sort((left, right) => right.score - left.score ||
        left.result.title.localeCompare(right.result.title))
        .filter((entry) => {
        if (seenKeys.has(entry.dedupeKey)) {
            return false;
        }
        const titleKey = normaliseHelpSearchText(entry.result.title);
        if (seenTitles.has(titleKey)) {
            return false;
        }
        const urlKey = entry.result.publicUrl
            ? normaliseHelpSearchText(entry.result.publicUrl)
            : entry.result.registrationUrl
                ? normaliseHelpSearchText(entry.result.registrationUrl)
                : "";
        if (urlKey && seenUrls.has(urlKey)) {
            return false;
        }
        seenKeys.add(entry.dedupeKey);
        seenTitles.add(titleKey);
        if (urlKey) {
            seenUrls.add(urlKey);
        }
        return true;
    })
        .map((entry) => entry.result);
}
export function searchUnifiedHelpResources(question, sources, options) {
    const questionTokens = tokenizeHelpSearchQuestion(question);
    const maxResults = options?.maxResults ?? DEFAULT_HELP_SEARCH_MAX_RESULTS;
    const sourceFilter = options?.sourceFilter ?? "all";
    const syncedAt = new Date().toISOString();
    const entries = [];
    const includeSource = (source) => sourceFilter === "all" || sourceFilter === source;
    if (includeSource("customer_docs")) {
        for (const resource of sources.customerDocs ?? []) {
            if (!resource.enabled) {
                continue;
            }
            const score = sourceBoost("customer_docs", question, scoreTextMatch(question, questionTokens, [
                resource.title,
                resource.category,
                resource.bodyText,
                resource.topics.join(" "),
            ]));
            if (score > 0) {
                entries.push({
                    score,
                    result: toHelpSearchResult(resource, score),
                    dedupeKey: `customer_docs:${resource.url}`,
                });
            }
        }
    }
    if (includeSource("freshdesk")) {
        for (const article of sources.freshdeskArticles ?? []) {
            if (!article.enabled) {
                continue;
            }
            const normalized = fromFreshdeskResource(article);
            const score = sourceBoost("freshdesk", question, scoreTextMatch(question, questionTokens, [
                normalized.title,
                normalized.category,
                normalized.bodyText,
            ]));
            if (score > 0) {
                entries.push({
                    score,
                    result: toHelpSearchResult(normalized, score),
                    dedupeKey: `freshdesk:${article.freshdeskArticleId}`,
                });
            }
        }
    }
    if (includeSource("recorded_webinar")) {
        for (const resource of sources.recordedWebinars ?? []) {
            if (!resource.isActive) {
                continue;
            }
            const normalized = fromRecordedWebinarResource(resource, syncedAt);
            const score = sourceBoost("recorded_webinar", question, scoreTextMatch(question, questionTokens, [
                normalized.title,
                normalized.category,
                normalized.bodyText,
                normalized.topics.join(" "),
            ]));
            if (score > 0) {
                entries.push({
                    score,
                    result: toHelpSearchResult(normalized, score),
                    dedupeKey: `recorded_webinar:${normalized.url}`,
                });
            }
        }
    }
    if (includeSource("upcoming_webinar")) {
        for (const resource of sources.upcomingWebinars ?? []) {
            if (!resource.enabled) {
                continue;
            }
            const normalized = fromUpcomingWebinarResource(resource);
            const score = sourceBoost("upcoming_webinar", question, scoreTextMatch(question, questionTokens, [
                normalized.title,
                normalized.eventDay ?? "",
                normalized.bodyText,
                normalized.topics.join(" "),
            ]));
            if (score > 0) {
                entries.push({
                    score,
                    result: toHelpSearchResult(normalized, score),
                    dedupeKey: `upcoming_webinar:${normalized.resourceId}`,
                });
            }
        }
    }
    return dedupeSearchResults(entries).slice(0, maxResults);
}
export function buildUnifiedFindHelpResourcesResponse(question, sources, options) {
    const resources = searchUnifiedHelpResources(question, sources, options);
    return {
        question,
        category: options?.category ?? null,
        matchCount: resources.length,
        resources,
        responseGuidance: {
            format: [
                "Provide a concise synthesized direct answer first.",
                "Add clear steps where applicable.",
                "Include a Helpful resources section with 3–5 descriptive customer-facing links only.",
                "Use only publicUrl values returned in resources for hyperlinks.",
                "Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.",
                FRESHDESK_LINK_RESPONSE_GUIDANCE,
                "Use brc_get_help_resource_details for Freshdesk images or full article text when useful.",
                "Do not show internal resource IDs, Azure blob names, storage URLs, relevance scores, or sync metadata.",
            ],
            preferredResourceOrder: [
                "customer_docs",
                "recorded_webinar",
                "upcoming_webinar",
                "freshdesk",
            ],
            supportFooter: SUPPORT_FOOTER_GUIDANCE,
            supportFooterWhen: "Include for substantive support or how-to answers, not greetings or tool errors.",
        },
        supportFallbackUrl: resources.length === 0 ? "https://bigredcloud.com/support/" : null,
    };
}
export { fromCustomerDocsResource, fromFreshdeskResource, fromRecordedWebinarResource, fromUpcomingWebinarResource, };
