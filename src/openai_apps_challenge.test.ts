import assert from "node:assert/strict";
import test from "node:test";

import type { Response } from "express";
import {
  OPENAI_APPS_CHALLENGE_PATH,
  sendOpenAiAppsChallenge,
} from "./openai_apps_challenge.js";

function captureResponse() {
  const captured: {
    status: number;
    type?: string;
    body?: string;
  } = { status: 200 };

  const response = {
    status(status: number) {
      captured.status = status;
      return response;
    },
    type(type: string) {
      captured.type = type;
      return response;
    },
    send(body: string) {
      captured.body = body;
      return response;
    },
  } as unknown as Response;

  return { captured, response };
}

test("OpenAI Apps challenge returns only the configured token as plain text", () => {
  const token = "openai-apps-verification-test-token";
  const { captured, response } = captureResponse();

  sendOpenAiAppsChallenge(response, {
    OPENAI_APPS_CHALLENGE_TOKEN: token,
  });

  assert.equal(OPENAI_APPS_CHALLENGE_PATH, "/.well-known/openai-apps-challenge");
  assert.deepEqual(captured, {
    status: 200,
    type: "text/plain",
    body: token,
  });
});

test("OpenAI Apps challenge returns an error when the token is absent", () => {
  const { captured, response } = captureResponse();

  sendOpenAiAppsChallenge(response, {});

  assert.deepEqual(captured, {
    status: 503,
    type: "text/plain",
    body: "OpenAI Apps challenge token is not configured.",
  });
});
