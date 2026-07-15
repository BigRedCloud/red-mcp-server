import * as cheerio from "cheerio";
import { createHash } from "node:crypto";

import {
  buildHelpResourceId,
  isPublicHttpsUrl,
  type NormalizedHelpResource,
} from "../help/help-resource-types.js";

export const UPCOMING_WEBINAR_PAGE_URL =
  "https://bigredcloud.com/webinar-series/";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const RECORDED_SECTION_MARKERS = [
  "recorded webinars",
  "watch previous webinar sessions",
  "expert hosts",
];

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isZoomRegistrationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname.endsWith("zoom.us") ||
        parsed.hostname.endsWith("zoom.com"))
    );
  } catch {
    return false;
  }
}

function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractSummary(description: string, topics: string[]): string {
  const base = cleanText(description);
  if (base) {
    return base.length > 220 ? `${base.slice(0, 219).trimEnd()}…` : base;
  }

  if (topics.length > 0) {
    return `Recurring live training covering ${topics.slice(0, 4).join(", ")}.`;
  }

  return "Recurring live training session.";
}

export function parseUpcomingWebinarsFromHtml(
  html: string,
  pageUrl: string = UPCOMING_WEBINAR_PAGE_URL,
  syncedAt: string = new Date().toISOString(),
): NormalizedHelpResource[] {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();
  const lowerBody = bodyText.toLowerCase();

  const upcomingStart = lowerBody.indexOf("upcoming webinars");
  const recordedStart = RECORDED_SECTION_MARKERS.map((marker) => lowerBody.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (upcomingStart < 0) {
    return [];
  }

  const sectionEnd =
    recordedStart != null && recordedStart > upcomingStart
      ? recordedStart
      : lowerBody.length;

  const sectionText = bodyText.slice(upcomingStart, sectionEnd);
  const sectionHtml = html.slice(
    Math.max(0, html.toLowerCase().indexOf("upcoming webinars")),
    recordedStart != null && recordedStart > upcomingStart
      ? html.toLowerCase().indexOf("recorded webinars")
      : html.length,
  );

  const $section = cheerio.load(`<div>${sectionHtml}</div>`);
  const webinars: NormalizedHelpResource[] = [];

  $section("h3").each((_, heading) => {
    const title = cleanText($section(heading).text());
    if (!title || /recorded webinar/i.test(title)) {
      return;
    }

    let weekday: string | undefined;
    let previous = $section(heading).prev();
    while (previous.length > 0) {
      const previousText = cleanText(previous.text());
      const matchedWeekday = WEEKDAYS.find((day) => previousText === day);
      if (matchedWeekday) {
        weekday = matchedWeekday;
        break;
      }
      previous = previous.prev();
    }

    const block = $section(heading).parent();
    const blockText = cleanText(block.text());

    const description = cleanText(
      block
        .find("p")
        .map((__, element) => $section(element).text())
        .get()
        .join(" "),
    );

    const topics = block
      .find("li")
      .map((__, element) => cleanText($section(element).text()))
      .get()
      .filter(Boolean);

    let registrationUrl: string | undefined;
    block.find("a[href]").each((__, anchor) => {
      const href = $section(anchor).attr("href")?.trim();
      if (!href || registrationUrl) {
        return;
      }

      if (isYouTubeUrl(href)) {
        return;
      }

      if (isZoomRegistrationUrl(href) && isPublicHttpsUrl(href)) {
        registrationUrl = href;
      }
    });

    const slugBase = `${weekday ?? "session"}-${title}`;
    const slug =
      slugify(slugBase) ||
      createHash("sha256").update(title).digest("hex").slice(0, 16);

    webinars.push({
      resourceId: buildHelpResourceId("upcoming_webinar", slug),
      source: "upcoming_webinar",
      title,
      summary: extractSummary(description, topics),
      bodyText: [description, topics.length ? `Topics: ${topics.join(", ")}` : ""]
        .filter(Boolean)
        .join("\n\n"),
      url: pageUrl,
      registrationUrl,
      category: "Live training",
      topics,
      imageBlobNames: [],
      eventDay: weekday,
      enabled: true,
      lastSyncedAt: syncedAt,
    });
  });

  if (webinars.length === 0) {
    return parseUpcomingWebinarsFromSectionText(sectionText, pageUrl, syncedAt);
  }

  const deduped = new Map<string, NormalizedHelpResource>();
  for (const webinar of webinars) {
    deduped.set(webinar.resourceId, webinar);
  }

  return [...deduped.values()];
}

function parseUpcomingWebinarsFromSectionText(
  sectionText: string,
  pageUrl: string,
  syncedAt: string,
): NormalizedHelpResource[] {
  const lines = sectionText
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);

  const webinars: NormalizedHelpResource[] = [];
  let currentWeekday: string | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (WEEKDAYS.includes(line)) {
      currentWeekday = line;
      continue;
    }

    if (!line.includes(":") || /recorded webinar/i.test(line)) {
      continue;
    }

    const title = line;
    const description = lines[index + 1] ?? "";
    const slug = slugify(`${currentWeekday ?? "session"}-${title}`) || title;

    webinars.push({
      resourceId: buildHelpResourceId("upcoming_webinar", slug),
      source: "upcoming_webinar",
      title,
      summary: extractSummary(description, []),
      bodyText: description,
      url: pageUrl,
      category: "Live training",
      topics: [],
      imageBlobNames: [],
      eventDay: currentWeekday,
      enabled: true,
      lastSyncedAt: syncedAt,
    });
  }

  return webinars;
}

export function shouldIgnoreRecordedWebinarCard(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("recorded webinar") ||
    normalized.includes("watch now") ||
    normalized.includes("youtube")
  );
}
