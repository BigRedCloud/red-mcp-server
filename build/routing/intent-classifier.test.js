import assert from "node:assert/strict";
import test from "node:test";
import { classifyRequestIntent } from "./intent-classifier.js";
import { routeRequest } from "./route-request.js";
test("classify: add a customer → action", () => {
    const result = classifyRequestIntent("add a customer");
    assert.equal(result.mode, "action");
    assert.equal(result.blockTransactionalTools, false);
    assert.ok(result.preferredTools.includes("brc_create_customer"));
});
test("classify: how do I add a customer → help", () => {
    const result = classifyRequestIntent("how do I add a customer");
    assert.equal(result.mode, "help");
    assert.equal(result.blockTransactionalTools, true);
    assert.deepEqual([...result.preferredTools], [
        "brc_red_help",
        "brc_find_help_resources",
        "brc_get_help_resource_details",
    ]);
});
test("classify: can you add a customer for me → action", () => {
    const result = classifyRequestIntent("can you add a customer for me");
    assert.equal(result.mode, "action");
    assert.equal(result.blockTransactionalTools, false);
});
test("classify: can you show me how to add a customer → help", () => {
    const result = classifyRequestIntent("can you show me how to add a customer");
    assert.equal(result.mode, "help");
    assert.equal(result.blockTransactionalTools, true);
});
test("classify: show me how to add a customer → help", () => {
    assert.equal(classifyRequestIntent("show me how to add a customer").mode, "help");
});
test("classify: red-help add a customer → help", () => {
    const result = classifyRequestIntent("red-help add a customer");
    assert.equal(result.mode, "help");
    assert.equal(result.cleanedQuery, "add a customer");
    assert.equal(result.blockTransactionalTools, true);
});
test("classify: what are the steps to create a sales invoice → help", () => {
    const result = classifyRequestIntent("what are the steps to create a sales invoice");
    assert.equal(result.mode, "help");
    assert.equal(result.blockTransactionalTools, true);
});
test("classify: create a sales invoice → action", () => {
    const result = classifyRequestIntent("create a sales invoice");
    assert.equal(result.mode, "action");
    assert.equal(result.blockTransactionalTools, false);
});
test("classify: post this purchase → action", () => {
    assert.equal(classifyRequestIntent("post this purchase").mode, "action");
});
test("classify: update this supplier → action", () => {
    assert.equal(classifyRequestIntent("update this supplier").mode, "action");
});
test("classify: delete this invoice → action", () => {
    const result = classifyRequestIntent("delete this invoice");
    assert.equal(result.mode, "action");
    assert.ok(result.preferredTools.includes("brc_delete_sales_invoice"));
});
test("classify: delete a customer → action with brc_delete_customer", () => {
    const result = classifyRequestIntent("delete a customer");
    assert.equal(result.mode, "action");
    assert.ok(result.preferredTools.includes("brc_delete_customer"));
});
test("classify: delete mysterious widget → unsupported_action", () => {
    const result = classifyRequestIntent("delete this mysterious widget");
    assert.equal(result.mode, "unsupported_action");
    assert.deepEqual([...result.preferredTools], []);
});
test("classify: how-to phrases stay help despite create/add verbs", () => {
    assert.equal(classifyRequestIntent("how do I create a sales invoice").mode, "help");
    assert.equal(classifyRequestIntent("tell me how to add a supplier").mode, "help");
    assert.equal(classifyRequestIntent("show me how to reconcile my bank").mode, "help");
    assert.equal(classifyRequestIntent("where do I add a customer").mode, "help");
    assert.equal(classifyRequestIntent("manual steps for bank reconciliation").mode, "help");
    assert.equal(classifyRequestIntent("red-help how do I add a customer").mode, "help");
    assert.equal(classifyRequestIntent("/red-help reconcile my bank").mode, "help");
});
test("classify: connect my companies → connection", () => {
    const result = classifyRequestIntent("connect my companies");
    assert.equal(result.mode, "connection");
    assert.ok(result.preferredTools.includes("brc_start_company_connection"));
});
test("classify: list customers → read", () => {
    assert.equal(classifyRequestIntent("list customers").mode, "read");
});
test("classify: empty → unknown", () => {
    assert.equal(classifyRequestIntent("").mode, "unknown");
});
test("classify: explicit cash receipt update routes correctly", () => {
    const result = classifyRequestIntent("In Company C, update Cash Receipt id 550078131. Change only the note to CASH RECEIPT MERGE TEST.");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "update_cash_receipt");
    assert.deepEqual([...result.preferredTools], ["brc_update_cash_receipt"]);
});
test("classify: short cash receipt update routes correctly", () => {
    const result = classifyRequestIntent("update cash receipt 550078131");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "update_cash_receipt");
    assert.deepEqual([...result.preferredTools], ["brc_update_cash_receipt"]);
});
test("classify: changing a cash receipt note routes correctly", () => {
    const result = classifyRequestIntent("change the note on cash receipt 550078131");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "update_cash_receipt");
    assert.deepEqual([...result.preferredTools], ["brc_update_cash_receipt"]);
});
test("routeRequest: cash receipt update issues correct route token", async () => {
    const result = await routeRequest("In Company C, update Cash Receipt id 550078131. Change only the note to CASH RECEIPT MERGE TEST.");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow, "update_cash_receipt");
    assert.deepEqual(result.allowedTools, ["brc_update_cash_receipt"]);
    assert.ok(result.routeToken);
});
const sampleArticle = {
    id: "freshdesk-1001",
    source: "freshdesk",
    freshdeskArticleId: 1001,
    categoryId: 1,
    folderId: 2,
    folderName: "Customers",
    title: "How do I add a Customer",
    bodyText: "Steps to add a customer in Big Red Cloud.",
    images: [],
    syncedImages: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    enabled: true,
    slug: "how-do-i-add-a-customer",
    publicUrl: "https://bigredcloud.freshdesk.com/support/solutions/articles/157000368447-how-do-i-add-a-customer-",
};
test("routeRequest help mode calls unified help pipeline and blocks transactional tools", async () => {
    const result = await routeRequest("how do I add a customer", {
        helpSources: { freshdeskArticles: [sampleArticle] },
    });
    assert.equal(result.mode, "help");
    assert.equal(result.blockTransactionalTools, true);
    assert.ok(result.help);
    assert.equal(result.help.helpMode, true);
    assert.equal(result.help.blockTransactionalTools, true);
    assert.ok(result.help.matchCount >= 1);
    assert.ok(result.help.resources.some((resource) => /add a customer/i.test(resource.title)));
    assert.match(result.guidance, /manual/i);
    assert.match(result.guidance, /Do this through Red/i);
    assert.deepEqual([...result.preferredTools], [
        "brc_red_help",
        "brc_find_help_resources",
        "brc_get_help_resource_details",
    ]);
});
test("routeRequest action mode allows create workflow", async () => {
    const result = await routeRequest("add a customer");
    assert.equal(result.mode, "action");
    assert.equal(result.blockTransactionalTools, false);
    assert.equal(result.workflow, "create_customer");
    assert.ok(result.workflowDetails?.requiresPreviewConfirmation);
    assert.ok(result.routeToken);
    assert.deepEqual(result.allowedTools, ["brc_create_customer"]);
    assert.equal(result.help, undefined);
    assert.match(result.guidance, /preview-before-posting/i);
});
test("routeRequest delete customer issues token", async () => {
    const result = await routeRequest("delete a customer");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow, "delete_customer");
    assert.ok(result.routeToken);
    assert.ok(result.preferredTools.length > 0);
    assert.deepEqual(result.allowedTools, ["brc_delete_customer"]);
});
test("routeRequest help mode does not persist into the next request", async () => {
    const help = await routeRequest("how do I add a customer", {
        helpSources: { freshdeskArticles: [sampleArticle] },
    });
    assert.equal(help.mode, "help");
    assert.equal(help.routeToken, undefined);
    const action = await routeRequest("add a customer");
    assert.equal(action.mode, "action");
    assert.equal(action.blockTransactionalTools, false);
    assert.ok(action.routeToken);
    assert.equal(action.help, undefined);
});
test("routeRequest red-help add a customer → help with cleaned query", async () => {
    const result = await routeRequest("red-help add a customer", {
        helpSources: { freshdeskArticles: [sampleArticle] },
    });
    assert.equal(result.mode, "help");
    assert.equal(result.cleanedQuery, "add a customer");
    assert.equal(result.blockTransactionalTools, true);
});
test("classify: cash receipt update ignores customer in do-not-change constraints", () => {
    const result = classifyRequestIntent('In Company C, update Cash Receipt id 550078131. Change only the note to: "CASH RECEIPT MERGE TEST". Do not change any monetary, VAT, allocation, ledger, customer, account or date fields. Use brc_update_cash_receipt. Show me the proposed update first and do not submit until I confirm.');
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "update_cash_receipt");
    assert.deepEqual([...result.preferredTools], ["brc_update_cash_receipt"]);
});
test("classify: update cash receipt record is not treated as create", () => {
    const result = classifyRequestIntent('Update cash receipt record. In Company C, update Cash Receipt id 550078131, changing only the note field to "CASH RECEIPT MERGE TEST".');
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "update_cash_receipt");
    assert.deepEqual([...result.preferredTools], ["brc_update_cash_receipt"]);
});
test("classify: staging batch cash payments wording routes to batch_cash_payments", () => {
    const result = classifyRequestIntent("In Company C, prepare a batch of 2 disposable analysed Cash Payments. Use brc_batch_cash_payments. Item 1: ... Item 2: ... Show me the exact batch payload first. Do not submit until I confirm.");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "batch_cash_payments");
    assert.deepEqual([...result.preferredTools], ["brc_batch_cash_payments"]);
});
test("classify: batch of 2 Cash Payments routes to batch_cash_payments", () => {
    const result = classifyRequestIntent("batch of 2 Cash Payments");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "batch_cash_payments");
});
test("classify: create 2 Cash Payments routes to batch_cash_payments", () => {
    const result = classifyRequestIntent("create 2 Cash Payments");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "batch_cash_payments");
});
test("classify: multiple Cash Payments routes to batch_cash_payments", () => {
    const result = classifyRequestIntent("multiple Cash Payments");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "batch_cash_payments");
});
test("classify: create a Cash Payment still routes to create_cash_payment", () => {
    const result = classifyRequestIntent("create a Cash Payment");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "create_cash_payment");
    assert.deepEqual([...result.preferredTools], ["brc_create_cash_payment"]);
});
test("classify: prepare a batch of Cash Receipts still routes to batch_cash_receipts", () => {
    const result = classifyRequestIntent("prepare a batch of 2 Cash Receipts");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow?.name, "batch_cash_receipts");
});
test("routeRequest: staging batch cash payments issues batch route token", async () => {
    const result = await routeRequest("In Company C, prepare a batch of 2 disposable analysed Cash Payments. Use brc_batch_cash_payments. Item 1: ... Item 2: ... Show me the exact batch payload first. Do not submit until I confirm.");
    assert.equal(result.mode, "action");
    assert.equal(result.workflow, "batch_cash_payments");
    assert.deepEqual(result.allowedTools, ["brc_batch_cash_payments"]);
    assert.ok(result.routeToken);
});
