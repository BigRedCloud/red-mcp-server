import * as cheerio from "cheerio";

import type {
  FreshdeskImageReference,
} from "./types.js";

export function extractFreshdeskImages(
  html: string,
): FreshdeskImageReference[] {
  const $ = cheerio.load(html);
  const images = new Map<string, FreshdeskImageReference>();

  $("img[src]").each((_index, element) => {
    const sourceUrl = $(element).attr("src")?.trim();

    if (!sourceUrl) {
      return;
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      return;
    }

    if (parsedUrl.protocol !== "https:") {
      return;
    }

    const altText = $(element).attr("alt")?.trim() || null;

    images.set(sourceUrl, {
      sourceUrl,
      altText,
    });
  });

  return [...images.values()];
}