import {
  readFreshdeskArticleUrlFields,
  resolveFreshdeskArticlePublicUrl,
  resolveFreshdeskArticleSlug,
} from "./freshdesk-article-url.js";
import { parseFreshdeskArticleContent } from "./article-content-parser.js";
import { extractFreshdeskImages } from "./image-extractor.js";

import type {
  FreshdeskArticle,
  NormalizedFreshdeskArticle,
} from "./types.js";

function normalizeBodyText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFreshdeskArticle(
  article: FreshdeskArticle,
  folderName: string,
): NormalizedFreshdeskArticle {
  const title = article.title.trim();
  const { apiUrl, apiPath, apiSlug } = readFreshdeskArticleUrlFields(
    article as Record<string, unknown>,
  );
  const publicUrl = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: article.id,
    title,
    apiUrl,
    apiPath,
    apiSlug,
  });
  const slug = resolveFreshdeskArticleSlug({
    apiSlug,
    title,
  });

  const parsed = parseFreshdeskArticleContent(article.description);
  const bodyText =
    normalizeBodyText(article.description_text) || parsed.bodyTextFromHtml;
  // Prefer ordered parser images; fall back to legacy extractor if HTML had none.
  const images =
    parsed.images.length > 0
      ? parsed.images
      : extractFreshdeskImages(article.description);

  return {
    id: `freshdesk-${article.id}`,
    source: "freshdesk",
    freshdeskArticleId: article.id,
    categoryId: article.category_id,
    folderId: article.folder_id,
    folderName,
    title,
    bodyText,
    images,
    contentBlocks: parsed.contentBlocks,
    updatedAt: article.updated_at,
    enabled: article.status === 2,
    slug,
    publicUrl,
  };
}
