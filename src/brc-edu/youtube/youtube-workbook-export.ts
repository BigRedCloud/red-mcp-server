import ExcelJS from "exceljs";

import type { YouTubeCatalogVideo, YouTubeEffectiveCatalog } from "./youtube-types.js";

export const YOUTUBE_WORKBOOK_HEADERS = [
  "Video ID",
  "Video Title",
  "Video URL",
  "Description",
  "Published Date",
  "Video Type",
  "Playlist IDs",
  "Visible in Red",
  "Excluded By",
  "Excluded At",
  "Exclusion Reason",
  "Last Synced",
  // Compatibility columns for the existing enrichment / blob → Red pipeline.
  "Help-Routing Category",
  "Active",
  "Resource Type",
] as const;

export type YouTubeWorkbookRow = {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  description: string;
  publishedDate: string;
  videoType: string;
  playlistIds: string;
  visibleInRed: string;
  excludedBy: string;
  excludedAt: string;
  exclusionReason: string;
  lastSynced: string;
  helpRoutingCategory: string;
  active: string;
  resourceType: string;
};

function categoryLabel(category: YouTubeCatalogVideo["category"]): string {
  return category === "recorded_webinar" ? "recorded_webinar" : "youtube_video";
}

function resourceTypeLabel(category: YouTubeCatalogVideo["category"]): string {
  return category === "recorded_webinar" ? "webinar" : "video";
}

/**
 * Maps a catalogue video into workbook rows. Help-routing category is left as
 * general_help here; Red enrichment still infers categories from title/description
 * when the compatibility sync path runs.
 */
export function catalogVideoToWorkbookRow(
  video: YouTubeCatalogVideo,
): YouTubeWorkbookRow {
  return {
    videoId: video.videoId,
    videoTitle: video.title,
    videoUrl: video.url,
    description: video.description,
    publishedDate: video.publishedAt.slice(0, 10),
    videoType: categoryLabel(video.category),
    playlistIds: video.playlistIds.join(", "),
    visibleInRed: video.excluded ? "No" : "Yes",
    excludedBy: video.excludedBy ?? "",
    excludedAt: video.excludedAt ?? "",
    exclusionReason: video.exclusionReason ?? "",
    lastSynced: video.lastSyncedAt,
    helpRoutingCategory: "general_help",
    active: video.excluded ? "No" : "Yes",
    resourceType: resourceTypeLabel(video.category),
  };
}

export function effectiveCatalogToWorkbookRows(
  catalog: YouTubeEffectiveCatalog,
): YouTubeWorkbookRow[] {
  return catalog.items.map(catalogVideoToWorkbookRow);
}

export async function buildYouTubeWorkbookBuffer(
  catalog: YouTubeEffectiveCatalog,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("YouTube Videos");
  const rows = effectiveCatalogToWorkbookRows(catalog);

  worksheet.addRow([...YOUTUBE_WORKBOOK_HEADERS]);

  for (const row of rows) {
    worksheet.addRow([
      row.videoId,
      row.videoTitle,
      row.videoUrl,
      row.description,
      row.publishedDate,
      row.videoType,
      row.playlistIds,
      row.visibleInRed,
      row.excludedBy,
      row.excludedAt,
      row.exclusionReason,
      row.lastSynced,
      row.helpRoutingCategory,
      row.active,
      row.resourceType,
    ]);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
