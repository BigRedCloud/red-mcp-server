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
  buildCustomerFacingInstructionMarkdown,
  buildCustomerFacingScreenshotMarkdown,
  buildScreenshotLinksMarkdown,
  buildScreenshotMarkdownTextBlock,
  resolveHelpImagePresentation,
  type HelpImagePresentation,
} from "../freshdesk/screenshot-markdown.js";
import { isRejectedFreshdeskCaption } from "../freshdesk/screenshot-caption.js";
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
export type { HelpImagePresentation } from "../freshdesk/screenshot-markdown.js";

export const FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE = [
  "Copy the exact Markdown links from customerFacingScreenshotMarkdown or customerFacingInstructionMarkdown into the final customer-facing answer.",
  "Place each link after the related step.",
  "Do not merely describe the screenshots.",
  "Do not say Here are the screenshots without including the links.",
  "Do not replace links with Screenshot 1, Tool result, Show Image, or generic text.",
  "Do not depend on tool-result image previews being visible to the user.",
  "The final answer must contain the exact signed Markdown links.",
  "If no links are returned, clearly say that no matching screenshot was found.",
  "Never omit valid returned screenshot links after telling the user screenshots are available.",
].join(" ");

export const FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE = [
  "When customerFacingInstructionMarkdown is returned, prefer copying that Markdown into the answer, preserving every screenshot link exactly.",
  "When instructionBlocks are returned, follow them in order.",
  "Place each screenshot link immediately after the step it illustrates.",
  "Use the exact supplied caption as the clickable Markdown link text, for example [Changing a customer: Click Change](EXACT_SIGNED_IMAGE_URL).",
  "Never replace the caption with Show Image, View Image, Screenshot, or any other generic label.",
  "Do not group screenshots into a separate Relevant screenshots section when step-and-link Markdown is available.",
  "Omit screenshots from unused workflow branches.",
  "Omit unclear screenshots rather than guessing.",
  "Do not repeat a screenshot.",
  "Do not invent captions — use only the caption supplied on each screenshot block.",
  "Do not say screenshots are displayed inline unless the chat client actually rendered them.",
  "Keep the official Freshdesk article link in the Helpful resources section.",
  "Use the exact supplied signed public URL — do not rewrite, shorten, or replace it.",
  FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE,
].join(" ");

export const FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE = [
  "When instructionBlocks are not available, use customerFacingScreenshotMarkdown or screenshotUrls with their descriptive captions.",
  "Place each screenshot after the most relevant paragraph where possible.",
  "Use the exact supplied caption as the clickable Markdown link text.",
  "Never label screenshot links Show Image.",
  "Do not invent captions.",
  "Omit unclear screenshots rather than guessing.",
  "Do not claim screenshots are shown inline unless the client actually rendered them.",
  "MCP image content blocks are a fallback only.",
  "Do not claim screenshots were supplied when imageCount is 0 or when no Markdown links are returned.",
  FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE,
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
  imagePresentation?: HelpImagePresentation;
  /** Preferred ordered presentation of Freshdesk steps and screenshots. */
  instructionBlocks?: HelpInstructionBlock[];
  /** Backward-compatible screenshot URL list; prefer instructionBlocks when present. */
  screenshotUrls?: FreshdeskScreenshotUrl[];
  /** Ready-to-paste Markdown links for each selected screenshot. */
  screenshotLinksMarkdown?: string[];
  /** Combined ready-to-paste Markdown for selected screenshots. */
  customerFacingScreenshotMarkdown?: string;
  /** Fully assembled step-and-link Markdown from instructionBlocks. */
  customerFacingInstructionMarkdown?: string;
  responseGuidance: {
    supportFooter: string;
    freshdeskLinks?: string;
    images?: string;
    instructionBlocks?: string;
    screenshotMarkdown?: string;
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

function buildDetailsGuidance(hasInstructionBlocks: boolean, hasScreenshotLinks: boolean) {
  return {
    supportFooter: SUPPORT_FOOTER_GUIDANCE,
    freshdeskLinks: FRESHDESK_LINK_RESPONSE_GUIDANCE,
    images: hasInstructionBlocks
      ? FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE
      : FRESHDESK_LEGACY_SCREENSHOT_GUIDANCE,
    ...(hasInstructionBlocks
      ? { instructionBlocks: FRESHDESK_INSTRUCTION_BLOCKS_GUIDANCE }
      : {}),
    ...(hasScreenshotLinks
      ? { screenshotMarkdown: FRESHDESK_SCREENSHOT_MARKDOWN_GUIDANCE }
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

function sanitizeScreenshotUrls(
  screenshots: FreshdeskScreenshotUrl[],
): FreshdeskScreenshotUrl[] {
  return screenshots
    .map(toCustomerFacingScreenshotUrl)
    .filter(
      (screenshot) =>
        Boolean(screenshot.url) &&
        Boolean(screenshot.caption) &&
        !isRejectedFreshdeskCaption(screenshot.caption),
    );
}

function sanitizeInstructionBlocks(
  blocks: HelpInstructionBlock[],
): HelpInstructionBlock[] {
  return blocks.filter((block) => {
    if (block.type === "text") {
      return Boolean(block.text.trim());
    }
    return (
      Boolean(block.url) &&
      Boolean(block.caption) &&
      !isRejectedFreshdeskCaption(block.caption)
    );
  });
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
    /** How to present screenshots in the MCP tool result. Defaults to links. */
    imagePresentation?: HelpImagePresentation | string | null;
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
  const imagePresentation = resolveHelpImagePresentation(
    options.imagePresentation,
  );

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
      const rawInstructionBlocks = buildFreshdeskInstructionBlocks(
        article.contentBlocks,
        enrichedScreenshotUrls,
        { question },
      );
      const instructionBlocks = sanitizeInstructionBlocks(rawInstructionBlocks);
      const hasInstructionBlocks = instructionBlocks.length > 0;

      // Prefer screenshots that support the selected answer path. Fall back to
      // the full enriched list for legacy articles without instruction blocks.
      const screenshotUrls = sanitizeScreenshotUrls(
        hasInstructionBlocks
          ? instructionBlocks
              .filter(
                (
                  block,
                ): block is Extract<HelpInstructionBlock, { type: "screenshot" }> =>
                  block.type === "screenshot",
              )
              .map((block) => ({
                caption: block.caption,
                url: block.url,
                mimeType: block.mimeType,
              }))
          : enrichedScreenshotUrls,
      );

      const screenshotLinksMarkdown = buildScreenshotLinksMarkdown(screenshotUrls);
      const customerFacingScreenshotMarkdown =
        buildCustomerFacingScreenshotMarkdown(screenshotUrls);
      const customerFacingInstructionMarkdown =
        buildCustomerFacingInstructionMarkdown(
          hasInstructionBlocks ? instructionBlocks : undefined,
        );
      const hasScreenshotLinks = screenshotLinksMarkdown.length > 0;

      // imageCount must match selected customer-facing screenshots, not raw loads.
      const selectedImageCount = screenshotUrls.length;

      // Binary MCP image blocks only when presentation asks for them.
      const includeBinaryImages =
        includeImages &&
        (imagePresentation === "inline" || imagePresentation === "both");
      const inlineImages = includeBinaryImages
        ? imageResult.blocks
            .slice()
            .sort((left, right) => left.order - right.order)
            .slice(0, Math.min(maxImages, selectedImageCount || maxImages))
        : [];

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
          imageAvailable: hasScreenshotLinks
            ? true
            : freshdeskArticleImageAvailable(article) && selectedImageCount > 0,
          imageCount: selectedImageCount,
          requestedImageCount: imageResult.requestedImageCount,
          skippedImageCount: imageResult.skippedImageCount,
          imageWarning: imageResult.storageWarning,
          imagePresentation,
          ...(hasInstructionBlocks ? { instructionBlocks } : {}),
          ...(screenshotUrls.length > 0 ? { screenshotUrls } : {}),
          ...(screenshotLinksMarkdown.length > 0
            ? { screenshotLinksMarkdown }
            : {}),
          ...(customerFacingScreenshotMarkdown
            ? { customerFacingScreenshotMarkdown }
            : {}),
          ...(customerFacingInstructionMarkdown
            ? { customerFacingInstructionMarkdown }
            : {}),
          responseGuidance: buildDetailsGuidance(
            hasInstructionBlocks,
            hasScreenshotLinks,
          ),
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
          imagePresentation,
          responseGuidance: buildDetailsGuidance(false, false),
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
          imagePresentation,
          responseGuidance: buildDetailsGuidance(false, false),
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
          imagePresentation,
          responseGuidance: buildDetailsGuidance(false, false),
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
  const markdownText = buildScreenshotMarkdownTextBlock({
    instructionMarkdown: payload.customerFacingInstructionMarkdown,
    screenshotMarkdown: payload.customerFacingScreenshotMarkdown,
  });

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ];

  // Put ready-to-use Markdown before any binary image blocks so links are the
  // primary customer-facing signal.
  if (markdownText) {
    content.push({
      type: "text",
      text: markdownText,
    });
  }

  for (const image of sortedImages) {
    if (image.caption) {
      content.push({ type: "text", text: image.caption });
    }
    content.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }

  return { content };
}
