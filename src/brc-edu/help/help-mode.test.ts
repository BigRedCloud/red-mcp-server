import assert from "node:assert/strict";
import test from "node:test";

import {
  detectHelpMode,
  HELP_MODE_INSTRUCTION_SUMMARY,
  resolveHelpModeToolPolicy,
  resolveHelpSearchQuery,
} from "./help-mode.js";
import { buildHelpAnswerSectionsMarkdown } from "./help-answer-layout.js";
import { resolveHelpRedActionCapability } from "./help-red-action-capability.js";
import { buildUnifiedFindHelpResourcesResponse } from "./unified-help-search.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";

test("detectHelpMode: help, how do I add a customer", () => {
  const result = detectHelpMode("help, how do I add a customer");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "how do I add a customer");
});

test("detectHelpMode: HELP: How do I create an invoice?", () => {
  const result = detectHelpMode("HELP: How do I create an invoice?");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "How do I create an invoice?");
});

test("detectHelpMode: leading spaces help me reconcile", () => {
  const result = detectHelpMode("  help me reconcile my bank");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "reconcile my bank");
});

test("detectHelpMode: show me how to add a supplier", () => {
  const result = detectHelpMode("show me how to add a supplier");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "add a supplier");
});

test("detectHelpMode: tell me how to do this manually with colon", () => {
  const result = detectHelpMode(
    "tell me how to do this manually: create a credit note",
  );
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "create a credit note");
});

test("detectHelpMode: how do prefix", () => {
  const result = detectHelpMode("how do I add a customer to Big Red Cloud");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "I add a customer to Big Red Cloud");
});

test("detectHelpMode: manual help prefix", () => {
  const result = detectHelpMode("manual help: bank reconciliation");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "bank reconciliation");
});

test("detectHelpMode: bare help alone", () => {
  const result = detectHelpMode("help");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "");
});

test("normal mode: Add a customer", () => {
  const result = detectHelpMode("Add a customer");
  assert.equal(result.isHelpMode, false);
  assert.equal(result.cleanedQuery, "Add a customer");
});

test("normal mode: Can you help add this customer for me?", () => {
  const result = detectHelpMode("Can you help add this customer for me?");
  assert.equal(result.isHelpMode, false);
  assert.equal(result.cleanedQuery, "Can you help add this customer for me?");
});

test("normal mode: I need help but please create the invoice", () => {
  const result = detectHelpMode("I need help but please create the invoice");
  assert.equal(result.isHelpMode, false);
});

test("normal mode: Create a supplier called Test Ltd", () => {
  const result = detectHelpMode("Create a supplier called Test Ltd");
  assert.equal(result.isHelpMode, false);
  assert.equal(result.cleanedQuery, "Create a supplier called Test Ltd");
});

test("normal mode: helpfulness at start is not help mode", () => {
  const result = detectHelpMode("helpfulness tip for invoices");
  assert.equal(result.isHelpMode, false);
});

test("help mode policy blocks transactional tools", () => {
  const policy = resolveHelpModeToolPolicy(
    "help, how do I add a customer to Big Red Cloud",
  );
  assert.equal(policy.isHelpMode, true);
  assert.equal(policy.blockTransactionalTools, true);
  assert.deepEqual(policy.preferredHelpTools, [
    "brc_find_help_resources",
    "brc_get_help_resource_details",
  ]);
  assert.equal(policy.cleanedQuery, "how do I add a customer to Big Red Cloud");
});

test("normal mode policy does not block transactional tools", () => {
  const policy = resolveHelpModeToolPolicy("Add a customer");
  assert.equal(policy.isHelpMode, false);
  assert.equal(policy.blockTransactionalTools, false);
  assert.deepEqual(policy.preferredHelpTools, []);
});

test("resolveHelpSearchQuery strips prefix for search", () => {
  const resolved = resolveHelpSearchQuery(
    "help, how do I add a customer to Big Red Cloud",
  );
  assert.equal(resolved.isHelpMode, true);
  assert.equal(
    resolved.searchQuery,
    "how do I add a customer to Big Red Cloud",
  );
});

test("unified help search receives cleaned query in help mode", () => {
  const article: SyncedFreshdeskArticle = {
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
    publicUrl:
      "https://bigredcloud.freshdesk.com/support/solutions/articles/1001",
  };

  const response = buildUnifiedFindHelpResourcesResponse(
    "help, how do I add a customer",
    { freshdeskArticles: [article] },
    { maxResults: 5 },
  );

  assert.equal(response.helpMode, true);
  assert.equal(response.question, "how do I add a customer");
  assert.equal(
    response.originalQuestion,
    "help, how do I add a customer",
  );
  assert.equal(response.blockTransactionalTools, true);
  assert.match(
    JSON.stringify(response.responseGuidance),
    /help mode|Do not.*perform the accounting action|blockTransactionalTools|manual guidance/i,
  );
});

test("help-mode response puts manual Sources before Do this through Red", () => {
  const capability = resolveHelpRedActionCapability("how do I add a customer", {
    isToolEnabled: () => true,
  });
  assert.equal(capability.redActionAvailable, true);

  const sections = buildHelpAnswerSectionsMarkdown({
    sourcesMarkdown: "Sources\n\n### Articles\n- [Add a Customer](https://example.test/a)",
    redActionMarkdown: capability.customerFacingRedActionMarkdown,
    supportMarkdown:
      "Still need help?\n\n[Contact Big Red Cloud Support](https://bigredcloud.com/contact/)",
  });

  assert.ok(sections);
  const sourcesPos = sections!.indexOf("Sources");
  const redPos = sections!.indexOf("Do this through Red");
  const supportPos = sections!.indexOf("Still need help?");
  assert.ok(sourcesPos >= 0);
  assert.ok(redPos > sourcesPos);
  assert.ok(supportPos > redPos);
});

test("help mode instruction summary is explicit", () => {
  assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /help mode/i);
  assert.match(
    HELP_MODE_INSTRUCTION_SUMMARY,
    /Do not interpret it as permission to perform the accounting action/i,
  );
  assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /brc_find_help_resources/);
  assert.match(
    HELP_MODE_INSTRUCTION_SUMMARY,
    /Do not call create, update, delete/i,
  );
});
