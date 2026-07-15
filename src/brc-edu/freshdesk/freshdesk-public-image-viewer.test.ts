import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFreshdeskPublicImageViewerHtml,
  prefersFreshdeskPublicImageViewer,
} from "./freshdesk-public-image-viewer.js";
import {
  createFreshdeskPublicImageToken,
} from "./freshdesk-public-image-token.js";
import {
  handleFreshdeskPublicImageRequest,
} from "./freshdesk-public-image-route.js";
import type { SyncedFreshdeskArticle } from "./freshdesk-sync-service.js";

const ARTICLE_ID = "1001";
const IMAGE_KEY = "c".repeat(64);
const SECRET = "viewer-test-secret";

test("prefersFreshdeskPublicImageViewer detects browser navigation", () => {
  assert.equal(
    prefersFreshdeskPublicImageViewer({
      headers: { "sec-fetch-dest": "document", accept: "text/html" },
    } as never),
    true,
  );
  assert.equal(
    prefersFreshdeskPublicImageViewer({
      headers: { "sec-fetch-dest": "image", accept: "image/avif,image/*" },
    } as never),
    false,
  );
  assert.equal(
    prefersFreshdeskPublicImageViewer({
      headers: { accept: "*/*" },
    } as never),
    false,
  );
});

test("buildFreshdeskPublicImageViewerHtml centres and scales the image", () => {
  const html = buildFreshdeskPublicImageViewerHtml({
    imageSrc: "/public/brc-edu/freshdesk-images/1001/token",
    caption: 'Add Customer <screen> & "steps"',
  });

  assert.match(html, /display:\s*flex/);
  assert.match(html, /align-items:\s*center/);
  assert.match(html, /justify-content:\s*center/);
  assert.match(html, /width:\s*min\(95vw,\s*1400px\)/);
  assert.match(html, /Add Customer &lt;screen&gt; &amp; &quot;steps&quot;/);
  assert.match(
    html,
    /src="\/public\/brc-edu\/freshdesk-images\/1001\/token"/,
  );
});

test("browser navigation receives HTML viewer while image clients receive bytes", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  const png = Buffer.from("fake-png-bytes");
  const article: SyncedFreshdeskArticle = {
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

  const indexContainer = {
    getBlockBlobClient() {
      return {
        async exists() {
          return true;
        },
        async download() {
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(
                JSON.stringify({
                  generatedAt: "2026-07-15T10:00:00.000Z",
                  articleCount: 1,
                  failureCount: 0,
                  articles: [article],
                  failures: [],
                }),
                "utf8",
              );
            })(),
          };
        },
      };
    },
  };

  const imageContainer = {
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

  const viewerResponse = {
    headers: new Map<string, string | number>(),
    statusCode: 200,
    body: undefined as string | Buffer | undefined,
    setHeader(name: string, value: string | number) {
      this.headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(value: string | Buffer) {
      this.body = value;
    },
  };

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
      headers: { "sec-fetch-dest": "document", accept: "text/html" },
      originalUrl: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
      url: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
    } as never,
    viewerResponse as never,
    {
      freshdeskIndexContainer: indexContainer as never,
      freshdeskImageContainer: imageContainer as never,
    },
  );

  assert.equal(viewerResponse.statusCode, 200);
  assert.equal(viewerResponse.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(String(viewerResponse.body ?? ""), /Add Customer screen/);
  assert.match(String(viewerResponse.body ?? ""), /width:\s*min\(95vw,\s*1400px\)/);

  const imageResponse = {
    headers: new Map<string, string | number>(),
    statusCode: 200,
    body: undefined as string | Buffer | undefined,
    setHeader(name: string, value: string | number) {
      this.headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(value: string | Buffer) {
      this.body = value;
    },
  };

  await handleFreshdeskPublicImageRequest(
    {
      method: "GET",
      params: { articleId: ARTICLE_ID, imageToken: token },
      headers: { "sec-fetch-dest": "image", accept: "image/avif,image/*" },
      originalUrl: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
      url: `/public/brc-edu/freshdesk-images/${ARTICLE_ID}/${token}`,
    } as never,
    imageResponse as never,
    {
      freshdeskIndexContainer: indexContainer as never,
      freshdeskImageContainer: imageContainer as never,
    },
  );

  assert.equal(imageResponse.statusCode, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.equal(Buffer.isBuffer(imageResponse.body) ? imageResponse.body.equals(png) : false, true);
});
