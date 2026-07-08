import { z } from "zod";

import {
  buildFindHelpResourcesResponse,
  loadEnrichedEduResources,
} from "../../edu/brc_edu_resources.js";
import type { ServerType } from "../../server.js";
import { jsonResponse } from "../../shared.js";

export const FIND_HELP_RESOURCES_TOOL_DESCRIPTION = [
  "Find Big Red Cloud help videos, webinars, and training resources for how-to questions.",
  "Use when the user asks how to use Big Red Cloud, training, tutorials, webinars, videos, or feature guidance.",
  "Read-only. Does not require a connected company, does not write CSV, and does not call Big Red Cloud APIs.",
  "Returns up to 5 matching resources from the enriched BRC Edu CSV, or the support fallback URL when nothing matches.",
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
          "Plain-English help question, for example how do bank feeds work, create a sales invoice, or close the year end.",
        ),
      category: z
        .string()
        .optional()
        .describe("Optional helpRoutingCategory filter, for example bank_feeds or sales_cash_bank_rec."),
    },
    async ({ question, category }) => {
      const resources = loadEnrichedEduResources();
      return jsonResponse(buildFindHelpResourcesResponse(question, resources, { category }));
    },
  );
}
