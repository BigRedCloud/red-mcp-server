import assert from "node:assert/strict";
import test from "node:test";

import { classifyRequestIntent } from "./intent-classifier.js";
import { routeRequest } from "./route-request.js";
import type { SyncedFreshdeskArticle } from "../brc-edu/freshdesk/freshdesk-sync-service.js";

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
  assert.deepEqual(
    [...result.preferredTools],
    [
      "brc_red_help",
      "brc_find_help_resources",
      "brc_get_help_resource_details",
    ],
  );
});

test("classify: can you add a customer for me → action", () => {
  const result = classifyRequestIntent("can you add a customer for me");
  assert.equal(result.mode, "action");
  assert.equal(result.blockTransactionalTools, false);
});

test("classify: can you show me how to add a customer → help", () => {
  const result = classifyRequestIntent(
    "can you show me how to add a customer",
  );
  assert.equal(result.mode, "help");
  assert.equal(result.blockTransactionalTools, true);
});

test("classify: show me how to add a customer → help", () => {
  assert.equal(
    classifyRequestIntent("show me how to add a customer").mode,
    "help",
  );
});

test("classify: red-help add a customer → help", () => {
  const result = classifyRequestIntent("red-help add a customer");
  assert.equal(result.mode, "help");
  assert.equal(result.cleanedQuery, "add a customer");
  assert.equal(result.blockTransactionalTools, true);
});

test("classify: what are the steps to create a sales invoice → help", () => {
  const result = classifyRequestIntent(
    "what are the steps to create a sales invoice",
  );
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
  assert.equal(classifyRequestIntent("delete this invoice").mode, "action");
});

test("classify: how-to phrases stay help despite create/add verbs", () => {
  assert.equal(
    classifyRequestIntent("how do I create a sales invoice").mode,
    "help",
  );
  assert.equal(
    classifyRequestIntent("tell me how to add a supplier").mode,
    "help",
  );
  assert.equal(
    classifyRequestIntent("show me how to reconcile my bank").mode,
    "help",
  );
  assert.equal(
    classifyRequestIntent("where do I add a customer").mode,
    "help",
  );
  assert.equal(
    classifyRequestIntent("manual steps for bank reconciliation").mode,
    "help",
  );
  assert.equal(
    classifyRequestIntent("red-help how do I add a customer").mode,
    "help",
  );
  assert.equal(
    classifyRequestIntent("/red-help reconcile my bank").mode,
    "help",
  );
});

test("classify: connect my companies → connection", () => {
  const result = classifyRequestIntent("connect my companies");
  assert.equal(result.mode, "connection");
  assert.ok(
    result.preferredTools.includes("brc_start_company_connection"),
  );
});

test("classify: list customers → read", () => {
  assert.equal(classifyRequestIntent("list customers").mode, "read");
});

test("classify: empty → unknown", () => {
  assert.equal(classifyRequestIntent("").mode, "unknown");
});

const sampleArticle: SyncedFreshdeskArticle = {
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

test("routeRequest help mode calls unified help pipeline and blocks transactional tools", async () => {
  const result = await routeRequest("how do I add a customer", {
    helpSources: { freshdeskArticles: [sampleArticle] },
  });

  assert.equal(result.mode, "help");
  assert.equal(result.blockTransactionalTools, true);
  assert.ok(result.help);
  assert.equal(result.help!.helpMode, true);
  assert.equal(result.help!.blockTransactionalTools, true);
  assert.ok(result.help!.matchCount >= 1);
  assert.ok(
    result.help!.resources.some((resource) =>
      /add a customer/i.test(resource.title),
    ),
  );
  assert.match(result.guidance, /manual/i);
  assert.match(result.guidance, /Do this through Red/i);
  assert.deepEqual(
    [...result.preferredTools],
    [
      "brc_red_help",
      "brc_find_help_resources",
      "brc_get_help_resource_details",
    ],
  );
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
