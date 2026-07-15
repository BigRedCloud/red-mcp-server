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
  type FreshdeskScreenshotUrl,
} from "../freshdesk/freshdesk-public-image-url.js";
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
  screenshotUrls?: FreshdeskScreenshotUrl[];
  responseGuidance: {
    supportFooter: string;
    freshdeskLinks?: string;
    images?: string;
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

function buildDetailsGuidance() {
  return {
    supportFooter: SUPPORT_FOOTER_GUIDANCE,
    freshdeskLinks: FRESHDESK_LINK_RESPONSE_GUIDANCE,
    images:
      "When screenshotUrls are returned, present them in the same order as the article steps. Include each screenshot using Markdown image syntax where the chat client supports it, for example ![Add Customer screen](PUBLIC_IMAGE_URL). Otherwise provide descriptive links labelled View screenshot. Do not rewrite or alter the supplied image URL. MCP image content blocks are a fallback only — do not claim screenshots are shown above unless the client visibly rendered them or you included Markdown images or links. Prefer wording such as Relevant screenshots: followed by Markdown images or links. Do not claim screenshots were supplied when imageCount is 0.",
    doNotExpose: [
      "resource IDs in customer-facing text",
      "Azure blob names",
      "storage URLs",
      "Freshdesk source image URLs",
      "sync metadata",
      "invented Freshdesk article URLs",
      "internal image metadata",
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
      const imageResult = await loadFreshdeskImageBlocks(article, imageContainer, {
        includeImages,
        maxImages,
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

      const screenshotUrls = buildFreshdeskScreenshotUrls(
        article.freshdeskArticleId,
        getNormalizedFreshdeskSyncedImages(article),
        imageResult.blocks,
      );

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
          imageCount: imageResult.imageCount,
          requestedImageCount: imageResult.requestedImageCount,
          skippedImageCount: imageResult.skippedImageCount,
          imageWarning: imageResult.storageWarning,
          ...(screenshotUrls.length > 0 ? { screenshotUrls } : {}),
          responseGuidance: buildDetailsGuidance(),
        },
        images: imageResult.blocks,
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
          responseGuidance: buildDetailsGuidance(),
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
          responseGuidance: buildDetailsGuidance(),
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
          responseGuidance: buildDetailsGuidance(),
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
