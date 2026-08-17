import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION } from "../tools/edu/help_resources_tools.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";

async function startTestServer(t: TestContext, port: number) {
  return startHttpTestServer(t, port, {
    BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET: "integration-test-secret",
    RED_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
  });
}

test("GET public Freshdesk image route rejects invalid token without Azure details", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(
    `http://127.0.0.1:${port}/public/brc-edu/freshdesk-images/1001/invalid.token.value`,
  );

  assert.equal(response.status, 404);
  const body = await response.text();
  assert.equal(body, "");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(body.includes("blob.core.windows.net"), false);
  assert.equal(body.includes("AccountKey="), false);
  assert.equal(body.includes("sig="), false);
});

test("HEAD public Freshdesk image route is available without company credentials", async (t) => {
  const port = await getFreePort();
  await startTestServer(t, port);

  const response = await fetch(
    `http://127.0.0.1:${port}/public/brc-edu/freshdesk-images/1001/invalid.token.value`,
    { method: "HEAD" },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("help resource details tool guidance prefers Markdown links and prohibits Show Image", () => {
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /instructionBlocks/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /customerFacingScreenshotMarkdown/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /imagePresentation='links'/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /Never label screenshot links Show Image/i);
  assert.match(
    GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION,
    /exact signed Markdown links/i,
  );
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /Do not merely describe the screenshots/i);
  assert.match(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /bigredcloud\.freshdesk\.com/i);
  assert.doesNotMatch(GET_HELP_RESOURCE_DETAILS_TOOL_DESCRIPTION, /View screenshot/i);
});
