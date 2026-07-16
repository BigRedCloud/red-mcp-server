import type { ContainerClient } from "@azure/storage-blob";

import { loadCustomerDocsForHelpSearch } from "../customer-docs/customer-docs-index-store.js";
import {
  createConfiguredFreshdeskIndexContainer,
  loadFreshdeskArticlesIndex,
} from "../freshdesk/freshdesk-index-store.js";
import {
  getSyncedFreshdeskArticlePublicUrl,
  FRESHDESK_LINK_RESPONSE_GUIDANCE,
} from "../freshdesk/freshdesk-article-url.js";
import {
  buildFreshdeskScreenshotUrls,
  toCustomerFacingScreenshotUrl,
  type FreshdeskScreenshotUrl,
} from "../freshdesk/freshdesk-public-image-url.js";
import {
  buildFreshdeskInstructionBlocks,
  enrichScreenshotUrlCaptions,
  type HelpInstructionBlock,
} from "../freshdesk/instruction-blocks.js";
import {
  buildFreshdeskImageLoadDiagnostics,
  getNormalizedFreshdeskSyncedImages,
  FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD,
  freshdeskArticleImageAvailable,
  loadFreshdeskImageBlocks,
  logFreshdeskImageLoadDiagnostics,
  type HelpResourceImageBlock,
} from "../freshdesk/freshdesk-image-load.js";
import {
  createConfiguredFreshdeskImageContainer,
  isFreshdeskImageContainerConfigured,
} from "../freshdesk/image-sync.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";
import { loadUpcomingWebinarsForHelpSearch } from "../upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import {
  parseHelpResourceId,
  type HelpResourceSource,
  type NormalizedHelpResource,
} from "./help-resource-types.js";
import { toSafeVersionedIndexStorageError } from "./versioned-index-store.js";
import {
  fromFreshdeskResource,
  fromRecordedWebinarResource,
  SUPPORT_FOOTER_GUIDANCE,
} from "./unified-help-search.js";

export const HELP_RESOURCE_DETAILS_MAX_IMAGES = 5;
export const HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES = 512 * 1024;
export const HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES = 2 * 1024 * 1024;

export type { HelpResourceImageBlock } from "../freshdesk/freshdesk-image-load.js";
export type { FreshdeskScreenshotUrl } from "../freshdesk/freshdesk-public-image-url.js";
export type { HelpInstructionBlock } from "../freshdesk/instruction-blocks.js";

export const FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE = [
  "When instructionBlocks are returned, follow them in order.",
  "Place each screenshot link immediately after the step it illustrates.",
  "Use the exact supplied caption as the clickable Markdown link text, for example [Changing a customer: Click Change](EXACT_SIGNED_IMAGE_URL).",
  "Never replace the caption with Show Image, View Image, Screenshot, or any other generic label.",
  "Do not group screenshots into a separate Relevant screenshots section.",
  "Omit screenshots from unused workflow branches.",
  "Omit unclear screenshots rather than guessing.",
  "Do not repeat a screenshot.",
  "Do not invent captions — use only the caption supplied on each screenshot block.",
  "Do not say screenshots are displayed inline unless the chat client actually rendered them.",
  "Keep the official Freshdesk article link in the Helpful resources section.",
  "Use the exact supplied signed public URL — do not rewrite, shorten, or replace it.",
].join(" ");

export const FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE = [
  "When instructionBlocks are not available, use screenshotUrls with their descriptive captions.",
  "Place each screenshot after the most relevant paragraph where possible.",
  "Use the exact supplied caption as the clickable Markdown link text.",
  "Never label screenshot links Show Image.",
  "Do not invent captions.",
  "Omit unclear screenshots rather than guessing.",
  "Do not claim screenshots are shown inline unless the client actually rendered them.",
  "MCP image content blocks are a fallback only.",
  "Do not claim screenshots were supplied when imageCount is 0.",
].join(" ");

export type HelpResourceDetailsPayload = {
  resourceId: string;
  source: HelpResourceSource;
  title: string;
  summary: string;
  instructions: string;
  publicUrl: string | null;
  registrationUrl?: string;
  category: string;
  topics: string[];
  eventDay?: string;
  imageAvailable?: boolean;
  imageCount: number;
  requestedImageCount?: number;
  skippedImageCount?: number;
  imageWarning?: string;
  /** Preferred ordered presentation of Freshdesk steps and screenshots. */
  instructionBlocks?: HelpInstructionBlock[];
  /** Backward-compatible screenshot URL list; prefer instructionBlocks when present. */
  screenshotUrls?: FreshdeskScreenshotUrl[];
  responseGuidance: {
    supportFooter: string;
    freshdeskLinks?: string;
    images?: string;
    instructionBlocks?: string;
    doNotExpose: string[];
  };
};

async function findFreshdeskArticleById(
  freshdeskArticleId: string,
  container: ContainerClient | null,
): Promise<SyncedFreshdeskArticle | null> {
  if (!container) {
    return null;
  }

  try {
    const index = await loadFreshdeskArticlesIndex(container);
    return (
      index?.articles.find(
        (article) => String(article.freshdeskArticleId) === freshdeskArticleId,
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function findCustomerDocById(
  resourceId: string,
): Promise<NormalizedHelpResource | null> {
  const articles = await loadCustomerDocsForHelpSearch();
  return articles?.find((article) => article.resourceId === resourceId) ?? null;
}

async function findUpcomingWebinarById(
  resourceId: string,
): Promise<NormalizedHelpResource | null> {
  const webinars = await loadUpcomingWebinarsForHelpSearch();
  return webinars?.find((webinar) => webinar.resourceId === resourceId) ?? null;
}

async function findRecordedWebinarById(
  resourceId: string,
): Promise<NormalizedHelpResource | null> {
  const resources = await loadEnrichedEduResources();
  const syncedAt = new Date().toISOString();

  for (const resource of resources) {
    const normalized = fromRecordedWebinarResource(resource, syncedAt);
    if (normalized.resourceId === resourceId) {
      return normalized;
    }
  }

  return null;
}

function buildDetailsGuidance(hasInstructionBlocks: boolean) {
  return {
    supportFooter: SUPPORT_FOOTER_GUIDANCE,
    freshdeskLinks: FRESHDESK_LINK_RESPONSE_GUIDANCE,
    images: hasInstructionBlocks
      ? FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE
      : FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE,
    ...(hasInstructionBlocks
      ? { instructionBlocks: FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE }
      : {}),
    doNotExpose: [
      "resource IDs in customer-facing text",
      "Azure blob names",
      "storage URLs",
      "Freshdesk source image URLs",
      "sync metadata",
      "invented Freshdesk article URLs",
      "internal image metadata",
      "image hashes",
      "relevance scores",
      "internal content-block order keys",
      "workflow tags",
      "nearbyActions",
      "sourceUrl",
    ],
  };
}

export async function getHelpResourceDetails(
  resourceId: string,
  options: {
    freshdeskIndexContainer?: ContainerClient | null;
    freshdeskImageContainer?: ContainerClient | null;
    includeImages?: boolean;
    maxImages?: number;
    /** Customer question — used to select Freshdesk workflow screenshot branches. */
    question?: string | null;
  } = {},
): Promise<
  | {
      ok: true;
      payload: HelpResourceDetailsPayload;
      images: HelpResourceImageBlock[];
    }
  | { ok: false; error: string }
> {
  const parsed = parseHelpResourceId(resourceId);
  if (!parsed) {
    return { ok: false, error: "Help resource ID is invalid." };
  }

  const freshdeskIndexContainer =
    options.freshdeskIndexContainer === undefined
      ? createConfiguredFreshdeskIndexContainer()
      : options.freshdeskIndexContainer;

  const imageContainer =
    options.freshdeskImageContainer === undefined
      ? createConfiguredFreshdeskImageContainer()
      : options.freshdeskImageContainer;

  const includeImages = options.includeImages ?? true;
  const maxImages = Math.min(
    options.maxImages ?? HELP_RESOURCE_DETAILS_MAX_IMAGES,
    FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD,
  );
  const question = options.question?.trim() || null;

  try {
    if (parsed.source === "freshdesk") {
      const article = await findFreshdeskArticleById(
        parsed.id,
        freshdeskIndexContainer,
      );

      if (!article) {
        return { ok: false, error: "Help resource was not found." };
      }

      const normalized = fromFreshdeskResource(article);
      // Load up to the hard max so workflow matching can pick later screenshots
      // even when maxImages (MCP inline limit) is lower.
      const imageLoadLimit = article.contentBlocks?.length
        ? FRESHDESK_IMAGE_LOAD_MAX_IMAGES_HARD
        : maxImages;
      const imageResult = await loadFreshdeskImageBlocks(article, imageContainer, {
        includeImages,
        maxImages: imageLoadLimit,
        maxImageBytes: HELP_RESOURCE_DETAILS_MAX_IMAGE_BYTES,
        maxTotalBytes: HELP_RESOURCE_DETAILS_MAX_TOTAL_IMAGE_BYTES,
      });

      logFreshdeskImageLoadDiagnostics(
        buildFreshdeskImageLoadDiagnostics(
          article,
          imageResult,
          isFreshdeskImageContainerConfigured(),
        ),
      );

      const rawScreenshotUrls = buildFreshdeskScreenshotUrls(
        article.freshdeskArticleId,
        getNormalizedFreshdeskSyncedImages(article),
        imageResult.blocks,
      );
      const enrichedScreenshotUrls = enrichScreenshotUrlCaptions(
        rawScreenshotUrls,
        article.contentBlocks,
      );
      const instructionBlocks = buildFreshdeskInstructionBlocks(
        article.contentBlocks,
        enrichedScreenshotUrls,
        { question },
      );
      const hasInstructionBlocks = instructionBlocks.length > 0;

      // Prefer screenshots that support the selected answer path. Fall back to
      // the full enriched list for legacy articles without instruction blocks.
      const screenshotUrls = hasInstructionBlocks
        ? instructionBlocks
            .filter(
              (block): block is Extract<HelpInstructionBlock, { type: "screenshot" }> =>
                block.type === "screenshot",
            )
            .map((block) =>
              toCustomerFacingScreenshotUrl({
                caption: block.caption,
                url: block.url,
                mimeType: block.mimeType,
              }),
            )
        : enrichedScreenshotUrls.map(toCustomerFacingScreenshotUrl);

      // Cap MCP inline image blocks to the requested maxImages while keeping
      // full signed URL candidates available for instructionBlocks.
      const inlineImages = imageResult.blocks
        .slice()
        .sort((left, right) => left.order - right.order)
        .slice(0, maxImages);

      return {
        ok: true,
        payload: {
          resourceId: normalized.resourceId,
          source: normalized.source,
          title: normalized.title,
          summary: normalized.summary,
          instructions: normalized.bodyText,
          publicUrl: getSyncedFreshdeskArticlePublicUrl(article),
          category: normalized.category,
          topics: normalized.topics,
          imageAvailable: freshdeskArticleImageAvailable(article),
          imageCount: inlineImages.length,
          requestedImageCount: imageResult.requestedImageCount,
          skippedImageCount: imageResult.skippedImageCount,
          imageWarning: imageResult.storageWarning,
          ...(hasInstructionBlocks ? { instructionBlocks } : {}),
          ...(screenshotUrls.length > 0 ? { screenshotUrls } : {}),
          responseGuidance: buildDetailsGuidance(hasInstructionBlocks),
        },
        images: inlineImages,
      };
    }

    if (parsed.source === "customer_docs") {
      const resource = await findCustomerDocById(resourceId);
      if (!resource) {
        return { ok: false, error: "Help resource was not found." };
      }

      return {
        ok: true,
        payload: {
          resourceId: resource.resourceId,
          source: resource.source,
          title: resource.title,
          summary: resource.summary,
          instructions: resource.bodyText,
          publicUrl: resource.url,
          category: resource.category,
          topics: resource.topics,
          imageCount: 0,
          responseGuidance: buildDetailsGuidance(false),
        },
        images: [],
      };
    }

    if (parsed.source === "recorded_webinar") {
      const resource = await findRecordedWebinarById(resourceId);
      if (!resource) {
        return { ok: false, error: "Help resource was not found." };
      }

      return {
        ok: true,
        payload: {
          resourceId: resource.resourceId,
          source: resource.source,
          title: resource.title,
          summary: resource.summary,
          instructions: resource.bodyText,
          publicUrl: resource.url,
          category: resource.category,
          topics: resource.topics,
          imageCount: 0,
          responseGuidance: buildDetailsGuidance(false),
        },
        images: [],
      };
    }

    if (parsed.source === "upcoming_webinar") {
      const resource = await findUpcomingWebinarById(resourceId);
      if (!resource) {
        return { ok: false, error: "Help resource was not found." };
      }

      return {
        ok: true,
        payload: {
          resourceId: resource.resourceId,
          source: resource.source,
          title: resource.title,
          summary: resource.summary,
          instructions: resource.bodyText,
          publicUrl: resource.url,
          registrationUrl: resource.registrationUrl,
          category: resource.category,
          topics: resource.topics,
          eventDay: resource.eventDay,
          imageCount: 0,
          responseGuidance: buildDetailsGuidance(false),
        },
        images: [],
      };
    }

    return { ok: false, error: "Help resource was not found." };
  } catch (error) {
    return {
      ok: false,
      error: toSafeVersionedIndexStorageError(error),
    };
  }
}

export function helpResourceDetailResponse(
  payload: HelpResourceDetailsPayload,
  images: HelpResourceImageBlock[],
) {
  const sortedImages = [...images].sort((left, right) => left.order - right.order);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
      ...sortedImages.flatMap((image) => [
        ...(image.caption
          ? [{ type: "text" as const, text: image.caption }]
          : []),
        {
          type: "image" as const,
          data: image.data,
          mimeType: image.mimeType,
        },
      ]),
    ],
  };
}
