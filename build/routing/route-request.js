/**
 * Stateless request router: classifies a message and, for help mode, runs the
 * existing unified help-search pipeline. Action mode issues a short-lived
 * routeToken for permitted transactional tools. Does not persist mode across calls.
 */
import { buildUnifiedFindHelpResourcesResponse, } from "../brc-edu/help/unified-help-search.js";
import { loadCustomerDocsForHelpSearch } from "../brc-edu/customer-docs/customer-docs-index-store.js";
import { loadFreshdeskArticlesForHelpSearch } from "../brc-edu/freshdesk/freshdesk-help-search.js";
import { loadUpcomingWebinarsForHelpSearch } from "../brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";
import { loadEnrichedEduResources } from "../edu/brc_edu_resources.js";
import { getCurrentMcpSessionId, resolveConnectionIdForActiveSessionWithMeta, } from "../auth/connection_store.js";
import { getActiveConnectionRef, resolveActiveMcpSessionId, resolveHttpClientKey, } from "../shared.js";
import { getRedTelemetryContext } from "../telemetry/identity.js";
import { getStoredSessionPlatform } from "../telemetry/platform.js";
import { classifyRequestIntent, resolveActionWorkflow, } from "./intent-classifier.js";
import { issueActionRouteToken, logRouteTokenIssued, resolveConnectionIdForRouteToken, } from "./route-token.js";
function guidanceFor(classification) {
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
    const [recordedWebinars, freshdeskArticles, customerDocs, upcomingWebinars,] = await Promise.all([
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
export async function routeRequest(message, options) {
    const classification = classifyRequestIntent(message);
    const base = {
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
            const sessionId = options?.sessionId ??
                resolveActiveMcpSessionId() ??
                getCurrentMcpSessionId();
            const clientKey = resolveHttpClientKey();
            // Re-run the same verified resolution path transactional tools use
            // (session binding → client claim → connectionRef) so connectionBinding
            // is embedded even when the model omits connectionRef on route_request.
            const resolution = sessionId
                ? await resolveConnectionIdForActiveSessionWithMeta({
                    sessionId,
                    clientKey,
                    connectionRef: options?.connectionId?.trim()
                        ? undefined
                        : getActiveConnectionRef(),
                })
                : {
                    connectionId: null,
                    sessionBindingFound: false,
                    clientClaimInherited: false,
                    connectionRefResolved: false,
                    connectionRefInvalid: false,
                };
            const connectionId = (await resolveConnectionIdForRouteToken({
                sessionId,
                connectionId: options?.connectionId ?? resolution.connectionId,
            })) ?? null;
            const issued = issueActionRouteToken({
                workflow: workflow.name,
                allowedTools: workflow.preferredTools,
                message: classification.originalMessage || message,
                sessionId,
                connectionId,
                now: options?.now,
                ttlMs: options?.ttlMs,
            });
            const platform = getRedTelemetryContext()?.clientPlatform ??
                (sessionId ? getStoredSessionPlatform(sessionId) : null) ??
                "unknown";
            logRouteTokenIssued({
                workflow: workflow.name,
                connectionIdPresent: Boolean(connectionId),
                sessionBindingFound: resolution.sessionBindingFound,
                clientClaimInherited: resolution.clientClaimInherited,
                connectionRefResolved: resolution.connectionRefResolved,
                connectionBindingAdded: Boolean(issued.payload.connectionBinding),
                platform: String(platform),
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
    const help = buildUnifiedFindHelpResourcesResponse(classification.originalMessage || message, sources, { maxResults: options?.maxHelpResults ?? 5 });
    return {
        ...base,
        cleanedQuery: help.cleanedQuery || classification.cleanedQuery,
        blockTransactionalTools: true,
        preferredTools: classification.preferredTools,
        help,
        // Explicitly omit routeToken — help must never unlock transactional tools.
    };
}
