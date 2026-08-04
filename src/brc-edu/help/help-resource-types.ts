export const HELP_RESOURCE_SOURCES = [
  "freshdesk",
  "customer_docs",
  "recorded_webinar",
  "youtube_video",
  "upcoming_webinar",
] as const;

export type HelpResourceSource = (typeof HELP_RESOURCE_SOURCES)[number];

export type NormalizedHelpResource = {
  resourceId: string;
  source: HelpResourceSource;
  title: string;
  summary: string;
  bodyText: string;
  url: string;
  registrationUrl?: string;
  category: string;
  topics: string[];
  imageBlobNames: string[];
  eventDay?: string;
  enabled: boolean;
  lastSyncedAt: string;
};

export type HelpSearchResult = {
  resourceId: string;
  source: HelpResourceSource;
  title: string;
  summary: string;
  publicUrl: string | null;
  registrationUrl?: string;
  category: string;
  relevanceScore: number;
  imageAvailable: boolean;
  eventDay?: string;
};

export type HelpResourceSourceFilter = HelpResourceSource | "all";

export function buildHelpResourceId(
  source: HelpResourceSource,
  id: string,
): string {
  return `${source}:${id}`;
}

export function parseHelpResourceId(
  resourceId: string,
): { source: HelpResourceSource; id: string } | null {
  const separator = resourceId.indexOf(":");
  if (separator <= 0) {
    return null;
  }

  const source = resourceId.slice(0, separator) as HelpResourceSource;
  const id = resourceId.slice(separator + 1);

  if (!HELP_RESOURCE_SOURCES.includes(source) || !id) {
    return null;
  }

  return { source, id };
}

export function isPublicHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") {
      return false;
    }

    const blockedProtocols = ["javascript:", "data:", "file:"];
    if (blockedProtocols.some((protocol) => value.trim().toLowerCase().startsWith(protocol))) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
