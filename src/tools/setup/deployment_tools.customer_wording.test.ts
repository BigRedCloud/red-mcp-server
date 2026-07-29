import assert from "node:assert/strict";
import test from "node:test";

import { formatCredentialTtlForUser } from "../../auth/connection_presentation.js";
import {
  buildExamplesText,
  buildGettingStartedText,
  buildSafetyText,
  customerDeploymentPolicyText,
} from "./deployment_tools.js";

const INTERNAL_AUTH_FAILURE_PATTERN =
  /confirmed authentication failure|empty result or missing data|does not by itself mean the connection/i;

const FORBIDDEN_CUSTOMER_INTERNALS =
  /connectionRef|redconn_|rehydrat|HTTP status|session binding|mcp\.json|BRC_ALLOW_|Cursor/i;

test("getting-started separates one-time link from connection duration", () => {
  const text = buildGettingStartedText();
  const duration = formatCredentialTtlForUser();

  assert.match(text, /secure link can only be used once/i);
  assert.match(
    text,
    new RegExp(
      `remains available in this Red session for ${duration.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}`,
      "i",
    ),
  );
  assert.match(text, /ask Red for a fresh link when reconnecting/i);
  assert.equal(/stays valid for/i.test(text), false);
  assert.equal(INTERNAL_AUTH_FAILURE_PATTERN.test(text), false);
  assert.equal(FORBIDDEN_CUSTOMER_INTERNALS.test(text), false);
  assert.equal(/api[_ -]?key\s*[:=]\s*\S+/i.test(text), false);
});

test("customer deployment policy omits internal authentication-failure wording", () => {
  const text = customerDeploymentPolicyText();

  assert.match(text, /sales invoices, quotes, and customer statements/i);
  assert.match(text, /Where the relevant tool supports it/i);
  assert.equal(INTERNAL_AUTH_FAILURE_PATTERN.test(text), false);
  assert.equal(FORBIDDEN_CUSTOMER_INTERNALS.test(text), false);
  assert.equal(/empty list does not by itself/i.test(text), false);
});

test("safety wording requires confirmation without overpromising identical previews", () => {
  const text = buildSafetyText();
  const duration = formatCredentialTtlForUser();

  assert.match(text, /secure link can only be used once/i);
  assert.match(
    text,
    new RegExp(
      `remains available in this Red session for ${duration.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )}`,
      "i",
    ),
  );
  assert.match(text, /require explicit plain-English confirmation/i);
  assert.match(text, /Where the relevant tool supports it/i);
  assert.match(text, /does not bypass disabled actions/i);
  assert.equal(/Preview every proposed change/i.test(text), false);
  assert.equal(
    /Nothing gets created, updated, or deleted without me showing you a plain-English preview first/i.test(
      text,
    ),
    false,
  );
  assert.equal(INTERNAL_AUTH_FAILURE_PATTERN.test(text), false);
  assert.equal(FORBIDDEN_CUSTOMER_INTERNALS.test(text), false);
});

test("examples list only the three supported email document types when email is enabled", () => {
  const text = buildExamplesText();
  const capabilitiesEmailSection =
    /Supported email actions:[\s\S]*sales invoice[\s\S]*quote[\s\S]*customer statement/i.test(
      text,
    ) || /Email sending is not available in this Red session/i.test(text);

  assert.equal(capabilitiesEmailSection, true);
  if (/Supported email actions:/i.test(text)) {
    assert.match(text, /sales invoices, quotes, and customer statements only/i);
    assert.match(text, /cannot email purchases, payments, cash receipts/i);
    assert.equal(/email this purchase/i.test(text), false);
    assert.equal(/"Email .*bank account/i.test(text), false);
    assert.equal(/email this payment/i.test(text), false);
  }
  assert.equal(FORBIDDEN_CUSTOMER_INTERNALS.test(text), false);
});
