import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  createFreshdeskPublicImageToken,
} from "./freshdesk-public-image-token.js";
import {
  FRESHDESK_PUBLIC_IMAGE_ROUTE,
  handleFreshdeskPublicImageRequest,
} from "./freshdesk-public-image-route.js";
import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";

const ARTICLE_ID = "1001";
const IMAGE_KEY = "c".repeat(64);
const SECRET = "route-test-secret";

function tokenOptions(expiresInSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return {
    now,
    expiresAt: now + expiresInSeconds,
  };
}

function freshdeskArticle(): SyncedFreshdeskArticle {
  return {
    id: "freshdesk-1001",
    source: "freshdesk",
    freshdeskArticleId: 1001,
    categoryId: 1,
    folderId: 2,
    folderName: "Sales",
    title: "Add a customer",
    bodyText: "Steps",
    images: [],
    syncedImages: [
      {
        sourceUrl: "https://cdn.freshdesk.com/a.png",
        blobName: "freshdesk/1001/a.png",
        sha256: IMAGE_KEY,
        contentType: "image/png",
        altText: "Add Customer screen",
        order: 0,
      },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: null,
    publicUrl: null,
  };
}

function createMockResponse() {
  const headers = new Map<string, string | number>();
  let statusCode = 200;
  let body: Buffer | string | undefined;

  return {
    headers,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    end(value?: Buffer | string) {
      body = value;
    },
    send(value: Buffer | string) {
      body = value;
    },
  };
}

function createIndexContainer(article: SyncedFreshdeskArticle) {
  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [article],
    failures: [],
  };

  return {
    getBlockBlobClient() {
      return {
        async exists() {
          return true;
        },
        async download() {
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(JSON.stringify(index), "utf8");
            })(),
          };
        },
      };
    },
  };
}

function createImageContainer(png: Buffer) {
  return {
    getBlockBlobClient(blobName: string) {
      return {
        async exists() {
          return blobName === "freshdesk/1001/a.png";
        },
        async download() {
          return {
            readableStreamBody: (async function* () {
              yield png;
            })(),
          };
        },
      };
    },
  };
}

test("public image endpoint crops large black canvas before streaming", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, tokenOptions());

  const screenshot = await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: { r: 230, g: 235, b: 245 },
    },
  })
    .png()
    .toBuffer();

  const source = await sharp({
    create: {
      width: 900,
      height: 700,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{ input: screenshot, left: 20, top: 16 }])
    .png()
    .toBuffer();

  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: createImageContainer(source) as never,
    },
  );

  assert.equal(res.statusCode, 200);
  assert.ok(Buffer.isBuffer(res.body));
  const metadata = await sharp(res.body as Buffer).metadata();
  assert.ok((metadata.width ?? 0) < 900);
  assert.ok((metadata.height ?? 0) < 700);
});

test("valid token streams the expected image with inline headers", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, tokenOptions());

  const png = Buffer.from("fake-png-bytes");
  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: createImageContainer(png) as never,
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("content-disposition"), "inline");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.isBuffer(res.body) ? res.body.equals(png) : false, true);
});

test("HEAD returns headers without body", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, tokenOptions());

  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "HEAD",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: createImageContainer(Buffer.from("png")) as never,
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, undefined);
});

test("missing blob returns safe 404 without Azure details", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, tokenOptions());

  const res = createMockResponse();
  const emptyImageContainer = {
    getBlockBlobClient() {
      return {
        async exists() {
          return false;
        },
        async download() {
          throw new Error("Should not download missing blob");
        },
      };
    },
  };

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: emptyImageContainer as never,
    },
  );

  assert.equal(res.statusCode, 404);
  assert.equal(String(res.body ?? ""), "");
});

test("expired token is rejected with 404", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const now = Math.floor(Date.now() / 1000);
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: now - 7200,
    expiresAt: now - 3600,
  });

  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: createImageContainer(Buffer.from("png")) as never,
    },
  );

  assert.equal(res.statusCode, 404);
});

test("tampered token is rejected with 404", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const token = `${createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, tokenOptions())}x`;

  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: createImageContainer(Buffer.from("png")) as never,
    },
  );

  assert.equal(res.statusCode, 404);
});

test("unsupported MIME type is rejected", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const badArticle = freshdeskArticle();
  badArticle.syncedImages = [
    {
      sourceUrl: "https://cdn.freshdesk.com/a.svg",
      blobName: "freshdesk/1001/a.svg",
      sha256: IMAGE_KEY,
      contentType: "image/svg+xml",
      order: 0,
    },
  ];

  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, tokenOptions());

  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(badArticle) as never,
      freshdeskImageContainer: createImageContainer(Buffer.from("svg")) as never,
    },
  );

  assert.equal(res.statusCode, 404);
});

test("arbitrary blob access is impossible without article-bound token", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const otherKey = "d".repeat(64);
  const token = createFreshdeskPublicImageToken("9999", otherKey, tokenOptions());

  const res = createMockResponse();

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
    } as never,
    res as never,
    {
      freshdeskIndexContainer: createIndexContainer(freshdeskArticle()) as never,
      freshdeskImageContainer: createImageContainer(Buffer.from("png")) as never,
    },
  );

  assert.equal(res.statusCode, 404);
});

test("route path is customer-safe", () => {
  assert.equal(
    FRESHDESK_PUBLIC_IMAGE_ROUTE,
    "/public/brc-edu/freshdesk-images/:articleId/:imageToken",
  );
});

test("accepted PNG JPEG WebP GIF content types are served", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;

  for (const [mimeType, blobName, imageKey] of [
    ["image/png", "freshdesk/1001/a.png", "0000000000000000000000000000000000000000000000000000000000000001"],
    ["image/jpeg", "freshdesk/1001/a.jpg", "0000000000000000000000000000000000000000000000000000000000000002"],
    ["image/webp", "freshdesk/1001/a.webp", "0000000000000000000000000000000000000000000000000000000000000003"],
    ["image/gif", "freshdesk/1001/a.gif", "0000000000000000000000000000000000000000000000000000000000000004"],
  ] as const) {
    const article = freshdeskArticle();
    article.syncedImages = [
      {
        sourceUrl: "https://cdn.freshdesk.com/a.png",
        blobName,
        sha256: imageKey,
        contentType: mimeType,
        order: 0,
      },
    ];

    const token = createFreshdeskPublicImageToken(ARTICLE_ID, imageKey, tokenOptions());

    const imageContainer = {
      getBlockBlobClient(name: string) {
        return {
          async exists() {
            return name === blobName;
          },
          async download() {
            return {
              readableStreamBody: (async function* () {
                yield Buffer.from("bytes");
              })(),
            };
          },
        };
      },
    };

    const res = createMockResponse();
    await handleFreshdeskPublicImageRequest(
      {
        method: "GET",
        params: { articleId: ARTICLE_ID, imageToken: token },
      } as never,
      res as never,
      {
        freshdeskIndexContainer: createIndexContainer(article) as never,
        freshdeskImageContainer: imageContainer as never,
      },
    );

    assert.equal(res.statusCode, 200, mimeType);
    assert.equal(res.headers.get("content-type"), mimeType, mimeType);
  }
});
