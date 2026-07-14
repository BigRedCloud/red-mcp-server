import { normalizeFreshdeskArticle } from
  "../src/brc-edu/freshdesk/article-normalizer.js";

import { FreshdeskClient } from
  "../src/brc-edu/freshdesk/freshdesk-client.js";

import {
  createFreshdeskImageContainer,
  syncFreshdeskImages,
} from "../src/brc-edu/freshdesk/image-sync.js";

const baseUrl =
  process.env.FRESHDESK_BASE_URL ??
  "https://bigredcloud.freshdesk.com";

const apiKey = process.env.FRESHDESK_API_KEY;

const storageConnection =
  process.env.BRC_EDU_KB_STORAGE_CONNECTION;

const imageContainerName =
  process.env.BRC_EDU_KB_IMAGE_CONTAINER ??
  "brc-edu-images";

if (!apiKey) {
  throw new Error("FRESHDESK_API_KEY is not configured.");
}

if (!storageConnection) {
  throw new Error(
    "BRC_EDU_KB_STORAGE_CONNECTION is not configured.",
  );
}

const client = new FreshdeskClient(baseUrl, apiKey);

const article = await client.getArticle(157000367770);

const normalized = normalizeFreshdeskArticle(
  article,
  "Sales Book and Customers",
);

const container = createFreshdeskImageContainer(
  storageConnection,
  imageContainerName,
);

const syncedImages = await syncFreshdeskImages(
  article.id,
  normalized.images,
  container,
);

console.log({
  id: normalized.id,
  title: normalized.title,
  bodyLength: normalized.bodyText.length,
  imageCount: normalized.images.length,
  syncedImageCount: syncedImages.length,
  blobNames: syncedImages.map(image => image.blobName),
  updatedAt: normalized.updatedAt,
});