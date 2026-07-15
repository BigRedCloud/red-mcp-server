import { z } from "zod";

import { loadCustomerDocsForHelpSearch } from "../../brc-edu/customer-docs/customer-docs-index-store.js";
import { loadFreshdeskArticlesForHelpSearch } from "../../brc-edu/freshdesk/freshdesk-help-search.js";
import {
  getHelpResourceDetails,
  helpResourceDetailResponse,
} from "../../brc-edu/help/help-resource-details.js";
import { HELP_RESOURCE_SOURCES } from "../../brc-edu/help/help-resource-types.js";
import { buildUnifiedFindHelpResourcesResponse } from "../../brc-edu/help/unified-help-search.js";
import { loadUpcomingWebinarsForHelpSearch } from "../../brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import type { ServerType } from "../../server.js";
import { jsonResponse } from "../../shared.js";

export const FIND_HELP_RESOURCES_TOOL_DESCRIPTION = [
  "Find Big Red Cloud customer help across Freshdesk support articles, customer documentation, recorded webinar videos, and upcoming live webinars.",
  "Use when the customer asks a support question or how-to question about Big Red Cloud.",
  "Do not use for connecting companies, listing connected companies, clearing connections, or any company books data.",
  "Read-only. Does not require a connected company.",
  "Return a concise synthesized answer for the customer: direct answer, clear steps where applicable, then a Helpful resources section with 3–5 descriptive links.",
  "Use only publicUrl values returned in resources for hyperlinks. Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.",
  "Prefer customer documentation for procedural questions, Freshdesk for detailed step-by-step instructions, recorded webinars for video walkthroughs, and upcoming webinars for training/onboarding/live help requests.",
  "Do not show internal resource IDs, Azure blob names, storage URLs, relevance scores, or sync metadata to the customer.",
  "For Freshdesk screenshots or full article text, call brc_get_help_resource_details with the resourceId from search results.",
  "For substantive how-to answers, end with the standard Big Red Cloud support contact footer unless the question is a greeting, unrelated chat, or very short clarification.",
].join(" ");

export const GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION = [
  "Load full help-resource details for a resourceId returned by brc_find_help_resources.",
  "Freshdesk resources return cleaned article text, the canonical Freshdesk publicUrl when available, and may include ordered mirrored screenshots as MCP image content.",
  "Use only the publicUrl returned by this tool for Freshdesk links.",
  "Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.",
  "Customer documentation returns cleaned article text and the public docs URL.",
  "Recorded webinars return title, description, public video URL, and category.",
  "Upcoming webinars return title, weekday, description, topics, registration URL, and webinar-series page URL.",
  "Read-only. Does not require a connected company.",
  "Do not expose Azure blob names, storage URLs, private Freshdesk image URLs, or sync metadata in customer-facing text.",
].join(" ");

export function registerHelpResourcesTools(server: ServerType): void {
  server.tool(
    "brc_find_help_resources",
    FIND_HELP_RESOURCES_TOOL_DESCRIPTION,
    {
      question: z
        .string()
        .min(1)
        .describe(
          "Plain-English help question, for example how do bank feeds work or how do I reconcile my bank account.",
        ),
      category: z
        .string()
        .optional()
        .describe("Optional help category filter, for example bank_feeds or sales."),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum number of matching resources to return. Defaults to 5."),
      source: z
        .enum([...HELP_RESOURCE_SOURCES, "all"])
        .optional()
        .describe(
          "Optional source filter: freshdesk, customer_docs, recorded_webinar, upcoming_webinar, or all.",
        ),
    },
    async ({ question, category, maxResults, source }) => {
      const [
        recordedWebinars,
        freshdeskArticles,
        customerDocs,
        upcomingWebinars,
      ] = await Promise.all([
        loadEnrichedEduResources(),
        loadFreshdeskArticlesForHelpSearch(),
        loadCustomerDocsForHelpSearch(),
        loadUpcomingWebinarsForHelpSearch(),
      ]);

      return jsonResponse(
        buildUnifiedFindHelpResourcesResponse(
          question,
          {
            recordedWebinars,
            freshdeskArticles: freshdeskArticles ?? undefined,
            customerDocs: customerDocs ?? undefined,
            upcomingWebinars: upcomingWebinars ?? undefined,
          },
          {
            category,
            maxResults: maxResults ?? 5,
            sourceFilter: source ?? "all",
          },
        ),
      );
    },
  );

  server.tool(
    "brc_get_help_resource_details",
    GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    {
      resourceId: z
        .string()
        .min(1)
        .describe(
          "Resource ID from brc_find_help_resources, for example customer_docs:bank-reconciliation or freshdesk:1001.",
        ),
    },
    async ({ resourceId }) => {
      const result = await getHelpResourceDetails(resourceId);
      if (!result.ok) {
        return jsonResponse({ error: result.error });
      }

      return helpResourceDetailResponse(result.payload, result.images);
    },
  );
}
