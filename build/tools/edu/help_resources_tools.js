import { z } from "zod";
import { loadCustomerDocsForHelpSearch } from "../../brc-edu/customer-docs/customer-docs-index-store.js";
import { loadFreshdeskArticlesForHelpSearch } from "../../brc-edu/freshdesk/freshdesk-help-search.js";
import { detectHelpMode } from "../../brc-edu/help/help-mode.js";
import { getHelpResourceDetails, helpResourceDetailResponse, } from "../../brc-edu/help/help-resource-details.js";
import { HELP_RESOURCE_SOURCES } from "../../brc-edu/help/help-resource-types.js";
import { buildUnifiedFindHelpResourcesResponse, unifiedFindHelpResourcesMcpContent, } from "../../brc-edu/help/unified-help-search.js";
import { loadUpcomingWebinarsForHelpSearch } from "../../brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../../edu/brc_edu_resources.js";
import { jsonResponse } from "../../shared.js";
/**
 * Preferred display title for brc_red_help (surfaced in the tool description;
 * MCP clients may also show the tool name).
 */
export const RED_HELP_TOOL_TITLE = "Red Help — Manual Instructions and Resources";
/**
 * High-priority discovery description for the reserved red-help command.
 * Begins with a mandatory routing directive so semantic tool search prefers
 * this tool over transactional create/update/delete tools.
 *
 * Note: detectHelpMode() only runs after a help tool is invoked. MCP clients
 * remain responsible for selecting the initial tool from name, description,
 * and server instructions — this metadata is the discovery-layer fix.
 */
export const RED_HELP_TOOL_DESCRIPTION = [
    "Returns Big Red Cloud help and manual Big Red Cloud instructions for how-to questions, including how do I queries and tutorials.",
    "Covers topics including sales invoices, purchases, customers, suppliers, banking, VAT, reports and company setup.",
    "Searches Freshdesk, YouTube, BRC Edu, webinars and screenshots.",
    "Read-only and available without a connected company.",
].join(" ");
export const FIND_HELP_RESOURCES_TOOL_DESCRIPTION = [
    "Searches Big Red Cloud customer help across Freshdesk support articles, customer documentation, recorded webinar videos and upcoming webinars.",
    "Returns a synthesized answer, ordered guidance and public source metadata.",
    "Read-only and available without a connected company.",
].join(" ");
export const GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION = [
    "Load full help-resource details for a resourceId returned by brc_red_help or brc_find_help_resources.",
    "For Big Red Cloud how-to or tutorial questions, call this automatically for the best matching Freshdesk article with includeImages=true and imagePresentation=links — even when the user did not explicitly ask for screenshots.",
    "Freshdesk resources return cleaned article text, the canonical Freshdesk publicUrl when available, preferred instructionBlocks, ready-to-use customerFacingScreenshotMarkdown / customerFacingInstructionMarkdown, screenshotUrls for backward compatibility, Sources fields, optional Red-action fields, and optional MCP image content.",
    "When includeImages is true, use imagePresentation='links' unless the user explicitly asks for inline image content.",
    "Copy the exact Markdown links returned in customerFacingScreenshotMarkdown or customerFacingInstructionMarkdown into the final answer.",
    "Place each link after its related step.",
    "Use the short View image link text (or View image N when one step has multiple images) — do not paste the descriptive caption as link text or as a second instruction sentence.",
    "Never omit valid returned screenshot links after telling the user screenshots are available.",
    "Do not merely describe the screenshots. Do not say Here are the screenshots without including the links.",
    "Do not replace links with Screenshot 1, Tool result, Show Image, or invent different URLs.",
    "Do not depend on tool-result image previews being visible to the user — the final answer must contain the exact signed Markdown links.",
    "If no links are returned, clearly say that no matching screenshot was found.",
    "Pass the customer question when available so Freshdesk screenshots are selected from the matching workflow branch (for example existing customer versus add customer).",
    "Prefer instructionBlocks / customerFacingInstructionMarkdown when present: follow them in order and keep every screenshot Markdown link exact.",
    "Never label screenshot links Show Image. Do not invent captions or URLs.",
    "Do not group screenshots under a Relevant screenshots section when step-and-link Markdown is available.",
    "Omit screenshots from unused workflow branches. Omit unclear screenshots rather than guessing. Do not repeat a screenshot.",
    "When instructionBlocks are absent, use customerFacingScreenshotMarkdown with [View image](URL) links and place each after the most relevant paragraph where possible.",
    "Do not rewrite or alter supplied screenshot URLs.",
    "Copy customerFacingSourcesMarkdown into a Sources section using the exact publicUrl or registrationUrl returned by this tool.",
    "Group Freshdesk / documentation under Articles and recorded webinars under Videos — omit an empty Videos heading.",
    "Keep screenshot links beside steps — do not move them into Sources.",
    "When redActionAvailable is true, include customerFacingRedActionMarkdown after Sources. Do not start the Red action unless the user asks. Mention preview-before-posting for write actions.",
    "Always end with customerFacingSupportMarkdown (Still need help?) after Sources and any Red-action section.",
    "Freshdesk links use bigredcloud.freshdesk.com — never rewrite them onto bigredcloud.com/support.",
    "Customer documentation returns cleaned article text and the public docs URL.",
    "Recorded webinars return title, description, public video URL, and category.",
    "Upcoming webinars return title, weekday, description, topics, registration URL, and webinar-series page URL.",
    "Read-only. Does not require a connected company.",
    "MCP image content blocks are optional compatibility content when imagePresentation is inline or both. Do not claim screenshots were supplied when imageCount is 0 or when no Markdown links are returned.",
    "Do not expose Azure blob names, storage URLs, private Freshdesk image URLs, image hashes, or sync metadata in customer-facing text.",
    "Never claim company data was changed by a tutorial answer.",
].join(" ");
/**
 * Ensure the unified help pipeline runs in red-help mode when the client
 * already stripped the command and passed only the remaining query text.
 */
export function ensureRedHelpQueryForUnifiedSearch(query) {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (!trimmed) {
        return "red-help";
    }
    if (detectHelpMode(trimmed).isHelpMode) {
        return trimmed;
    }
    return `red-help ${trimmed}`;
}
export async function runUnifiedHelpSearchPipeline(question, options) {
    const [recordedWebinars, freshdeskArticles, customerDocs, upcomingWebinars,] = await Promise.all([
        loadEnrichedEduResources(),
        loadFreshdeskArticlesForHelpSearch(),
        loadCustomerDocsForHelpSearch(),
        loadUpcomingWebinarsForHelpSearch(),
    ]);
    return unifiedFindHelpResourcesMcpContent(buildUnifiedFindHelpResourcesResponse(question, {
        recordedWebinars,
        freshdeskArticles: freshdeskArticles ?? undefined,
        customerDocs: customerDocs ?? undefined,
        upcomingWebinars: upcomingWebinars ?? undefined,
    }, {
        category: options?.category,
        maxResults: options?.maxResults ?? 5,
        sourceFilter: options?.source ?? "all",
    }));
}
export function registerHelpResourcesTools(server) {
    server.tool("brc_red_help", RED_HELP_TOOL_DESCRIPTION, {
        query: z
            .string()
            .min(1)
            .describe("Text after the red-help command, for example how do I add a sales invoice or add a customer manually."),
    }, async ({ query }) => {
        return runUnifiedHelpSearchPipeline(ensureRedHelpQueryForUnifiedSearch(query));
    });
    registerFindHelpResourcesTool(server);
    server.tool("brc_get_help_resource_details", GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, {
        resourceId: z
            .string()
            .min(1)
            .describe("Resource ID from brc_red_help or brc_find_help_resources, for example customer_docs:bank-reconciliation or freshdesk:1001."),
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
/** Register only public help search; no company session is needed. */
export function registerFindHelpResourcesTool(server) {
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
            .describe("Optional source filter: freshdesk, customer_docs, recorded_webinar, youtube_video, upcoming_webinar, or all."),
    }, async ({ question, category, maxResults, source }) => {
        return runUnifiedHelpSearchPipeline(question, {
            category,
            maxResults,
            source,
        });
    });
}
