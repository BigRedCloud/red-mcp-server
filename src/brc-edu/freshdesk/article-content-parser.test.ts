import assert from "node:assert/strict";
import test from "node:test";

import { parseFreshdeskArticleContent } from "./article-content-parser.js";
import {
  buildFreshdeskInstructionBlocks,
  enrichScreenshotUrlCaptions,
} from "./instruction-blocks.js";
import {
  buildFreshdeskScreenshotCaption,
  FRESHDESK_SCREENSHOT_CAPTION_FALLBACK,
  FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH,
  isGenericFreshdeskAltText,
} from "./screenshot-caption.js";

const SAMPLE_HTML = `
  <h2>Add Customer</h2>
  <p>Click Lookup or Setup.</p>
  <p>Click Customers, then click Add.</p>
  <img src="https://cdn.freshdesk.com/customers-list.png" alt="image" width="800" height="500" />
  <p>Fill in the relevant Details. The A/C Code box is mandatory.</p>
  <img src="https://cdn.freshdesk.com/add-customer.png" alt="screenshot" />
  <p>Click Email Preferences on the right-hand side.</p>
  <img src="https://cdn.freshdesk.com/email-prefs.png" alt="Customer Email Preferences" />
  <img src="https://cdn.freshdesk.com/logo.png" alt="logo" class="logo" width="24" height="24" />
`;

test("Freshdesk HTML text and images are preserved in DOM order", () => {
  const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);

  assert.deepEqual(
    parsed.contentBlocks.map((block) => block.type),
    ["text", "text", "text", "image", "text", "image", "text", "image"],
  );
  assert.equal(parsed.images.length, 3);
  assert.equal(
    parsed.images[0]?.sourceUrl,
    "https://cdn.freshdesk.com/customers-list.png",
  );
  assert.equal(
    parsed.contentBlocks.find((block) => block.type === "text")?.text,
    "Add Customer",
  );
});

test("screenshot is associated with nearest preceding instruction", () => {
  const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
  const firstImage = parsed.contentBlocks.find(
    (block) => block.type === "image",
  );

  assert.ok(firstImage && firstImage.type === "image");
  assert.equal(
    firstImage.precedingText,
    "Click Customers, then click Add.",
  );
  assert.equal(firstImage.nearbyHeading, "Add Customer");
});

test("nearest heading is used when alt text is generic", () => {
  const caption = buildFreshdeskScreenshotCaption({
    altText: "image",
    nearbyHeading: "Customers list",
    precedingText: undefined,
  });

  assert.equal(caption, "Customers list");
});

test("meaningful alt text has highest caption priority", () => {
  const caption = buildFreshdeskScreenshotCaption({
    altText: "Customer Email Preferences",
    nearbyHeading: "Add Customer",
    precedingText: "Click Email Preferences on the right-hand side.",
  });

  assert.equal(caption, "Customer Email Preferences");
});

test("generic alt text such as image or screenshot is ignored", () => {
  assert.equal(isGenericFreshdeskAltText("image"), true);
  assert.equal(isGenericFreshdeskAltText("screenshot"), true);
  assert.equal(isGenericFreshdeskAltText("Show Image"), true);
  assert.equal(isGenericFreshdeskAltText("Customer Email Preferences"), false);
});

test("caption uses nearby instruction text", () => {
  const caption = buildFreshdeskScreenshotCaption({
    altText: "screenshot",
    nearbyHeading: undefined,
    precedingText: "Click Customers, then click Add.",
  });

  assert.equal(caption, "Customers — click Add");
});

test("caption length is capped", () => {
  const longText = "A".repeat(200);
  const caption = buildFreshdeskScreenshotCaption({
    altText: longText,
  });

  assert.ok(caption.length <= FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH);
  assert.match(caption, /…$/);
});

test("caption HTML is removed safely", () => {
  const caption = buildFreshdeskScreenshotCaption({
    altText: "<b>Add Customer</b> &amp; save",
  });

  assert.equal(caption.includes("<"), false);
  assert.equal(caption.includes("&amp;"), false);
  assert.match(caption, /Add Customer/);
});

test("instructionBlocks alternate correctly between text and screenshots", () => {
  const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
  const screenshotUrls = [
    {
      caption: "Customers — click Add",
      mimeType: "image/png",
      url: "https://red.example.com/public/brc-edu/freshdesk-images/1001/token-a",
    },
    {
      caption: "Add Customer screen — enter the required A/C Code",
      mimeType: "image/png",
      url: "https://red.example.com/public/brc-edu/freshdesk-images/1001/token-b",
    },
    {
      caption: "Customer Email Preferences",
      mimeType: "image/png",
      url: "https://red.example.com/public/brc-edu/freshdesk-images/1001/token-c",
    },
  ];

  const blocks = buildFreshdeskInstructionBlocks(
    parsed.contentBlocks,
    screenshotUrls,
  );

  assert.ok(blocks.length >= 5);
  assert.equal(blocks[0]?.type, "text");
  assert.ok(blocks.some((block) => block.type === "screenshot"));

  const serialized = JSON.stringify(blocks);
  assert.equal(serialized.includes("cdn.freshdesk.com"), false);
  assert.equal(serialized.includes("blobName"), false);
  assert.equal(serialized.includes("sourceUrl"), false);
  assert.equal(serialized.includes("sha256"), false);
  assert.equal(serialized.includes("Show Image"), false);

  const firstScreenshot = blocks.find((block) => block.type === "screenshot");
  assert.ok(firstScreenshot && firstScreenshot.type === "screenshot");
  assert.match(
    firstScreenshot.url,
    /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\//,
  );
  assert.notEqual(firstScreenshot.caption, FRESHDESK_SCREENSHOT_CAPTION_FALLBACK);
});

test("enrichScreenshotUrlCaptions uses content-block context", () => {
  const parsed = parseFreshdeskArticleContent(SAMPLE_HTML);
  const enriched = enrichScreenshotUrlCaptions(
    [
      {
        caption: "Freshdesk screenshot",
        mimeType: "image/png",
        url: "https://red.example.com/public/brc-edu/freshdesk-images/1001/token-a",
      },
    ],
    parsed.contentBlocks,
  );

  assert.equal(enriched[0]?.caption, "Customers — click Add");
});

test("caption combines heading with fill instruction for A/C Code", () => {
  const caption = buildFreshdeskScreenshotCaption({
    altText: "image",
    nearbyHeading: "Add Customer",
    precedingText:
      "Fill in the relevant Details. The A/C Code box is mandatory.",
  });

  assert.equal(
    caption,
    "Add Customer screen — enter the required A/C Code",
  );
});
