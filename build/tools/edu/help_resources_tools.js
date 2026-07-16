import { z } from "zod";
import { loadCustomerDocsForHelpSearch } from "../../brc-edu/customer-docs/customer-docs-index-store.js";
import { loadFreshdeskArticlesForHelpSearch } from "../../brc-edu/freshdesk/freshdesk-help-search.js";
import { getHelpResourceDetails, helpResourceDetailResponse, } from "../../brc-edu/help/help-resource-details.js";
import { HELP_RESOURCE_SOURCES } from "../../brc-edu/help/help-resource-types.js";
import { buildUnifiedFindHelpResourcesResponse } from "../../brc-edu/help/unified-help-search.js";
import { loadUpcomingWebinarsForHelpSearch } from "../../brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
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
    "Freshdesk resources return cleaned article text, the canonical Freshdesk publicUrl when available, preferred instructionBlocks, ready-to-use customerFacingScreenshotMarkdown / customerFacingInstructionMarkdown, screenshotUrls for backward compatibility, and optional MCP image content.",
    "When includeImages is true, use imagePresentation='links' unless the user explicitly asks for inline image content.",
    "Copy the exact Markdown links returned in customerFacingScreenshotMarkdown or customerFacingInstructionMarkdown into the final answer.",
    "Place each link after its related step.",
    "Never omit valid returned screenshot links after telling the user screenshots are available.",
    "Do not merely describe the screenshots. Do not say Here are the screenshots without including the links.",
    "Do not replace links with Screenshot 1, Tool result, Show Image, or generic text.",
    "Do not depend on tool-result image previews being visible to the user — the final answer must contain the exact signed Markdown links.",
    "If no links are returned, clearly say that no matching screenshot was found.",
    "Pass the customer question when available so Freshdesk screenshots are selected from the matching workflow branch (for example existing customer versus add customer).",
    "Prefer instructionBlocks / customerFacingInstructionMarkdown when present: follow them in order and keep every screenshot Markdown link exact.",
    "Never label screenshot links Show Image. Do not invent captions.",
    "Do not group screenshots under a Relevant screenshots section when step-and-link Markdown is available.",
    "Omit screenshots from unused workflow branches. Omit unclear screenshots rather than guessing. Do not repeat a screenshot.",
    "When instructionBlocks are absent, use customerFacingScreenshotMarkdown or screenshotUrls with their descriptive captions and place each after the most relevant paragraph where possible.",
    "Do not rewrite or alter supplied screenshot URLs.",
    "Use only the publicUrl returned by this tool for Freshdesk links.",
    "Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.",
    "Customer documentation returns cleaned article text and the public docs URL.",
    "Recorded webinars return title, description, public video URL, and category.",
    "Upcoming webinars return title, weekday, description, topics, registration URL, and webinar-series page URL.",
    "Read-only. Does not require a connected company.",
    "Call this tool when the user asks for screenshots, visuals, or detailed Freshdesk steps.",
    "MCP image content blocks are optional compatibility content when imagePresentation is inline or both. Do not claim screenshots were supplied when imageCount is 0 or when no Markdown links are returned.",
    "Do not expose Azure blob names, storage URLs, private Freshdesk image URLs, image hashes, or sync metadata in customer-facing text.",
].join(" ");
export function registerHelpResourcesTools(server) {
    server.tool("brc_find_help_resources", FIND_HELP_RESOURCES_TOOL_DESCRIPTION, {
        question: z
            .string()
            .min(1)
            .describe("Plain-English help question, for example how do bank feeds work or how do I reconcile my bank account."),
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
            .describe("Optional source filter: freshdesk, customer_docs, recorded_webinar, upcoming_webinar, or all."),
    }, async ({ question, category, maxResults, source }) => {
        const [recordedWebinars, freshdeskArticles, customerDocs, upcomingWebinars,] = await Promise.all([
            loadEnrichedEduResources(),
            loadFreshdeskArticlesForHelpSearch(),
            loadCustomerDocsForHelpSearch(),
            loadUpcomingWebinarsForHelpSearch(),
        ]);
        return jsonResponse(buildUnifiedFindHelpResourcesResponse(question, {
            recordedWebinars,
            freshdeskArticles: freshdeskArticles ?? undefined,
            customerDocs: customerDocs ?? undefined,
            upcomingWebinars: upcomingWebinars ?? undefined,
        }, {
            category,
            maxResults: maxResults ?? 5,
            sourceFilter: source ?? "all",
        }));
    });
    server.tool("brc_get_help_resource_details", GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, {
        resourceId: z
            .string()
            .min(1)
            .describe("Resource ID from brc_find_help_resources, for example customer_docs:bank-reconciliation or freshdesk:1001."),
        includeImages: z
            .boolean()
            .optional()
            .describe("When true, Freshdesk articles may include screenshot presentation. Defaults to true."),
        maxImages: z
            .number()
            .int()
            .min(1)
            .max(8)
            .optional()
            .describe("Maximum Freshdesk screenshots to return. Defaults to 5. Hard maximum 8."),
        question: z
            .string()
            .min(1)
            .optional()
            .describe("Optional customer question used to select the matching Freshdesk workflow screenshots, for example an existing-customer opening balance question versus adding a new customer."),
        imagePresentation: z
            .enum(["links", "inline", "both"])
            .optional()
            .describe("How to present Freshdesk screenshots. Defaults to links (signed Markdown links only). Use inline for MCP image blocks, or both for Markdown plus image blocks."),
    }, async ({ resourceId, includeImages, maxImages, question, imagePresentation, }) => {
        const result = await getHelpResourceDetails(resourceId, {
            includeImages: includeImages ?? true,
            maxImages,
            question,
            imagePresentation,
        });
        if (!result.ok) {
            return jsonResponse({ error: result.error });
        }
        return helpResourceDetailResponse(result.payload, result.images);
    });
}
