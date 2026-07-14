import assert from "node:assert/strict";
import test from "node:test";

import type { ContainerClient } from "@azure/storage-blob";

import {
  buildFreshdeskArticlesIndex,
  createReadableStreamFromBuffer,
  FRESHDESK_ARTICLES_INDEX_BLOB_PATH,
  FRESHDESK_ARTICLES_INDEX_CACHE_CONTROL,
  FRESHDESK_ARTICLES_INDEX_CONTENT_TYPE,
  loadFreshdeskArticlesIndex,
  saveFreshdeskArticlesIndex,
  serializeFreshdeskArticlesIndex,
  toSafeIndexStorageErrorMessage,
} from "./freshdesk-index-store.js";

import type {
  FreshdeskSyncResult,
  SyncedFreshdeskArticle,
} from "./freshdesk-sync-service.js";

const CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=secret;AccountKey=super-secret-key;EndpointSuffix=core.windows.net";

function createSyncedArticle(
  overrides: Partial<SyncedFreshdeskArticle> = {},
): SyncedFreshdeskArticle {
  return {
    id: "freshdesk-101",
    source: "freshdesk",
    freshdeskArticleId: 101,
    categoryId: 157000561739,
    folderId: 200,
    folderName: "General",
    title: "Getting started",
    bodyText: "Body text",
    images: [],
    updatedAt: "2026-07-01T00:00:00Z",
    enabled: true,
    syncedImages: [],
    ...overrides,
  };
}

function createSyncResult(
  overrides: Partial<FreshdeskSyncResult> = {},
): FreshdeskSyncResult {
  return {
    articles: [createSyncedArticle()],
    failures: [
      {
        freshdeskArticleId: 202,
        folderId: 200,
        message: "Freshdesk article sync failed.",
      },
    ],
    ...overrides,
  };
}

type StoredBlob = {
  body: Buffer;
  contentType?: string;
  cacheControl?: string;
};

function createMockContainer(initialBlobs = new Map<string, StoredBlob>()) {
  const blobs = new Map(initialBlobs);

  const container = {
    getBlockBlobClient: (blobName: string) => ({
      exists: async () => blobs.has(blobName),
      uploadData: async (
        buffer: Buffer,
        options: {
          blobHTTPHeaders?: {
            blobContentType?: string;
            blobCacheControl?: string;
          };
        },
      ) => {
        blobs.set(blobName, {
          body: buffer,
          contentType: options.blobHTTPHeaders?.blobContentType,
          cacheControl: options.blobHTTPHeaders?.blobCacheControl,
        });
      },
      download: async () => {
        const blob = blobs.get(blobName);
        if (!blob) {
          throw new Error(`Blob not found: ${blobName}`);
        }

        return {
          readableStreamBody: createReadableStreamFromBuffer(blob.body),
        };
      },
    }),
  } as unknown as ContainerClient;

  return { container, blobs };
}

test("saveFreshdeskArticlesIndex writes to the correct blob path", async () => {
  const { container, blobs } = createMockContainer();
  const generatedAt = new Date("2026-07-14T12:00:00.000Z");

  await saveFreshdeskArticlesIndex(container, createSyncResult(), {
    generatedAt,
  });

  assert.equal(blobs.has(FRESHDESK_ARTICLES_INDEX_BLOB_PATH), true);
  assert.equal(blobs.size, 1);
});

test("saveFreshdeskArticlesIndex stores the correct JSON structure", async () => {
  const { container, blobs } = createMockContainer();
  const syncResult = createSyncResult();
  const generatedAt = new Date("2026-07-14T12:00:00.000Z");

  const saved = await saveFreshdeskArticlesIndex(container, syncResult, {
    generatedAt,
  });

  const stored = blobs.get(FRESHDESK_ARTICLES_INDEX_BLOB_PATH);
  assert.ok(stored);

  const parsed = JSON.parse(stored.body.toString("utf8"));
  assert.equal(parsed.generatedAt, generatedAt.toISOString());
  assert.equal(parsed.articleCount, 1);
  assert.equal(parsed.failureCount, 1);
  assert.deepEqual(parsed.articles, syncResult.articles);
  assert.deepEqual(parsed.failures, syncResult.failures);
  assert.deepEqual(saved, parsed);
});

test("serializeFreshdeskArticlesIndex uses deterministic formatting", () => {
  const index = buildFreshdeskArticlesIndex(
    createSyncResult(),
    new Date("2026-07-14T12:00:00.000Z"),
  );

  const first = serializeFreshdeskArticlesIndex(index);
  const second = serializeFreshdeskArticlesIndex(index);

  assert.equal(first, second);
  assert.match(first, /^\{\n  "generatedAt": "/);
  assert.match(first, /\n  "articleCount": 1,/);
  assert.match(first, /\n  "failureCount": 1,/);
});

test("saveFreshdeskArticlesIndex sets upload headers", async () => {
  const { container, blobs } = createMockContainer();

  await saveFreshdeskArticlesIndex(container, createSyncResult());

  const stored = blobs.get(FRESHDESK_ARTICLES_INDEX_BLOB_PATH);
  assert.equal(stored?.contentType, FRESHDESK_ARTICLES_INDEX_CONTENT_TYPE);
  assert.equal(stored?.cacheControl, FRESHDESK_ARTICLES_INDEX_CACHE_CONTROL);
});

test("loadFreshdeskArticlesIndex loads an existing index", async () => {
  const syncResult = createSyncResult({
    articles: [
      createSyncedArticle({ id: "freshdesk-303", freshdeskArticleId: 303 }),
    ],
    failures: [],
  });
  const index = buildFreshdeskArticlesIndex(
    syncResult,
    new Date("2026-07-14T13:00:00.000Z"),
  );
  const body = Buffer.from(serializeFreshdeskArticlesIndex(index), "utf8");

  const { container } = createMockContainer(
    new Map([[FRESHDESK_ARTICLES_INDEX_BLOB_PATH, { body }]]),
  );

  const loaded = await loadFreshdeskArticlesIndex(container);

  assert.deepEqual(loaded, index);
});

test("loadFreshdeskArticlesIndex returns null when the blob is missing", async () => {
  const { container } = createMockContainer();

  const loaded = await loadFreshdeskArticlesIndex(container);

  assert.equal(loaded, null);
});

test("loadFreshdeskArticlesIndex throws a safe error for malformed JSON", async () => {
  const body = Buffer.from("{ not valid json", "utf8");
  const { container } = createMockContainer(
    new Map([[FRESHDESK_ARTICLES_INDEX_BLOB_PATH, { body }]]),
  );

  await assert.rejects(
    () => loadFreshdeskArticlesIndex(container),
    /Freshdesk articles index JSON is malformed/,
  );
});

test("loadFreshdeskArticlesIndex storage errors do not expose secrets", async () => {
  const container = {
    getBlockBlobClient: () => ({
      exists: async () => {
        throw new Error(`Download failed with ${CONNECTION_STRING}`);
      },
      uploadData: async () => {},
      download: async () => ({
        readableStreamBody: createReadableStreamFromBuffer(Buffer.from("{}")),
      }),
    }),
  } as unknown as ContainerClient;

  try {
    await loadFreshdeskArticlesIndex(container);
    assert.fail("Expected loadFreshdeskArticlesIndex to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    assert.equal(
      message,
      "Freshdesk articles index storage operation failed.",
    );
    assert.equal(message.includes(CONNECTION_STRING), false);
    assert.equal(message.includes("AccountKey="), false);
  }
});

test("buildFreshdeskArticlesIndex sets article and failure counts correctly", () => {
  const syncResult = createSyncResult({
    articles: [
      createSyncedArticle({ id: "freshdesk-1", freshdeskArticleId: 1 }),
      createSyncedArticle({ id: "freshdesk-2", freshdeskArticleId: 2 }),
    ],
    failures: [
      {
        freshdeskArticleId: 3,
        folderId: 200,
        message: "Freshdesk article sync failed.",
      },
      {
        freshdeskArticleId: 4,
        folderId: 201,
        message: "Freshdesk image download failed with status 404.",
      },
    ],
  });

  const index = buildFreshdeskArticlesIndex(
    syncResult,
    new Date("2026-07-14T14:00:00.000Z"),
  );

  assert.equal(index.articleCount, 2);
  assert.equal(index.failureCount, 2);
  assert.equal(index.articles.length, 2);
  assert.equal(index.failures.length, 2);
});

test("toSafeIndexStorageErrorMessage redacts SAS tokens and authorization values", () => {
  assert.equal(
    toSafeIndexStorageErrorMessage(
      new Error("https://account.blob.core.windows.net/c?sv=2021&sig=abc123"),
    ),
    "Freshdesk articles index storage operation failed.",
  );
  assert.equal(
    toSafeIndexStorageErrorMessage(
      new Error("Authorization: Basic dXNlcjpwYXNzd29yZA=="),
    ),
    "Freshdesk articles index storage operation failed.",
  );
});
