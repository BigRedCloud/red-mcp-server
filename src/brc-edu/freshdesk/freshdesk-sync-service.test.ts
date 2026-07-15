import assert from "node:assert/strict";
import test from "node:test";

import type { ContainerClient } from "@azure/storage-blob";

import {
  FRESHDESK_EXCLUDED_FOLDER_IDS,
  FRESHDESK_SYNC_CATEGORY_ID,
  syncFreshdeskKnowledgeBase,
  toSafeSyncErrorMessage,
  type FreshdeskSyncClient,
} from "./freshdesk-sync-service.js";

import type { SyncedFreshdeskImage } from "./image-sync.js";

import type {
  FreshdeskArticle,
  FreshdeskFolder,
} from "./types.js";

const API_KEY = "super-secret-freshdesk-api-key";
const CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=secret;AccountKey=super-secret-key;EndpointSuffix=core.windows.net";

const MOCK_CONTAINER = {} as ContainerClient;

function createFolder(
  overrides: Partial<FreshdeskFolder> = {},
): FreshdeskFolder {
  return {
    id: 100,
    name: "General",
    description: null,
    articles_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    visibility: 1,
    ...overrides,
  };
}

function createArticle(
  overrides: Partial<FreshdeskArticle> = {},
): FreshdeskArticle {
  return {
    id: 1001,
    type: 1,
    status: 2,
    category_id: FRESHDESK_SYNC_CATEGORY_ID,
    folder_id: 100,
    title: "Published article",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    description: '<img src="https://cdn.freshdesk.com/a.png" alt="Guide" />',
    description_text: "Published body text",
    ...overrides,
  };
}

type MockClientOptions = {
  folders?: FreshdeskFolder[];
  articlesByFolder?: Map<number, FreshdeskArticle[]>;
  fullArticles?: Map<number, FreshdeskArticle>;
  getArticleErrors?: Map<number, Error>;
};

function createMockClient(options: MockClientOptions): FreshdeskSyncClient {
  return {
    getFolders: async (categoryId) => {
      assert.equal(categoryId, FRESHDESK_SYNC_CATEGORY_ID);
      return options.folders ?? [];
    },
    getArticles: async (folderId) =>
      options.articlesByFolder?.get(folderId) ?? [],
    getArticle: async (articleId) => {
      const error = options.getArticleErrors?.get(articleId);
      if (error) {
        throw error;
      }

      const article = options.fullArticles?.get(articleId);
      if (!article) {
        throw new Error(`Article ${articleId} not found`);
      }

      return article;
    },
  };
}

function createMockSyncImages(
  handler?: (
    articleId: number,
    images: { sourceUrl: string }[],
  ) => SyncedFreshdeskImage[],
) {
  return async (
    articleId: number,
    images: { sourceUrl: string }[],
    _container: ContainerClient,
  ): Promise<SyncedFreshdeskImage[]> => {
    if (handler) {
      return handler(articleId, images);
    }

    return images.map((image, index) => ({
      sourceUrl: image.sourceUrl,
      blobName: `freshdesk/${articleId}/mock-${index}.png`,
      sha256: `mock-sha-${articleId}-${index}`,
      contentType: "image/png",
    }));
  };
}

test("syncFreshdeskKnowledgeBase includes visible folders", async () => {
  const visibleFolder = createFolder({ id: 200, name: "Visible" });
  const article = createArticle({
    id: 2001,
    folder_id: 200,
  });

  const client = createMockClient({
    folders: [visibleFolder],
    articlesByFolder: new Map([[200, [article]]]),
    fullArticles: new Map([[2001, article]]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.folderId, 200);
  assert.equal(result.articles[0]?.folderName, "Visible");
  assert.deepEqual(result.failures, []);
});

test("syncFreshdeskKnowledgeBase excludes internal and hidden folders", async () => {
  const excludedInternalId = [...FRESHDESK_EXCLUDED_FOLDER_IDS][0]!;
  const folders = [
    createFolder({
      id: excludedInternalId,
      name: "Internal excluded",
      visibility: 1,
    }),
    createFolder({
      id: 300,
      name: "Hidden folder",
      visibility: 2,
    }),
    createFolder({
      id: 301,
      name: "Visible folder",
      visibility: 1,
    }),
  ];

  const visibleArticle = createArticle({
    id: 3001,
    folder_id: 301,
  });

  const client = createMockClient({
    folders,
    articlesByFolder: new Map([
      [excludedInternalId, [createArticle({ id: 9001, folder_id: excludedInternalId })]],
      [300, [createArticle({ id: 9002, folder_id: 300 })]],
      [301, [visibleArticle]],
    ]),
    fullArticles: new Map([[3001, visibleArticle]]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.freshdeskArticleId, 3001);
  assert.equal(result.articles[0]?.folderId, 301);
});

test("syncFreshdeskKnowledgeBase stores canonical Freshdesk publicUrl from API slug", async () => {
  const folder = createFolder({ id: 301, name: "Cash Book" });
  const visibleArticle = createArticle({
    id: 3001,
    folder_id: 301,
    slug: "how-do-i-do-the-bank-reconciliation-bank-rec-",
  });

  const client = createMockClient({
    folders: [folder],
    articlesByFolder: new Map([[301, [visibleArticle]]]),
    fullArticles: new Map([[3001, visibleArticle]]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(
    result.articles[0]?.publicUrl,
    "https://bigredcloud.freshdesk.com/support/solutions/articles/3001-how-do-i-do-the-bank-reconciliation-bank-rec-",
  );
});

test("syncFreshdeskKnowledgeBase excludes unpublished articles", async () => {
  const folder = createFolder({ id: 400, name: "FAQ" });
  const published = createArticle({
    id: 4001,
    folder_id: 400,
    status: 2,
    title: "Published",
  });
  const draft = createArticle({
    id: 4002,
    folder_id: 400,
    status: 1,
    title: "Draft",
  });

  const client = createMockClient({
    folders: [folder],
    articlesByFolder: new Map([[400, [published, draft]]]),
    fullArticles: new Map([[4001, published]]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.freshdeskArticleId, 4001);
  assert.equal(result.articles[0]?.title, "Published");
});

test("syncFreshdeskKnowledgeBase syncs multiple folders and articles", async () => {
  const folderA = createFolder({ id: 501, name: "Folder A" });
  const folderB = createFolder({ id: 502, name: "Folder B" });
  const articleA1 = createArticle({
    id: 5101,
    folder_id: 501,
    title: "Article A1",
  });
  const articleA2 = createArticle({
    id: 5102,
    folder_id: 501,
    title: "Article A2",
  });
  const articleB1 = createArticle({
    id: 5201,
    folder_id: 502,
    title: "Article B1",
  });

  const client = createMockClient({
    folders: [folderA, folderB],
    articlesByFolder: new Map([
      [501, [articleA1, articleA2]],
      [502, [articleB1]],
    ]),
    fullArticles: new Map([
      [5101, articleA1],
      [5102, articleA2],
      [5201, articleB1],
    ]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(result.articles.length, 3);
  assert.deepEqual(
    result.articles.map((article) => article.title).sort(),
    ["Article A1", "Article A2", "Article B1"],
  );
  assert.deepEqual(result.failures, []);
});

test("syncFreshdeskKnowledgeBase returns empty results for an empty category", async () => {
  const client = createMockClient({ folders: [] });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.deepEqual(result.articles, []);
  assert.deepEqual(result.failures, []);
});

test("syncFreshdeskKnowledgeBase attaches synced image metadata", async () => {
  const folder = createFolder({ id: 600, name: "With images" });
  const article = createArticle({
    id: 6001,
    folder_id: 600,
    description:
      '<img src="https://cdn.freshdesk.com/one.png" alt="One" />' +
      '<img src="https://cdn.freshdesk.com/two.png" alt="Two" />',
  });

  const client = createMockClient({
    folders: [folder],
    articlesByFolder: new Map([[600, [article]]]),
    fullArticles: new Map([[6001, article]]),
  });

  const syncedImages: SyncedFreshdeskImage[] = [
    {
      sourceUrl: "https://cdn.freshdesk.com/one.png",
      blobName: "freshdesk/6001/abc123.png",
      sha256: "abc123",
      contentType: "image/png",
    },
    {
      sourceUrl: "https://cdn.freshdesk.com/two.png",
      blobName: "freshdesk/6001/def456.png",
      sha256: "def456",
      contentType: "image/png",
    },
  ];

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: async (_articleId, _images, _container) => syncedImages,
  });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.images.length, 2);
  assert.deepEqual(result.articles[0]?.syncedImages, syncedImages);
});

test("syncFreshdeskKnowledgeBase continues when one article fails", async () => {
  const folder = createFolder({ id: 700, name: "Mixed results" });
  const goodArticle = createArticle({
    id: 7001,
    folder_id: 700,
    title: "Good article",
  });
  const badSummary = createArticle({
    id: 7002,
    folder_id: 700,
    title: "Bad article",
    status: 2,
  });

  const client = createMockClient({
    folders: [folder],
    articlesByFolder: new Map([[700, [goodArticle, badSummary]]]),
    fullArticles: new Map([[7001, goodArticle]]),
    getArticleErrors: new Map([
      [
        7002,
        new Error(
          `Freshdesk request failed with Authorization: Basic ${Buffer.from(`${API_KEY}:X`, "utf8").toString("base64")}`,
        ),
      ],
    ]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0]?.freshdeskArticleId, 7001);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.freshdeskArticleId, 7002);
  assert.equal(result.failures[0]?.folderId, 700);
  assert.equal(
    result.failures[0]?.message,
    "Freshdesk article sync failed.",
  );
});

test("toSafeSyncErrorMessage removes API keys and Azure connection strings", () => {
  const encodedAuth = Buffer.from(`${API_KEY}:X`, "utf8").toString("base64");

  assert.equal(
    toSafeSyncErrorMessage(
      new Error(`Authorization: Basic ${encodedAuth}`),
    ),
    "Freshdesk article sync failed.",
  );
  assert.equal(
    toSafeSyncErrorMessage(new Error(`Upload failed: ${CONNECTION_STRING}`)),
    "Freshdesk article sync failed.",
  );
  assert.equal(
    toSafeSyncErrorMessage(new Error("Freshdesk image download failed with status 404.")),
    "Freshdesk image download failed with status 404.",
  );
});

test("syncFreshdeskKnowledgeBase failure messages never include secret values", async () => {
  const folder = createFolder({ id: 800, name: "Secrets" });
  const failingArticle = createArticle({
    id: 8001,
    folder_id: 800,
  });

  const client = createMockClient({
    folders: [folder],
    articlesByFolder: new Map([[800, [failingArticle]]]),
    getArticleErrors: new Map([
      [8001, new Error(`Failed with key ${API_KEY} and ${CONNECTION_STRING}`)],
    ]),
  });

  const result = await syncFreshdeskKnowledgeBase(client, MOCK_CONTAINER, {
    syncImages: createMockSyncImages(),
  });

  assert.equal(result.articles.length, 0);
  assert.equal(result.failures.length, 1);

  const serialized = JSON.stringify(result.failures);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(CONNECTION_STRING), false);
  assert.equal(serialized.includes("AccountKey="), false);
  assert.equal(result.failures[0]?.message, "Freshdesk article sync failed.");
});
