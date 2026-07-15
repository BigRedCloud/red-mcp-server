import assert from "node:assert/strict";
import test from "node:test";

import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";
import {
  getHelpResourceDetails,
  loadFreshdeskImageBlocks,
} from "./help-resource-details.js";

function freshdeskArticle(): SyncedFreshdeskArticle {
  return {
    id: "freshdesk-1001",
    source: "freshdesk",
    freshdeskArticleId: 1001,
    categoryId: 1,
    folderId: 2,
    folderName: "Cash Book",
    title: "Complete a bank reconciliation",
    bodyText: "Step one. Step two.",
    images: [],
    syncedImages: [
      {
        sourceUrl: "https://cdn.freshdesk.com/a.png",
        blobName: "freshdesk/1001/a.png",
        sha256: "a",
        contentType: "image/png",
      },
      {
        sourceUrl: "https://cdn.freshdesk.com/b.png",
        blobName: "freshdesk/1001/b.png",
        sha256: "b",
        contentType: "image/png",
      },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
  };
}

test("loadFreshdeskImageBlocks returns ordered supported image blocks with limits", async () => {
  const png = Buffer.from("fake-image-bytes");

  const container = {
    getBlockBlobClient(blobName: string) {
      return {
        async exists() {
          return blobName.startsWith("freshdesk/1001/");
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

  const blocks = await loadFreshdeskImageBlocks(freshdeskArticle(), container as never, {
    maxImages: 1,
    maxImageBytes: png.byteLength,
    maxTotalBytes: png.byteLength,
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.mimeType, "image/png");
  assert.match(blocks[0]?.data ?? "", /^[A-Za-z0-9+/=]+$/);
});

test("loadFreshdeskImageBlocks skips missing images safely", async () => {
  const container = {
    getBlockBlobClient() {
      return {
        async exists() {
          return false;
        },
        async download() {
          throw new Error("should not download");
        },
      };
    },
  };

  const blocks = await loadFreshdeskImageBlocks(freshdeskArticle(), container as never);
  assert.deepEqual(blocks, []);
});

test("getHelpResourceDetails returns Freshdesk instructions without storage URLs", async () => {
  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [freshdeskArticle()],
    failures: [],
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
              yield Buffer.from(JSON.stringify(index), "utf8");
            })(),
          };
        },
      };
    },
  };

  const imageContainer = {
    getBlockBlobClient() {
      return {
        async exists() {
          return false;
        },
      };
    },
  };

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: indexContainer as never,
    freshdeskImageContainer: imageContainer as never,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.payload.instructions, /Step one/i);
    assert.equal(result.payload.publicUrl, null);
    assert.equal(JSON.stringify(result.payload).includes("AccountKey="), false);
  }
});

test("getHelpResourceDetails rejects invalid resource IDs safely", async () => {
  const result = await getHelpResourceDetails("not-a-valid-id");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /invalid/i);
  }
});
