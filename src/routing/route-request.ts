/**
 * Stateless request router: classifies a message and, for help mode, runs the
 * existing unified help-search pipeline. Action mode issues a short-lived
 * routeToken for permitted transactional tools. Does not persist mode across calls.
 */

import {
  buildUnifiedFindHelpResourcesResponse,
} from "../brc-edu/help/unified-help-search.js";
import { loadCustomerDocsForHelpSearch } from "../brc-edu/customer-docs/customer-docs-index-store.js";
import { loadFreshdeskArticlesForHelpSearch } from "../brc-edu/freshdesk/freshdesk-help-search.js";
import { loadUpcomingWebinarsForHelpSearch } from "../brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../edu/brc_edu_resources.js";
import { getCurrentMcpSessionId } from "../auth/connection_store.js";
import {
  classifyRequestIntent,
  resolveActionWorkflow,
  type IntentClassification,
  type RequestRouteMode,
} from "./intent-classifier.js";
import { issueActionRouteToken } from "./route-token.js";

export type RouteRequestResult = {
  mode: RequestRouteMode;
  cleanedQuery: string;
  originalMessage: string;
  reason: string;
  blockTransactionalTools: boolean;
  preferredTools: readonly string[];
  allowCompanyConnectionTool: boolean;
  /** Action workflow id when mode is action and a workflow matched. */
  workflow?: string;
  workflowDetails?: {
    name: string;
    description: string;
    preferredTools: string[];
    requiresPreviewConfirmation: true;
  };
  /** Tools permitted by the issued action routeToken. */
  allowedTools?: string[];
  /**
   * Opaque short-lived action routeToken. Only present for action mode with a
   * matched workflow. Never issued for help mode.
   */
  routeToken?: string;
  routeTokenExpiresAt?: number;
  /** Present in help mode — output of the unified help pipeline. */
  help?: ReturnType<typeof buildUnifiedFindHelpResourcesResponse>;
  guidance: string;
};

function guidanceFor(classification: IntentClassification): string {
  switch (classification.mode) {
    case "help":
      return [
        "Help mode: return manual Big Red Cloud instructions from the help payload.",
        "Put manual steps and Sources first. Do not call create/update/delete/post/send tools.",
        "Do not ask for accounting record details.",
        "No transactional routeToken is issued in help mode.",
        "A short Do this through Red section may appear only after manual guidance when redActionAvailable is true.",
        "Call brc_get_help_resource_details for the best Freshdesk match with includeImages=true and imagePresentation=links.",
      ].join(" ");
    case "action":
      return [
        "Action mode: Red should perform the accounting action.",
        "Pass the returned routeToken on every transactional tool call for this workflow.",
        "Ask for required details, then follow preview-before-posting and confirmation rules.",
        "A routeToken is routing permission only — it does not replace preview-before-posting or confirmWrite.",
      ].join(" ");
    case "connection":
      return [
        "Connection mode: use brc_start_company_connection and direct the user to the secure Red connection page.",
        "Do not ask for API keys in chat. No transactional routeToken is required for connection tools.",
      ].join(" ");
    case "read":
      return [
        "Read mode: use read-only lookup tools once a company is connected.",
        "Do not create, update, or delete records for this request.",
      ].join(" ");
    default:
      return [
        "Mode unknown: ask a brief clarifying question — whether they want Red to perform the action or want manual Big Red Cloud steps.",
      ].join(" ");
  }
}

async function loadHelpSources() {
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

  return {
    recordedWebinars,
    freshdeskArticles: freshdeskArticles ?? undefined,
    customerDocs: customerDocs ?? undefined,
    upcomingWebinars: upcomingWebinars ?? undefined,
  };
}

/**
 * Classify `message` and route help mode through the unified help pipeline.
 * Each call is independent — prior help/action mode does not carry over.
 */
export async function routeRequest(
  message: string,
  options?: {
    /** Injected help sources for tests (skips live index loads). */
    helpSources?: Parameters<typeof buildUnifiedFindHelpResourcesResponse>[1];
    maxHelpResults?: number;
    sessionId?: string | null;
    now?: number;
    ttlMs?: number;
  },
): Promise<RouteRequestResult> {
  const classification = classifyRequestIntent(message);
  const base: RouteRequestResult = {
    mode: classification.mode,
    cleanedQuery: classification.cleanedQuery,
    originalMessage: classification.originalMessage,
    reason: classification.reason,
    blockTransactionalTools: classification.blockTransactionalTools,
    preferredTools: classification.preferredTools,
    allowCompanyConnectionTool: classification.allowCompanyConnectionTool,
    guidance: guidanceFor(classification),
  };

  if (classification.mode === "action") {
    const workflow = resolveActionWorkflow(classification.cleanedQuery);
    if (workflow) {
      const issued = issueActionRouteToken({
        workflow: workflow.name,
        allowedTools: workflow.preferredTools,
        message: classification.originalMessage || message,
        sessionId: options?.sessionId ?? getCurrentMcpSessionId(),
        now: options?.now,
        ttlMs: options?.ttlMs,
      });

      return {
        ...base,
        workflow: workflow.name,
        workflowDetails: workflow,
        allowedTools: [...workflow.preferredTools],
        preferredTools: workflow.preferredTools,
        routeToken: issued.routeToken,
        routeTokenExpiresAt: issued.payload.exp,
      };
    }
    return base;
  }

  if (classification.mode !== "help") {
    return base;
  }

  const sources = options?.helpSources ?? (await loadHelpSources());
  const help = buildUnifiedFindHelpResourcesResponse(
    classification.originalMessage || message,
    sources,
    { maxResults: options?.maxHelpResults ?? 5 },
  );

  return {
    ...base,
    cleanedQuery: help.cleanedQuery || classification.cleanedQuery,
    blockTransactionalTools: true,
    preferredTools: classification.preferredTools,
    help,
    // Explicitly omit routeToken — help must never unlock transactional tools.
  };
}
