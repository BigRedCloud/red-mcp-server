import type { EnrichedEduResource } from "../../edu/brc_edu_enrichment.js";
import {
  enrichSupportEduRows,
  inferHelpRoutingCategory,
  type SupportEduRow,
} from "../../edu/brc_edu_enrichment.js";
import type { YouTubeCatalogVideo } from "./youtube-types.js";

export function catalogVideoToSupportRow(video: YouTubeCatalogVideo): SupportEduRow {
  return {
    title: video.title,
    url: video.url,
    notes: video.description,
    preferredCategory: undefined,
    active: !video.excluded,
  };
}

export function catalogVideosToEnrichedResources(
  videos: YouTubeCatalogVideo[],
  options?: { reviewDate?: Date; includeExcluded?: boolean },
): EnrichedEduResource[] {
  const includeExcluded = options?.includeExcluded === true;
  const visible = includeExcluded ? videos : videos.filter((video) => !video.excluded);
  const supportRows = visible.map(catalogVideoToSupportRow);
  const enriched = enrichSupportEduRows(supportRows, {
    reviewDate: options?.reviewDate,
    generatedFrom: "youtube-effective-catalog",
  });

  return enriched.map((resource, index) => {
    const video = visible[index]!;
    const inference = inferHelpRoutingCategory(
      video.title,
      video.description,
      undefined,
    );

    return {
      ...resource,
      helpRoutingCategory: inference.category,
      description: video.description || resource.description,
      contentType: video.category === "recorded_webinar" ? "webinar" : "video",
      isActive: !video.excluded,
      videoId: video.videoId,
      youtubeCategory: video.category,
    };
  });
}
