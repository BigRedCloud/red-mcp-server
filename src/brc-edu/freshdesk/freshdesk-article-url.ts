export const FRESHDESK_PUBLIC_HOST = "bigredcloud.freshdesk.com";

export const FRESHDESK_PUBLIC_ARTICLES_PATH_PREFIX =
  "/support/solutions/articles/";

export const FRESHDESK_PUBLIC_ARTICLES_BASE_URL = `https://${FRESHDESK_PUBLIC_HOST}${FRESHDESK_PUBLIC_ARTICLES_PATH_PREFIX}`;

export const FRESHDESK_LINK_RESPONSE_GUIDANCE =
  "Use the exact publicUrl returned by Red for Freshdesk article links. Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.";

const BLOCKED_URL_PREFIXES = ["javascript:", "data:", "file:"];

const LEGACY_BIGREDCLOUD_SUPPORT_HOST = "bigredcloud.com";

export type FreshdeskArticleUrlInput = {
  freshdeskArticleId: number;
  title?: string | null;
  apiUrl?: string | null;
  apiPath?: string | null;
  apiSlug?: string | null;
  storedPublicUrl?: string | null;
  storedSlug?: string | null;
};

export function slugifyFreshdeskArticleTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[''`´""]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "");
}

export function isFreshdeskPublicArticleUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (BLOCKED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return false;
    }

    if (parsed.username || parsed.password) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== FRESHDESK_PUBLIC_HOST) {
      return false;
    }

    if (!parsed.pathname.startsWith(FRESHDESK_PUBLIC_ARTICLES_PATH_PREFIX)) {
      return false;
    }

    const segment = parsed.pathname.slice(
      FRESHDESK_PUBLIC_ARTICLES_PATH_PREFIX.length,
    );
    return /^\d+-.+/.test(segment);
  } catch {
    return false;
  }
}

export function isLegacyBigredcloudSupportArticleUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") {
      return false;
    }

    return (
      parsed.hostname.toLowerCase() === LEGACY_BIGREDCLOUD_SUPPORT_HOST &&
      parsed.pathname.startsWith("/support/")
    );
  } catch {
    return false;
  }
}

export function extractSlugFromLegacyBigredcloudSupportUrl(
  value: string,
): string | null {
  if (!isLegacyBigredcloudSupportArticleUrl(value)) {
    return null;
  }

  try {
    const pathname = new URL(value.trim()).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1];
    return slug?.trim() ? slug : null;
  } catch {
    return null;
  }
}

export function buildFreshdeskPublicArticleUrl(
  freshdeskArticleId: number,
  slug: string,
): string {
  const normalizedSlug = slug.trim().replace(/^\/+/, "");
  const slugWithoutIdPrefix = normalizedSlug.startsWith(`${freshdeskArticleId}-`)
    ? normalizedSlug.slice(String(freshdeskArticleId).length + 1)
    : normalizedSlug;

  return `${FRESHDESK_PUBLIC_ARTICLES_BASE_URL}${freshdeskArticleId}-${slugWithoutIdPrefix}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function readFreshdeskArticleUrlFields(
  article: Record<string, unknown>,
): {
  apiUrl: string | null;
  apiPath: string | null;
  apiSlug: string | null;
} {
  return {
    apiUrl: normalizeOptionalString(article.url),
    apiPath: normalizeOptionalString(article.path),
    apiSlug: normalizeOptionalString(article.slug),
  };
}

function parseArticleSegmentFromPath(path: string): {
  freshdeskArticleId: number;
  slug: string;
} | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }

  let segment = trimmed;
  if (segment.startsWith(FRESHDESK_PUBLIC_ARTICLES_PATH_PREFIX)) {
    segment = segment.slice(FRESHDESK_PUBLIC_ARTICLES_PATH_PREFIX.length);
  } else if (segment.startsWith("/")) {
    segment = segment.replace(/^\/+/, "");
  }

  const match = segment.match(/^(\d+)-(.+)$/);
  if (!match) {
    return null;
  }

  return {
    freshdeskArticleId: Number(match[1]),
    slug: match[2] ?? "",
  };
}

function resolveFromApiPath(
  freshdeskArticleId: number,
  apiPath: string,
): string | null {
  if (isFreshdeskPublicArticleUrl(apiPath)) {
    return apiPath.trim();
  }

  if (apiPath.startsWith("http://") || apiPath.startsWith("https://")) {
    return isFreshdeskPublicArticleUrl(apiPath) ? apiPath.trim() : null;
  }

  const parsedSegment = parseArticleSegmentFromPath(apiPath);
  if (parsedSegment) {
    if (parsedSegment.freshdeskArticleId !== freshdeskArticleId) {
      return null;
    }

    const url = buildFreshdeskPublicArticleUrl(
      freshdeskArticleId,
      parsedSegment.slug,
    );
    return isFreshdeskPublicArticleUrl(url) ? url : null;
  }

  const url = buildFreshdeskPublicArticleUrl(freshdeskArticleId, apiPath);
  return isFreshdeskPublicArticleUrl(url) ? url : null;
}

function resolveFromTitleSlug(
  freshdeskArticleId: number,
  title: string,
): string | null {
  const slug = slugifyFreshdeskArticleTitle(title);
  if (!slug) {
    return null;
  }

  const url = buildFreshdeskPublicArticleUrl(freshdeskArticleId, slug);
  return isFreshdeskPublicArticleUrl(url) ? url : null;
}

export function resolveFreshdeskArticlePublicUrl(
  input: FreshdeskArticleUrlInput,
): string | null {
  if (input.apiUrl && isFreshdeskPublicArticleUrl(input.apiUrl)) {
    return input.apiUrl.trim();
  }

  if (
    input.storedPublicUrl &&
    isFreshdeskPublicArticleUrl(input.storedPublicUrl)
  ) {
    return input.storedPublicUrl.trim();
  }

  if (input.apiPath) {
    const fromPath = resolveFromApiPath(
      input.freshdeskArticleId,
      input.apiPath,
    );
    if (fromPath) {
      return fromPath;
    }
  }

  if (input.apiSlug) {
    const fromSlug = buildFreshdeskPublicArticleUrl(
      input.freshdeskArticleId,
      input.apiSlug,
    );
    if (isFreshdeskPublicArticleUrl(fromSlug)) {
      return fromSlug;
    }
  }

  if (input.storedSlug) {
    const fromStoredSlug = buildFreshdeskPublicArticleUrl(
      input.freshdeskArticleId,
      input.storedSlug,
    );
    if (isFreshdeskPublicArticleUrl(fromStoredSlug)) {
      return fromStoredSlug;
    }
  }

  if (input.title?.trim()) {
    const fromTitle = resolveFromTitleSlug(
      input.freshdeskArticleId,
      input.title,
    );
    if (fromTitle) {
      return fromTitle;
    }
  }

  if (
    input.storedPublicUrl &&
    isLegacyBigredcloudSupportArticleUrl(input.storedPublicUrl)
  ) {
    const legacySlug = extractSlugFromLegacyBigredcloudSupportUrl(
      input.storedPublicUrl,
    );
    if (legacySlug) {
      const repaired = buildFreshdeskPublicArticleUrl(
        input.freshdeskArticleId,
        legacySlug,
      );
      if (isFreshdeskPublicArticleUrl(repaired)) {
        return repaired;
      }
    }
  }

  return null;
}

export function resolveFreshdeskArticleSlug(
  input: Pick<
    FreshdeskArticleUrlInput,
    "apiSlug" | "storedSlug" | "title" | "storedPublicUrl"
  >,
): string | null {
  if (input.apiSlug) {
    return input.apiSlug;
  }

  if (input.storedSlug) {
    return input.storedSlug;
  }

  if (
    input.storedPublicUrl &&
    isLegacyBigredcloudSupportArticleUrl(input.storedPublicUrl)
  ) {
    return extractSlugFromLegacyBigredcloudSupportUrl(input.storedPublicUrl);
  }

  if (input.title?.trim()) {
    return slugifyFreshdeskArticleTitle(input.title);
  }

  return null;
}

export function repairStoredFreshdeskArticlePublicUrl(input: {
  freshdeskArticleId: number;
  title?: string | null;
  publicUrl?: string | null;
  slug?: string | null;
}): { publicUrl: string | null; slug: string | null } {
  const publicUrl = resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: input.freshdeskArticleId,
    title: input.title,
    storedPublicUrl: input.publicUrl,
    storedSlug: input.slug,
    apiSlug: input.slug,
  });

  const slug = resolveFreshdeskArticleSlug({
    apiSlug: input.slug,
    storedSlug: input.slug,
    title: input.title,
    storedPublicUrl: input.publicUrl,
  });

  return { publicUrl, slug };
}

export function getSyncedFreshdeskArticlePublicUrl(article: {
  freshdeskArticleId: number;
  title: string;
  publicUrl?: string | null;
  slug?: string | null;
}): string | null {
  return resolveFreshdeskArticlePublicUrl({
    freshdeskArticleId: article.freshdeskArticleId,
    title: article.title,
    storedPublicUrl: article.publicUrl,
    storedSlug: article.slug,
    apiSlug: article.slug,
  });
}
