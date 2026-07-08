import { z } from "zod";
import { findHelpResources, loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import { jsonResponse } from "../../shared.js";
export const FIND_HELP_RESOURCES_TOOL_DESCRIPTION = [
    "Find Big Red Cloud help videos, webinars, and support resources for how-to questions.",
    "Use when the user asks how to do something in Big Red Cloud and a relevant video or webinar may help.",
    "Does not require a connected company.",
    "Returns titles, URLs, categories, and short descriptions from the enriched BRC Edu routing CSV.",
].join(" ");
export function registerHelpResourcesTools(server) {
    server.tool("brc_find_help_resources", FIND_HELP_RESOURCES_TOOL_DESCRIPTION, {
        query: z
            .string()
            .min(1)
            .describe("Plain-English help topic, for example bank feeds, sales invoices, year end, or company setup."),
        category: z
            .string()
            .optional()
            .describe("Optional helpRoutingCategory filter, for example bank_feeds or sales."),
        maxResults: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Maximum number of resources to return. Defaults to 5."),
    }, async ({ query, category, maxResults }) => {
        const resources = loadEnrichedEduResources();
        const matches = findHelpResources(query, {
            category,
            maxResults: maxResults ?? 5,
            resources,
        });
        return jsonResponse({
            query,
            category: category ?? null,
            matchCount: matches.length,
            resources: matches.map((resource) => ({
                title: resource.title,
                url: resource.url,
                helpRoutingCategory: resource.helpRoutingCategory,
                description: resource.description,
                contentType: resource.contentType,
                source: resource.source,
                needsReview: resource.needsReview,
            })),
            guidance: matches.length > 0
                ? "Share the most relevant title and URL in plain English. Mention that Red cannot change Big Red Cloud settings directly when appropriate."
                : "No matching help resource was found in the current BRC Edu index. Suggest Big Red Cloud support or webinars in general terms.",
        });
    });
}
