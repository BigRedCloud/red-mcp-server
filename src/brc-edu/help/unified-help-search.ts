import { createHash } from "node:crypto";

import type { EnrichedEduResource } from "../../edu/brc_edu_enrichment.js";
import {
  normaliseHelpSearchText,
  tokenizeHelpSearchQuestion,
} from "../freshdesk/freshdesk-help-search.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";
import {
  getSyncedFreshdeskArticlePublicUrl,
  FRESHDESK_LINK_RESPONSE_GUIDANCE,
  isFreshdeskPublicArticleUrl,
} from "../freshdesk/freshdesk-article-url.js";
import { normalizeFreshdeskSyncedImages } from "../freshdesk/freshdesk-image-metadata.js";
import type {
  HelpResourceSource,
  HelpResourceSourceFilter,
  HelpSearchResult,
  NormalizedHelpResource,
} from "./help-resource-types.js";
import { isPublicHttpsUrl } from "./help-resource-types.js";
import {
  buildCustomerFacingSourcesMarkdown,
  buildHelpAnswerSources,
  buildSourcesMarkdownTextBlock,
  helpSearchResultsToSourceInputs,
  selectUsedHelpResources,
} from "./help-answer-sources.js";
import {
  SUPPORT_CONTACT_URL,
  SUPPORT_FALLBACK_RESPONSE_GUIDANCE,
  buildSupportMarkdownTextBlock,
  resolveSupportFallback,
} from "./help-support-fallback.js";
import {
  AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE,
  HELP_ANSWER_LAYOUT_GUIDANCE,
  TUTORIAL_NO_DATA_CHANGE_GUIDANCE,
  buildHelpAnswerSectionsMarkdown,
} from "./help-answer-layout.js";
import {
  buildRedActionMarkdownTextBlock,
  resolveHelpRedActionCapability,
} from "./help-red-action-capability.js";
import {
  detectHelpProceduralIntent,
  expandHelpSearchQueries,
  scoreProceduralTitleMatch,
  scoreProceduralVideoMatch,
} from "./help-query-expansion.js";
import {
  buildEmptyUpcomingWebinarCustomerMarkdown,
  EMPTY_UPCOMING_WEBINAR_RESPONSE_GUIDANCE,
  isUpcomingWebinarScheduleQuery,
} from "../upcoming-webinars/upcoming-webinar-customer-fallback.js";

export const DEFAULT_HELP_SEARCH_MAX_RESULTS = 5;
export const SUPPORT_CONTACT_FOOTER_URL = SUPPORT_CONTACT_URL;

export const SUPPORT_FOOTER_GUIDANCE =
  "For advice specific to your company, or for more specialised assistance, please contact the Big Red Cloud support team: https://bigredcloud.com/contact/";

const TRAINING_QUERY_PATTERN =
  /\b(training|onboarding|webinar|live assistance|demonstration|demo|q\s*&\s*a|learn(?:ing)?|walkthrough|session)\b/i;

export function isTrainingOrLiveHelpQuery(question: string): boolean {
  return TRAINING_QUERY_PATTERN.test(question);
}

function scoreTextMatch(
  question: string,
  questionTokens: string[],
  fields: string[],
): number {
  const query = normaliseHelpSearchText(question);

  const combined = normaliseHelpSearchText(fields.join(" "));
  const title = normaliseHelpSearchText(fields[0] ?? "");

  if (query && query === title) {
    return 1000;
  }

  if (query && title.includes(query)) {
    return 850;
  }

  if (
    questionTokens.length > 0 &&
    questionTokens.every((token) => title.includes(token))
  ) {
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

const OPENING_BALANCE_QUERY_PATTERN =
  /\b(opening\s+balance|outstanding\s+balance|existing\s+balance|amount\s+already\s+owed)\b/i;

const OPENING_BALANCE_TITLE_PATTERN = /\bopening\s+balance\b/i;

const PROCEDURAL_PREFIX_PATTERN =
  /^(how\s+do\s+i|how\s+to|how\s+can\s+i|how\s+do\s+you|how\s+does\s+one)\s+/i;

function stripProceduralTitleNoise(value: string): string {
  return normaliseHelpSearchText(value)
    .replace(PROCEDURAL_PREFIX_PATTERN, "")
    .replace(/\?+$/g, "")
    .replace(/\b(my|a|an|the|first)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Freshdesk-only ranking adjustments for direct procedural queries.
 * Prefer near-exact title matches and avoid boosting opening-balance articles
 * unless the query mentions opening/outstanding/existing balance.
 *
 * Also applies strong entity+action title boosts from query expansion.
 */
export function adjustFreshdeskHelpScore(
  question: string,
  title: string,
  baseScore: number,
): number {
  const proceduralBoost = scoreProceduralTitleMatch(question, title);
  if (proceduralBoost < 0) {
    return Math.max(0, baseScore + proceduralBoost);
  }

  let score = Math.max(baseScore, 0);
  if (proceduralBoost > 0) {
    score = Math.max(score, proceduralBoost);
  }

  if (score <= 0) {
    return 0;
  }

  const queryMentionsOpeningBalance = OPENING_BALANCE_QUERY_PATTERN.test(question);
  const titleIsOpeningBalance = OPENING_BALANCE_TITLE_PATTERN.test(title);
  const intent = detectHelpProceduralIntent(question);

  if (titleIsOpeningBalance) {
    if (queryMentionsOpeningBalance || intent === "opening_balance") {
      score += 80;
    } else if (intent === "add_customer" || intent === "add_supplier") {
      score -= 500;
    } else {
      score -= 220;
    }
  }

  const queryCore = stripProceduralTitleNoise(question);
  const titleCore = stripProceduralTitleNoise(title);

  if (queryCore && titleCore && proceduralBoost === 0) {
    if (titleCore.startsWith(`${queryCore} `)) {
      const extra = titleCore.slice(queryCore.length).trim();
      if (extra && !queryMentionsOpeningBalance) {
        score -= Math.min(80, 20 + extra.split(/\s+/).length * 25);
      }
    } else if (queryCore !== titleCore) {
      const queryTokens = queryCore.split(" ").filter((token) => token.length >= 2);
      const titleTokens = titleCore.split(" ").filter((token) => token.length >= 2);
      if (queryTokens.length > 0) {
        const covered = queryTokens.filter((token) => titleCore.includes(token)).length;
        const coverage = covered / queryTokens.length;
        if (coverage >= 0.75) {
          const extraTitleTokens = titleTokens.filter(
            (token) => !queryTokens.includes(token),
          ).length;
          if (extraTitleTokens > 0 && !queryMentionsOpeningBalance) {
            score -= extraTitleTokens * 35;
          }
        }
      }
    }
  }

  return Math.max(0, score);
}

function sourceBoost(
  source: HelpResourceSource,
  question: string,
  baseScore: number,
): number {
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

  if (source === "youtube_video") {
    if (/\b(video|recording|watch|tutorial|how\s*to)\b/i.test(question)) {
      return baseScore + 12;
    }
    // Prefer recorded webinars over ordinary channel videos for webinar queries.
    if (/\bwebinar\b/i.test(question)) {
      return Math.max(0, baseScore - 5);
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

function fromCustomerDocsResource(
  resource: NormalizedHelpResource,
): NormalizedHelpResource {
  return resource;
}

function fromUpcomingWebinarResource(
  resource: NormalizedHelpResource,
): NormalizedHelpResource {
  return resource;
}

function resolveVideoHelpSource(
  resource: EnrichedEduResource,
): "recorded_webinar" | "youtube_video" {
  return resource.youtubeCategory === "youtube_video"
    ? "youtube_video"
    : "recorded_webinar";
}

function buildVideoHelpResourceId(
  resource: EnrichedEduResource,
  source: "recorded_webinar" | "youtube_video",
): string {
  if (resource.videoId) {
    return `${source}:${resource.videoId}`;
  }

  return `${source}:${createHash("sha256").update(resource.url).digest("hex").slice(0, 16)}`;
}

function fromRecordedWebinarResource(
  resource: EnrichedEduResource,
  syncedAt: string,
): NormalizedHelpResource {
  const source = resolveVideoHelpSource(resource);

  return {
    resourceId: buildVideoHelpResourceId(resource, source),
    source,
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

function fromFreshdeskResource(
  article: SyncedFreshdeskArticle,
): NormalizedHelpResource {
  const syncedImages = normalizeFreshdeskSyncedImages(article.syncedImages, article.images);

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

export function toHelpSearchResult(
  resource: NormalizedHelpResource,
  relevanceScore: number,
): HelpSearchResult {
  const publicUrl =
    resource.source === "freshdesk"
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
    registrationUrl:
      resource.registrationUrl && isPublicHttpsUrl(resource.registrationUrl)
        ? resource.registrationUrl
        : undefined,
    category: resource.category,
    relevanceScore,
    imageAvailable:
      resource.source === "freshdesk" && resource.imageBlobNames.length > 0,
    eventDay: resource.eventDay,
  };
}

function dedupeSearchResults(
  entries: Array<{ score: number; result: HelpSearchResult; dedupeKey: string }>,
): HelpSearchResult[] {
  const seenKeys = new Set<string>();
  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();

  return entries
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.result.title.localeCompare(right.result.title),
    )
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

export function searchUnifiedHelpResources(
  question: string,
  sources: {
    customerDocs?: NormalizedHelpResource[];
    freshdeskArticles?: SyncedFreshdeskArticle[];
    recordedWebinars?: EnrichedEduResource[];
    upcomingWebinars?: NormalizedHelpResource[];
  },
  options?: {
    category?: string;
    maxResults?: number;
    sourceFilter?: HelpResourceSourceFilter;
  },
): HelpSearchResult[] {
  const maxResults = options?.maxResults ?? DEFAULT_HELP_SEARCH_MAX_RESULTS;
  const sourceFilter = options?.sourceFilter ?? "all";
  const syncedAt = new Date().toISOString();
  const expandedQueries = expandHelpSearchQueries(question);
  const intent = detectHelpProceduralIntent(question);

  const bestByKey = new Map<
    string,
    { score: number; result: HelpSearchResult; dedupeKey: string }
  >();

  const includeSource = (source: HelpResourceSource): boolean =>
    sourceFilter === "all" || sourceFilter === source;

  const consider = (
    dedupeKey: string,
    score: number,
    result: HelpSearchResult,
  ) => {
    if (score <= 0) {
      return;
    }
    const existing = bestByKey.get(dedupeKey);
    if (!existing || score > existing.score) {
      bestByKey.set(dedupeKey, {
        score,
        result: { ...result, relevanceScore: score },
        dedupeKey,
      });
    }
  };

  for (const query of expandedQueries) {
    const questionTokens = tokenizeHelpSearchQuestion(query);

    if (includeSource("customer_docs")) {
      for (const resource of sources.customerDocs ?? []) {
        if (!resource.enabled) {
          continue;
        }

        let score = sourceBoost(
          "customer_docs",
          query,
          scoreTextMatch(query, questionTokens, [
            resource.title,
            resource.category,
            resource.bodyText,
            resource.topics.join(" "),
          ]),
        );

        // Prefer official Freshdesk procedural articles for how-to intents.
        if (intent && intent !== "opening_balance") {
          score = Math.max(0, score - 40);
        }

        consider(
          `customer_docs:${resource.url}`,
          score,
          toHelpSearchResult(resource, score),
        );
      }
    }

    if (includeSource("freshdesk")) {
      for (const article of sources.freshdeskArticles ?? []) {
        if (!article.enabled) {
          continue;
        }

        const normalized = fromFreshdeskResource(article);
        const score = adjustFreshdeskHelpScore(
          question,
          normalized.title,
          sourceBoost(
            "freshdesk",
            query,
            scoreTextMatch(query, questionTokens, [
              normalized.title,
              normalized.category,
              normalized.bodyText,
            ]),
          ),
        );

        consider(
          `freshdesk:${article.freshdeskArticleId}`,
          score,
          toHelpSearchResult(normalized, score),
        );
      }
    }

    if (includeSource("recorded_webinar") || includeSource("youtube_video")) {
      for (const resource of sources.recordedWebinars ?? []) {
        if (!resource.isActive) {
          continue;
        }

        const normalized = fromRecordedWebinarResource(resource, syncedAt);
        if (
          (normalized.source === "recorded_webinar" &&
            !includeSource("recorded_webinar")) ||
          (normalized.source === "youtube_video" &&
            !includeSource("youtube_video"))
        ) {
          continue;
        }

        let score = sourceBoost(
          normalized.source,
          query,
          scoreTextMatch(query, questionTokens, [
            normalized.title,
            normalized.category,
            normalized.bodyText,
            normalized.topics.join(" "),
          ]),
        );

        // Auto-surface topic-aligned training videos for procedural how-tos —
        // do not require the user to say "video" / "webinar".
        const videoMatch = scoreProceduralVideoMatch(
          question,
          normalized.title,
          normalized.topics,
        );
        if (videoMatch > 0) {
          score = Math.max(score, videoMatch);
        } else if (
          intent &&
          !/\b(video|webinar|recording|watch)\b/i.test(question)
        ) {
          // Keep weak/generic videos from crowding procedural results.
          score = Math.max(0, score - 40);
        }

        consider(
          `${normalized.source}:${normalized.url}`,
          score,
          toHelpSearchResult(normalized, score),
        );
      }
    }

    if (includeSource("upcoming_webinar")) {
      for (const resource of sources.upcomingWebinars ?? []) {
        if (!resource.enabled) {
          continue;
        }

        const normalized = fromUpcomingWebinarResource(resource);
        let score = sourceBoost(
          "upcoming_webinar",
          query,
          scoreTextMatch(query, questionTokens, [
            normalized.title,
            normalized.eventDay ?? "",
            normalized.bodyText,
            normalized.topics.join(" "),
          ]),
        );

        if (intent && !isTrainingOrLiveHelpQuery(question)) {
          score = Math.max(0, score - 80);
        }

        consider(
          `upcoming_webinar:${normalized.resourceId}`,
          score,
          toHelpSearchResult(normalized, score),
        );
      }
    }
  }

  return dedupeSearchResults([...bestByKey.values()]).slice(0, maxResults);
}

export function buildUnifiedFindHelpResourcesResponse(
  question: string,
  sources: {
    customerDocs?: NormalizedHelpResource[];
    freshdeskArticles?: SyncedFreshdeskArticle[];
    recordedWebinars?: EnrichedEduResource[];
    upcomingWebinars?: NormalizedHelpResource[];
  },
  options?: {
    category?: string;
    maxResults?: number;
    sourceFilter?: HelpResourceSourceFilter;
  },
) {
  let resources = searchUnifiedHelpResources(question, sources, options);
  const upcomingScheduleQuery =
    options?.sourceFilter === "upcoming_webinar" ||
    isUpcomingWebinarScheduleQuery(question);

  if (upcomingScheduleQuery) {
    const upcomingOnly = resources.filter(
      (resource) => resource.source === "upcoming_webinar",
    );
    if (upcomingOnly.length > 0) {
      // Upcoming-schedule questions must not treat recorded videos as live sessions.
      resources = upcomingOnly;
    } else {
      // Generic schedule questions often have no text overlap with listing titles —
      // surface every enabled upcoming webinar from the catalogue instead.
      const catalogue = (sources.upcomingWebinars ?? []).filter(
        (resource) => resource.enabled !== false,
      );
      resources = catalogue.map((resource) =>
        toHelpSearchResult(fromUpcomingWebinarResource(resource), 100),
      );
    }
  }

  const intent = detectHelpProceduralIntent(question);
  const usedResources = selectUsedHelpResources(resources, {
    intentIsProcedural: intent !== null,
    question,
  });
  const usedResourceIds = usedResources.map((resource) => resource.resourceId);
  const answerSources = buildHelpAnswerSources(
    helpSearchResultsToSourceInputs(usedResources),
  );
  const customerFacingSourcesMarkdown =
    buildCustomerFacingSourcesMarkdown(answerSources);
  const emptyUpcomingWebinarResult =
    upcomingScheduleQuery &&
    !usedResources.some((resource) => resource.source === "upcoming_webinar");
  const customerFacingEmptyUpcomingWebinarMarkdown = emptyUpcomingWebinarResult
    ? buildEmptyUpcomingWebinarCustomerMarkdown()
    : undefined;
  const supportFallback = resolveSupportFallback({
    matchCount: usedResources.length > 0 ? usedResources.length : resources.length,
    strongestScore:
      usedResources[0]?.relevanceScore ?? resources[0]?.relevanceScore ?? null,
    hasRelevantSourceOrScreenshot: answerSources.length > 0,
  });
  const redAction = resolveHelpRedActionCapability(question);
  const hasFreshdeskMatch = usedResources.some(
    (resource) => resource.source === "freshdesk",
  );
  const customerFacingAnswerSectionsMarkdown = buildHelpAnswerSectionsMarkdown({
    sourcesMarkdown: customerFacingSourcesMarkdown,
    redActionMarkdown: redAction.customerFacingRedActionMarkdown,
    supportMarkdown: supportFallback.customerFacingSupportMarkdown,
  });

  return {
    question,
    category: options?.category ?? null,
    matchCount: resources.length,
    resources,
    usedResourceIds,
    sources: answerSources,
    ...(customerFacingSourcesMarkdown
      ? { customerFacingSourcesMarkdown }
      : {}),
    ...(customerFacingAnswerSectionsMarkdown
      ? { customerFacingAnswerSectionsMarkdown }
      : {}),
    ...(customerFacingEmptyUpcomingWebinarMarkdown
      ? { customerFacingEmptyUpcomingWebinarMarkdown }
      : {}),
    supportFallbackRecommended: supportFallback.supportFallbackRecommended,
    supportFallbackReason: supportFallback.supportFallbackReason,
    supportUrl: supportFallback.supportUrl,
    contactUrl: supportFallback.contactUrl,
    customerFacingSupportMarkdown:
      supportFallback.customerFacingSupportMarkdown,
    redActionAvailable: redAction.redActionAvailable,
    redActionName: redAction.redActionName,
    ...(redAction.customerFacingRedActionMarkdown
      ? {
          customerFacingRedActionMarkdown:
            redAction.customerFacingRedActionMarkdown,
        }
      : {}),
    responseGuidance: {
      format: [
        "Provide a concise synthesized direct answer first.",
        "Add clear steps where applicable, based only on usedResourceIds / Sources — not every search hit.",
        emptyUpcomingWebinarResult
          ? EMPTY_UPCOMING_WEBINAR_RESPONSE_GUIDANCE
          : "When upcoming_webinar resources are returned, list only those sessions and use only their returned registrationUrl or publicUrl values — never invent webinar details.",
        "Do not describe recorded_webinar or youtube_video resources as upcoming webinars.",
        "End with customerFacingAnswerSectionsMarkdown (or Sources with Articles/Videos, then optional Do this through Red, then Still need help? support) in that exact order.",
        "Never emit Do this through Red before Sources.",
        "Keep screenshot Markdown links beside their related steps — never move them into Sources.",
        "Always end with the Still need help? support section.",
        "Use only publicUrl or registrationUrl values returned in sources for hyperlinks.",
        "Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.",
        FRESHDESK_LINK_RESPONSE_GUIDANCE,
        AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE,
        hasFreshdeskMatch
          ? "A matching Freshdesk article was returned in usedResourceIds — never claim no dedicated help article exists; call brc_get_help_resource_details for that resourceId with includeImages=true and imagePresentation=links."
          : "Do not claim no article exists until expanded procedural search returned no Freshdesk match. Use brc_get_help_resource_details when a Freshdesk resource is returned.",
        HELP_ANSWER_LAYOUT_GUIDANCE,
        TUTORIAL_NO_DATA_CHANGE_GUIDANCE,
        "Do not show internal resource IDs, Azure blob names, storage URLs, relevance scores, or sync metadata.",
      ],
      preferredResourceOrder: [
        "customer_docs",
        "recorded_webinar",
        "upcoming_webinar",
        "freshdesk",
      ],
      supportFooter: SUPPORT_FOOTER_GUIDANCE,
      supportFooterWhen: SUPPORT_FALLBACK_RESPONSE_GUIDANCE,
      sources: [
        "Copy customerFacingSourcesMarkdown into the final answer under the heading Sources.",
        "Group Freshdesk / documentation links under Articles and recorded webinars under Videos — omit an empty Videos heading.",
        "For procedural how-tos, automatically include the strongest topic-aligned training video under Videos when one exists — do not require the user to ask for a video.",
        "Sources must list only usedResourceIds — never login, API-key, user, or webinar hits that were not used.",
        "Use exact URLs from the sources array — never invent or rewrite URLs.",
        "Deduplicate. Cap at five. Most relevant first.",
        "Do not expose resource IDs, Azure URLs, storage paths, blob names, or internal metadata.",
      ].join(" "),
      layout: HELP_ANSWER_LAYOUT_GUIDANCE,
      autoScreenshots: AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE,
      ...(emptyUpcomingWebinarResult
        ? { emptyUpcomingWebinar: EMPTY_UPCOMING_WEBINAR_RESPONSE_GUIDANCE }
        : {}),
    },
    // Backward-compatible alias — prefer supportUrl / supportFallbackRecommended.
    supportFallbackUrl: supportFallback.supportUrl,
  };
}

/**
 * MCP content for find-help: JSON payload plus ready-to-use Sources / Red-action / support Markdown.
 */
export function unifiedFindHelpResourcesMcpContent(
  payload: ReturnType<typeof buildUnifiedFindHelpResourcesResponse>,
): {
  content: Array<{ type: "text"; text: string }>;
} {
  const content: Array<{ type: "text"; text: string }> = [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ];

  if (payload.customerFacingEmptyUpcomingWebinarMarkdown) {
    content.push({
      type: "text",
      text: [
        "Use the following as the direct customer answer for this empty upcoming-webinar result. Do not claim no webinars are scheduled. Still end with the Still need help? support section:",
        "",
        payload.customerFacingEmptyUpcomingWebinarMarkdown,
      ].join("\n"),
    });
  }

  const sourcesText = buildSourcesMarkdownTextBlock(
    payload.customerFacingSourcesMarkdown,
  );
  if (sourcesText) {
    content.push({ type: "text", text: sourcesText });
  }

  if (payload.redActionAvailable) {
    const redActionText = buildRedActionMarkdownTextBlock(
      payload.customerFacingRedActionMarkdown,
    );
    if (redActionText) {
      content.push({ type: "text", text: redActionText });
    }
  }

  const supportText = buildSupportMarkdownTextBlock(
    payload.customerFacingSupportMarkdown,
  );
  if (supportText) {
    content.push({ type: "text", text: supportText });
  }

  if (payload.customerFacingAnswerSectionsMarkdown) {
    content.push({
      type: "text",
      text: [
        "Copy the following sections after the tutorial steps and screenshots, preserving this exact order (Sources with Articles/Videos, then optional Do this through Red, then Still need help? support last):",
        "",
        payload.customerFacingAnswerSectionsMarkdown,
      ].join("\n"),
    });
  }

  return { content };
}

export {
  fromCustomerDocsResource,
  fromFreshdeskResource,
  fromRecordedWebinarResource,
  fromUpcomingWebinarResource,
};
