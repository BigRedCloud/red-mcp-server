import assert from "node:assert/strict";
import test from "node:test";
import { detectHelpMode, HELP_MODE_INSTRUCTION_SUMMARY, isHowToHelpPhrase, isRedHelpCompanyConnectionQuery, resolveHelpModeToolPolicy, resolveHelpSearchQuery, } from "./help-mode.js";
import { buildHelpAnswerSectionsMarkdown } from "./help-answer-layout.js";
import { resolveHelpRedActionCapability } from "./help-red-action-capability.js";
import { buildUnifiedFindHelpResourcesResponse } from "./unified-help-search.js";
test("detectHelpMode: red-help how do I add a sales invoice", () => {
    const result = detectHelpMode("red-help how do I add a sales invoice");
    assert.equal(result.isHelpMode, true);
    assert.equal(result.cleanedQuery, "how do I add a sales invoice");
});
test("detectHelpMode: RED-HELP: how do I add a customer?", () => {
    const result = detectHelpMode("RED-HELP: how do I add a customer?");
    assert.equal(result.isHelpMode, true);
    assert.equal(result.cleanedQuery, "how do I add a customer?");
});
test("detectHelpMode: leading spaces /red-help", () => {
    const result = detectHelpMode("  /red-help reconcile my bank");
    assert.equal(result.isHelpMode, true);
    assert.equal(result.cleanedQuery, "reconcile my bank");
});
test("detectHelpMode: red-help, add a supplier manually", () => {
    const result = detectHelpMode("red-help, add a supplier manually");
    assert.equal(result.isHelpMode, true);
    assert.equal(result.cleanedQuery, "add a supplier manually");
});
test("detectHelpMode: how-to wording is help mode", () => {
    assert.equal(detectHelpMode("how do I add a customer").isHelpMode, true);
    assert.equal(detectHelpMode("how do I create an invoice?").isHelpMode, true);
    assert.equal(detectHelpMode("show me how to add a supplier").isHelpMode, true);
    assert.equal(detectHelpMode("tell me how to add a payment").isHelpMode, true);
    assert.equal(detectHelpMode("what are the steps to create a sales invoice").isHelpMode, true);
    assert.equal(isHowToHelpPhrase("where do I reconcile my bank"), true);
});
test("non-trigger: help me add a customer (action-style help me)", () => {
    const result = detectHelpMode("help me add a customer");
    assert.equal(result.isHelpMode, false);
    assert.equal(result.cleanedQuery, "help me add a customer");
});
test("non-trigger: can you help add this supplier?", () => {
    const result = detectHelpMode("can you help add this supplier?");
    assert.equal(result.isHelpMode, false);
});
test("non-trigger: I need red-help documentation", () => {
    const result = detectHelpMode("I need red-help documentation");
    assert.equal(result.isHelpMode, false);
});
test("non-trigger: create a customer / add a customer", () => {
    assert.equal(detectHelpMode("create a customer").isHelpMode, false);
    assert.equal(detectHelpMode("add a customer").isHelpMode, false);
});
test("non-trigger: bare help / manual help label without how-to phrase", () => {
    assert.equal(detectHelpMode("manual help: bank reconciliation").isHelpMode, false);
    assert.equal(detectHelpMode("help").isHelpMode, false);
});
test("how do I inside a longer help-labelled message is still help", () => {
    assert.equal(detectHelpMode("help, how do I add a customer").isHelpMode, true);
});
test("red-help policy blocks transactional tools", () => {
    const policy = resolveHelpModeToolPolicy("red-help how do I add a sales invoice");
    assert.equal(policy.isHelpMode, true);
    assert.equal(policy.blockTransactionalTools, true);
    assert.equal(policy.allowCompanyConnectionTool, false);
    assert.deepEqual(policy.preferredHelpTools, [
        "brc_red_help",
        "brc_find_help_resources",
        "brc_get_help_resource_details",
    ]);
    assert.equal(policy.cleanedQuery, "how do I add a sales invoice");
});
test("how-to policy blocks transactional tools", () => {
    const policy = resolveHelpModeToolPolicy("how do I add a customer");
    assert.equal(policy.isHelpMode, true);
    assert.equal(policy.blockTransactionalTools, true);
});
test("normal mode policy does not block transactional tools", () => {
    const policy = resolveHelpModeToolPolicy("create a customer");
    assert.equal(policy.isHelpMode, false);
    assert.equal(policy.blockTransactionalTools, false);
    assert.equal(policy.allowCompanyConnectionTool, false);
    assert.deepEqual(policy.preferredHelpTools, []);
});
test("red-help connection query may keep company connection tool", () => {
    assert.equal(isRedHelpCompanyConnectionQuery("how do I connect my companies"), true);
    const policy = resolveHelpModeToolPolicy("red-help how do I connect my companies");
    assert.equal(policy.isHelpMode, true);
    assert.equal(policy.blockTransactionalTools, true);
    assert.equal(policy.allowCompanyConnectionTool, true);
});
test("resolveHelpSearchQuery strips red-help command", () => {
    const resolved = resolveHelpSearchQuery("red-help how do I add a sales invoice");
    assert.equal(resolved.isHelpMode, true);
    assert.equal(resolved.searchQuery, "how do I add a sales invoice");
});
test("unified help search receives cleaned query in red-help mode", () => {
    const article = {
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
        publicUrl: "https://bigredcloud.freshdesk.com/support/solutions/articles/1001",
    };
    const response = buildUnifiedFindHelpResourcesResponse("red-help how do I add a customer", { freshdeskArticles: [article] }, { maxResults: 5 });
    assert.equal(response.helpMode, true);
    assert.equal(response.question, "how do I add a customer");
    assert.equal(response.originalQuestion, "red-help how do I add a customer");
    assert.equal(response.blockTransactionalTools, true);
    assert.match(JSON.stringify(response.responseGuidance), /manual help mode|blockTransactionalTools|manual guidance/i);
});
test("ordinary how-to enters help mode for unified search", () => {
    const response = buildUnifiedFindHelpResourcesResponse("how do I create an invoice?", { freshdeskArticles: [] }, { maxResults: 5 });
    assert.equal(response.helpMode, true);
    assert.equal(response.question, "how do I create an invoice?");
    assert.equal(response.blockTransactionalTools, true);
});
test("action wording stays outside help mode for unified search", () => {
    const response = buildUnifiedFindHelpResourcesResponse("add a customer", { freshdeskArticles: [] }, { maxResults: 5 });
    assert.equal(response.helpMode, false);
    assert.equal(response.blockTransactionalTools, false);
});
test("red-help response puts manual Sources before Do this through Red", () => {
    const capability = resolveHelpRedActionCapability("how do I add a customer", {
        isToolEnabled: () => true,
    });
    assert.equal(capability.redActionAvailable, true);
    const sections = buildHelpAnswerSectionsMarkdown({
        sourcesMarkdown: "Sources\n\n### Articles\n- [Add a Customer](https://example.test/a)",
        redActionMarkdown: capability.customerFacingRedActionMarkdown,
        supportMarkdown: "Still need help?\n\n[Contact Big Red Cloud Support](https://bigredcloud.com/contact/)",
    });
    assert.ok(sections);
    const sourcesPos = sections.indexOf("Sources");
    const redPos = sections.indexOf("Do this through Red");
    const supportPos = sections.indexOf("Still need help?");
    assert.ok(sourcesPos >= 0);
    assert.ok(redPos > sourcesPos);
    assert.ok(supportPos > redPos);
});
test("red-help instruction summary is explicit", () => {
    assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /Manual help mode/i);
    assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /how-to wording|how do I/i);
    assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /brc_route_request|brc_red_help/);
    assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /Do not call create, update, delete/i);
    assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /detectHelpMode alone cannot force tool selection/i);
});
