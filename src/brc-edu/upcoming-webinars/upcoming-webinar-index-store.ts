import type { ContainerClient } from "@azure/storage-blob";

import {
  getBrcEduUploadContainer,
  getBrcEduUploadStorageConnectionString,
} from "../../edu/brc_edu_upload_store.js";
import type { NormalizedHelpResource } from "../help/help-resource-types.js";
import {
  BIGREDCLOUD_WEBINAR_SERIES_RULE,
  safeWebFetchText,
  type SafeWebFetchOptions,
} from "../help/safe-web-fetch.js";
import {
  buildVersionedHelpIndex,
  createHelpIndexContainer,
  loadVersionedHelpIndex,
  saveVersionedHelpIndex,
  type VersionedHelpIndex,
} from "../help/versioned-index-store.js";
import {
  parseUpcomingWebinarsFromHtml,
  UPCOMING_WEBINAR_PAGE_URL,
} from "./upcoming-webinar-parser.js";

export const UPCOMING_WEBINARS_INDEX_LATEST_BLOB =
  "brc-edu/upcoming-webinars/latest/webinars.json";

export const UPCOMING_WEBINARS_INDEX_ARCHIVE_PREFIX =
  "brc-edu/upcoming-webinars/archive/webinars";

export type UpcomingWebinarsIndex = VersionedHelpIndex<NormalizedHelpResource>;

export function parseUpcomingWebinarsIndex(value: unknown): UpcomingWebinarsIndex | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.generatedAt !== "string" || !Array.isArray(record.items)) {
    return null;
  }

  for (const item of record.items) {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const webinar = item as Record<string, unknown>;
    if (
      typeof webinar.resourceId !== "string" ||
      webinar.source !== "upcoming_webinar" ||
      typeof webinar.title !== "string"
    ) {
      return null;
    }
  }

  return {
    generatedAt: record.generatedAt,
    itemCount:
      typeof record.itemCount === "number" ? record.itemCount : record.items.length,
    items: record.items as NormalizedHelpResource[],
  };
}

export function createConfiguredUpcomingWebinarsIndexContainer(): ContainerClient | null {
  const connectionString = getBrcEduUploadStorageConnectionString();
  const containerName = getBrcEduUploadContainer();

  if (!connectionString || !containerName) {
    return null;
  }

  return createHelpIndexContainer(connectionString, containerName);
}

export async function loadUpcomingWebinarsIndex(
  container: ContainerClient,
): Promise<UpcomingWebinarsIndex | null> {
  return loadVersionedHelpIndex(
    container,
    UPCOMING_WEBINARS_INDEX_LATEST_BLOB,
    parseUpcomingWebinarsIndex,
  );
}

export async function saveUpcomingWebinarsIndex(
  container: ContainerClient,
  webinars: NormalizedHelpResource[],
  options: {
    previousIndex?: UpcomingWebinarsIndex | null;
    generatedAt?: Date;
  } = {},
): Promise<UpcomingWebinarsIndex> {
  const index = buildVersionedHelpIndex(webinars, options.generatedAt);
  return saveVersionedHelpIndex(
    container,
    {
      latestBlobPath: UPCOMING_WEBINARS_INDEX_LATEST_BLOB,
      archiveBlobPathPrefix: UPCOMING_WEBINARS_INDEX_ARCHIVE_PREFIX,
    },
    index,
    { previousIndex: options.previousIndex, generatedAt: options.generatedAt },
  );
}

export type UpcomingWebinarsSyncResult =
  | {
      ok: true;
      index: UpcomingWebinarsIndex;
      webinars: NormalizedHelpResource[];
    }
  | {
      ok: false;
      error: string;
      preservedPreviousIndex: boolean;
    };

export async function syncUpcomingWebinarsIndex(
  container: ContainerClient,
  options: SafeWebFetchOptions = {},
): Promise<UpcomingWebinarsSyncResult> {
  const previousIndex = await loadUpcomingWebinarsIndex(container);

  try {
    const page = await safeWebFetchText(
      UPCOMING_WEBINAR_PAGE_URL,
      [BIGREDCLOUD_WEBINAR_SERIES_RULE],
      options,
    );
    const webinars = parseUpcomingWebinarsFromHtml(page.text, page.url);
    const index = await saveUpcomingWebinarsIndex(container, webinars, {
      previousIndex,
    });

    return {
      ok: true,
      index,
      webinars,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      preservedPreviousIndex: previousIndex != null,
    };
  }
}

type UpcomingWebinarsIndexCache =
  | { webinars: NormalizedHelpResource[]; expiresAt: number }
  | { unavailable: true; expiresAt: number };

let upcomingWebinarsIndexCache: UpcomingWebinarsIndexCache | null = null;

export function resetUpcomingWebinarsIndexCacheForTests(): void {
  upcomingWebinarsIndexCache = null;
}

function getUpcomingWebinarsCacheTtlMs(): number {
  const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
  const minutes = rawMinutes ? Number(rawMinutes) : 5;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60 * 1000;
  }
  return minutes * 60 * 1000;
}

export async function loadUpcomingWebinarsForHelpSearch(
  options: {
    now?: number;
    container?: ContainerClient | null;
  } = {},
): Promise<NormalizedHelpResource[] | null> {
  const now = options.now ?? Date.now();
  const ttlMs = getUpcomingWebinarsCacheTtlMs();

  if (upcomingWebinarsIndexCache && upcomingWebinarsIndexCache.expiresAt > now) {
    return "unavailable" in upcomingWebinarsIndexCache
      ? null
      : upcomingWebinarsIndexCache.webinars;
  }

  try {
    const container =
      options.container === undefined
        ? createConfiguredUpcomingWebinarsIndexContainer()
        : options.container;

    if (!container) {
      upcomingWebinarsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
      return null;
    }

    const index = await loadUpcomingWebinarsIndex(container);
    if (!index) {
      upcomingWebinarsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
      return null;
    }

    upcomingWebinarsIndexCache = {
      webinars: index.items.filter((item) => item.enabled),
      expiresAt: now + ttlMs,
    };

    return upcomingWebinarsIndexCache.webinars;
  } catch {
    upcomingWebinarsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
    return null;
  }
}
