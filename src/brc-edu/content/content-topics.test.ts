import assert from "node:assert/strict";
import test from "node:test";

import {
  compareContentTopics,
  resolveContentTopic,
  topicLabel,
} from "./content-topics.js";
import { buildContentOverview } from "./content-overview-service.js";
import type { YouTubeCatalogVideo } from "../youtube/youtube-types.js";
import type { FreshdeskCatalogArticle } from "../freshdesk/freshdesk-catalog-types.js";

test("topicLabel maps known keys to friendly labels", () => {
  assert.equal(topicLabel("sales_invoices"), "Sales Invoices");
  assert.equal(topicLabel("general_help"), "General Help");
  assert.equal(topicLabel("cash_book"), "Cash Book");
});

test("resolveContentTopic prefers folder aliases then inference", () => {
  assert.equal(
    resolveContentTopic({ folderName: "Sales Invoices", title: "Anything" })
      .topic,
    "sales_invoices",
  );
  assert.equal(
    resolveContentTopic({ folderName: "Cash Book", title: "Guide" }).topic,
    "cash_book",
  );
  assert.equal(
    resolveContentTopic({
      title: "Year end close",
      helpRoutingCategory: "year_end",
    }).topic,
    "year_end",
  );
});

test("unknown folders are retained under a humanised topic", () => {
  const resolved = resolveContentTopic({
    folderName: "Widget Wizardry",
    title: "Obscure topic",
  });
  assert.equal(resolved.topic, "widget_wizardry");
  assert.equal(resolved.label, "Widget Wizardry");
});

test("compareContentTopics sorts general_help and other last", () => {
  const topics = ["sales", "other", "bank", "general_help"];
  topics.sort(compareContentTopics);
  assert.deepEqual(topics, ["bank", "sales", "general_help", "other"]);
});

test("buildContentOverview groups visible Freshdesk and YouTube by topic", async () => {
  const youtubeItems: YouTubeCatalogVideo[] = [
    {
      videoId: "v1",
      title: "Sales invoice walkthrough",
      description: "Create sales invoices",
      url: "https://www.youtube.com/watch?v=v1",
      publishedAt: "2026-06-02T00:00:00Z",
      channelId: "ch",
      category: "youtube_video",
      playlistIds: [],
      excluded: false,
      lastSyncedAt: "2026-07-01T00:00:00Z",
    },
    {
      videoId: "w1",
      title: "Sales webinar recording",
      description: "Sales invoices deep dive",
      url: "https://www.youtube.com/watch?v=w1",
      publishedAt: "2026-06-03T00:00:00Z",
      channelId: "ch",
      category: "recorded_webinar",
      playlistIds: ["pl"],
      excluded: false,
      lastSyncedAt: "2026-07-01T00:00:00Z",
    },
  ];

  const freshdeskItems: FreshdeskCatalogArticle[] = [
    {
      id: "freshdesk-1",
      source: "freshdesk",
      freshdeskArticleId: 1,
      categoryId: 1,
      folderId: 1,
      folderName: "Sales Invoices",
      title: "How to raise a sales invoice",
      bodyText: "Steps for sales invoices",
      images: [],
      updatedAt: "2026-06-10T00:00:00Z",
      enabled: true,
      slug: "how-to",
      publicUrl:
        "https://bigredcloud.freshdesk.com/support/solutions/articles/1",
      syncedImages: [],
      articleId: "1",
      topic: "sales_invoices",
      topicLabel: "Sales Invoices",
      excluded: false,
      lastSyncedAt: "2026-07-02T00:00:00Z",
      description: "Steps for sales invoices",
      url: "https://bigredcloud.freshdesk.com/support/solutions/articles/1",
    },
  ];

  const overview = await buildContentOverview({
    youtubeContainer: null,
    freshdeskContainer: null,
    adminBasePath: "/internal/brc-edu/admin",
    loadYouTube: async () => ({ items: youtubeItems, excluded: 1 }),
    loadFreshdesk: async () => ({ items: freshdeskItems, excluded: 1 }),
    loadYouTubeStatus: async () => ({ lastSuccessAt: "2026-07-01T00:00:00Z" }),
    loadFreshdeskStatus: async () => ({
      lastSuccessAt: "2026-07-02T00:00:00Z",
    }),
  });

  assert.equal(overview.counts.totalVisible, 3);
  assert.equal(overview.counts.freshdeskArticles, 1);
  assert.equal(overview.counts.youtubeVideos, 1);
  assert.equal(overview.counts.recordedWebinars, 1);
  assert.equal(overview.counts.excluded, 2);
  assert.equal(overview.lastContentRefreshAt, "2026-07-02T00:00:00Z");

  const salesTopic = overview.topics.find(
    (topic) => topic.topic === "sales_invoices" || topic.topic === "sales",
  );
  assert.ok(salesTopic);
  assert.ok(salesTopic!.items.length >= 1);
  assert.ok(
    salesTopic!.items.every((item) => item.type !== undefined),
  );
  assert.equal(
    overview.topics.some((topic) =>
      topic.items.some((item) => item.id === "hidden"),
    ),
    false,
  );

  const manageUrls = salesTopic!.items.map((item) => item.manageUrl);
  assert.ok(
    manageUrls.some((url) => url?.includes("view=freshdesk")) ||
      manageUrls.some((url) => url?.includes("view=youtube")),
  );
});

test("buildContentOverview omits empty topics", async () => {
  const overview = await buildContentOverview({
    loadYouTube: async () => ({ items: [], excluded: 0 }),
    loadFreshdesk: async () => ({ items: [], excluded: 0 }),
  });
  assert.equal(overview.topics.length, 0);
  assert.equal(overview.counts.totalVisible, 0);
});
