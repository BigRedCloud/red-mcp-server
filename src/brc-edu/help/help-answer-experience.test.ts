import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerFacingSourcesMarkdown,
  buildHelpAnswerSources,
  buildSourcesMarkdownTextBlock,
} from "./help-answer-sources.js";
import {
  COMPANY_SPECIFIC_SUPPORT_MARKDOWN,
  CUSTOMER_FACING_SUPPORT_MARKDOWN,
  SUPPORT_CONTACT_URL,
  resolveSupportFallback,
} from "./help-support-fallback.js";
import { resolveHelpRedActionCapability } from "./help-red-action-capability.js";
import {
  AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE,
  HELP_ANSWER_LAYOUT_GUIDANCE,
  HELP_ANSWER_SECTION_ORDER,
} from "./help-answer-layout.js";
import {
  FIND_HELP_RESOURCES_TOOL_DESCRIPTION,
  GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
} from "../../tools/edu/help_resources_tools.js";
import { getBrcMcpServerInstructions } from "../../config/mcp_config.js";
import {
  buildUnifiedFindHelpResourcesResponse,
  unifiedFindHelpResourcesMcpContent,
} from "./unified-help-search.js";
import type { NormalizedHelpResource } from "./help-resource-types.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";

const FRESHDESK_PUBLIC_URL =
  "https://bigredcloud.freshdesk.com/support/solutions/articles/1001-how-do-i-add-a-customer";

function customerDoc(): NormalizedHelpResource {
  return {
    resourceId: "customer_docs:getting-started",
    source: "customer_docs",
    title: "Getting Started with Big Red Cloud",
    summary: "Get started",
    bodyText: "Getting started guide for Big Red Cloud.",
    url: "https://docs.example.com/getting-started",
    category: "Getting Started",
    topics: ["getting started"],
    imageBlobNames: [],
    enabled: true,
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
  };
}

function freshdeskArticle(): SyncedFreshdeskArticle {
  return {
    id: "freshdesk-1001",
    source: "freshdesk",
    freshdeskArticleId: 1001,
    categoryId: 1,
    folderId: 2,
    folderName: "Customers",
    title: "How do I add a Customer?",
    bodyText: "Click Customers, then click Add.",
    images: [],
    syncedImages: [
      {
        sourceUrl: "https://cdn.freshdesk.com/a.png",
        blobName: "freshdesk/1001/a.png",
        sha256: "00000000000000000000000000000000000000000000000000000000000000ab",
        contentType: "image/png",
        altText: "Add customer",
        order: 0,
      },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: "how-do-i-add-a-customer",
    publicUrl: FRESHDESK_PUBLIC_URL,
  };
}

test("how-to question guidance retrieves details with includeImages=true", () => {
  assert.match(
    FIND_HELP_RESOURCES_TOOL_DESCRIPTION,
    /includeImages=true/i,
  );
  assert.match(
    FIND_HELP_RESOURCES_TOOL_DESCRIPTION,
    /imagePresentation=links/i,
  );
  assert.match(
    GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    /automatically.*includeImages=true/i,
  );
  assert.match(
    GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    /even when the user did not explicitly ask for screenshots/i,
  );

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I add a customer in Big Red Cloud?",
    { freshdeskArticles: [freshdeskArticle()] },
  );
  assert.match(
    response.responseGuidance.format.join(" "),
    /includeImages=true/i,
  );
  assert.match(
    response.responseGuidance.autoScreenshots ?? "",
    /did not explicitly ask for images/i,
  );
});

test("screenshots guidance applies even when the user did not ask for images", () => {
  assert.match(AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE, /did not explicitly ask/i);
  assert.match(
    getBrcMcpServerInstructions(50, false),
    /even when the user did not explicitly ask for images/i,
  );
});

test("screenshots remain beside steps and are not moved into Sources", () => {
  const screenshotUrl =
    "https://red.example.com/public/brc-edu/freshdesk-images/1001/token";
  const sourcesMarkdown = buildCustomerFacingSourcesMarkdown([
    {
      title: "How do I add a Customer?",
      url: FRESHDESK_PUBLIC_URL,
      sourceType: "support_article",
    },
  ]);

  assert.equal(sourcesMarkdown?.includes(screenshotUrl), false);
  assert.equal(sourcesMarkdown?.includes("Adding a customer: Click Add"), false);
  assert.match(
    buildSourcesMarkdownTextBlock(sourcesMarkdown) ?? "",
    /Do not move screenshot links into Sources/i,
  );
  assert.match(HELP_ANSWER_LAYOUT_GUIDANCE, /beside steps/i);
});

test("no screenshots are claimed when none exist", () => {
  assert.match(
    GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    /Do not claim screenshots were supplied when imageCount is 0/i,
  );
  assert.match(
    AUTO_SCREENSHOT_RETRIEVAL_GUIDANCE,
    /Do not claim screenshots were shown when imageCount is 0/i,
  );
});

test("used Freshdesk article appears under Sources with exact publicUrl", () => {
  const response = buildUnifiedFindHelpResourcesResponse("add a customer", {
    customerDocs: [customerDoc()],
    freshdeskArticles: [freshdeskArticle()],
  });

  assert.ok(response.sources.length >= 1);
  assert.ok(response.customerFacingSourcesMarkdown?.startsWith("Sources"));
  const freshdeskSource = response.sources.find(
    (source) => source.sourceType === "support_article",
  );
  assert.equal(freshdeskSource?.url, FRESHDESK_PUBLIC_URL);
  assert.match(
    response.customerFacingSourcesMarkdown ?? "",
    new RegExp(FRESHDESK_PUBLIC_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(
    response.customerFacingSourcesMarkdown?.includes("bigredcloud.com/support/how"),
    false,
  );
});

test("Sources are deduplicated and internal metadata is not exposed", () => {
  const sources = buildHelpAnswerSources([
    {
      title: "How do I add a Customer?",
      source: "freshdesk",
      publicUrl: FRESHDESK_PUBLIC_URL,
    },
    {
      title: "How do I add a Customer? (duplicate)",
      source: "freshdesk",
      publicUrl: FRESHDESK_PUBLIC_URL,
    },
    {
      title: "Getting Started with Big Red Cloud",
      source: "customer_docs",
      publicUrl: "https://docs.example.com/getting-started",
    },
  ]);

  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.url, FRESHDESK_PUBLIC_URL);

  const markdown = buildCustomerFacingSourcesMarkdown(sources);
  assert.equal(markdown?.includes("freshdesk:1001"), false);
  assert.equal(markdown?.includes("blob.core.windows.net"), false);
  assert.equal(markdown?.includes("freshdesk/1001/a.png"), false);
  assert.equal(markdown?.includes("AccountKey="), false);
});

test("Do this through Red appears for customer creation when tool is enabled", () => {
  const capability = resolveHelpRedActionCapability(
    "How do I add a customer in Big Red Cloud?",
    { isToolEnabled: (name) => name === "brc_create_customer" },
  );

  assert.equal(capability.redActionAvailable, true);
  assert.equal(capability.redActionName, "create_customer");
  assert.match(
    capability.customerFacingRedActionMarkdown ?? "",
    /Do this through Red/,
  );
  assert.match(
    capability.customerFacingRedActionMarkdown ?? "",
    /preview before anything is saved/i,
  );
  assert.equal(
    /already (created|saved|posted|changed)/i.test(
      capability.customerFacingRedActionMarkdown ?? "",
    ),
    false,
  );
});

test("Do this through Red appears for supplier and invoice when tools are enabled", () => {
  const supplier = resolveHelpRedActionCapability("How do I create a supplier?", {
    isToolEnabled: (name) => name === "brc_create_supplier",
  });
  assert.equal(supplier.redActionAvailable, true);
  assert.equal(supplier.redActionName, "create_supplier");
  assert.match(supplier.customerFacingRedActionMarkdown ?? "", /preview before posting/i);

  const invoice = resolveHelpRedActionCapability(
    "Show me how to create a sales invoice",
    {
      isToolEnabled: (name) =>
        name === "brc_create_sales_invoice" ||
        name === "brc_create_sales_invoice_gen_ref",
    },
  );
  assert.equal(invoice.redActionAvailable, true);
  assert.equal(invoice.redActionName, "create_sales_invoice");
  assert.match(invoice.customerFacingRedActionMarkdown ?? "", /preview before posting/i);
});

test("Do this through Red is omitted when no matching operational tool exists", () => {
  const bankRec = resolveHelpRedActionCapability(
    "How do I reconcile my bank?",
    { isToolEnabled: () => true },
  );
  assert.equal(bankRec.redActionAvailable, false);
  assert.equal(bankRec.customerFacingRedActionMarkdown, undefined);

  const disabledCustomer = resolveHelpRedActionCapability(
    "How do I add a customer?",
    { isToolEnabled: () => false },
  );
  assert.equal(disabledCustomer.redActionAvailable, false);
});

test("support appears after Sources and Red-action with exact contact URL", () => {
  assert.deepEqual([...HELP_ANSWER_SECTION_ORDER], [
    "tutorial_steps_and_screenshots",
    "sources",
    "red_action",
    "support",
  ]);

  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I add a customer in Big Red Cloud?",
    { freshdeskArticles: [freshdeskArticle()] },
    undefined,
  );

  // Force a known-enabled create_customer capability for MCP content ordering.
  const withRedAction = {
    ...response,
    redActionAvailable: true,
    redActionName: "create_customer" as const,
    customerFacingRedActionMarkdown: [
      "Do this through Red",
      "",
      "You can also create the customer directly here through Red. I'll collect the required customer details and show you a preview before anything is saved.",
    ].join("\n"),
    supportFallbackRecommended: true,
    supportFallbackReason: "incomplete_answer" as const,
    customerFacingSupportMarkdown: CUSTOMER_FACING_SUPPORT_MARKDOWN,
  };

  const mcp = unifiedFindHelpResourcesMcpContent(withRedAction);
  const texts = mcp.content.map((block) => block.text);
  const sourcesIndex = texts.findIndex((text) =>
    text.includes("Include the following exact Sources Markdown"),
  );
  const redIndex = texts.findIndex((text) =>
    text.includes("When redActionAvailable is true"),
  );
  const supportIndex = texts.findIndex((text) =>
    text.includes("Place it last, after Sources"),
  );

  assert.ok(sourcesIndex > 0);
  assert.ok(redIndex > sourcesIndex);
  assert.ok(supportIndex > redIndex);

  assert.equal(SUPPORT_CONTACT_URL, "https://bigredcloud.com/contact/");
  assert.match(CUSTOMER_FACING_SUPPORT_MARKDOWN, /https:\/\/bigredcloud\.com\/contact\//);
});

test("support link appears when no strong answer is found", () => {
  const response = buildUnifiedFindHelpResourcesResponse(
    "completely unrelated zzqx topic",
    {
      customerDocs: [customerDoc()],
      freshdeskArticles: [freshdeskArticle()],
    },
  );

  assert.equal(response.matchCount, 0);
  assert.equal(response.supportFallbackRecommended, true);
  assert.equal(response.supportFallbackReason, "no_strong_match");
  assert.equal(response.supportUrl, SUPPORT_CONTACT_URL);
  assert.equal(response.contactUrl, SUPPORT_CONTACT_URL);
  assert.equal(
    response.customerFacingSupportMarkdown,
    CUSTOMER_FACING_SUPPORT_MARKDOWN,
  );
});

test("support link appears for company-specific settings and is omitted for complete answers", () => {
  const fallback = resolveSupportFallback({
    matchCount: 2,
    strongestScore: 500,
    hasRelevantSourceOrScreenshot: true,
    companySpecific: true,
  });

  assert.equal(fallback.supportFallbackRecommended, true);
  assert.equal(fallback.supportFallbackReason, "company_specific_settings");
  assert.equal(
    fallback.customerFacingSupportMarkdown,
    COMPANY_SPECIFIC_SUPPORT_MARKDOWN,
  );

  const response = buildUnifiedFindHelpResourcesResponse("add a customer", {
    freshdeskArticles: [freshdeskArticle()],
  });
  assert.ok(response.matchCount > 0);
  assert.equal(response.supportFallbackRecommended, false);
  assert.equal(response.customerFacingSupportMarkdown, undefined);
  assert.equal(response.supportFallbackUrl, null);
});

test("never claims no Freshdesk article exists when a matching article was returned", () => {
  const response = buildUnifiedFindHelpResourcesResponse(
    "How do I add a customer in Big Red Cloud?",
    { freshdeskArticles: [freshdeskArticle()] },
  );

  assert.ok(response.resources.some((resource) => resource.source === "freshdesk"));
  assert.match(
    response.responseGuidance.format.join(" "),
    /never claim no dedicated help article exists/i,
  );
  assert.match(
    FIND_HELP_RESOURCES_TOOL_DESCRIPTION,
    /Never claim no Freshdesk article exists/i,
  );
});

test("interaction-mode clarification feature is not restored", () => {
  const instructions = getBrcMcpServerInstructions(50, false);
  assert.equal(/helpInteractionMode/i.test(instructions), false);
  assert.equal(
    /Would you like instructions for doing this in Big Red Cloud, or would you like to do it here through Red/i.test(
      instructions,
    ),
    false,
  );
  assert.equal(
    /ask once.*tutorial versus Red/i.test(
      FIND_HELP_RESOURCES_TOOL_DESCRIPTION + GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    ),
    false,
  );
});

test("find-help MCP content includes ready-to-use Sources Markdown", () => {
  const payload = buildUnifiedFindHelpResourcesResponse("add a customer", {
    freshdeskArticles: [freshdeskArticle()],
  });
  const mcp = unifiedFindHelpResourcesMcpContent(payload);

  assert.equal(mcp.content[0]?.type, "text");
  assert.ok(mcp.content.some((block) => block.text.includes("Sources")));
  assert.ok(
    mcp.content.some((block) => block.text.includes(FRESHDESK_PUBLIC_URL)),
  );
  assert.equal(
    mcp.content.some((block) => block.text.includes("freshdesk/1001")),
    false,
  );
});
