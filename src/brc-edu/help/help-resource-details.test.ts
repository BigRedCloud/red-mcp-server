import assert from "node:assert/strict";
import test from "node:test";

import {
  findFreshdeskArticleById,
  getHelpResourceDetails,
  helpResourceDetailResponse,
} from "./help-resource-details.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";
import {
  DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB,
  DEFAULT_BRC_FRESHDESK_OVERRIDES_BLOB,
  freshdeskArticleIdsMatch,
} from "../freshdesk/freshdesk-catalog-types.js";
import { FRESHDESK_ARTICLES_INDEX_BLOB_PATH } from "../freshdesk/freshdesk-index-store.js";

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
        sha256: "00000000000000000000000000000000000000000000000000000000000000ab",
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

test("getHelpResourceDetails defaults to links presentation without binary images", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

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
    assert.equal(result.payload.imagePresentation, "links");
    assert.equal(result.payload.imageAvailable, true);
    assert.equal(result.payload.imageCount, 1);
    assert.equal(result.payload.screenshotUrls?.length, 1);
    assert.equal(result.payload.screenshotUrls?.[0]?.caption, "Cash book screen");
    assert.equal(result.payload.screenshotUrls?.[0]?.linkLabel, "View image");
    assert.match(
      result.payload.screenshotUrls?.[0]?.url ?? "",
      /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//,
    );
    assert.equal(result.payload.screenshotLinksMarkdown?.length, 1);
    assert.match(
      result.payload.screenshotLinksMarkdown?.[0] ?? "",
      /^\[View image\]\(https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//,
    );
    assert.ok(result.payload.customerFacingScreenshotMarkdown?.includes("[View image]("));
    assert.equal(
      result.payload.customerFacingScreenshotMarkdown?.includes("Cash book screen"),
      false,
    );
    assert.equal(result.images.length, 0);
    assert.match(
      result.payload.responseGuidance.images ?? "",
      /Never label screenshot links Show Image/i,
    );
    assert.match(
      result.payload.responseGuidance.images ?? "",
      /exact signed Markdown links/i,
    );
    assert.equal(result.payload.instructionBlocks, undefined);
    assert.equal(
      result.payload.publicUrl,
      "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation",
    );
    assert.equal(JSON.stringify(result.payload).includes("freshdesk/1001"), false);
    assert.equal(JSON.stringify(result.payload).includes("AccountKey="), false);
    assert.equal(JSON.stringify(result.payload).includes("blob.core.windows.net"), false);
  }
});

test("getHelpResourceDetails returns ordered instructionBlocks with safe captions", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const article = freshdeskArticle();
  article.contentBlocks = [
    {
      type: "text",
      text: "Click Customers, then click Add.",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
      sectionHeading: "Add Customer",
    },
    {
      type: "image",
      imageIndex: 0,
      sourceUrl: "https://cdn.freshdesk.com/a.png",
      altText: "image",
      nearbyHeading: "Add Customer",
      sectionHeading: "Add Customer",
      precedingText: "Click Customers, then click Add.",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
    },
    { type: "text", text: "Enter the customer details.", workflow: "add_customer" },
  ];

  const png = Buffer.from("fake-image-bytes");
  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [article],
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
    assert.ok(result.payload.instructionBlocks);
    assert.equal(result.payload.instructionBlocks?.[0]?.type, "text");
    assert.equal(result.payload.instructionBlocks?.[1]?.type, "screenshot");
    const screenshot = result.payload.instructionBlocks?.[1];
    assert.ok(screenshot && screenshot.type === "screenshot");
    assert.equal(screenshot.caption, "Adding a customer: Click Add");
    assert.equal(screenshot.linkLabel, "View image");
    assert.match(
      screenshot.url,
      /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//,
    );
    assert.equal(result.payload.imagePresentation, "links");
    assert.equal(result.images.length, 0);
    assert.ok(result.payload.customerFacingInstructionMarkdown);
    assert.match(
      result.payload.customerFacingInstructionMarkdown ?? "",
      /\[View image\]\(https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//,
    );
    assert.equal(
      result.payload.customerFacingInstructionMarkdown?.includes(
        "Adding a customer: Click Add",
      ),
      false,
    );
    assert.equal(result.payload.screenshotLinksMarkdown?.length, 1);
    assert.equal(result.payload.imageCount, 1);
    assert.match(
      result.payload.responseGuidance.images ?? "",
      /View image/i,
    );
    assert.match(
      result.payload.responseGuidance.images ?? "",
      /exact signed Markdown links/i,
    );
    assert.match(
      result.payload.responseGuidance.images ?? "",
      /Do not group screenshots into a separate Relevant screenshots section/i,
    );
    const payloadJson = JSON.stringify(result.payload);
    assert.equal(payloadJson.includes("cdn.freshdesk.com"), false);
    assert.equal(
      JSON.stringify(result.payload.instructionBlocks).includes("sourceUrl"),
      false,
    );
    assert.equal(
      result.payload.instructionBlocks?.some(
        (block) =>
          block.type === "screenshot" && /show image/i.test(block.caption),
      ),
      false,
    );
  }
});

test("getHelpResourceDetails selects existing-customer screenshots from question", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const png = Buffer.from("fake-image-bytes");
  const article = freshdeskArticle();
  article.title = "Customer Opening Balance";
  article.images = [
    { sourceUrl: "https://cdn.freshdesk.com/change.png", altText: null },
    { sourceUrl: "https://cdn.freshdesk.com/add.png", altText: null },
    { sourceUrl: "https://cdn.freshdesk.com/ageing.png", altText: null },
    { sourceUrl: "https://cdn.freshdesk.com/obalance.png", altText: null },
    { sourceUrl: "https://cdn.freshdesk.com/save.png", altText: null },
  ];
  article.syncedImages = article.images.map((image, order) => ({
    sourceUrl: image.sourceUrl,
    blobName: `freshdesk/1001/${order}.png`,
    sha256: `00000000000000000000000000000000000000000000000000000000000000${order}${order}`,
    contentType: "image/png",
    altText: "Show Image",
    order,
  }));
  article.contentBlocks = [
    {
      type: "text",
      text: "Open Customers, select the customer and click Change.",
      workflow: "existing_customer",
      nearbyActions: ["Customers", "Change"],
    },
    {
      type: "image",
      imageIndex: 0,
      precedingText: "Open Customers, select the customer and click Change.",
      workflow: "existing_customer",
      nearbyActions: ["Customers", "Change"],
      altText: "Show Image",
    },
    {
      type: "text",
      text: "To add a brand-new customer, click Add.",
      workflow: "add_customer",
      nearbyActions: ["Add"],
    },
    {
      type: "image",
      imageIndex: 1,
      precedingText: "To add a brand-new customer, click Add.",
      workflow: "add_customer",
      nearbyActions: ["Add"],
      altText: "Show Image",
    },
    {
      type: "text",
      text: "Click O/Balance.",
      workflow: "existing_customer",
      nearbyActions: ["O/Balance"],
    },
    {
      type: "image",
      imageIndex: 3,
      precedingText: "Click O/Balance.",
      workflow: "existing_customer",
      nearbyActions: ["O/Balance"],
      altText: "Show Image",
    },
    {
      type: "text",
      text: "Enter the opening balance into Current, 1 Month, 2 Months and 3 Months Plus.",
      workflow: "customer_opening_balance",
      nearbyActions: ["Current", "1 Month", "2 Months", "3 Months Plus"],
    },
    {
      type: "image",
      imageIndex: 2,
      precedingText:
        "Enter the opening balance into Current, 1 Month, 2 Months and 3 Months Plus.",
      workflow: "customer_opening_balance",
      nearbyActions: ["Current", "1 Month", "2 Months", "3 Months Plus"],
      altText: "Show Image",
    },
    {
      type: "text",
      text: "Click Save on the main customer screen.",
      workflow: "final_save",
      nearbyActions: ["Save"],
    },
    {
      type: "image",
      imageIndex: 4,
      precedingText: "Click Save on the main customer screen.",
      workflow: "final_save",
      nearbyActions: ["Save"],
      altText: "Show Image",
    },
  ];

  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [article],
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
          return /^freshdesk\/1001\/\d+\.png$/.test(blobName);
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
    question:
      "I've added a customer who already owes us money. How do I enter their opening balance?",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const screenshots = result.payload.instructionBlocks?.filter(
      (block) => block.type === "screenshot",
    );
    assert.ok(screenshots && screenshots.length === 4);
    assert.equal(result.payload.imageCount, 4);
    assert.equal(result.payload.screenshotUrls?.length, 4);
    assert.equal(result.payload.screenshotLinksMarkdown?.length, 4);
    assert.equal(result.images.length, 0);
    assert.ok(result.payload.customerFacingScreenshotMarkdown);
    assert.ok(result.payload.customerFacingInstructionMarkdown);
    assert.equal(
      screenshots?.some((block) => /Click Add/i.test(block.caption)),
      false,
    );
    assert.ok(
      screenshots?.some((block) => /Click Change/i.test(block.caption)),
    );
    assert.ok(
      screenshots?.some((block) => /Open O\/Balance/i.test(block.caption)),
    );
    assert.ok(
      screenshots?.some((block) => /Enter aged balances/i.test(block.caption)),
    );
    assert.ok(
      screenshots?.some((block) => /Save changes/i.test(block.caption)),
    );
    assert.equal(
      /Email Preferences/i.test(result.payload.customerFacingScreenshotMarkdown ?? ""),
      false,
    );
    assert.equal(
      screenshots?.some(
        (block) =>
          block.type === "screenshot" && /show image/i.test(block.caption),
      ),
      false,
    );

    const linkUrls = result.payload.screenshotLinksMarkdown?.map((link) => {
      const match = link.match(/\((https:[^)]+)\)/);
      return match?.[1];
    });
    const screenshotUrls = result.payload.screenshotUrls?.map((item) => item.url);
    assert.deepEqual(linkUrls, screenshotUrls);
    assert.equal(
      JSON.stringify(result.payload.instructionBlocks).includes("sourceUrl"),
      false,
    );
    assert.equal(JSON.stringify(result.payload).includes("cdn.freshdesk.com"), false);
    assert.equal(
      result.payload.customerFacingInstructionMarkdown?.includes("blob.core.windows.net"),
      false,
    );
  }
});

test("helpResourceDetailResponse emits Markdown text before optional binary images", () => {
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
      imagePresentation: "both",
      customerFacingScreenshotMarkdown:
        "[View image](https://red.example.com/public/brc-edu/freshdesk-images/1001/token)",
      customerFacingInstructionMarkdown:
        "1. Click Change.\n\n   [View image](https://red.example.com/public/brc-edu/freshdesk-images/1001/token)",
      responseGuidance: {
        supportFooter: "footer",
        doNotExpose: [],
      },
    },
    [
      {
        mimeType: "image/png",
        data: Buffer.from("x").toString("base64"),
        caption: "Changing a customer: Click Change",
        order: 0,
      },
    ],
  );

  assert.equal(response.content[0]?.type, "text");
  assert.equal(response.content[1]?.type, "text");
  assert.match(
    String((response.content[1] as { text?: string }).text),
    /Include the following exact Markdown links/,
  );
  assert.match(
    String((response.content[1] as { text?: string }).text),
    /\[View image\]\(https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\/token\)/,
  );
  assert.equal(
    String((response.content[1] as { text?: string }).text).includes(
      "Changing a customer: Click Change",
    ),
    false,
  );
  assert.ok(
    response.content.some(
      (block) =>
        block.type === "text" &&
        "text" in block &&
        block.text.includes("Still need help?"),
    ),
  );
  const imageIndex = response.content.findIndex((block) => block.type === "image");
  assert.ok(imageIndex > 1);
  assert.equal(response.content[imageIndex - 1]?.type, "text");
});

test("helpResourceDetailResponse links mode has Markdown without binary images", () => {
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
      imagePresentation: "links",
      customerFacingScreenshotMarkdown:
        "[View image](https://red.example.com/public/brc-edu/freshdesk-images/1001/token)",
      responseGuidance: {
        supportFooter: "footer",
        doNotExpose: [],
      },
    },
    [],
  );

  assert.ok(response.content.length >= 2);
  assert.equal(response.content.every((block) => block.type === "text"), true);
  assert.equal(response.content.some((block) => block.type === "image"), false);
  assert.ok(
    response.content.some(
      (block) =>
        block.type === "text" &&
        "text" in block &&
        block.text.includes("Still need help?"),
    ),
  );
});

test("inline presentation returns binary image blocks", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

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
    imagePresentation: "inline",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.imagePresentation, "inline");
    assert.equal(result.images.length, 1);
    assert.ok(result.payload.screenshotLinksMarkdown?.length);
  }
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

test("links mode returns signed screenshot links without downloading blobs", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

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

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: indexContainer as never,
    freshdeskImageContainer: null,
    includeImages: true,
    imagePresentation: "links",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.imagePresentation, "links");
    assert.equal(result.payload.imageAvailable, true);
    assert.equal(result.payload.imageCount, 1);
    assert.equal(result.payload.screenshotUrls?.length, 1);
    assert.match(
      result.payload.screenshotUrls?.[0]?.url ?? "",
      /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\//,
    );
    assert.equal(result.images.length, 0);
    assert.ok(result.payload.customerFacingScreenshotMarkdown);
  }
});

test("syncedImages without distinctive context still return image links", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const article: SyncedFreshdeskArticle = {
    id: "freshdesk-157000368447",
    source: "freshdesk",
    freshdeskArticleId: 157000368447,
    categoryId: 1,
    folderId: 2,
    folderName: "Customers",
    title: "How do I add a Customer?",
    bodyText: "Overview of the customer record.",
    images: [
      { sourceUrl: "https://cdn.freshdesk.com/1.jpg", altText: null },
      { sourceUrl: "https://cdn.freshdesk.com/2.jpg", altText: null },
      { sourceUrl: "https://cdn.freshdesk.com/3.jpg", altText: null },
      { sourceUrl: "https://cdn.freshdesk.com/4.jpg", altText: null },
    ],
    syncedImages: [
      {
        sourceUrl: "https://cdn.freshdesk.com/1.jpg",
        blobName: "freshdesk/157000368447/aaaa.jpg",
        sha256: "a".repeat(64),
        contentType: "image/jpeg",
      },
      {
        sourceUrl: "https://cdn.freshdesk.com/2.jpg",
        blobName: "freshdesk/157000368447/bbbb.jpg",
        sha256: "b".repeat(64),
        contentType: "image/jpeg",
      },
      {
        sourceUrl: "https://cdn.freshdesk.com/3.jpg",
        blobName: "freshdesk/157000368447/cccc.jpg",
        sha256: "c".repeat(64),
        contentType: "image/jpeg",
      },
      {
        sourceUrl: "https://cdn.freshdesk.com/4.jpg",
        blobName: "freshdesk/157000368447/dddd.jpg",
        sha256: "d".repeat(64),
        contentType: "image/jpeg",
      },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: "how-do-i-add-a-customer",
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer",
  };

  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [article],
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

  const result = await getHelpResourceDetails("freshdesk:157000368447", {
    freshdeskIndexContainer: indexContainer as never,
    freshdeskImageContainer: null,
    includeImages: true,
    imagePresentation: "links",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok((result.payload.imageCount ?? 0) >= 1);
    assert.ok((result.payload.screenshotLinksMarkdown?.length ?? 0) >= 1);
    assert.deepEqual(result.payload.usedResourceIds, ["freshdesk:157000368447"]);
    assert.equal(result.payload.sources?.length, 1);
    assert.equal(result.payload.sources?.[0]?.title, "How do I add a Customer?");
    assert.equal(
      result.payload.sources?.[0]?.url,
      "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer",
    );
    assert.match(
      result.payload.customerFacingSourcesMarkdown ?? "",
      /How do I add a Customer\?/,
    );
    assert.equal(JSON.stringify(result.payload).includes("freshdesk/157000368447"), false);
    assert.equal(JSON.stringify(result.payload).includes("cdn.freshdesk.com"), false);
  }
});

test("text-only contentBlocks semantically match syncedImages to steps", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const article = freshdeskArticle();
  article.title = "How do I add a Customer?";
  article.freshdeskArticleId = 157000368447;
  article.id = "freshdesk-157000368447";
  article.slug = "how-do-i-add-a-customer";
  article.publicUrl =
    "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer";
  article.images = [
    { sourceUrl: "https://cdn.freshdesk.com/1.png", altText: "Lookup or Setup" },
    { sourceUrl: "https://cdn.freshdesk.com/2.png", altText: "Click Add" },
    { sourceUrl: "https://cdn.freshdesk.com/3.png", altText: "Enter customer details" },
    { sourceUrl: "https://cdn.freshdesk.com/4.png", altText: "Save customer" },
  ];
  article.syncedImages = article.images.map((image, order) => ({
    sourceUrl: image.sourceUrl,
    blobName: `freshdesk/157000368447/${order}.png`,
    sha256: `${order}`.repeat(64).slice(0, 64),
    contentType: "image/png",
    order,
  }));
  article.contentBlocks = [
    {
      type: "text",
      text: "Click Lookup or Setup.",
      workflow: "add_customer",
      nearbyActions: ["Lookup", "Setup"],
    },
    {
      type: "text",
      text: "Click Customers, then click Add.",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
    },
    {
      type: "text",
      text: "Enter the customer details. The A/C Code field is mandatory.",
      workflow: "add_customer",
      nearbyActions: ["A/C Code"],
    },
    {
      type: "text",
      text: "Click Save on the main customer screen.",
      workflow: "add_customer",
      nearbyActions: ["Save"],
    },
  ];

  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [article],
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

  const result = await getHelpResourceDetails("freshdesk:157000368447", {
    freshdeskIndexContainer: indexContainer as never,
    freshdeskImageContainer: null,
    includeImages: true,
    question: "How do I add a customer in Big Red Cloud?",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.payload.instructionBlocks);
    assert.ok(result.payload.customerFacingInstructionMarkdown);
    const blocks = result.payload.instructionBlocks ?? [];
    const screenshots = blocks.filter((block) => block.type === "screenshot");
    assert.ok(screenshots.length >= 2);
    assert.equal(
      new Set(screenshots.map((block) => block.url)).size,
      screenshots.length,
    );

    // Each screenshot must sit immediately after its matched instruction.
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block?.type !== "screenshot") {
        continue;
      }
      assert.equal(blocks[index - 1]?.type, "text");
    }

    const textThenShot = (stepNeedle: string, captionNeedle: RegExp) => {
      const stepIndex = blocks.findIndex(
        (block) =>
          block.type === "text" && block.text.includes(stepNeedle),
      );
      assert.ok(stepIndex >= 0, `missing step: ${stepNeedle}`);
      const shot = blocks[stepIndex + 1];
      assert.equal(shot?.type, "screenshot");
      if (shot?.type === "screenshot") {
        assert.match(shot.caption, captionNeedle);
      }
    };

    textThenShot("Click Lookup or Setup", /Lookup|Setup/i);
    textThenShot("Click Customers, then click Add", /Click Add|\bAdd\b/i);
    textThenShot("Enter the customer details", /customer details|A\/C Code/i);
    textThenShot("Click Save", /Save/i);

    const captions = screenshots
      .map((block) => (block.type === "screenshot" ? block.caption : ""))
      .join(" ");
    assert.equal(/Article image \d/i.test(captions), false);
    assert.match(captions, /Lookup|Add|Save|customer details/i);

    const markdown = result.payload.customerFacingInstructionMarkdown ?? "";
    assert.match(markdown, /\[View image\]\(https:\/\//);
    assert.equal(/Adding a customer:|Article image \d/i.test(markdown), false);
    const lookupStepPos = markdown.indexOf("Click Lookup or Setup");
    const addStepPos = markdown.indexOf("Click Customers, then click Add");
    const lookupShotPos = markdown.indexOf("](https://", lookupStepPos);
    const addShotPos = markdown.indexOf("](https://", addStepPos);
    assert.ok(lookupStepPos >= 0);
    assert.ok(addStepPos > lookupStepPos);
    assert.ok(lookupShotPos > lookupStepPos && lookupShotPos < addStepPos);
    assert.ok(addShotPos > addStepPos);

    assert.deepEqual(result.payload.usedResourceIds, ["freshdesk:157000368447"]);
    assert.equal(result.payload.sources?.length, 1);
    assert.equal(result.payload.sources?.[0]?.title, "How do I add a Customer?");
    assert.equal(
      result.payload.sources?.[0]?.url,
      article.publicUrl,
    );
    assert.match(
      result.payload.customerFacingSourcesMarkdown ?? "",
      /How do I add a Customer\?/,
    );
    assert.match(
      result.payload.customerFacingSourcesMarkdown ?? "",
      /157000368447-how-do-i-add-a-customer/,
    );
    assert.match(result.payload.customerFacingSourcesMarkdown ?? "", /Articles/);
    assert.equal(
      result.payload.customerFacingSourcesMarkdown?.includes("Videos"),
      false,
    );
    assert.ok(
      result.payload.customerFacingAnswerSectionsMarkdown?.startsWith("Sources"),
    );
    const sections = result.payload.customerFacingAnswerSectionsMarkdown ?? "";
    const sourcesPos = sections.indexOf("Sources");
    const redPos = sections.indexOf("Do this through Red");
    const supportPos = sections.indexOf("Still need help?");
    assert.ok(sourcesPos >= 0);
    assert.ok(supportPos > sourcesPos);
    if (result.payload.redActionAvailable) {
      assert.ok(redPos > sourcesPos);
      assert.ok(supportPos > redPos);
    }
    assert.match(
      result.payload.customerFacingSupportMarkdown ?? "",
      /https:\/\/bigredcloud\.com\/contact\//,
    );
  }
});

test("explicit image contentBlocks still preserve step placement", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const article = freshdeskArticle();
  article.contentBlocks = [
    {
      type: "text",
      text: "Click Customers, then click Add.",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
    },
    {
      type: "image",
      imageIndex: 0,
      precedingText: "Click Customers, then click Add.",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
      altText: "Add customer",
    },
    {
      type: "text",
      text: "Enter the customer details.",
      workflow: "add_customer",
    },
  ];

  const index = {
    generatedAt: "2026-07-15T10:00:00.000Z",
    articleCount: 1,
    failureCount: 0,
    articles: [article],
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

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: indexContainer as never,
    freshdeskImageContainer: null,
    includeImages: true,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.payload.instructionBlocks);
    assert.equal(result.payload.instructionBlocks?.[0]?.type, "text");
    assert.equal(result.payload.instructionBlocks?.[1]?.type, "screenshot");
    assert.match(
      result.payload.customerFacingInstructionMarkdown ?? "",
      /Click Customers, then click Add[\s\S]*\[View image\]\(https:\/\/red\.example\.com/,
    );
    assert.equal(
      result.payload.customerFacingInstructionMarkdown?.includes("Add customer"),
      false,
    );
    assert.ok(result.payload.customerFacingSourcesMarkdown);
  }
});

function mockBlobContainer(blobs: Record<string, unknown>) {
  return {
    getBlockBlobClient(blobPath: string) {
      return {
        async exists() {
          return Object.prototype.hasOwnProperty.call(blobs, blobPath);
        },
        async getProperties() {
          return { etag: `"etag-${blobPath}"` };
        },
        async download() {
          const value = blobs[blobPath];
          if (value === undefined) {
            throw new Error(`Missing blob: ${blobPath}`);
          }
          return {
            readableStreamBody: (async function* () {
              yield Buffer.from(JSON.stringify(value), "utf8");
            })(),
          };
        },
      };
    },
  };
}

test("visible article from effective catalogue returns instructionBlocks and syncedImages", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const article = freshdeskArticle();
  article.contentBlocks = [
    {
      type: "text",
      text: "Click Customers, then click Add.",
      sectionHeading: "Add Customer",
    },
    {
      type: "image",
      imageIndex: 0,
      sourceUrl: "https://cdn.freshdesk.com/a.png",
      sectionHeading: "Add Customer",
    },
  ];

  const container = mockBlobContainer({
    [DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      itemCount: 1,
      visibleCount: 1,
      excludedCount: 0,
      items: [
        {
          ...article,
          articleId: "1001",
          topic: "cash_book",
          topicLabel: "Cash Book",
          excluded: false,
          lastSyncedAt: "2026-07-20T00:00:00.000Z",
          // Intentionally omit rich fields from effective item to prove
          // details are loaded from the raw catalogue.
          contentBlocks: undefined,
          syncedImages: [],
        },
      ],
    },
    [FRESHDESK_ARTICLES_INDEX_BLOB_PATH]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      articleCount: 1,
      failureCount: 0,
      articles: [article],
      failures: [],
    },
  });

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: container as never,
    freshdeskImageContainer: null,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.payload.instructionBlocks);
    assert.equal(result.payload.instructionBlocks?.[0]?.type, "text");
    assert.equal(result.payload.instructionBlocks?.[1]?.type, "screenshot");
    assert.equal(result.payload.imageAvailable, true);
    assert.equal(result.payload.screenshotUrls?.length, 1);
  }
});

test("excluded Freshdesk article is not returned for help details", async () => {
  const article = freshdeskArticle();
  const container = mockBlobContainer({
    [DEFAULT_BRC_FRESHDESK_EFFECTIVE_CATALOG_BLOB]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      itemCount: 1,
      visibleCount: 0,
      excludedCount: 1,
      items: [
        {
          ...article,
          articleId: "1001",
          topic: "cash_book",
          topicLabel: "Cash Book",
          excluded: true,
          exclusionReason: "Staff only",
          lastSyncedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    },
    [FRESHDESK_ARTICLES_INDEX_BLOB_PATH]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      articleCount: 1,
      failureCount: 0,
      articles: [article],
      failures: [],
    },
  });

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: container as never,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /not found/i);
  }
});

test("raw catalogue fallback returns rich fields when effective catalogue is missing", async () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "help-details-secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const article = freshdeskArticle();
  article.contentBlocks = [
    {
      type: "text",
      text: "Click Customers, then click Add.",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
      sectionHeading: "Add Customer",
    },
    {
      type: "image",
      imageIndex: 0,
      sourceUrl: "https://cdn.freshdesk.com/a.png",
      altText: "image",
      nearbyHeading: "Add Customer",
      sectionHeading: "Add Customer",
      workflow: "add_customer",
      nearbyActions: ["Customers", "Add"],
    },
  ];

  const container = mockBlobContainer({
    [FRESHDESK_ARTICLES_INDEX_BLOB_PATH]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      articleCount: 1,
      failureCount: 0,
      articles: [article],
      failures: [],
    },
  });

  const found = await findFreshdeskArticleById("1001", container as never);
  assert.ok(found);
  assert.equal(found?.contentBlocks?.length, 2);
  assert.equal(found?.syncedImages?.length, 1);

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: container as never,
    freshdeskImageContainer: null,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.payload.instructionBlocks);
    assert.equal(result.payload.instructionBlocks?.[1]?.type, "screenshot");
    assert.equal(result.payload.screenshotUrls?.length, 1);
  }
});

test("raw catalogue fallback honours exclusion overrides", async () => {
  const article = freshdeskArticle();
  const container = mockBlobContainer({
    [FRESHDESK_ARTICLES_INDEX_BLOB_PATH]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      articleCount: 1,
      failureCount: 0,
      articles: [article],
      failures: [],
    },
    [DEFAULT_BRC_FRESHDESK_OVERRIDES_BLOB]: {
      updatedAt: "2026-07-20T00:00:00.000Z",
      overrides: {
        "1001": {
          excluded: true,
          reason: "Hidden",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      },
    },
  });

  const result = await getHelpResourceDetails("freshdesk:1001", {
    freshdeskIndexContainer: container as never,
  });

  assert.equal(result.ok, false);
});

test("string and numeric Freshdesk article IDs match safely", async () => {
  assert.equal(freshdeskArticleIdsMatch("1001", 1001), true);
  assert.equal(freshdeskArticleIdsMatch(" 1001 ", "1001"), true);
  assert.equal(freshdeskArticleIdsMatch("1001", "1002"), false);

  const article = freshdeskArticle();
  const container = mockBlobContainer({
    [FRESHDESK_ARTICLES_INDEX_BLOB_PATH]: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      articleCount: 1,
      failureCount: 0,
      articles: [article],
      failures: [],
    },
  });

  const found = await findFreshdeskArticleById("1001", container as never);
  assert.equal(found?.freshdeskArticleId, 1001);
  assert.equal(
    await findFreshdeskArticleById("9999", container as never),
    null,
  );
});
