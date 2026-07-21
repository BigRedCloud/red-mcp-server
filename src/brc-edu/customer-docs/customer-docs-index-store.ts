import type { ContainerClient } from "@azure/storage-blob";

import {
  getBrcEduUploadContainer,
  getBrcEduUploadStorageConnectionString,
} from "../../edu/brc_edu_storage_config.js";
import {
  buildVersionedHelpIndex,
  createHelpIndexContainer,
  loadVersionedHelpIndex,
  saveVersionedHelpIndex,
  type VersionedHelpIndex,
} from "../help/versioned-index-store.js";
import type { NormalizedHelpResource } from "../help/help-resource-types.js";
import {
  crawlCustomerDocumentation,
  type CustomerDocsCrawlResult,
} from "./customer-docs-crawler.js";
import type { SafeWebFetchOptions } from "../help/safe-web-fetch.js";

export const CUSTOMER_DOCS_INDEX_LATEST_BLOB =
  "brc-edu/customer-docs/latest/articles.json";

export const CUSTOMER_DOCS_INDEX_ARCHIVE_PREFIX =
  "brc-edu/customer-docs/archive/articles";

export type CustomerDocsIndex = VersionedHelpIndex<NormalizedHelpResource>;

export function parseCustomerDocsIndex(value: unknown): CustomerDocsIndex | null {
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

    const article = item as Record<string, unknown>;
    if (
      typeof article.resourceId !== "string" ||
      article.source !== "customer_docs" ||
      typeof article.title !== "string" ||
      typeof article.url !== "string"
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

export function createConfiguredCustomerDocsIndexContainer(): ContainerClient | null {
  const connectionString = getBrcEduUploadStorageConnectionString();
  const containerName = getBrcEduUploadContainer();

  if (!connectionString || !containerName) {
    return null;
  }

  return createHelpIndexContainer(connectionString, containerName);
}

export async function loadCustomerDocsIndex(
  container: ContainerClient,
): Promise<CustomerDocsIndex | null> {
  return loadVersionedHelpIndex(
    container,
    CUSTOMER_DOCS_INDEX_LATEST_BLOB,
    parseCustomerDocsIndex,
  );
}

export async function saveCustomerDocsIndex(
  container: ContainerClient,
  articles: NormalizedHelpResource[],
  options: {
    previousIndex?: CustomerDocsIndex | null;
    generatedAt?: Date;
  } = {},
): Promise<CustomerDocsIndex> {
  const index = buildVersionedHelpIndex(articles, options.generatedAt);
  return saveVersionedHelpIndex(
    container,
    {
      latestBlobPath: CUSTOMER_DOCS_INDEX_LATEST_BLOB,
      archiveBlobPathPrefix: CUSTOMER_DOCS_INDEX_ARCHIVE_PREFIX,
    },
    index,
    { previousIndex: options.previousIndex, generatedAt: options.generatedAt },
  );
}

export type CustomerDocsSyncResult = {
  ok: true;
  index: CustomerDocsIndex;
  crawl: CustomerDocsCrawlResult;
} | {
  ok: false;
  error: string;
  preservedPreviousIndex: boolean;
};

export async function syncCustomerDocumentationIndex(
  container: ContainerClient,
  options: SafeWebFetchOptions = {},
): Promise<CustomerDocsSyncResult> {
  const previousIndex = await loadCustomerDocsIndex(container);

  try {
    const crawl = await crawlCustomerDocumentation(options);
    const index = await saveCustomerDocsIndex(container, crawl.articles, {
      previousIndex,
    });

    return {
      ok: true,
      index,
      crawl,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      preservedPreviousIndex: previousIndex != null,
    };
  }
}

type CustomerDocsIndexCache =
  | { articles: NormalizedHelpResource[]; expiresAt: number }
  | { unavailable: true; expiresAt: number };

let customerDocsIndexCache: CustomerDocsIndexCache | null = null;

export function resetCustomerDocsIndexCacheForTests(): void {
  customerDocsIndexCache = null;
}

function getCustomerDocsCacheTtlMs(): number {
  const rawMinutes = process.env.BRC_EDU_CACHE_TTL_MINUTES?.trim();
  const minutes = rawMinutes ? Number(rawMinutes) : 5;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 5 * 60 * 1000;
  }
  return minutes * 60 * 1000;
}

export async function loadCustomerDocsForHelpSearch(
  options: {
    now?: number;
    container?: ContainerClient | null;
  } = {},
): Promise<NormalizedHelpResource[] | null> {
  const now = options.now ?? Date.now();
  const ttlMs = getCustomerDocsCacheTtlMs();

  if (customerDocsIndexCache && customerDocsIndexCache.expiresAt > now) {
    return "unavailable" in customerDocsIndexCache
      ? null
      : customerDocsIndexCache.articles;
  }

  try {
    const container =
      options.container === undefined
        ? createConfiguredCustomerDocsIndexContainer()
        : options.container;

    if (!container) {
      customerDocsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
      return null;
    }

    const index = await loadCustomerDocsIndex(container);
    if (!index) {
      customerDocsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
      return null;
    }

    customerDocsIndexCache = {
      articles: index.items.filter((item) => item.enabled),
      expiresAt: now + ttlMs,
    };

    return customerDocsIndexCache.articles;
  } catch {
    customerDocsIndexCache = { unavailable: true, expiresAt: now + ttlMs };
    return null;
  }
}
