import { isPublicHttpsUrl } from "./help-resource-types.js";
import { isFreshdeskPublicArticleUrl } from "../freshdesk/freshdesk-article-url.js";
export const DEFAULT_HELP_SOURCES_MAX = 5;
export const SOURCES_MARKDOWN_COPY_INSTRUCTION = "Include the following exact Sources Markdown in the customer-facing answer. Use these exact URLs — never invent or rewrite them. Do not move screenshot links into Sources.";
const SOURCE_TYPE_BY_RESOURCE = {
    freshdesk: "support_article",
    customer_docs: "customer_documentation",
    recorded_webinar: "recorded_webinar",
    upcoming_webinar: "upcoming_webinar",
};
function pickSourceUrl(resource) {
    const publicUrl = resource.publicUrl?.trim() || null;
    const registrationUrl = resource.registrationUrl?.trim() || null;
    if (resource.source === "freshdesk") {
        if (publicUrl && isFreshdeskPublicArticleUrl(publicUrl)) {
            return publicUrl;
        }
        return null;
    }
    if (publicUrl && isPublicHttpsUrl(publicUrl)) {
        return publicUrl;
    }
    if (resource.source === "upcoming_webinar" &&
        registrationUrl &&
        isPublicHttpsUrl(registrationUrl)) {
        return registrationUrl;
    }
    return null;
}
/**
 * Build customer-facing Sources from help resources already used in the answer.
 * Preserves input order (most relevant first), dedupes by exact URL, caps at max.
 */
export function buildHelpAnswerSources(resources, options) {
    const maxSources = options?.maxSources ?? DEFAULT_HELP_SOURCES_MAX;
    const seenUrls = new Set();
    const sources = [];
    for (const resource of resources) {
        if (sources.length >= maxSources) {
            break;
        }
        const url = pickSourceUrl(resource);
        if (!url) {
            continue;
        }
        const urlKey = url.toLowerCase();
        if (seenUrls.has(urlKey)) {
            continue;
        }
        const title = resource.title.trim();
        if (!title) {
            continue;
        }
        seenUrls.add(urlKey);
        sources.push({
            title,
            url,
            sourceType: SOURCE_TYPE_BY_RESOURCE[resource.source],
        });
    }
    return sources;
}
export function buildCustomerFacingSourcesMarkdown(sources) {
    if (sources.length === 0) {
        return undefined;
    }
    const lines = sources.map((source) => `- [${source.title}](${source.url})`);
    return ["Sources", "", ...lines].join("\n");
}
export function buildSourcesMarkdownTextBlock(sourcesMarkdown) {
    const markdown = sourcesMarkdown?.trim();
    if (!markdown) {
        return undefined;
    }
    return [SOURCES_MARKDOWN_COPY_INSTRUCTION, "", markdown].join("\n");
}
export function helpSearchResultsToSourceInputs(results) {
    return results.map((result) => ({
        title: result.title,
        source: result.source,
        publicUrl: result.publicUrl,
        registrationUrl: result.registrationUrl,
        resourceId: result.resourceId,
    }));
}
/**
 * Choose the resources that should appear under Sources for a tutorial answer.
 * Prefer the strongest Freshdesk procedural article; otherwise the top result only.
 * Never dump the full search list into Sources.
 */
export function selectUsedHelpResources(results, options) {
    if (results.length === 0) {
        return [];
    }
    const maxUsed = options?.maxUsed ?? 1;
    const strongFreshdesk = results.find((result) => result.source === "freshdesk" &&
        result.relevanceScore >= 500 &&
        Boolean(result.publicUrl));
    if (strongFreshdesk) {
        return [strongFreshdesk];
    }
    if (options?.intentIsProcedural) {
        const anyFreshdesk = results.find((result) => result.source === "freshdesk" && Boolean(result.publicUrl));
        if (anyFreshdesk) {
            return [anyFreshdesk];
        }
    }
    return results.slice(0, maxUsed);
}
export function filterHelpResultsByUsedIds(results, usedResourceIds) {
    if (usedResourceIds.length === 0) {
        return [];
    }
    const allowed = new Set(usedResourceIds);
    return results.filter((result) => allowed.has(result.resourceId));
}
