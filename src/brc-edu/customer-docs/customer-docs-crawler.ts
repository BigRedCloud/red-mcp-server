import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

import {
  BIGREDCLOUD_DOCS_RULE,
  normalizeApprovedWebUrl,
  safeWebFetchText,
  type SafeWebFetchOptions,
} from "../help/safe-web-fetch.js";
import {
  buildHelpResourceId,
  isPublicHttpsUrl,
  type NormalizedHelpResource,
} from "../help/help-resource-types.js";

export const CUSTOMER_DOCS_BASE_URL = "https://bigredcloud.com/docs/";
export const CUSTOMER_DOCS_MAX_PAGES = 250;

const DOCS_RULES = [BIGREDCLOUD_DOCS_RULE];

const REMOVAL_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  ".cookie",
  ".cookies",
  "#cookie",
  "#cookies",
  ".menu",
  ".navigation",
  ".site-header",
  ".site-footer",
  ".breadcrumb",
  ".search-form",
  "form",
];

function slugFromUrl(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  const slug = pathname.split("/").filter(Boolean).pop();
  return slug ?? createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractSummary(bodyText: string, maxLength = 220): string {
  const normalized = cleanText(bodyText);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractKeywords(title: string, category: string, headings: string[]): string[] {
  const tokens = `${title} ${category} ${headings.join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

  return [...new Set(tokens)].slice(0, 20);
}

export function extractCustomerDocsLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href")?.trim();
    if (!href || href.startsWith("#")) {
      return;
    }

    try {
      const resolved = normalizeApprovedWebUrl(href, DOCS_RULES, baseUrl);
      const pathname = new URL(resolved).pathname.replace(/\/+$/, "");
      if (pathname === "/docs") {
        return;
      }

      links.add(resolved.replace(/\/+$/, "") + "/");
    } catch {
      // Ignore links outside approved scope.
    }
  });

  return [...links];
}

export function isCustomerDocsArticleUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    const segments = pathname.split("/").filter(Boolean);
    return segments.length >= 3 && segments[0] === "docs";
  } catch {
    return false;
  }
}

export function parseCustomerDocsArticlePage(
  html: string,
  url: string,
  syncedAt: string,
): NormalizedHelpResource | null {
  const $ = cheerio.load(html);

  for (const selector of REMOVAL_SELECTORS) {
    $(selector).remove();
  }

  const title =
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text().replace(/\s*\|\s*Big Red Cloud.*$/i, ""));

  if (!title) {
    return null;
  }

  const category =
    cleanText($(".breadcrumb a").last().text()) ||
    cleanText($("h2").first().text()) ||
    "Documentation";

  const main =
    $("main").first().length > 0
      ? $("main").first()
      : $("article").first().length > 0
        ? $("article").first()
        : $(".entry-content, .content, .docs-content").first();

  const headings = main
    .find("h2, h3")
    .map((_, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean);

  const bodyText = cleanText(main.text());
  if (!bodyText || bodyText.length < 40) {
    return null;
  }

  const canonical = isPublicHttpsUrl(url) ? url : null;
  if (!canonical) {
    return null;
  }

  const slug = slugFromUrl(canonical);
  const topics = extractKeywords(title, category, headings);

  return {
    resourceId: buildHelpResourceId("customer_docs", slug),
    source: "customer_docs",
    title,
    summary: extractSummary(bodyText),
    bodyText,
    url: canonical,
    category,
    topics,
    imageBlobNames: [],
    enabled: true,
    lastSyncedAt: syncedAt,
  };
}

export type CustomerDocsCrawlResult = {
  articles: NormalizedHelpResource[];
  discoveredUrls: string[];
};

export async function crawlCustomerDocumentation(
  options: SafeWebFetchOptions & {
    baseUrl?: string;
    maxPages?: number;
  } = {},
): Promise<CustomerDocsCrawlResult> {
  const baseUrl = options.baseUrl ?? CUSTOMER_DOCS_BASE_URL;
  const maxPages = options.maxPages ?? CUSTOMER_DOCS_MAX_PAGES;
  const syncedAt = new Date().toISOString();

  const homepage = await safeWebFetchText(baseUrl, DOCS_RULES, options);
  const queue = extractCustomerDocsLinks(homepage.text, homepage.url);
  const visited = new Set<string>();
  const articles: NormalizedHelpResource[] = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const nextUrl = queue.shift();
    if (!nextUrl || visited.has(nextUrl)) {
      continue;
    }

    visited.add(nextUrl);

    const page = await safeWebFetchText(nextUrl, DOCS_RULES, options);
    const discovered = extractCustomerDocsLinks(page.text, page.url);

    for (const link of discovered) {
      if (!visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }

    if (!isCustomerDocsArticleUrl(page.url)) {
      continue;
    }

    const article = parseCustomerDocsArticlePage(page.text, page.url, syncedAt);
    if (article) {
      articles.push(article);
    }
  }

  const deduped = new Map<string, NormalizedHelpResource>();
  for (const article of articles) {
    deduped.set(article.url, article);
  }

  return {
    articles: [...deduped.values()],
    discoveredUrls: [...visited],
  };
}
