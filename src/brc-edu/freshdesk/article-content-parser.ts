import * as cheerio from "cheerio";

import type {
  FreshdeskArticleContentBlock,
  FreshdeskImageReference,
} from "./types.js";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_BLOCK_TAGS = new Set([
  "p",
  "li",
  "td",
  "th",
  "blockquote",
  "figcaption",
  "dt",
  "dd",
]);

const DECORATIVE_ALT_PATTERN =
  /^(logo|avatar|icon|spacer|separator|bullet|decoration|decorative|banner)$/i;
const DECORATIVE_CLASS_PATTERN =
  /\b(logo|avatar|icon|spacer|separator|decorative|decoration|emoji)\b/i;
const DECORATIVE_SRC_PATTERN =
  /(spacer|pixel|1x1|blank\.|transparent\.|logo[_-]|avatar[_-]|icon[_-])/i;

type CheerioSelection = cheerio.Cheerio<any>;

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtmlToText(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function isMeaningfulInstructionText(text: string): boolean {
  const cleaned = normalizeWhitespace(text);
  if (cleaned.length < 3) {
    return false;
  }

  if (/^[\d.\-)•]+$/.test(cleaned)) {
    return false;
  }

  return true;
}

function parseHttpsImageUrl(sourceUrl: string | undefined): string | null {
  const trimmed = sourceUrl?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function readNumericAttr(element: CheerioSelection, name: string): number | null {
  const raw = element.attr(name)?.trim();
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isDecorativeFreshdeskImage(element: CheerioSelection): boolean {
  const alt = element.attr("alt")?.trim() ?? "";
  const className = element.attr("class") ?? "";
  const src = element.attr("src") ?? "";
  const role = element.attr("role")?.trim().toLowerCase() ?? "";
  const ariaHidden = element.attr("aria-hidden")?.trim().toLowerCase();

  if (role === "presentation" || ariaHidden === "true") {
    return true;
  }

  if (alt && DECORATIVE_ALT_PATTERN.test(alt)) {
    return true;
  }

  if (DECORATIVE_CLASS_PATTERN.test(className)) {
    return true;
  }

  if (DECORATIVE_SRC_PATTERN.test(src)) {
    return true;
  }

  const width = readNumericAttr(element, "width");
  const height = readNumericAttr(element, "height");
  if (
    (width !== null && width > 0 && width <= 32) ||
    (height !== null && height > 0 && height <= 32)
  ) {
    return true;
  }

  return false;
}

function nearestPrecedingText(
  texts: string[],
  fromIndex: number,
): string | undefined {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const candidate = texts[index];
    if (candidate && isMeaningfulInstructionText(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function nearestPrecedingHeading(
  headings: Array<{ index: number; text: string }>,
  textIndex: number,
): string | undefined {
  let match: string | undefined;
  for (const heading of headings) {
    if (heading.index <= textIndex) {
      match = heading.text;
    } else {
      break;
    }
  }
  return match;
}

type OrderedNode =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "image";
      sourceUrl: string;
      altText: string | null;
    };

function collectOrderedNodes($: cheerio.CheerioAPI): OrderedNode[] {
  const nodes: OrderedNode[] = [];

  const visit = ($elements: CheerioSelection): void => {
    $elements.each((_index, element) => {
      const $el = $(element);
      const rawName =
        (element as { tagName?: string; name?: string }).tagName ??
        (element as { name?: string }).name ??
        "";
      const tagName = String(rawName).toLowerCase();

      if (tagName === "script" || tagName === "style" || tagName === "noscript") {
        return;
      }

      if (tagName === "img") {
        const sourceUrl = parseHttpsImageUrl($el.attr("src"));
        if (!sourceUrl || isDecorativeFreshdeskImage($el)) {
          return;
        }

        nodes.push({
          kind: "image",
          sourceUrl,
          altText: $el.attr("alt")?.trim() || null,
        });
        return;
      }

      if (HEADING_TAGS.has(tagName)) {
        const text = normalizeWhitespace($el.text());
        if (isMeaningfulInstructionText(text)) {
          nodes.push({ kind: "heading", text });
        }
        return;
      }

      if (TEXT_BLOCK_TAGS.has(tagName)) {
        const clone = $el.clone();
        clone.find("img, script, style").remove();
        const text = normalizeWhitespace(clone.text());
        if (isMeaningfulInstructionText(text)) {
          nodes.push({ kind: "text", text });
        }

        $el.find("img[src]").each((_imgIndex, img) => {
          const $img = $(img);
          const sourceUrl = parseHttpsImageUrl($img.attr("src"));
          if (!sourceUrl || isDecorativeFreshdeskImage($img)) {
            return;
          }

          nodes.push({
            kind: "image",
            sourceUrl,
            altText: $img.attr("alt")?.trim() || null,
          });
        });
        return;
      }

      visit($el.children());
    });
  };

  visit($.root().children());
  return nodes;
}

export type ParsedFreshdeskArticleContent = {
  contentBlocks: FreshdeskArticleContentBlock[];
  images: FreshdeskImageReference[];
  bodyTextFromHtml: string;
};

/**
 * Parse Freshdesk article HTML in DOM order, preserving interleaved text and
 * screenshot references. Decorative images are skipped. Image sourceUrl values
 * are retained for sync matching only and must not be exposed publicly.
 */
export function parseFreshdeskArticleContent(
  html: string,
): ParsedFreshdeskArticleContent {
  const $ = cheerio.load(html || "");
  const ordered = collectOrderedNodes($);

  const contentBlocks: FreshdeskArticleContentBlock[] = [];
  const images: FreshdeskImageReference[] = [];
  const seenImageUrls = new Map<string, number>();
  const textSequence: string[] = [];
  const headingMarkers: Array<{ index: number; text: string }> = [];
  let currentHeading: string | undefined;
  const bodyParts: string[] = [];

  for (const node of ordered) {
    if (node.kind === "heading") {
      currentHeading = node.text;
      textSequence.push(node.text);
      headingMarkers.push({
        index: textSequence.length - 1,
        text: node.text,
      });
      bodyParts.push(node.text);
      contentBlocks.push({
        type: "text",
        text: node.text,
        heading: node.text,
      });
      continue;
    }

    if (node.kind === "text") {
      textSequence.push(node.text);
      bodyParts.push(node.text);
      contentBlocks.push({
        type: "text",
        text: node.text,
        ...(currentHeading ? { heading: currentHeading } : {}),
      });
      continue;
    }

    const imageTextIndex = textSequence.length;
    const precedingText = nearestPrecedingText(textSequence, imageTextIndex);
    const nearbyHeading =
      currentHeading ??
      nearestPrecedingHeading(headingMarkers, imageTextIndex - 1);

    let imageIndex = seenImageUrls.get(node.sourceUrl);
    if (imageIndex === undefined) {
      imageIndex = images.length;
      seenImageUrls.set(node.sourceUrl, imageIndex);
      images.push({
        sourceUrl: node.sourceUrl,
        altText: node.altText,
      });
    } else if (node.altText) {
      images[imageIndex] = {
        sourceUrl: node.sourceUrl,
        altText: node.altText,
      };
    }

    contentBlocks.push({
      type: "image",
      imageIndex,
      sourceUrl: node.sourceUrl,
      altText: node.altText ?? undefined,
      nearbyHeading,
      precedingText,
    });
  }

  const textOnly = contentBlocks
    .map((block, index) =>
      block.type === "text" ? { index, text: block.text } : null,
    )
    .filter((entry): entry is { index: number; text: string } => entry !== null);

  for (let blockIndex = 0; blockIndex < contentBlocks.length; blockIndex += 1) {
    const block = contentBlocks[blockIndex];
    if (!block || block.type !== "image" || block.followingText) {
      continue;
    }

    const nextText = textOnly.find((entry) => entry.index > blockIndex);
    if (nextText) {
      contentBlocks[blockIndex] = {
        ...block,
        followingText: nextText.text,
      };
    }
  }

  return {
    contentBlocks,
    images,
    bodyTextFromHtml: bodyParts.join(" ").replace(/\s+/g, " ").trim(),
  };
}

export function stripHtmlEntitiesForCaption(value: string): string {
  return stripHtmlToText(value);
}
