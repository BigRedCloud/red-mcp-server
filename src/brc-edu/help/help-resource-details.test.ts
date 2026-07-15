import assert from "node:assert/strict";
import test from "node:test";

import {
  getHelpResourceDetails,
  helpResourceDetailResponse,
} from "./help-resource-details.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";

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
        altText: "Cash book screen",
        order: 0,
      },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: null,
    publicUrl: null,
  };
}

test("getHelpResourceDetails returns Freshdesk image blocks when blobs exist", async () => {
  const png = Buffer.from("fake-image-bytes");
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

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: indexContainer as never,
    freshdeskImageContainer: imageContainer as never,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.imageAvailable, true);
    assert.equal(result.payload.imageCount, 1);
    assert.equal(
      result.payload.publicUrl,
      "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation",
    );
    assert.equal(JSON.stringify(result.payload).includes("freshdesk/1001"), false);
    assert.equal(JSON.stringify(result.payload).includes("AccountKey="), false);
  }
});

test("helpResourceDetailResponse includes MCP image blocks and caption text", () => {
  const response = helpResourceDetailResponse(
    {
      resourceId: "freshdesk:1001",
      source: "freshdesk",
      title: "Test",
      summary: "Summary",
      instructions: "Instructions",
      publicUrl: "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-test",
      category: "Help",
      topics: ["Help"],
      imageCount: 1,
      responseGuidance: {
        supportFooter: "footer",
        doNotExpose: [],
      },
    },
    [
      {
        mimeType: "image/png",
        data: Buffer.from("x").toString("base64"),
        caption: "Screenshot 1: Cash book screen",
        order: 0,
      },
    ],
  );

  assert.equal(response.content.length, 3);
  assert.equal(response.content[0]?.type, "text");
  assert.equal(response.content[1]?.type, "text");
  assert.equal(response.content[2]?.type, "image");
});

test("getHelpResourceDetails rejects invalid resource IDs safely", async () => {
  const result = await getHelpResourceDetails("not-a-valid-id");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /invalid/i);
  }
});

test("customer docs do not attempt Azure image loading", async () => {
  const result = await getHelpResourceDetails("customer_docs:missing");
  assert.equal(result.ok, false);
});
