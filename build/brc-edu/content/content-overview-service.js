import { compareContentTopics, compareOverviewItemsByDateThenTitle, resolveContentTopic, topicLabel, } from "./content-topics.js";
import { createConfiguredFreshdeskCatalogContainer, loadFreshdeskEffectiveCatalog, loadFreshdeskOverrides, loadFreshdeskRawArticles, loadFreshdeskSyncStatus, } from "../freshdesk/freshdesk-catalog-store.js";
import { mergeFreshdeskCatalogWithOverrides } from "../freshdesk/freshdesk-catalog-merge.js";
import { createConfiguredYouTubeBlobContainer, loadYouTubeEffectiveCatalog, loadYouTubeOverrides, loadYouTubeRawCatalog, loadYouTubeSyncStatus, } from "../youtube/youtube-catalog-store.js";
import { mergeYouTubeCatalogWithOverrides } from "../youtube/youtube-catalog-merge.js";
import { inferHelpRoutingCategory } from "../../edu/brc_edu_enrichment.js";
export const CONTENT_OVERVIEW_API_PATH = "/internal/brc-edu/content/overview";
function maxIsoDate(left, right) {
    const leftTime = left ? Date.parse(left) : Number.NaN;
    const rightTime = right ? Date.parse(right) : Number.NaN;
    const leftValid = Number.isFinite(leftTime);
    const rightValid = Number.isFinite(rightTime);
    if (leftValid && rightValid) {
        return leftTime >= rightTime ? left : right;
    }
    if (leftValid)
        return left;
    if (rightValid)
        return right;
    return undefined;
}
function youtubeManageUrl(basePath) {
    return `${basePath}?view=youtube`;
}
function freshdeskManageUrl(basePath) {
    return `${basePath}?view=freshdesk`;
}
function youtubeTopic(video) {
    const inferred = inferHelpRoutingCategory(video.title, video.description);
    return resolveContentTopic({
        title: video.title,
        helpRoutingCategory: inferred.category,
    }).topic;
}
function toYouTubeOverviewItem(video, adminBasePath) {
    const topic = youtubeTopic(video);
    return {
        id: video.videoId,
        source: "youtube",
        type: video.category === "recorded_webinar"
            ? "recorded_webinar"
            : "youtube_video",
        title: video.title,
        description: video.description?.slice(0, 200) || undefined,
        url: video.url,
        topic,
        updatedAt: video.updatedAt || video.publishedAt,
        manageUrl: youtubeManageUrl(adminBasePath),
    };
}
function toFreshdeskOverviewItem(article, adminBasePath) {
    return {
        id: article.articleId,
        source: "freshdesk",
        type: "freshdesk_article",
        title: article.title,
        description: article.description,
        url: article.url ?? undefined,
        topic: article.topic,
        updatedAt: article.updatedAt,
        manageUrl: freshdeskManageUrl(adminBasePath),
    };
}
async function loadVisibleYouTubeItems(container) {
    if (!container) {
        return { items: [], excluded: 0 };
    }
    let catalog = await loadYouTubeEffectiveCatalog(container);
    if (!catalog) {
        const raw = await loadYouTubeRawCatalog(container);
        if (!raw) {
            return { items: [], excluded: 0 };
        }
        const overrides = await loadYouTubeOverrides(container);
        catalog = mergeYouTubeCatalogWithOverrides({
            rawVideos: raw.items,
            overrides: overrides.document.overrides,
            channelId: raw.channelId,
            webinarPlaylistId: raw.webinarPlaylistId,
            generatedAt: raw.generatedAt,
        });
    }
    return {
        items: catalog.items.filter((item) => !item.excluded),
        excluded: catalog.excludedCount,
    };
}
async function loadVisibleFreshdeskItems(container) {
    if (!container) {
        return { items: [], excluded: 0 };
    }
    let catalog = await loadFreshdeskEffectiveCatalog(container);
    if (!catalog) {
        const raw = await loadFreshdeskRawArticles(container);
        if (!raw) {
            return { items: [], excluded: 0 };
        }
        const overrides = await loadFreshdeskOverrides(container);
        catalog = mergeFreshdeskCatalogWithOverrides({
            articles: raw.articles,
            overrides: overrides.document.overrides,
            generatedAt: raw.generatedAt,
            lastSyncedAt: raw.generatedAt,
        });
    }
    return {
        items: catalog.items.filter((item) => !item.excluded),
        excluded: catalog.excludedCount,
    };
}
export async function buildContentOverview(deps = {}) {
    const adminBasePath = deps.adminBasePath ?? "/internal/brc-edu/admin";
    const youtubeContainer = deps.youtubeContainer === undefined
        ? createConfiguredYouTubeBlobContainer()
        : deps.youtubeContainer;
    const freshdeskContainer = deps.freshdeskContainer === undefined
        ? createConfiguredFreshdeskCatalogContainer()
        : deps.freshdeskContainer;
    const [youtube, freshdesk, youtubeStatus, freshdeskStatus] = await Promise.all([
        (deps.loadYouTube ?? loadVisibleYouTubeItems)(youtubeContainer),
        (deps.loadFreshdesk ?? loadVisibleFreshdeskItems)(freshdeskContainer),
        deps.loadYouTubeStatus
            ? deps.loadYouTubeStatus(youtubeContainer)
            : youtubeContainer
                ? loadYouTubeSyncStatus(youtubeContainer)
                : Promise.resolve(null),
        deps.loadFreshdeskStatus
            ? deps.loadFreshdeskStatus(freshdeskContainer)
            : freshdeskContainer
                ? loadFreshdeskSyncStatus(freshdeskContainer)
                : Promise.resolve(null),
    ]);
    const overviewItems = [
        ...freshdesk.items.map((article) => toFreshdeskOverviewItem(article, adminBasePath)),
        ...youtube.items.map((video) => toYouTubeOverviewItem(video, adminBasePath)),
    ];
    const topicMap = new Map();
    for (const item of overviewItems) {
        const existing = topicMap.get(item.topic);
        const topic = existing ??
            {
                topic: item.topic,
                label: topicLabel(item.topic),
                counts: {
                    total: 0,
                    freshdeskArticles: 0,
                    youtubeVideos: 0,
                    recordedWebinars: 0,
                },
                items: [],
            };
        topic.items.push(item);
        topic.counts.total += 1;
        if (item.type === "freshdesk_article") {
            topic.counts.freshdeskArticles += 1;
        }
        else if (item.type === "youtube_video") {
            topic.counts.youtubeVideos += 1;
        }
        else {
            topic.counts.recordedWebinars += 1;
        }
        topicMap.set(item.topic, topic);
    }
    const topics = [...topicMap.values()]
        .map((topic) => ({
        ...topic,
        items: [...topic.items].sort(compareOverviewItemsByDateThenTitle),
    }))
        .filter((topic) => topic.items.length > 0)
        .sort((left, right) => compareContentTopics(left.topic, right.topic));
    const youtubeVideos = youtube.items.filter((item) => item.category === "youtube_video").length;
    const recordedWebinars = youtube.items.filter((item) => item.category === "recorded_webinar").length;
    return {
        counts: {
            totalVisible: overviewItems.length,
            freshdeskArticles: freshdesk.items.length,
            youtubeVideos,
            recordedWebinars,
            excluded: youtube.excluded + freshdesk.excluded,
        },
        lastContentRefreshAt: maxIsoDate(youtubeStatus?.lastSuccessAt, freshdeskStatus?.lastSuccessAt),
        topics,
    };
}
