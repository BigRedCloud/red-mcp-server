import assert from "node:assert/strict";
import test from "node:test";

import { wrapWriteToolHandler } from "../guards/write_confirmation.js";
import { routeRequest } from "./route-request.js";
import {
  encodeRouteTokenForTests,
  issueActionRouteToken,
  markRouteTokenConsumed,
  requiresRouteToken,
  resetRouteTokenStateForTests,
  ROUTE_REQUIRED_ERROR,
  ROUTE_REQUIRED_MESSAGE,
  ROUTE_TOKEN_TTL_MS,
  validateRouteToken,
  wrapRouteTokenHandler,
  type RouteTokenPayload,
} from "./route-token.js";
import type { SyncedFreshdeskArticle } from "../brc-edu/freshdesk/freshdesk-sync-service.js";

const SECRET = "test-route-token-signing-secret";

function setup(): void {
  resetRouteTokenStateForTests({ signingSecret: SECRET });
}

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

test("add a customer returns action/create_customer and a valid token", async () => {
  setup();
  const result = await routeRequest("add a customer");

  assert.equal(result.mode, "action");
  assert.equal(result.workflow, "create_customer");
  assert.deepEqual(result.allowedTools, ["brc_create_customer"]);
  assert.ok(result.routeToken);
  assert.equal(typeof result.routeToken, "string");

  const validation = validateRouteToken(result.routeToken, {
    toolName: "brc_create_customer",
  });
  assert.equal(validation.ok, true);
});

test("how do I add a customer returns help and no transactional token", async () => {
  setup();
  const result = await routeRequest("how do I add a customer", {
    helpSources: { freshdeskArticles: [sampleArticle] },
  });

  assert.equal(result.mode, "help");
  assert.equal(result.blockTransactionalTools, true);
  assert.equal(result.routeToken, undefined);
  assert.ok(result.help);
});

test("red-help add a customer returns help and no transactional token", async () => {
  setup();
  const result = await routeRequest("red-help add a customer", {
    helpSources: { freshdeskArticles: [sampleArticle] },
  });

  assert.equal(result.mode, "help");
  assert.equal(result.routeToken, undefined);
  assert.equal(result.blockTransactionalTools, true);
});

test("create_customer without a token is rejected", async () => {
  setup();
  let handlerCalled = false;
  const wrapped = wrapRouteTokenHandler(
    "brc_create_customer",
    async () => {
      handlerCalled = true;
      return { ok: true };
    },
  );

  const result = (await wrapped({})) as {
    content: Array<{ text: string }>;
  };
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.error, ROUTE_REQUIRED_ERROR);
  assert.equal(body.message, ROUTE_REQUIRED_MESSAGE);
  assert.equal(handlerCalled, false);
});

test("create_customer with a help-mode attempt (no action token) is rejected", async () => {
  setup();
  const help = await routeRequest("how do I add a customer", {
    helpSources: { freshdeskArticles: [] },
  });
  assert.equal(help.routeToken, undefined);

  let handlerCalled = false;
  const wrapped = wrapRouteTokenHandler(
    "brc_create_customer",
    async () => {
      handlerCalled = true;
      return { ok: true };
    },
  );

  const result = (await wrapped({
    routeToken: help.routeToken as unknown as string,
  })) as { content: Array<{ text: string }> };
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.error, ROUTE_REQUIRED_ERROR);
  assert.equal(handlerCalled, false);
});

test("create_customer with the correct action token reaches normal preflight", async () => {
  setup();
  const routed = await routeRequest("add a customer");
  assert.ok(routed.routeToken);

  let handlerCalled = false;
  const writeWrapped = wrapWriteToolHandler(
    "brc_create_customer",
    async () => {
      handlerCalled = true;
      return { posted: true };
    },
  );
  const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);

  const result = (await wrapped({
    routeToken: routed.routeToken,
    companyName: "Demo",
    payload: { name: "Acme" },
  })) as { content: Array<{ text: string }> };
  const body = JSON.parse(result.content[0].text);

  assert.equal(handlerCalled, false);
  assert.equal(body.status ?? body.error, "confirmation_required");
  assert.ok(
    body.payloadPreview || body.confirmationField === "confirmWrite",
    "expected preview-before-posting payload",
  );
});

test("preview-before-posting remains mandatory even with a valid routeToken", async () => {
  setup();
  const routed = await routeRequest("add a customer");
  const writeWrapped = wrapWriteToolHandler(
    "brc_create_customer",
    async () => ({ posted: true }),
  );
  const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);

  const preview = (await wrapped({
    routeToken: routed.routeToken,
    companyName: "Demo",
    payload: { name: "Acme" },
  })) as { content: Array<{ text: string }> };
  const previewBody = JSON.parse(preview.content[0].text);
  assert.equal(previewBody.status ?? previewBody.error, "confirmation_required");
});

test("create_sales_invoice rejects a create_customer token", async () => {
  setup();
  const routed = await routeRequest("add a customer");
  let handlerCalled = false;
  const wrapped = wrapRouteTokenHandler(
    "brc_create_sales_invoice",
    async () => {
      handlerCalled = true;
      return { ok: true };
    },
  );

  const result = (await wrapped({
    routeToken: routed.routeToken,
  })) as { content: Array<{ text: string }> };
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.error, ROUTE_REQUIRED_ERROR);
  assert.equal(handlerCalled, false);
});

test("expired tokens are rejected", () => {
  setup();
  const issued = issueActionRouteToken({
    workflow: "create_customer",
    allowedTools: ["brc_create_customer"],
    message: "add a customer",
    now: Date.now() - ROUTE_TOKEN_TTL_MS - 1000,
    ttlMs: 1000,
  });

  const validation = validateRouteToken(issued.routeToken, {
    toolName: "brc_create_customer",
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reason, "expired");
  }
});

test("altered tokens are rejected", () => {
  setup();
  const issued = issueActionRouteToken({
    workflow: "create_customer",
    allowedTools: ["brc_create_customer"],
    message: "add a customer",
  });

  const altered = `${issued.routeToken.slice(0, -4)}xxxx`;
  const validation = validateRouteToken(altered, {
    toolName: "brc_create_customer",
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(
      validation.reason === "bad_signature" ||
        validation.reason === "malformed",
    );
  }
});

test("replayed (consumed) tokens are rejected", async () => {
  setup();
  const routed = await routeRequest("add a customer");
  const validation = validateRouteToken(routed.routeToken, {
    toolName: "brc_create_customer",
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) {
    return;
  }

  markRouteTokenConsumed(validation.payload.jti, validation.payload.exp);

  const again = validateRouteToken(routed.routeToken, {
    toolName: "brc_create_customer",
  });
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.equal(again.reason, "consumed");
  }
});

test("confirmed write consumes the routeToken (replay rejected)", async () => {
  setup();
  const routed = await routeRequest("add a customer");
  const writeWrapped = wrapWriteToolHandler(
    "brc_create_customer",
    async () => ({ posted: true }),
  );
  const wrapped = wrapRouteTokenHandler("brc_create_customer", writeWrapped);

  const posted = await wrapped({
    routeToken: routed.routeToken,
    companyName: "Demo",
    payload: { name: "Acme" },
    confirmWrite: true,
  });
  assert.deepEqual(posted, { posted: true });

  const replay = (await wrapped({
    routeToken: routed.routeToken,
    companyName: "Demo",
    payload: { name: "Acme" },
    confirmWrite: true,
  })) as { content: Array<{ text: string }> };
  const body = JSON.parse(replay.content[0].text);
  assert.equal(body.error, ROUTE_REQUIRED_ERROR);
});

test("cross-session tokens are rejected when identity is available", () => {
  setup();
  const issued = issueActionRouteToken({
    workflow: "create_customer",
    allowedTools: ["brc_create_customer"],
    message: "add a customer",
    sessionId: "session-a",
  });

  const validation = validateRouteToken(issued.routeToken, {
    toolName: "brc_create_customer",
    sessionId: "session-b",
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.equal(validation.reason, "wrong_session");
  }
});

test("forged help-mode style payload is not accepted as action token", () => {
  setup();
  const payload = {
    jti: "abc",
    mode: "help",
    workflow: "create_customer",
    allowedTools: ["brc_create_customer"],
    messageHash: "x",
    sessionId: "s1",
    iat: Date.now(),
    exp: Date.now() + ROUTE_TOKEN_TTL_MS,
  } as unknown as RouteTokenPayload;

  const token = encodeRouteTokenForTests(payload);
  const validation = validateRouteToken(token, {
    toolName: "brc_create_customer",
    sessionId: "s1",
  });
  assert.equal(validation.ok, false);
});

test("help routing does not persist into the next request", async () => {
  setup();
  const help = await routeRequest("how do I add a customer", {
    helpSources: { freshdeskArticles: [] },
  });
  assert.equal(help.mode, "help");
  assert.equal(help.routeToken, undefined);

  const action = await routeRequest("add a customer");
  assert.equal(action.mode, "action");
  assert.ok(action.routeToken);
});

test("requiresRouteToken covers transactional groups and exempts help/session", () => {
  assert.equal(requiresRouteToken("brc_create_customer"), true);
  assert.equal(requiresRouteToken("brc_create_sales_invoice"), true);
  assert.equal(requiresRouteToken("brc_delete_sales_invoice"), true);
  assert.equal(requiresRouteToken("brc_batch_sales_invoices"), true);
  assert.equal(requiresRouteToken("brc_send_quote_email"), true);
  assert.equal(requiresRouteToken("brc_route_request"), false);
  assert.equal(requiresRouteToken("brc_red_help"), false);
  assert.equal(requiresRouteToken("brc_find_help_resources"), false);
  assert.equal(requiresRouteToken("brc_start_company_connection"), false);
  assert.equal(requiresRouteToken("brc_list_customers"), false);
});
