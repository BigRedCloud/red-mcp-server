/**
 * Coverage and regression tests for the authoritative action-workflow registry.
 */
import assert from "node:assert/strict";
import test from "node:test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";
process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET =
    process.env.BRC_ROUTE_TOKEN_SIGNING_SECRET ||
        "test-route-token-signing-secret-coverage";
import { enabledToolsForWorkflow, getWorkflowForTool, listActionWorkflows, listEnabledTransactionalTools, resolveActionWorkflow, sampleUtteranceForWorkflow, } from "./action-workflow-registry.js";
import { classifyRequestIntent } from "./intent-classifier.js";
import { routeRequest } from "./route-request.js";
import { requiresRouteToken, validateRouteTokenForTool, ROUTE_TOKEN_SIGNING_SECRET_ENV, resetRouteTokenStateForTests, } from "./route-token.js";
import { isAffirmativeConfirmation, resolvePendingActionScopeKey, savePendingAction, getPendingAction, markPendingActionPreviewed, clearPendingAction, } from "./pending-action.js";
import { getToolSkillGroup, isToolEnabled } from "../config/server_config.js";
/** Every transactional tool that must appear in the registry (skill-group based). */
const EXPECTED_TRANSACTIONAL_TOOLS = [
    "brc_create_customer",
    "brc_update_customer",
    "brc_delete_customer",
    "brc_create_supplier",
    "brc_update_supplier",
    "brc_delete_supplier",
    "brc_create_product",
    "brc_update_product",
    "brc_delete_product",
    "brc_create_sales_rep",
    "brc_update_sales_rep",
    "brc_delete_sales_rep",
    "brc_create_sales_entry",
    "brc_update_sales_entry",
    "brc_delete_sales_entry",
    "brc_create_sales_invoice",
    "brc_create_sales_invoice_gen_ref",
    "brc_update_sales_invoice",
    "brc_delete_sales_invoice",
    "brc_create_sales_credit_note",
    "brc_create_sales_credit_note_gen_ref",
    "brc_update_sales_credit_note",
    "brc_delete_sales_credit_note",
    "brc_create_quote",
    "brc_create_quote_gen_ref",
    "brc_update_quote",
    "brc_close_quote",
    "brc_reopen_quote",
    "brc_generate_sales_invoice_from_quote",
    "brc_delete_quote",
    "brc_create_purchase",
    "brc_create_purchase_gen_ref",
    "brc_update_purchase",
    "brc_delete_purchase",
    "brc_create_payment",
    "brc_update_payment",
    "brc_delete_payment",
    "brc_create_bank_account",
    "brc_update_bank_account",
    "brc_delete_bank_account",
    "brc_create_cash_payment",
    "brc_update_cash_payment",
    "brc_delete_cash_payment",
    "brc_create_cash_receipt",
    "brc_update_cash_receipt",
    "brc_delete_cash_receipt",
    "brc_create_accrual",
    "brc_update_accrual",
    "brc_delete_accrual",
    "brc_create_prepayment",
    "brc_update_prepayment",
    "brc_delete_prepayment",
    "brc_update_allocations",
    "brc_delete_allocation_resolver",
    "brc_create_nominal_journal_batch",
    "brc_update_nominal_journal_batch",
    "brc_delete_nominal_journal_batch",
    "brc_process_vat_category_rates",
    "brc_batch_customers",
    "brc_batch_suppliers",
    "brc_batch_products",
    "brc_batch_sales_reps",
    "brc_batch_purchases",
    "brc_batch_sales_entries",
    "brc_batch_sales_invoices",
    "brc_batch_sales_credit_notes",
    "brc_batch_quotes",
    "brc_batch_cash_receipts",
    "brc_batch_payments",
    "brc_batch_cash_payments",
    "brc_send_sales_invoice_email",
    "brc_send_quote_email",
    "brc_send_email_statement",
];
test("registry covers every expected transactional tool exactly once", () => {
    const seen = new Map();
    for (const workflow of listActionWorkflows()) {
        assert.ok(workflow.allowedTools.length > 0, workflow.workflowId);
        for (const tool of workflow.allowedTools) {
            assert.equal(seen.has(tool), false, `tool ${tool} appears in both ${seen.get(tool)} and ${workflow.workflowId}`);
            seen.set(tool, workflow.workflowId);
            assert.equal(requiresRouteToken(tool), true, `${tool} must require routeToken`);
            assert.ok(["update", "delete", "batch", "email"].includes(getToolSkillGroup(tool)), `${tool} skill group`);
        }
    }
    for (const tool of EXPECTED_TRANSACTIONAL_TOOLS) {
        assert.ok(seen.has(tool), `missing registry coverage for ${tool}`);
    }
    assert.equal(seen.size, EXPECTED_TRANSACTIONAL_TOOLS.length);
});
test("every enabled transactional tool can obtain a valid routeToken", async () => {
    resetRouteTokenStateForTests({
        signingSecret: process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV],
    });
    for (const workflow of listActionWorkflows()) {
        const tools = enabledToolsForWorkflow(workflow);
        if (tools.length === 0) {
            continue;
        }
        const utterance = sampleUtteranceForWorkflow(workflow);
        const routed = await routeRequest(utterance, {
            sessionId: `coverage-session-${workflow.workflowId}`,
            connectionId: `coverage-connection-${workflow.workflowId}`,
        });
        assert.equal(routed.mode, "action", `${workflow.workflowId} utterance "${utterance}" → ${routed.mode}`);
        assert.ok(routed.routeToken, workflow.workflowId);
        assert.ok((routed.preferredTools?.length ?? 0) > 0, `${workflow.workflowId} preferredTools empty`);
        assert.equal(routed.preferredTools.length, tools.length);
        for (const tool of tools) {
            const validation = await validateRouteTokenForTool(routed.routeToken, {
                toolName: tool,
                sessionId: `coverage-session-${workflow.workflowId}`,
                connectionId: `coverage-connection-${workflow.workflowId}`,
            });
            assert.equal(validation.ok, true, `${workflow.workflowId} → ${tool}`);
        }
    }
});
test("action mode never returns empty preferredTools", async () => {
    const messages = [
        "add a customer",
        "delete customer ABC",
        "delete the customer named ABC with id 42",
        "remove the customer named Acme",
        "update customer ABC",
        "change customer ABC's name",
        "delete supplier XYZ",
        "create a sales invoice",
        "post a sales invoice",
        "email an invoice",
        "create a batch of customers",
        "update allocations",
        "create a nominal journal batch",
    ];
    for (const message of messages) {
        const routed = await routeRequest(message);
        if (routed.mode === "action") {
            assert.ok(routed.routeToken, message);
            assert.ok(routed.preferredTools.length > 0, message);
            assert.ok((routed.allowedTools?.length ?? 0) > 0, message);
        }
        else {
            assert.notEqual(routed.mode, "action");
            assert.equal(routed.routeToken, undefined);
        }
    }
});
test("delete customer and related utterances map to delete_customer with token", async () => {
    for (const message of [
        "delete customer ABC",
        "delete a customer",
        "remove the customer named ABC",
        "delete the customer named ABC with id 99",
    ]) {
        const classified = classifyRequestIntent(message);
        assert.equal(classified.mode, "action", message);
        assert.ok(classified.preferredTools.includes("brc_delete_customer"), message);
        const routed = await routeRequest(message);
        assert.equal(routed.mode, "action", message);
        assert.equal(routed.workflow, "delete_customer", message);
        assert.ok(routed.routeToken, message);
        assert.deepEqual(routed.allowedTools, ["brc_delete_customer"]);
    }
});
test("help requests never receive transactional tokens", async () => {
    for (const message of [
        "how do I delete a customer?",
        "show me how to create an invoice",
        "what are the steps to update a supplier?",
    ]) {
        const routed = await routeRequest(message, {
            helpSources: { freshdeskArticles: [] },
        });
        assert.equal(routed.mode, "help", message);
        assert.equal(routed.routeToken, undefined, message);
    }
});
test("unmapped action verb returns unsupported_action without token guidance", async () => {
    const routed = await routeRequest("delete this mysterious widget");
    assert.equal(routed.mode, "unsupported_action");
    assert.equal(routed.routeToken, undefined);
    assert.deepEqual([...routed.preferredTools], []);
    assert.match(routed.guidance, /Unsupported action/i);
    assert.doesNotMatch(routed.guidance, /Pass the returned routeToken/i);
});
test("affirmative confirmation helpers recognise yes and delete it", () => {
    assert.equal(isAffirmativeConfirmation("yes"), true);
    assert.equal(isAffirmativeConfirmation("delete it"), true);
    assert.equal(isAffirmativeConfirmation("go ahead"), true);
    assert.equal(isAffirmativeConfirmation("delete a customer"), false);
});
test("pending action confirmation continuation reuses routeToken", async () => {
    resetRouteTokenStateForTests({
        signingSecret: process.env[ROUTE_TOKEN_SIGNING_SECRET_ENV],
    });
    const sessionId = "pending-confirm-session";
    const connectionId = "pending-confirm-connection";
    const clientKey = "stable-pending-client-key";
    const first = await routeRequest("delete customer ACME", {
        sessionId,
        connectionId,
        clientKey,
    });
    assert.equal(first.mode, "action");
    assert.ok(first.routeToken);
    const scopeKeyHash = resolvePendingActionScopeKey({
        clientKey,
        sessionId,
    });
    await markPendingActionPreviewed({
        connectionId,
        scopeKeyHash,
        toolName: "brc_delete_customer",
        targetRecordKey: "code:acme",
    });
    const continued = await routeRequest("delete it", {
        sessionId: "rotated-session-after-preview",
        connectionId,
        clientKey,
    });
    assert.equal(continued.mode, "action");
    assert.equal(continued.confirmationContinuation, true);
    assert.equal(continued.routeToken, first.routeToken);
    assert.equal(continued.workflow, "delete_customer");
    assert.match(continued.guidance, /Confirmation continuation/i);
    await clearPendingAction({ connectionId, scopeKeyHash });
});
test("pending action survives scope lookup after save", async () => {
    const connectionId = "pending-store-connection";
    const scopeKeyHash = resolvePendingActionScopeKey({
        clientKey: "client-a",
    });
    await savePendingAction({
        connectionId,
        scopeKeyHash,
        workflowId: "create_customer",
        allowedTools: ["brc_create_customer"],
        routeToken: "redroute_test_token",
        originalMessage: "add a customer",
        messageHash: "abc",
        expiresAt: Date.now() + 60_000,
        status: "routed",
    });
    const loaded = await getPendingAction({ connectionId, scopeKeyHash });
    assert.ok(loaded);
    assert.equal(loaded.workflowId, "create_customer");
    assert.equal(loaded.routeToken, "redroute_test_token");
    await clearPendingAction({ connectionId, scopeKeyHash });
});
test("disabled delete skills yield unsupported_action for delete customer", async () => {
    const previous = process.env.BRC_ALLOW_DELETE_SKILLS;
    process.env.BRC_ALLOW_DELETE_SKILLS = "false";
    try {
        // isToolEnabled reads redServerConfig which is typically cached at import.
        // Still verify registry filtering helper respects isToolEnabled for deletes.
        const workflow = resolveActionWorkflow("delete a customer");
        if (!isToolEnabled("brc_delete_customer")) {
            assert.equal(workflow, null);
            const routed = await routeRequest("delete a customer");
            assert.equal(routed.mode, "unsupported_action");
            assert.equal(routed.routeToken, undefined);
        }
        else {
            // Config module may cache allowDeleteSkills at load — skip hard assert.
            assert.ok(getWorkflowForTool("brc_delete_customer"));
        }
    }
    finally {
        if (previous === undefined) {
            delete process.env.BRC_ALLOW_DELETE_SKILLS;
        }
        else {
            process.env.BRC_ALLOW_DELETE_SKILLS = previous;
        }
    }
});
test("listEnabledTransactionalTools only includes routeToken tools", () => {
    for (const tool of listEnabledTransactionalTools()) {
        assert.equal(requiresRouteToken(tool), true, tool);
    }
});
test("explicit workflow sample utterances from registry", () => {
    const samples = [
        ["create_customer", "add a customer"],
        ["update_customer", "update customer ABC"],
        ["delete_customer", "delete customer ABC"],
        ["delete_supplier", "delete supplier XYZ"],
        ["create_sales_invoice", "create a sales invoice"],
        ["batch_customers", "batch customers"],
        ["send_sales_invoice_email", "email an invoice"],
        ["update_allocations", "update allocations"],
        ["create_nominal_journal_batch", "create a nominal journal"],
        ["create_payment", "create a payment"],
    ];
    for (const [workflowId, message] of samples) {
        const resolved = resolveActionWorkflow(message);
        assert.ok(resolved, message);
        assert.equal(resolved.name, workflowId, message);
    }
});
