import { z } from "zod";

import type { ServerType } from "../../server.js";
import { connectionRefSchema } from "../../auth/connection_ref.js";
import { jsonResponse } from "../../shared.js";
import { routeRequest } from "../../routing/route-request.js";

export const ROUTE_REQUEST_TOOL_DESCRIPTION = [
  "MANDATORY FIRST STEP for broad Red requests involving read, create, update, delete, correct, undo, reverse, email, or batch actions.",
  "This tool is brc_route_request.",
  "Classify and route a user request between Red's two main behaviours: action (perform the accounting workflow) and help (manual Big Red Cloud instructions).",
  "Also returns connection, read, correction, unsupported_action, or unknown when those specialised modes apply.",
  "Pass the user's complete original message — never only a confirmation word such as yes or delete it when starting a new action.",
  "Action mode always returns a non-empty preferredTools list, allowedTools, and an opaque short-lived routeToken — pass that routeToken on every subsequent transactional tool call for the permitted workflow, including after lookup and preview.",
  "unsupported_action means Red cannot map the request to an enabled workflow — explain that to the user; do not invent a routeToken.",
  "Help mode runs the unified help search, returns manual resources, sets blockTransactionalTools true, and never issues a transactional routeToken.",
  "How-to wording (how do I, how can I, show me how, tell me how, where do I, what are the steps, manual steps for, red-help, /red-help) → mode help.",
  "Explicit action wording (add a customer, create a sales invoice, delete customer ABC, can you add a customer for me) → mode action with routeToken.",
  "Correction / undo / reverse / put it back / change it back / restore wording → mode correction: plan first, do not write immediately, and do not issue a transactional routeToken. This first request is not write confirmation.",
  "A routeToken does not replace preview-before-posting or user confirmation (confirmWrite).",
  "Help mode does not persist — each brc_route_request call is classified independently unless returning confirmation continuation for a pending preview.",
  "Read-only classification and help search. Does not require a connected company.",
  "When a company is already connected, pass connectionRef silently so the routeToken can bind to that connection and survive MCP session rotation.",
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
      connectionRef: connectionRefSchema,
    },
    async ({ message }) => {
      // connectionRef is resolved by wrapHttpSessionAwareToolHandler before this
      // handler runs; routeRequest reads the active connection from session context.
      const result = await routeRequest(message);
      return jsonResponse(result);
    },
  );
}
