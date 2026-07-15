import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ContainerClient } from "@azure/storage-blob";

import { syncFreshdeskImages } from "./image-sync.js";

import type { FreshdeskImageReference } from "./types.js";

const ARTICLE_ID = 123;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SECRET_CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=secret;AccountKey=super-secret-key;EndpointSuffix=core.windows.net";

type UploadRecord = {
  blobName: string;
  buffer: Buffer;
  options: {
    blobHTTPHeaders?: {
      blobContentType?: string;
      blobCacheControl?: string;
    };
    metadata?: Record<string, string>;
  };
};

type MockContainerOptions = {
  existingBlobs?: Set<string>;
  fetchHandler?: (url: string) => Response | Promise<Response>;
  uploadError?: Error;
};

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function createImageResponse(
  buffer: Buffer,
  contentType: string,
  status = 200,
): Response {
  return new Response(new Uint8Array(buffer), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function createMockContainer(options: MockContainerOptions = {}) {
  const existing = new Set(options.existingBlobs ?? []);
  const uploads: UploadRecord[] = [];
  const existsChecks: string[] = [];

  const container = {
    createIfNotExists: async () => {},
    getBlockBlobClient: (blobName: string) => ({
      exists: async () => {
        existsChecks.push(blobName);
        return existing.has(blobName);
      },
      uploadData: async (
        buffer: Buffer,
        uploadOptions: UploadRecord["options"],
      ) => {
        if (options.uploadError) {
          throw options.uploadError;
        }

        uploads.push({ blobName, buffer, options: uploadOptions });
        existing.add(blobName);
      },
    }),
  } as unknown as ContainerClient;

  return { container, uploads, existing, existsChecks };
}

async function withMockFetch<T>(
  handler: (url: string) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => handler(String(input));

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function imageRef(sourceUrl: string): FreshdeskImageReference {
  return { sourceUrl, altText: null };
}

test("syncFreshdeskImages rejects non-HTTPS URLs", async () => {
  const { container } = createMockContainer();

  await assert.rejects(
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("http://cdn.freshdesk.com/image.png")],
        container,
      ),
    /Freshdesk image URL must use HTTPS/,
  );
});

test("syncFreshdeskImages rejects unexpected hosts", async () => {
  const { container } = createMockContainer();

  await assert.rejects(
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("https://evil.example.com/image.png")],
        container,
      ),
    /Freshdesk image host is not allowed: evil.example.com/,
  );
});

test("syncFreshdeskImages rejects unsupported content types", async () => {
  const buffer = Buffer.from("not-an-image");
  const { container } = createMockContainer();

  await withMockFetch(
    () => createImageResponse(buffer, "text/plain"),
    async () => {
      await assert.rejects(
        () =>
          syncFreshdeskImages(
            ARTICLE_ID,
            [imageRef("https://cdn.freshdesk.com/file.bin")],
            container,
          ),
        /Unsupported Freshdesk image type: text\/plain/,
      );
    },
  );
});

test("syncFreshdeskImages rejects images over the configured size limit", async () => {
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1);
  const { container } = createMockContainer();

  await withMockFetch(
    () => createImageResponse(oversized, "image/png"),
    async () => {
      await assert.rejects(
        () =>
          syncFreshdeskImages(
            ARTICLE_ID,
            [imageRef("https://cdn.freshdesk.com/huge.png")],
            container,
          ),
        new RegExp(`Freshdesk image exceeds ${MAX_IMAGE_BYTES} bytes`),
      );
    },
  );
});

test("syncFreshdeskImages calculates a stable SHA-256 hash", async () => {
  const buffer = Buffer.from("fake-png-bytes");
  const { container } = createMockContainer();

  const synced = await withMockFetch(
    () => createImageResponse(buffer, "image/png"),
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("https://cdn.freshdesk.com/stable.png")],
        container,
      ),
  );

  assert.equal(synced[0]?.sha256, sha256Hex(buffer));
});

test("syncFreshdeskImages creates blob names under freshdesk/{articleId}/{sha256}.{extension}", async () => {
  const buffer = Buffer.from("blob-path-test");
  const { container } = createMockContainer();

  const synced = await withMockFetch(
    () => createImageResponse(buffer, "image/png"),
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("https://cdn.freshdesk.com/path.png")],
        container,
      ),
  );

  const expectedBlobName = `freshdesk/${ARTICLE_ID}/${sha256Hex(buffer)}.png`;
  assert.equal(synced[0]?.blobName, expectedBlobName);
});

test("syncFreshdeskImages maps png, jpeg, gif and webp to correct extensions", async () => {
  const cases = [
    { contentType: "image/png", extension: ".png" },
    { contentType: "image/jpeg", extension: ".jpg" },
    { contentType: "image/gif", extension: ".gif" },
    { contentType: "image/webp", extension: ".webp" },
  ] as const;

  for (const { contentType, extension } of cases) {
    const buffer = Buffer.from(`bytes-for-${contentType}`);
    const { container } = createMockContainer();

    const synced = await withMockFetch(
      () => createImageResponse(buffer, contentType),
      () =>
        syncFreshdeskImages(
          ARTICLE_ID,
          [
            imageRef(
              `https://s3.amazonaws.com/freshdesk/${contentType.replace("/", "-")}`,
            ),
          ],
          container,
        ),
    );

    assert.equal(
      synced[0]?.blobName,
      `freshdesk/${ARTICLE_ID}/${sha256Hex(buffer)}${extension}`,
      contentType,
    );
  }
});

test("syncFreshdeskImages uploads when the blob does not exist", async () => {
  const buffer = Buffer.from("upload-me");
  const { container, uploads } = createMockContainer();

  await withMockFetch(
    () => createImageResponse(buffer, "image/png"),
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("https://cdn.freshdesk.com/new.png")],
        container,
      ),
  );

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.buffer.equals(buffer), true);
});

test("syncFreshdeskImages skips upload when the blob already exists", async () => {
  const buffer = Buffer.from("existing-blob");
  const blobName = `freshdesk/${ARTICLE_ID}/${sha256Hex(buffer)}.png`;
  const { container, uploads } = createMockContainer({
    existingBlobs: new Set([blobName]),
  });

  await withMockFetch(
    () => createImageResponse(buffer, "image/png"),
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("https://cdn.freshdesk.com/existing.png")],
        container,
      ),
  );

  assert.equal(uploads.length, 0);
});

test("syncFreshdeskImages sets content type, cache control and metadata", async () => {
  const buffer = Buffer.from("metadata-test");
  const { container, uploads } = createMockContainer();

  await withMockFetch(
    () => createImageResponse(buffer, "image/jpeg"),
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [imageRef("https://cdn.freshdesk.com/meta.jpg")],
        container,
      ),
  );

  const upload = uploads[0];
  assert.equal(upload?.options.blobHTTPHeaders?.blobContentType, "image/jpeg");
  assert.equal(
    upload?.options.blobHTTPHeaders?.blobCacheControl,
    "private, max-age=31536000, immutable",
  );
  assert.equal(upload?.options.metadata?.articleId, String(ARTICLE_ID));
  assert.equal(upload?.options.metadata?.sha256, sha256Hex(buffer));
});

test("syncFreshdeskImages returns the expected synced-image metadata", async () => {
  const buffer = Buffer.from("metadata-return");
  const sourceUrl = "https://cdn.freshdesk.com/return.png";
  const { container } = createMockContainer();

  const synced = await withMockFetch(
    () => createImageResponse(buffer, "image/png"),
    () =>
      syncFreshdeskImages(
        ARTICLE_ID,
        [{ sourceUrl, altText: "ignored by sync" }],
        container,
      ),
  );

  assert.deepEqual(synced, [
    {
      sourceUrl,
      blobName: `freshdesk/${ARTICLE_ID}/${sha256Hex(buffer)}.png`,
      sha256: sha256Hex(buffer),
      contentType: "image/png",
      order: 0,
      altText: "ignored by sync",
    },
  ]);
});

test("syncFreshdeskImages does not expose storage connection strings in errors", async () => {
  const buffer = Buffer.from("upload-failure");
  const { container } = createMockContainer({
    uploadError: new Error(
      `Upload failed for ${SECRET_CONNECTION_STRING}`,
    ),
  });

  await withMockFetch(
    () => createImageResponse(buffer, "image/png"),
    async () => {
      try {
        await syncFreshdeskImages(
          ARTICLE_ID,
          [imageRef("https://cdn.freshdesk.com/fail.png")],
          container,
        );
        assert.fail("Expected upload to fail");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        assert.match(message, /Freshdesk image upload failed/);
        assert.equal(message.includes(SECRET_CONNECTION_STRING), false);
        assert.equal(message.includes("AccountKey="), false);
      }
    },
  );
});

test("syncFreshdeskImages is idempotent for identical image bytes", async () => {
  const buffer = Buffer.from("idempotent-image");
  const sourceUrl = "https://cdn.freshdesk.com/idempotent.png";
  const { container, uploads } = createMockContainer();

  const fetchHandler = () => createImageResponse(buffer, "image/png");

  const first = await withMockFetch(fetchHandler, () =>
    syncFreshdeskImages(ARTICLE_ID, [imageRef(sourceUrl)], container),
  );
  const second = await withMockFetch(fetchHandler, () =>
    syncFreshdeskImages(ARTICLE_ID, [imageRef(sourceUrl)], container),
  );

  assert.equal(uploads.length, 1);
  assert.deepEqual(first, second);
  assert.equal(first[0]?.blobName, second[0]?.blobName);
});

test("syncFreshdeskImages uses a different hash and blob name when image bytes change", async () => {
  const firstBuffer = Buffer.from("version-one");
  const secondBuffer = Buffer.from("version-two");
  const sourceUrl = "https://cdn.freshdesk.com/versioned.png";
  const { container, uploads } = createMockContainer();

  let fetchCount = 0;
  const fetchHandler = () => {
    fetchCount += 1;
    const buffer = fetchCount === 1 ? firstBuffer : secondBuffer;
    return createImageResponse(buffer, "image/png");
  };

  const first = await withMockFetch(fetchHandler, () =>
    syncFreshdeskImages(ARTICLE_ID, [imageRef(sourceUrl)], container),
  );
  const second = await withMockFetch(fetchHandler, () =>
    syncFreshdeskImages(ARTICLE_ID, [imageRef(sourceUrl)], container),
  );

  assert.equal(uploads.length, 2);
  assert.notEqual(first[0]?.sha256, second[0]?.sha256);
  assert.notEqual(first[0]?.blobName, second[0]?.blobName);
  assert.equal(first[0]?.blobName, `freshdesk/${ARTICLE_ID}/${sha256Hex(firstBuffer)}.png`);
  assert.equal(second[0]?.blobName, `freshdesk/${ARTICLE_ID}/${sha256Hex(secondBuffer)}.png`);
});
