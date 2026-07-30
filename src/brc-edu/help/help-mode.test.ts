import assert from "node:assert/strict";
import test from "node:test";

import {
  detectHelpMode,
  HELP_MODE_INSTRUCTION_SUMMARY,
  isRedHelpCompanyConnectionQuery,
  resolveHelpModeToolPolicy,
  resolveHelpSearchQuery,
} from "./help-mode.js";
import { buildHelpAnswerSectionsMarkdown } from "./help-answer-layout.js";
import { resolveHelpRedActionCapability } from "./help-red-action-capability.js";
import { buildUnifiedFindHelpResourcesResponse } from "./unified-help-search.js";
import type { SyncedFreshdeskArticle } from "../freshdesk/freshdesk-sync-service.js";

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

test("detectHelpMode: RED-HELP: add a supplier manually", () => {
  const result = detectHelpMode("RED-HELP: add a supplier manually");
  assert.equal(result.isHelpMode, true);
  assert.equal(result.cleanedQuery, "add a supplier manually");
});

test("non-trigger: help me add a customer", () => {
  const result = detectHelpMode("help me add a customer");
  assert.equal(result.isHelpMode, false);
  assert.equal(result.cleanedQuery, "help me add a customer");
});

test("non-trigger: how do I create an invoice?", () => {
  const result = detectHelpMode("how do I create an invoice?");
  assert.equal(result.isHelpMode, false);
  assert.equal(result.cleanedQuery, "how do I create an invoice?");
});

test("non-trigger: can you help add this supplier?", () => {
  const result = detectHelpMode("can you help add this supplier?");
  assert.equal(result.isHelpMode, false);
});

test("non-trigger: I need red-help documentation", () => {
  const result = detectHelpMode("I need red-help documentation");
  assert.equal(result.isHelpMode, false);
});

test("non-trigger: create a customer", () => {
  const result = detectHelpMode("create a customer");
  assert.equal(result.isHelpMode, false);
  assert.equal(result.cleanedQuery, "create a customer");
});

test("non-trigger: tell me how to add a payment", () => {
  const result = detectHelpMode("tell me how to add a payment");
  assert.equal(result.isHelpMode, false);
});

test("non-trigger: show me how / manual help / bare help", () => {
  assert.equal(detectHelpMode("show me how to add a supplier").isHelpMode, false);
  assert.equal(detectHelpMode("manual help: bank reconciliation").isHelpMode, false);
  assert.equal(detectHelpMode("help").isHelpMode, false);
  assert.equal(detectHelpMode("help, how do I add a customer").isHelpMode, false);
});

test("red-help policy blocks transactional tools", () => {
  const policy = resolveHelpModeToolPolicy(
    "red-help how do I add a sales invoice",
  );
  assert.equal(policy.isHelpMode, true);
  assert.equal(policy.blockTransactionalTools, true);
  assert.equal(policy.allowCompanyConnectionTool, false);
  assert.deepEqual(policy.preferredHelpTools, [
    "brc_find_help_resources",
    "brc_get_help_resource_details",
  ]);
  assert.equal(policy.cleanedQuery, "how do I add a sales invoice");
});

test("normal mode policy does not block transactional tools", () => {
  const policy = resolveHelpModeToolPolicy("create a customer");
  assert.equal(policy.isHelpMode, false);
  assert.equal(policy.blockTransactionalTools, false);
  assert.equal(policy.allowCompanyConnectionTool, false);
  assert.deepEqual(policy.preferredHelpTools, []);
});

test("red-help connection query may keep company connection tool", () => {
  assert.equal(
    isRedHelpCompanyConnectionQuery("how do I connect my companies"),
    true,
  );
  const policy = resolveHelpModeToolPolicy(
    "red-help how do I connect my companies",
  );
  assert.equal(policy.isHelpMode, true);
  assert.equal(policy.blockTransactionalTools, true);
  assert.equal(policy.allowCompanyConnectionTool, true);
});

test("resolveHelpSearchQuery strips red-help command", () => {
  const resolved = resolveHelpSearchQuery(
    "red-help how do I add a sales invoice",
  );
  assert.equal(resolved.isHelpMode, true);
  assert.equal(resolved.searchQuery, "how do I add a sales invoice");
});

test("unified help search receives cleaned query in red-help mode", () => {
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
    "red-help how do I add a customer",
    { freshdeskArticles: [article] },
    { maxResults: 5 },
  );

  assert.equal(response.helpMode, true);
  assert.equal(response.question, "how do I add a customer");
  assert.equal(response.originalQuestion, "red-help how do I add a customer");
  assert.equal(response.blockTransactionalTools, true);
  assert.match(
    JSON.stringify(response.responseGuidance),
    /red-help|reserved manual-help command|blockTransactionalTools|manual guidance/i,
  );
});

test("ordinary how-to remains normal mode for unified search", () => {
  const response = buildUnifiedFindHelpResourcesResponse(
    "how do I create an invoice?",
    { freshdeskArticles: [] },
    { maxResults: 5 },
  );

  assert.equal(response.helpMode, false);
  assert.equal(response.question, "how do I create an invoice?");
  assert.equal(response.blockTransactionalTools, false);
});

test("red-help response puts manual Sources before Do this through Red", () => {
  const capability = resolveHelpRedActionCapability("how do I add a customer", {
    isToolEnabled: () => true,
  });
  assert.equal(capability.redActionAvailable, true);

  const sections = buildHelpAnswerSectionsMarkdown({
    sourcesMarkdown:
      "Sources\n\n### Articles\n- [Add a Customer](https://example.test/a)",
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

test("red-help instruction summary is explicit", () => {
  assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /red-help is Red's reserved manual-help command/i);
  assert.match(
    HELP_MODE_INSTRUCTION_SUMMARY,
    /provide customer-help resources and manual instructions instead of performing the accounting action/i,
  );
  assert.match(HELP_MODE_INSTRUCTION_SUMMARY, /brc_find_help_resources/);
  assert.match(
    HELP_MODE_INSTRUCTION_SUMMARY,
    /Do not call create, update, delete/i,
  );
  assert.match(
    HELP_MODE_INSTRUCTION_SUMMARY,
    /brc_start_company_connection only when/i,
  );
});
