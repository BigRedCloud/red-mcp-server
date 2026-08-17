/**
 * Request router: classifies a message, issues action routeTokens from the
 * authoritative workflow registry, and continues pending confirmed actions.
 */

import {
  buildUnifiedFindHelpResourcesResponse,
} from "../brc-edu/help/unified-help-search.js";
import { loadCustomerDocsForHelpSearch } from "../brc-edu/customer-docs/customer-docs-index-store.js";
import { loadFreshdeskArticlesForHelpSearch } from "../brc-edu/freshdesk/freshdesk-help-search.js";
import { loadUpcomingWebinarsForHelpSearch } from "../brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../edu/brc_edu_resources.js";
import {
  getCurrentConnectionId,
  getCurrentMcpSessionId,
  resolveConnectionIdForActiveSessionWithMeta,
} from "../auth/connection_store.js";
import {
  getActiveConnectionRef,
  resolveActiveMcpSessionId,
  resolveHttpClientKey,
} from "../shared.js";
import { getRedTelemetryContext } from "../telemetry/identity.js";
import { getStoredSessionPlatform } from "../telemetry/platform.js";
import {
  classifyRequestIntent,
  type IntentClassification,
  type RequestRouteMode,
} from "./intent-classifier.js";
import {
  CORRECTION_ASSISTANT_GUIDANCE,
  CORRECTION_CUSTOMER_LANGUAGE_RULES,
  isCorrectionIntent,
} from "./correction-intent.js";
import {
  hashRouteMessage,
  issueActionRouteToken,
  isIssuedRouteTokenConsumed,
  logRouteTokenIssued,
  resolveConnectionIdForRouteToken,
  validateRouteToken,
} from "./route-token.js";
import {
  clearPendingAction,
  getPendingAction,
  isAffirmativeConfirmation,
  logPendingActionLookup,
  logPendingActionRejected,
  resolvePendingActionScopeKey,
  savePendingAction,
} from "./pending-action.js";

export type RouteRequestResult = {
  mode: RequestRouteMode;
  cleanedQuery: string;
  originalMessage: string;
  reason: string;
  blockTransactionalTools: boolean;
  preferredTools: readonly string[];
  allowCompanyConnectionTool: boolean;
  /** Action workflow id when mode is action. */
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
   * Opaque short-lived action routeToken. Only present for action mode.
   * Never issued for help, correction, or unsupported_action.
   */
  routeToken?: string;
  routeTokenExpiresAt?: number;
  /** True when this result reused a pending previewed action. */
  confirmationContinuation?: boolean;
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
        "Retain the same routeToken through lookup, preview, and confirmation.",
        "Ask for required details, then follow preview-before-posting and confirmation rules.",
        "A routeToken is routing permission only — it does not replace preview-before-posting or confirmWrite.",
        "When the user confirms with yes / delete it / go ahead after a preview, reuse this routeToken — do not call brc_route_request with only the confirmation word.",
      ].join(" ");
    case "unsupported_action":
      return [
        "Unsupported action: Red recognised an action request but cannot map it to an enabled transactional workflow in this deployment.",
        "Explain that in plain English. Do not invent or suggest a placeholder routeToken.",
        "Do not call transactional create/update/delete/batch/email tools for this message.",
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
        "Do not clear or replace an active routeToken from a prior action preview.",
      ].join(" ");
    case "correction":
      return [CORRECTION_ASSISTANT_GUIDANCE, CORRECTION_CUSTOMER_LANGUAGE_RULES].join(
        " "
      );
    default:
      return [
        "Mode unknown: ask a brief clarifying question — whether they want Red to perform the action or want manual Big Red Cloud steps.",
      ].join(" ");
  }
}

function logRouteRequestResolved(args: {
  mode: RequestRouteMode;
  workflow?: string | null;
  allowedToolCount: number;
  tokenIssued: boolean;
  pendingSaved: boolean;
  confirmationContinuation: boolean;
}): void {
  console.info(
    JSON.stringify({
      event: "route_request_resolved",
      mode: args.mode,
      workflow: args.workflow ?? null,
      allowedToolCount: args.allowedToolCount,
      tokenIssued: args.tokenIssued,
      pendingSaved: args.pendingSaved,
      confirmationContinuation: args.confirmationContinuation,
    }),
  );
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

async function resolveRouteConnection(args: {
  sessionId?: string | null;
  connectionId?: string | null;
  clientKey?: string | null;
}): Promise<{
  connectionId: string | null;
  sessionBindingFound: boolean;
  clientClaimInherited: boolean;
  connectionRefResolved: boolean;
}> {
  const sessionId = args.sessionId?.trim() || null;
  const clientKey = args.clientKey?.trim() || resolveHttpClientKey();
  const resolution = sessionId
    ? await resolveConnectionIdForActiveSessionWithMeta({
        sessionId,
        clientKey: clientKey ?? undefined,
        connectionRef:
          args.connectionId?.trim() ? undefined : getActiveConnectionRef(),
      })
    : {
        connectionId: null,
        sessionBindingFound: false,
        clientClaimInherited: false,
        connectionRefResolved: false,
        connectionRefInvalid: false,
      };

  const connectionId =
    (await resolveConnectionIdForRouteToken({
      sessionId,
      connectionId: args.connectionId ?? resolution.connectionId,
    })) ??
    getCurrentConnectionId() ??
    null;

  return {
    connectionId,
    sessionBindingFound: resolution.sessionBindingFound,
    clientClaimInherited: resolution.clientClaimInherited,
    connectionRefResolved: resolution.connectionRefResolved,
  };
}

async function tryConfirmationContinuation(args: {
  message: string;
  sessionId?: string | null;
  connectionId?: string | null;
  clientKey?: string | null;
}): Promise<RouteRequestResult | null> {
  // Undo / reverse / put it back is planning, not permission to complete a
  // pending write — even if a preview is waiting.
  if (isCorrectionIntent(args.message) || !isAffirmativeConfirmation(args.message)) {
    return null;
  }

  const sessionId =
    args.sessionId ??
    resolveActiveMcpSessionId() ??
    getCurrentMcpSessionId();
  const clientKey = args.clientKey ?? resolveHttpClientKey();
  const resolved = await resolveRouteConnection({
    sessionId,
    connectionId: args.connectionId,
    clientKey,
  });

  if (!resolved.connectionId) {
    logPendingActionLookup({
      found: false,
      confirmationContinuation: true,
      rejectionReason: "no_pending",
    });
    logPendingActionRejected({ reason: "no_pending" });
    return null;
  }

  const scopeKeyHash = resolvePendingActionScopeKey({
    clientKey,
    sessionId,
  });
  const pending = await getPendingAction({
    connectionId: resolved.connectionId,
    scopeKeyHash,
  });

  if (!pending) {
    logPendingActionLookup({
      found: false,
      confirmationContinuation: true,
      rejectionReason: "no_pending",
    });
    logPendingActionRejected({ reason: "no_pending" });
    return null;
  }

  if (pending.expiresAt <= Date.now()) {
    await clearPendingAction({
      connectionId: resolved.connectionId,
      scopeKeyHash,
    });
    logPendingActionLookup({
      found: true,
      status: pending.status,
      confirmationContinuation: true,
      workflowId: pending.workflowId,
      rejectionReason: "expired",
    });
    logPendingActionRejected({
      reason: "expired",
      workflowId: pending.workflowId,
    });
    return null;
  }

  if (isIssuedRouteTokenConsumed(pending.routeToken)) {
    await clearPendingAction({
      connectionId: resolved.connectionId,
      scopeKeyHash,
    });
    logPendingActionLookup({
      found: true,
      status: pending.status,
      confirmationContinuation: true,
      workflowId: pending.workflowId,
      rejectionReason: "token_consumed",
    });
    logPendingActionRejected({
      reason: "token_consumed",
      workflowId: pending.workflowId,
    });
    return null;
  }

  const validation = validateRouteToken(pending.routeToken, {
    toolName: pending.allowedTools[0],
    sessionId,
    connectionId: resolved.connectionId,
    workflow: pending.workflowId,
  });
  if (!validation.ok) {
    const reason =
      validation.reason === "expired"
        ? "expired"
        : validation.reason === "wrong_session"
          ? "connection_mismatch"
          : validation.reason === "consumed"
            ? "token_consumed"
            : "no_pending";
    logPendingActionLookup({
      found: true,
      status: pending.status,
      confirmationContinuation: true,
      workflowId: pending.workflowId,
      rejectionReason: reason,
    });
    logPendingActionRejected({
      reason,
      workflowId: pending.workflowId,
    });
    return null;
  }

  logPendingActionLookup({
    found: true,
    status: pending.status,
    confirmationContinuation: true,
    workflowId: pending.workflowId,
  });
  logRouteRequestResolved({
    mode: "action",
    workflow: pending.workflowId,
    allowedToolCount: pending.allowedTools.length,
    tokenIssued: true,
    pendingSaved: false,
    confirmationContinuation: true,
  });

  return {
    mode: "action",
    cleanedQuery: pending.originalMessage,
    originalMessage: pending.originalMessage,
    reason: "confirmation_continuation",
    blockTransactionalTools: false,
    preferredTools: pending.allowedTools,
    allowCompanyConnectionTool: false,
    workflow: pending.workflowId,
    workflowDetails: {
      name: pending.workflowId,
      description:
        "Continue the already-previewed action with the same routeToken after user confirmation.",
      preferredTools: pending.allowedTools,
      requiresPreviewConfirmation: true,
    },
    allowedTools: pending.allowedTools,
    routeToken: pending.routeToken,
    routeTokenExpiresAt: pending.expiresAt,
    confirmationContinuation: true,
    guidance: [
      "Confirmation continuation: reuse the existing routeToken and workflow from the pending preview.",
      "Call the permitted transactional tool with confirmWrite/confirmDelete true.",
      "Do not invent a new routeToken. Do not start a different workflow.",
    ].join(" "),
  };
}

/**
 * Classify `message` and route help mode through the unified help pipeline.
 * Affirmative confirmations reuse a durable pending action when valid.
 */
export async function routeRequest(
  message: string,
  options?: {
    /** Injected help sources for tests (skips live index loads). */
    helpSources?: Parameters<typeof buildUnifiedFindHelpResourcesResponse>[1];
    maxHelpResults?: number;
    sessionId?: string | null;
    /** Active company connection id when already known (tests / callers). */
    connectionId?: string | null;
    clientKey?: string | null;
    now?: number;
    ttlMs?: number;
  },
): Promise<RouteRequestResult> {
  const continuation = await tryConfirmationContinuation({
    message,
    sessionId: options?.sessionId,
    connectionId: options?.connectionId,
    clientKey: options?.clientKey,
  });
  if (continuation) {
    return continuation;
  }

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

  if (classification.mode === "unsupported_action" || classification.mode === "correction") {
    logRouteRequestResolved({
      mode: classification.mode,
      allowedToolCount: classification.preferredTools.length,
      tokenIssued: false,
      pendingSaved: false,
      confirmationContinuation: false,
    });
    return base;
  }

  if (classification.mode === "action") {
    const workflow = classification.workflow;
    if (!workflow || workflow.preferredTools.length === 0) {
      // Invariant: never return mode=action without tools/token.
      logRouteRequestResolved({
        mode: "unsupported_action",
        allowedToolCount: 0,
        tokenIssued: false,
        pendingSaved: false,
        confirmationContinuation: false,
      });
      return {
        ...base,
        mode: "unsupported_action",
        reason: "unsupported_action",
        blockTransactionalTools: true,
        preferredTools: [],
        guidance: guidanceFor({
          ...classification,
          mode: "unsupported_action",
          reason: "unsupported_action",
          blockTransactionalTools: true,
          preferredTools: [],
        }),
      };
    }

    const sessionId =
      options?.sessionId ??
      resolveActiveMcpSessionId() ??
      getCurrentMcpSessionId();
    const clientKey = options?.clientKey ?? resolveHttpClientKey();
    const resolution = await resolveRouteConnection({
      sessionId,
      connectionId: options?.connectionId,
      clientKey,
    });

    const issued = issueActionRouteToken({
      workflow: workflow.name,
      allowedTools: workflow.preferredTools,
      message: classification.originalMessage || message,
      sessionId,
      connectionId: resolution.connectionId,
      now: options?.now,
      ttlMs: options?.ttlMs,
    });

    const platform =
      getRedTelemetryContext()?.clientPlatform ??
      (sessionId ? getStoredSessionPlatform(sessionId) : null) ??
      "unknown";

    logRouteTokenIssued({
      workflow: workflow.name,
      connectionIdPresent: Boolean(resolution.connectionId),
      sessionBindingFound: resolution.sessionBindingFound,
      clientClaimInherited: resolution.clientClaimInherited,
      connectionRefResolved: resolution.connectionRefResolved,
      connectionBindingAdded: Boolean(issued.payload.connectionBinding),
      platform: String(platform),
    });

    let pendingSaved = false;
    if (resolution.connectionId) {
      const scopeKeyHash = resolvePendingActionScopeKey({
        clientKey,
        sessionId,
      });
      await savePendingAction({
        connectionId: resolution.connectionId,
        scopeKeyHash,
        workflowId: workflow.name,
        allowedTools: workflow.preferredTools,
        routeToken: issued.routeToken,
        originalMessage: classification.originalMessage || message,
        messageHash: hashRouteMessage(
          classification.originalMessage || message,
        ),
        expiresAt: issued.payload.exp,
        status: "routed",
      });
      pendingSaved = true;
    }

    logRouteRequestResolved({
      mode: "action",
      workflow: workflow.name,
      allowedToolCount: workflow.preferredTools.length,
      tokenIssued: true,
      pendingSaved,
      confirmationContinuation: false,
    });

    return {
      ...base,
      workflow: workflow.name,
      workflowDetails: workflow,
      allowedTools: [...workflow.preferredTools],
      preferredTools: workflow.preferredTools,
      routeToken: issued.routeToken,
      routeTokenExpiresAt: issued.payload.exp,
      confirmationContinuation: false,
    };
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
  };
}
