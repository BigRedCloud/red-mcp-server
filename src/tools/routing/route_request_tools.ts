import { z } from "zod";

import type { ServerType } from "../../server.js";
import { jsonResponse } from "../../shared.js";
import { routeRequest } from "../../routing/route-request.js";

export const ROUTE_REQUEST_TOOL_DESCRIPTION = [
  "MANDATORY FIRST STEP for Red requests that may create, update, delete, post, email, or batch-write company data.",
  "Classify and route a user request between Red's two main behaviours: action (perform the accounting workflow) and help (manual Big Red Cloud instructions).",
  "Also returns connection, read, or unknown when those specialised modes apply.",
  "Pass the user's complete original message.",
  "Action mode returns an opaque short-lived routeToken and allowedTools — pass that routeToken on every subsequent transactional tool call for the permitted workflow.",
  "Help mode runs the unified help search, returns manual resources, sets blockTransactionalTools true, and never issues a transactional routeToken.",
  "How-to wording (how do I, how can I, show me how, tell me how, where do I, what are the steps, manual steps for, red-help, /red-help) → mode help.",
  "Explicit action wording (add a customer, create a sales invoice, can you add a customer for me) → mode action with routeToken.",
  "A routeToken does not replace preview-before-posting or user confirmation (confirmWrite).",
  "Help mode does not persist — each brc_route_request call is classified independently.",
  "Read-only classification and help search. Does not require a connected company.",
].join(" ");

export function registerRouteRequestTools(server: ServerType): void {
  server.tool(
    "brc_route_request",
    ROUTE_REQUEST_TOOL_DESCRIPTION,
    {
      message: z
        .string()
        .min(1)
        .describe(
          "The user's complete original message to classify, for example add a customer or how do I add a customer.",
        ),
    },
    async ({ message }) => {
      const result = await routeRequest(message);
      return jsonResponse(result);
    },
  );
}
