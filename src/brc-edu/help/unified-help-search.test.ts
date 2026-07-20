import assert from "node:assert/strict";
import test from "node:test";

import { parseEnrichedEduCsv } from "../../edu/brc_edu_resources.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";
import type { NormalizedHelpResource } from "./help-resource-types.js";
import {
  buildUnifiedFindHelpResourcesResponse,
  isTrainingOrLiveHelpQuery,
  searchUnifiedHelpResources,
} from "./unified-help-search.js";

const BANK_RECON_CANONICAL_URL =
  "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368991-how-do-i-do-the-bank-reconciliation-bank-rec-";

const WEBINAR_CSV = [
  "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview",
  "Bank Reconciliation Webinar,https://www.youtube.com/watch?v=bank-rec,bank_feeds,bank reconciliation,Video walkthrough,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
].join("\n");

const TRAINING_VIDEOS_CSV = [
  "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview",
  '"Sales Invoices, Cash Book and Bank Rec in Big Red Cloud",https://www.youtube.com/watch?v=sales-invoices-cash-bank,sales_cash_bank_rec,"sales invoices, cash book, bank reconciliation","Sales invoices cash book and bank rec walkthrough",true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false',
  "Bank Reconciliation Webinar,https://www.youtube.com/watch?v=bank-rec,bank_feeds,bank reconciliation,Video walkthrough of bank reconciliation,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
  "Getting Started with Big Red Cloud,https://www.youtube.com/watch?v=getting-started,getting_started,getting started overview,Generic onboarding overview,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
  "API Keys and Users Overview,https://www.youtube.com/watch?v=api-keys,admin,api key users login,API and user administration,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
].join("\n");

function freshdeskArticle(): SyncedFreshdeskArticle {
  return {
    id: "freshdesk-1001",
    source: "freshdesk",
    freshdeskArticleId: 1001,
    categoryId: 1,
    folderId: 2,
    folderName: "Cash Book",
    title: "Complete a bank reconciliation",
    bodyText:
      "Step one open the cash book. Step two match transactions. Step three complete the reconciliation.",
    images: [],
    syncedImages: [{ sourceUrl: "https://cdn.freshdesk.com/a.png", blobName: "freshdesk/1001/a.png", sha256: "a", contentType: "image/png" }],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: null,
    publicUrl: null,
  };
}

function customerDoc(): NormalizedHelpResource {
  return {
    resourceId: "customer_docs:bank-reconciliation",
    source: "customer_docs",
    title: "Completing a Bank Reconciliation",
    summary: "Customer guide for bank reconciliation.",
    bodyText:
      "Use the cash book to match transactions and complete the bank reconciliation process.",
    url: "https://bigredcloud.com/docs/cash-book/bank-reconciliation/",
    category: "Cash Book",
    topics: ["bank", "reconciliation"],
    imageBlobNames: [],
    enabled: true,
    lastSyncedAt: "2026-07-15T10:00:00.000Z",
  };
}

function upcomingWebinar(): NormalizedHelpResource {
  return {
    resourceId: "upcoming_webinar:onboarding-3",
    source: "upcoming_webinar",
    title: "Onboarding 3: Sales, Cash Book & Bank Reconciliation",
    summary: "Recurring live training on sales and bank reconciliation.",
    bodyText: "Learn sales entries and bank reconciliation live.",
    url: "https://bigredcloud.com/webinar-series/",
    registrationUrl: "https://zoom.us/meeting/register/onboarding-3",
    category: "Live training",
    topics: ["Sales Entries", "Bank Reconciliation"],
    imageBlobNames: [],
    eventDay: "Wednesday",
    enabled: true,
    lastSyncedAt: "2026-07-15T10:00:00.000Z",
  };
}

test("searchUnifiedHelpResources searches all four sources", () => {
  const results = searchUnifiedHelpResources(
    "bank reconciliation",
    {
      customerDocs: [customerDoc()],
      freshdeskArticles: [freshdeskArticle()],
      recordedWebinars: parseEnrichedEduCsv(WEBINAR_CSV),
      upcomingWebinars: [upcomingWebinar()],
    },
    { maxResults: 10 },
  );

  const sources = new Set(results.map((result) => result.source));
  assert.ok(sources.has("customer_docs"));
  assert.ok(sources.has("freshdesk"));
  assert.ok(sources.has("recorded_webinar"));
});

test("procedural bank reconciliation query prefers Freshdesk article", () => {
  const bankRec: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    title: "How do I do the Bank Reconciliation (Bank Rec)?",
    publicUrl: BANK_RECON_CANONICAL_URL,
  };
  const results = searchUnifiedHelpResources(
    "how do I complete a bank reconciliation",
    {
      customerDocs: [customerDoc()],
      freshdeskArticles: [bankRec],
      recordedWebinars: parseEnrichedEduCsv(WEBINAR_CSV),
    },
  );

  assert.equal(results[0]?.source, "freshdesk");
  assert.match(results[0]?.title ?? "", /Bank Reconciliation/i);
});

test("video query includes recorded webinar", () => {
  const results = searchUnifiedHelpResources("bank reconciliation video walkthrough", {
    customerDocs: [customerDoc()],
    recordedWebinars: parseEnrichedEduCsv(WEBINAR_CSV),
  });

  assert.ok(results.some((result) => result.source === "recorded_webinar"));
});

test("training query includes upcoming webinar", () => {
  assert.equal(isTrainingOrLiveHelpQuery("I need onboarding training"), true);

  const results = searchUnifiedHelpResources("onboarding training webinar", {
    upcomingWebinars: [upcomingWebinar()],
    customerDocs: [customerDoc()],
  });

  assert.ok(results.some((result) => result.source === "upcoming_webinar"));
});

test("semantically duplicated resources are deduplicated", () => {
  const duplicateWebinar = {
    ...upcomingWebinar(),
    resourceId: "upcoming_webinar:onboarding-3-copy",
    registrationUrl: "https://zoom.us/meeting/register/onboarding-3",
  };

  const results = searchUnifiedHelpResources("onboarding training", {
    upcomingWebinars: [upcomingWebinar(), duplicateWebinar],
  });

  assert.equal(results.length, 1);
});

test("max result limit is enforced", () => {
  const results = searchUnifiedHelpResources(
    "bank reconciliation",
    {
      customerDocs: [customerDoc()],
      freshdeskArticles: [freshdeskArticle()],
      recordedWebinars: parseEnrichedEduCsv(WEBINAR_CSV),
      upcomingWebinars: [upcomingWebinar()],
    },
    { maxResults: 2 },
  );

  assert.equal(results.length, 2);
});

test("search results expose public URLs only and mark Freshdesk image availability", () => {
  const results = searchUnifiedHelpResources("bank reconciliation", {
    customerDocs: [customerDoc()],
    freshdeskArticles: [freshdeskArticle()],
  });

  const doc = results.find((result) => result.source === "customer_docs");
  assert.match(doc?.publicUrl ?? "", /^https:\/\//);

  const fd = results.find((result) => result.source === "freshdesk");
  assert.equal(
    fd?.publicUrl,
    "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-complete-a-bank-reconciliation",
  );
  assert.equal(fd?.imageAvailable, true);
  assert.notEqual(fd?.publicUrl, null);
});

test("buildUnifiedFindHelpResourcesResponse includes synthesized answer guidance", () => {
  const response = buildUnifiedFindHelpResourcesResponse(
    "bank reconciliation",
    {
      customerDocs: [customerDoc()],
    },
  );

  assert.match(
    response.responseGuidance.format.join(" "),
    /concise synthesized direct answer/i,
  );
  assert.match(response.responseGuidance.supportFooter, /bigredcloud.com\/contact/);
  assert.match(
    response.responseGuidance.format.join(" "),
    /bigredcloud\.freshdesk\.com/i,
  );
  assert.match(
    response.responseGuidance.format.join(" "),
    /Sources/i,
  );
  assert.match(
    response.responseGuidance.autoScreenshots ?? "",
    /includeImages=true/i,
  );
});

test("bank reconciliation Freshdesk search returns exact canonical URL", () => {
  const article: SyncedFreshdeskArticle = {
    id: "freshdesk-157000368991",
    source: "freshdesk",
    freshdeskArticleId: 157000368991,
    categoryId: 1,
    folderId: 2,
    folderName: "Cash Book",
    title: "How do I do the Bank Reconciliation (Bank Rec)?",
    bodyText: "Open the cash book and complete the bank reconciliation.",
    images: [],
    syncedImages: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: "how-do-i-do-the-bank-reconciliation-bank-rec-",
    publicUrl: BANK_RECON_CANONICAL_URL,
  };

  const results = searchUnifiedHelpResources("bank reconciliation", {
    freshdeskArticles: [article],
  });

  const freshdesk = results.find((result) => result.source === "freshdesk");
  assert.equal(freshdesk?.publicUrl, BANK_RECON_CANONICAL_URL);
  assert.notEqual(
    freshdesk?.publicUrl,
    "https://bigredcloud.com/support/how-do-i-do-the-bank-reconciliation-bank-rec/",
  );
});

test("add a customer ranks Add Customer ahead of Opening Balance", () => {
  const addCustomer: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-2001",
    freshdeskArticleId: 2001,
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    syncedImages: [],
  };
  const openingBalance: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-2002",
    freshdeskArticleId: 2002,
    title: "How do I add a Customer Opening Balance?",
    bodyText: "Enter the opening balance for an existing customer.",
    syncedImages: [],
  };

  const results = searchUnifiedHelpResources("add a customer", {
    freshdeskArticles: [openingBalance, addCustomer],
  });

  assert.equal(results[0]?.title, "How do I add a Customer?");
  assert.ok(
    (results.findIndex((result) => result.title.includes("Opening Balance")) ===
      -1) ||
      results[0]?.title === "How do I add a Customer?",
  );
});

test("customer opening balance ranks Opening Balance article first", () => {
  const addCustomer: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-2001",
    freshdeskArticleId: 2001,
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    syncedImages: [],
  };
  const openingBalance: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-2002",
    freshdeskArticleId: 2002,
    title: "How do I add a Customer Opening Balance?",
    bodyText: "Enter the opening balance for an existing customer.",
    syncedImages: [],
  };

  const results = searchUnifiedHelpResources("customer opening balance", {
    freshdeskArticles: [addCustomer, openingBalance],
  });

  assert.equal(
    results[0]?.title,
    "How do I add a Customer Opening Balance?",
  );
});

test("add my first customer still prefers Add Customer over Opening Balance", () => {
  const addCustomer: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-2001",
    freshdeskArticleId: 2001,
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    syncedImages: [],
  };
  const openingBalance: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-2002",
    freshdeskArticleId: 2002,
    title: "How do I add a Customer Opening Balance?",
    bodyText: "Enter the opening balance for an existing customer.",
    syncedImages: [],
  };

  const results = searchUnifiedHelpResources(
    "How do I add my first customer?",
    {
      freshdeskArticles: [openingBalance, addCustomer],
    },
  );

  assert.equal(results[0]?.title, "How do I add a Customer?");
});

test("How do I add a customer in Big Red Cloud ranks freshdesk:157000368447 first", () => {
  const addCustomer: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-157000368447",
    freshdeskArticleId: 157000368447,
    folderName: "Customers",
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    syncedImages: [],
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer",
  };
  const login: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-login",
    freshdeskArticleId: 9001,
    title: "How do I log in to Big Red Cloud?",
    bodyText: "Enter your username, password and API key.",
    syncedImages: [],
  };
  const users: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-users",
    freshdeskArticleId: 9002,
    title: "How do I add a User?",
    bodyText: "Open Users and add a new user.",
    syncedImages: [],
  };

  const results = searchUnifiedHelpResources(
    "How do I add a customer in Big Red Cloud?",
    {
      freshdeskArticles: [login, users, addCustomer],
      recordedWebinars: parseEnrichedEduCsv(WEBINAR_CSV),
      upcomingWebinars: [upcomingWebinar()],
    },
  );

  assert.equal(results[0]?.resourceId, "freshdesk:157000368447");
  assert.equal(results[0]?.title, "How do I add a Customer?");
});

test("reconcile my bank finds Bank Reconciliation on the first request", () => {
  const bankRec: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-157000368991",
    freshdeskArticleId: 157000368991,
    title: "How do I do the Bank Reconciliation (Bank Rec)?",
    bodyText: "Open the cash book and complete the bank reconciliation.",
    syncedImages: [],
    publicUrl: BANK_RECON_CANONICAL_URL,
  };
  const login: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-login",
    freshdeskArticleId: 9001,
    title: "How do I log in to Big Red Cloud?",
    bodyText: "Enter your username and password for Big Red Cloud.",
    syncedImages: [],
  };

  const fullQuestion = searchUnifiedHelpResources(
    "How do I reconcile my bank in Big Red Cloud?",
    { freshdeskArticles: [login, bankRec] },
  );
  const bankRecQuery = searchUnifiedHelpResources("bank rec", {
    freshdeskArticles: [login, bankRec],
  });
  const reconcileQuery = searchUnifiedHelpResources("reconcile my bank", {
    freshdeskArticles: [login, bankRec],
  });

  assert.equal(fullQuestion[0]?.resourceId, "freshdesk:157000368991");
  assert.equal(bankRecQuery[0]?.resourceId, "freshdesk:157000368991");
  assert.equal(reconcileQuery[0]?.resourceId, "freshdesk:157000368991");
});

test("Sources include only used resources, not login or webinar hits", () => {
  const addCustomer: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-157000368447",
    freshdeskArticleId: 157000368447,
    folderName: "Customers",
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    syncedImages: [],
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer",
  };
  const login: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-login",
    freshdeskArticleId: 9001,
    title: "How do I log in to Big Red Cloud?",
    bodyText: "API key and login for Big Red Cloud users.",
    syncedImages: [],
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/9001-login",
  };

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I add a customer in Big Red Cloud?",
    {
      freshdeskArticles: [login, addCustomer],
      recordedWebinars: parseEnrichedEduCsv(WEBINAR_CSV),
      upcomingWebinars: [upcomingWebinar()],
      customerDocs: [customerDoc()],
    },
  );

  assert.deepEqual(response.usedResourceIds, ["freshdesk:157000368447"]);
  assert.equal(response.sources.length, 1);
  assert.equal(response.sources[0]?.title, "How do I add a Customer?");
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("log in"),
    false,
  );
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("Webinar"),
    false,
  );
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("API"),
    false,
  );
  assert.match(
    response.responseGuidance.format.join(" "),
    /never claim no dedicated help article exists/i,
  );
  assert.ok(response.customerFacingAnswerSectionsMarkdown?.startsWith("Sources"));
  assert.match(response.customerFacingSourcesMarkdown ?? "", /Articles/);
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("Videos"),
    false,
  );
  const sections = response.customerFacingAnswerSectionsMarkdown ?? "";
  const sourcesPos = sections.indexOf("Sources");
  const redPos = sections.indexOf("Do this through Red");
  const supportPos = sections.indexOf("Still need help?");
  assert.ok(sourcesPos >= 0);
  assert.ok(supportPos > sourcesPos);
  if (response.redActionAvailable) {
    assert.ok(redPos > sourcesPos);
    assert.ok(supportPos > redPos);
  }
  assert.equal(
    response.customerFacingSupportMarkdown?.includes(
      "https://bigredcloud.com/contact/",
    ),
    true,
  );
});

test("sales invoice help automatically includes the relevant training video", () => {
  const salesBook: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-sales-book",
    freshdeskArticleId: 2001,
    folderName: "Sales",
    title: "Sales Book Explained",
    bodyText: "How to create a sales invoice in the sales book.",
    syncedImages: [],
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/2001-sales-book-explained",
  };

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I create a sales invoice?",
    {
      freshdeskArticles: [salesBook],
      recordedWebinars: parseEnrichedEduCsv(TRAINING_VIDEOS_CSV),
    },
  );

  assert.ok(response.usedResourceIds.includes("freshdesk:2001"));
  assert.ok(
    response.usedResourceIds.some((id) => id.startsWith("recorded_webinar:")),
  );
  assert.equal(response.sources[0]?.sourceType, "support_article");
  assert.equal(response.sources[0]?.title, "Sales Book Explained");

  const videoSource = response.sources.find(
    (source) => source.sourceType === "recorded_webinar",
  );
  assert.ok(videoSource);
  assert.match(videoSource?.title ?? "", /Sales Invoices/i);
  assert.equal(
    videoSource?.url,
    "https://www.youtube.com/watch?v=sales-invoices-cash-bank",
  );

  const markdown = response.customerFacingSourcesMarkdown ?? "";
  assert.match(markdown, /Articles/);
  assert.match(markdown, /Videos/);
  assert.match(
    markdown,
    /\[Sales Invoices, Cash Book and Bank Rec in Big Red Cloud\]\(https:\/\/www\.youtube\.com\/watch\?v=sales-invoices-cash-bank\)/,
  );
  assert.equal(markdown.includes("API Keys"), false);
  assert.equal(markdown.includes("Getting Started"), false);
});

test("bank reconciliation help automatically includes a relevant video when available", () => {
  const bankRec: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    title: "How do I do the Bank Reconciliation (Bank Rec)?",
    publicUrl: BANK_RECON_CANONICAL_URL,
  };

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I reconcile my bank?",
    {
      freshdeskArticles: [bankRec],
      recordedWebinars: parseEnrichedEduCsv(TRAINING_VIDEOS_CSV),
    },
  );

  assert.ok(response.usedResourceIds[0]?.startsWith("freshdesk:"));
  const videoSource = response.sources.find(
    (source) => source.sourceType === "recorded_webinar",
  );
  assert.ok(videoSource);
  assert.match(videoSource?.title ?? "", /Bank Reconciliation/i);
  assert.equal(
    videoSource?.url,
    "https://www.youtube.com/watch?v=bank-rec",
  );
  assert.match(response.customerFacingSourcesMarkdown ?? "", /Videos/);
  assert.match(
    response.customerFacingSourcesMarkdown ?? "",
    /https:\/\/www\.youtube\.com\/watch\?v=bank-rec/,
  );
});

test("Videos heading is omitted when no strong video match exists", () => {
  const addCustomer: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-157000368447",
    freshdeskArticleId: 157000368447,
    folderName: "Customers",
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    syncedImages: [],
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer",
  };

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I add a customer in Big Red Cloud?",
    {
      freshdeskArticles: [addCustomer],
      recordedWebinars: parseEnrichedEduCsv(TRAINING_VIDEOS_CSV),
    },
  );

  assert.deepEqual(response.usedResourceIds, ["freshdesk:157000368447"]);
  assert.equal(response.sources.length, 1);
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("Videos"),
    false,
  );
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("youtube.com"),
    false,
  );
});

test("irrelevant webinars are excluded from Sources Videos", () => {
  const salesBook: SyncedFreshdeskArticle = {
    ...freshdeskArticle(),
    id: "freshdesk-sales-book",
    freshdeskArticleId: 2001,
    folderName: "Sales",
    title: "Sales Book Explained",
    bodyText: "How to create a sales invoice in the sales book.",
    syncedImages: [],
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/2001-sales-book-explained",
  };

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I create a sales invoice?",
    {
      freshdeskArticles: [salesBook],
      recordedWebinars: parseEnrichedEduCsv(TRAINING_VIDEOS_CSV),
    },
  );

  const markdown = response.customerFacingSourcesMarkdown ?? "";
  assert.equal(markdown.includes("API Keys and Users Overview"), false);
  assert.equal(markdown.includes("watch?v=api-keys"), false);
  assert.equal(markdown.includes("Getting Started with Big Red Cloud"), false);
  assert.equal(markdown.includes("watch?v=getting-started"), false);
  assert.match(markdown, /Sales Invoices, Cash Book and Bank Rec/);
});
