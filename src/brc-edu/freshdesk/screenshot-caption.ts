import { stripHtmlEntitiesForCaption } from "./article-content-parser.js";

export const FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH = 80;
export const FRESHDESK_SCREENSHOT_CAPTION_FALLBACK =
  "Freshdesk instruction screenshot";

const GENERIC_ALT_PATTERN =
  /^(image|images|img|screenshot|screenshots|photo|picture|graphic|diagram|untitled|show image|a screenshot of a computer|screenshot\s*\d+|image\s*\d+|relevant article section|freshdesk screenshot)$/i;

const INSTRUCTION_PREFIX_PATTERN =
  /^(please\s+)?(then\s+)?(next[,:]?\s+)?(now[,:]?\s+)?/i;

export type ScreenshotCaptionContext = {
  altText?: string | null;
  nearbyHeading?: string | null;
  precedingText?: string | null;
  followingText?: string | null;
};

export function isGenericFreshdeskAltText(
  altText: string | null | undefined,
): boolean {
  const cleaned = stripHtmlEntitiesForCaption(altText ?? "");
  if (!cleaned) {
    return true;
  }

  return GENERIC_ALT_PATTERN.test(cleaned);
}

function truncateCaption(value: string): string {
  const cleaned = stripHtmlEntitiesForCaption(value);
  if (cleaned.length <= FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH) {
    return cleaned;
  }

  const slice = cleaned
    .slice(0, FRESHDESK_SCREENSHOT_CAPTION_MAX_LENGTH - 1)
    .trimEnd();
  const lastSpace = slice.lastIndexOf(" ");
  const base =
    lastSpace >= 40 ? slice.slice(0, lastSpace).trimEnd() : slice.trimEnd();
  return `${base}…`;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9/]+$/.test(word) && word.length <= 4) {
        return word;
      }
      if (word.includes("/")) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Turn nearby instruction text into a concise customer-facing label.
 * Deterministic only — no AI, no guessed UI actions beyond nearby text.
 */
export function instructionTextToCaption(
  text: string,
  nearbyHeading?: string | null,
): string {
  const original = stripHtmlEntitiesForCaption(text);
  let cleaned = original.replace(INSTRUCTION_PREFIX_PATTERN, "").trim();

  if (
    /\ba\/c\s*code\b/i.test(original) &&
    /\b(fill|enter|mandatory|required|details)\b/i.test(original)
  ) {
    const heading = stripHtmlEntitiesForCaption(nearbyHeading ?? "");
    const screen = heading
      ? /screen$/i.test(heading)
        ? heading
        : `${heading} screen`
      : null;
    if (screen) {
      return truncateCaption(`${screen} — enter the required A/C Code`);
    }
    return truncateCaption("enter the required A/C Code");
  }

  const sentenceMatch = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  if (sentenceMatch?.[1]) {
    cleaned = sentenceMatch[1].replace(/[.!?]+$/, "").trim();
  }

  const clickThenClick = cleaned.match(
    /^click\s+(.+?)[,.]?\s+then\s+click\s+(.+)$/i,
  );
  if (clickThenClick) {
    return truncateCaption(
      `${titleCaseWords(clickThenClick[1] ?? "")} — click ${clickThenClick[2]}`,
    );
  }

  const clickTarget = cleaned.match(
    /^click\s+(.+?)(?:\s+on\s+the\s+.+)?$/i,
  );
  if (clickTarget?.[1] && clickTarget[1].length <= 60) {
    const target = clickTarget[1].replace(/[.]+$/, "").trim();
    if (!/^here$/i.test(target)) {
      const labelled = titleCaseWords(target);
      const heading = stripHtmlEntitiesForCaption(nearbyHeading ?? "");
      if (
        heading &&
        /\bcustomer\b/i.test(heading) &&
        /\bemail\s+preferences\b/i.test(labelled)
      ) {
        return truncateCaption(`Customer ${labelled}`);
      }
      return truncateCaption(labelled);
    }
  }

  if (/^(fill in|enter|complete|go to)\b/i.test(cleaned)) {
    return truncateCaption(cleaned);
  }

  return truncateCaption(cleaned);
}

function headingToCaption(heading: string): string {
  return truncateCaption(stripHtmlEntitiesForCaption(heading));
}

/**
 * Build a deterministic screenshot caption using nearby article text only.
 *
 * Priority:
 * 1. meaningful Freshdesk image alt text
 * 2. nearest preceding actionable instruction (click/go/fill/enter)
 * 3. nearest preceding heading
 * 4. nearest preceding other instruction sentence
 * 5. nearest following instruction sentence
 * 6. safe fallback
 *
 * When a heading and a fill/enter instruction are both available, combine them
 * so captions stay descriptive (e.g. "Add Customer screen — enter the required A/C Code").
 */
export function buildFreshdeskScreenshotCaption(
  context: ScreenshotCaptionContext,
): string {
  const alt = stripHtmlEntitiesForCaption(context.altText ?? "");
  if (alt && !isGenericFreshdeskAltText(alt)) {
    return truncateCaption(alt);
  }

  const heading = stripHtmlEntitiesForCaption(context.nearbyHeading ?? "");
  const preceding = stripHtmlEntitiesForCaption(context.precedingText ?? "");
  const following = stripHtmlEntitiesForCaption(context.followingText ?? "");

  if (
    heading &&
    preceding &&
    /\b(fill|enter|complete)\b/i.test(preceding)
  ) {
    return instructionTextToCaption(preceding, heading);
  }

  if (preceding && /^(click|go to|fill|enter|complete)\b/i.test(preceding)) {
    return instructionTextToCaption(preceding, heading || null);
  }

  if (heading) {
    return headingToCaption(heading);
  }

  if (preceding) {
    return instructionTextToCaption(preceding, heading || null);
  }

  if (following) {
    return instructionTextToCaption(following, heading || null);
  }

  return FRESHDESK_SCREENSHOT_CAPTION_FALLBACK;
}
