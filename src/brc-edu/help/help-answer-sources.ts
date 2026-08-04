import type { HelpResourceSource, HelpSearchResult } from "./help-resource-types.js";
import { isPublicHttpsUrl } from "./help-resource-types.js";
import { isFreshdeskPublicArticleUrl } from "../freshdesk/freshdesk-article-url.js";
import {
  isStrongProceduralVideoMatch,
  scoreProceduralVideoMatch,
} from "./help-query-expansion.js";

export const DEFAULT_HELP_SOURCES_MAX = 5;

export type HelpAnswerSourceType =
  | "support_article"
  | "customer_documentation"
  | "recorded_webinar"
  | "upcoming_webinar";

export type HelpAnswerSource = {
  title: string;
  url: string;
  sourceType: HelpAnswerSourceType;
};

export const SOURCES_MARKDOWN_COPY_INSTRUCTION =
  "Include the following exact Sources Markdown in the customer-facing answer. Use these exact URLs — never invent or rewrite them. Do not move screenshot links into Sources.";

const SOURCE_TYPE_BY_RESOURCE: Record<HelpResourceSource, HelpAnswerSourceType> = {
  freshdesk: "support_article",
  customer_docs: "customer_documentation",
  recorded_webinar: "recorded_webinar",
  youtube_video: "recorded_webinar",
  upcoming_webinar: "upcoming_webinar",
};

function pickSourceUrl(resource: {
  publicUrl?: string | null;
  registrationUrl?: string | null;
  source: HelpResourceSource;
}): string | null {
  const publicUrl = resource.publicUrl?.trim() || null;
  const registrationUrl = resource.registrationUrl?.trim() || null;

  if (resource.source === "freshdesk") {
    if (publicUrl && isFreshdeskPublicArticleUrl(publicUrl)) {
      return publicUrl;
    }
    return null;
  }

  if (resource.source === "upcoming_webinar") {
    if (registrationUrl && isPublicHttpsUrl(registrationUrl)) {
      return registrationUrl;
    }
    if (publicUrl && isPublicHttpsUrl(publicUrl)) {
      return publicUrl;
    }
    return null;
  }

  if (publicUrl && isPublicHttpsUrl(publicUrl)) {
    return publicUrl;
  }

  return null;
}

/**
 * Build customer-facing Sources from help resources already used in the answer.
 * Preserves input order (most relevant first), dedupes by exact URL, caps at max.
 */
export function buildHelpAnswerSources(
  resources: Array<{
    title: string;
    source: HelpResourceSource;
    publicUrl?: string | null;
    registrationUrl?: string | null;
  }>,
  options?: { maxSources?: number },
): HelpAnswerSource[] {
  const maxSources = options?.maxSources ?? DEFAULT_HELP_SOURCES_MAX;
  const seenUrls = new Set<string>();
  const sources: HelpAnswerSource[] = [];

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

export function buildCustomerFacingSourcesMarkdown(
  sources: HelpAnswerSource[],
): string | undefined {
  if (sources.length === 0) {
    return undefined;
  }

  const articles = sources.filter(
    (source) =>
      source.sourceType === "support_article" ||
      source.sourceType === "customer_documentation",
  );
  const videos = sources.filter(
    (source) =>
      source.sourceType === "recorded_webinar" ||
      source.sourceType === "upcoming_webinar",
  );

  const lines: string[] = ["Sources"];

  if (articles.length > 0) {
    lines.push("", "Articles");
    for (const source of articles) {
      lines.push(`- [${source.title}](${source.url})`);
    }
  }

  if (videos.length > 0) {
    lines.push("", "Videos");
    for (const source of videos) {
      lines.push(`- [${source.title}](${source.url})`);
    }
  }

  // If somehow only unclassified types appear, fall back to a flat list.
  if (articles.length === 0 && videos.length === 0) {
    for (const source of sources) {
      lines.push(`- [${source.title}](${source.url})`);
    }
  }

  return lines.join("\n");
}

export function buildSourcesMarkdownTextBlock(
  sourcesMarkdown: string | undefined,
): string | undefined {
  const markdown = sourcesMarkdown?.trim();
  if (!markdown) {
    return undefined;
  }

  return [SOURCES_MARKDOWN_COPY_INSTRUCTION, "", markdown].join("\n");
}

export function helpSearchResultsToSourceInputs(
  results: HelpSearchResult[],
): Array<{
  title: string;
  source: HelpResourceSource;
  publicUrl?: string | null;
  registrationUrl?: string | null;
  resourceId?: string;
}> {
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
 * Prefer the strongest Freshdesk procedural article as primary, then the
 * strongest topic-aligned recorded webinar when one exists.
 * Never dump the full search list into Sources.
 */
export function selectUsedHelpResources(
  results: HelpSearchResult[],
  options?: {
    intentIsProcedural?: boolean;
    question?: string;
    maxUsed?: number;
  },
): HelpSearchResult[] {
  if (results.length === 0) {
    return [];
  }

  const maxUsed = options?.maxUsed ?? 5;
  const question = options?.question?.trim() ?? "";
  const used: HelpSearchResult[] = [];
  const usedIds = new Set<string>();

  const push = (resource: HelpSearchResult | undefined) => {
    if (!resource || usedIds.has(resource.resourceId) || used.length >= maxUsed) {
      return;
    }
    usedIds.add(resource.resourceId);
    used.push(resource);
  };

  const strongFreshdesk = results.find(
    (result) =>
      result.source === "freshdesk" &&
      result.relevanceScore >= 500 &&
      Boolean(result.publicUrl),
  );
  push(strongFreshdesk);

  if (used.length === 0 && options?.intentIsProcedural) {
    push(
      results.find(
        (result) => result.source === "freshdesk" && Boolean(result.publicUrl),
      ),
    );
  }

  if (used.length === 0) {
    push(results[0]);
  }

  // Auto-include one strong topic-aligned training video for procedural how-tos.
  if (options?.intentIsProcedural && question) {
    const companionVideo = pickStrongCompanionVideo(results, question, usedIds);
    push(companionVideo);
  }

  return used;
}

function pickStrongCompanionVideo(
  results: HelpSearchResult[],
  question: string,
  usedIds: Set<string>,
): HelpSearchResult | undefined {
  const candidates = results
    .filter(
      (result) =>
        (result.source === "recorded_webinar" ||
          result.source === "youtube_video") &&
        Boolean(result.publicUrl) &&
        !usedIds.has(result.resourceId),
    )
    .map((result) => {
      const matchScore = scoreProceduralVideoMatch(question, result.title);
      return {
        result,
        matchScore,
        strong: isStrongProceduralVideoMatch(
          question,
          result.title,
          [],
          result.relevanceScore,
        ),
      };
    })
    .filter((entry) => entry.strong)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }
      return right.result.relevanceScore - left.result.relevanceScore;
    });

  return candidates[0]?.result;
}

export function filterHelpResultsByUsedIds(
  results: HelpSearchResult[],
  usedResourceIds: string[],
): HelpSearchResult[] {
  if (usedResourceIds.length === 0) {
    return [];
  }
  const allowed = new Set(usedResourceIds);
  return results.filter((result) => allowed.has(result.resourceId));
}
