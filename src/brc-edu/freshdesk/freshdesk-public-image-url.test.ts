import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFreshdeskPublicImagePath,
  buildFreshdeskPublicImageUrl,
  buildFreshdeskScreenshotUrls,
} from "./freshdesk-public-image-url.js";

const ARTICLE_ID = 1001;
const IMAGE_KEY = "b".repeat(64);

test("buildFreshdeskPublicImagePath does not expose blob names", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "secret";
  const token = "opaque.token.value";

  const path = buildFreshdeskPublicImagePath(ARTICLE_ID, token);

  assert.equal(path.startsWith("/public/brc-edu/freshdesk-images/1001/"), true);
  assert.equal(path.includes("freshdesk/1001/"), false);
  assert.equal(path.includes("blob.core.windows.net"), false);
});

test("buildFreshdeskPublicImageUrl uses RED_PUBLIC_BASE_URL", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const token = "opaque.token.value";
  const url = buildFreshdeskPublicImageUrl(ARTICLE_ID, token);

  assert.equal(
    url,
    "https://red.example.com/public/brc-edu/freshdesk-images/1001/opaque.token.value",
  );
});

test("buildFreshdeskScreenshotUrls returns ordered customer-safe screenshot URLs", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";
  const screenshotUrls = buildFreshdeskScreenshotUrls(
    ARTICLE_ID,
    [
      {
        blobName: "freshdesk/1001/a.png",
        mimeType: "image/png",
        order: 0,
        altText: "Add Customer screen",
        sha256: IMAGE_KEY,
      },
    ],
    { now: 1_700_000_000 },
  );

  assert.equal(screenshotUrls.length, 1);
  assert.equal(screenshotUrls[0]?.caption, "Add Customer screen");
  assert.equal(screenshotUrls[0]?.mimeType, "image/png");
  assert.match(screenshotUrls[0]?.url ?? "", /^https:\/\/red\.example\.com\/public\/brc-edu\/freshdesk-images\/1001\//);
  assert.equal(JSON.stringify(screenshotUrls).includes("freshdesk/1001"), false);
});

test("buildFreshdeskScreenshotUrls does not require downloaded image blocks", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "secret";
  process.env.RED_PUBLIC_BASE_URL = "https://red.example.com";

  const screenshotUrls = buildFreshdeskScreenshotUrls(
    ARTICLE_ID,
    [
      {
        blobName: "freshdesk/1001/a.png",
        mimeType: "image/png",
        order: 0,
        altText: "Changing a customer: Click Change",
        sha256: IMAGE_KEY,
      },
    ],
    { now: 1_700_000_000 },
  );

  assert.equal(screenshotUrls.length, 1);
  assert.equal(
    screenshotUrls[0]?.caption,
    "Changing a customer: Click Change",
  );
  assert.equal(screenshotUrls[0]?.imageIndex, 0);
});
