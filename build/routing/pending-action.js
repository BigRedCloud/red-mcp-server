/**
 * Durable pending-action state for confirmation continuation.
 *
 * After brc_route_request issues a routeToken, the pending record lets a later
 * affirmative ("yes", "delete it") reuse the same workflow and token without
 * reclassifying an incomplete confirmation message as a new action.
 *
 * Scoped to verified connectionId + hashed scope key. Never log routeToken.
 */
import { createHash } from "node:crypto";
import { ensureConnectionStoreInitialized, getConnectionStore, getCurrentConnectionId, } from "../auth/connection_store.js";
import { resolveHttpClientKey } from "../shared.js";
import { ROUTE_TOKEN_TTL_MS } from "./route-token.js";
const AFFIRMATIVE_PATTERNS = [
    /^\s*(?:yes|y|yeah|yep|ok|okay|sure|confirm|confirmed|proceed|go\s+ahead|do\s+it|please\s+do|please\s+proceed)\s*[.!?]?\s*$/i,
    /^\s*(?:yes|ok|okay|sure)[,.]?\s+(?:please\s+)?(?:do\s+it|proceed|confirm|go\s+ahead)\s*[.!?]?\s*$/i,
    /^\s*(?:delete|remove)\s+it\s*[.!?]?\s*$/i,
    /^\s*(?:yes[,.]?\s+)?(?:delete|remove)\s+(?:it|them|that|this)\s*[.!?]?\s*$/i,
    /^\s*(?:go\s+ahead\s+and\s+)?(?:delete|remove|post|send|create|update)\s+it\s*[.!?]?\s*$/i,
];
export function isAffirmativeConfirmation(message) {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 80) {
        return false;
    }
    return AFFIRMATIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
}
export function hashPendingActionScopeKey(raw) {
    const value = raw?.trim() || "session-only";
    return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}
export function resolvePendingActionScopeKey(args) {
    const clientKey = args?.clientKey?.trim() || resolveHttpClientKey()?.trim();
    if (clientKey) {
        return hashPendingActionScopeKey(`client:${clientKey}`);
    }
    const sessionId = args?.sessionId?.trim();
    if (sessionId) {
        return hashPendingActionScopeKey(`session:${sessionId}`);
    }
    return hashPendingActionScopeKey(null);
}
export function buildTargetRecordKey(args) {
    const parts = [];
    for (const key of [
        "id",
        "code",
        "customerCode",
        "supplierCode",
        "productCode",
        "invoiceId",
        "quoteId",
        "companyName",
    ]) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) {
            parts.push(`${key}:${value.trim().toLowerCase()}`);
        }
        else if (typeof value === "number" && Number.isFinite(value)) {
            parts.push(`${key}:${value}`);
        }
    }
    const payload = args.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const record = payload;
        for (const key of ["id", "code", "name"]) {
            const value = record[key];
            if (typeof value === "string" && value.trim()) {
                parts.push(`payload.${key}:${value.trim().toLowerCase()}`);
            }
            else if (typeof value === "number" && Number.isFinite(value)) {
                parts.push(`payload.${key}:${value}`);
            }
        }
    }
    if (parts.length === 0) {
        return undefined;
    }
    return createHash("sha256")
        .update(parts.sort().join("|"), "utf8")
        .digest("hex")
        .slice(0, 32);
}
export function logPendingActionLookup(args) {
    console.info(JSON.stringify({
        event: "pending_action_lookup",
        found: args.found,
        status: args.status ?? null,
        confirmationContinuation: args.confirmationContinuation,
        workflow: args.workflowId ?? null,
        rejectionReason: args.rejectionReason ?? null,
    }));
}
export function logPendingActionRejected(args) {
    console.info(JSON.stringify({
        event: "pending_action_rejected",
        rejectionReason: args.reason,
        workflow: args.workflowId ?? null,
    }));
}
export async function savePendingAction(args) {
    await ensureConnectionStoreInitialized();
    const now = Date.now();
    const record = {
        connectionId: args.connectionId.trim(),
        scopeKeyHash: args.scopeKeyHash.trim(),
        workflowId: args.workflowId,
        allowedTools: [...args.allowedTools],
        routeToken: args.routeToken,
        originalMessage: args.originalMessage,
        messageHash: args.messageHash,
        expiresAt: args.expiresAt,
        status: args.status ?? "routed",
        targetRecordKey: args.targetRecordKey,
        updatedAt: now,
        previewedAt: args.status === "previewed" ? now : undefined,
    };
    await getConnectionStore().savePendingAction(record);
}
export async function getPendingAction(args) {
    await ensureConnectionStoreInitialized();
    const record = await getConnectionStore().getPendingAction(args.connectionId.trim(), args.scopeKeyHash.trim());
    if (!record) {
        return null;
    }
    if (record.expiresAt <= Date.now()) {
        await clearPendingAction(args);
        return null;
    }
    return record;
}
export async function markPendingActionPreviewed(args) {
    const connectionId = args.connectionId?.trim() || getCurrentConnectionId()?.trim();
    if (!connectionId) {
        return;
    }
    const scopeKeyHash = args.scopeKeyHash ?? resolvePendingActionScopeKey();
    const existing = await getPendingAction({ connectionId, scopeKeyHash });
    if (!existing) {
        return;
    }
    if (args.toolName &&
        !existing.allowedTools.includes(args.toolName.trim())) {
        return;
    }
    await savePendingAction({
        ...existing,
        status: "previewed",
        targetRecordKey: args.targetRecordKey ?? existing.targetRecordKey,
        expiresAt: Math.max(existing.expiresAt, Date.now() + ROUTE_TOKEN_TTL_MS),
    });
}
export async function clearPendingAction(args) {
    await ensureConnectionStoreInitialized();
    await getConnectionStore().clearPendingAction(args.connectionId.trim(), args.scopeKeyHash.trim());
}
export async function clearPendingActionForCurrentScope(args) {
    const connectionId = args?.connectionId?.trim() || getCurrentConnectionId()?.trim();
    if (!connectionId) {
        return;
    }
    await clearPendingAction({
        connectionId,
        scopeKeyHash: resolvePendingActionScopeKey({
            clientKey: args?.clientKey,
            sessionId: args?.sessionId,
        }),
    });
}
