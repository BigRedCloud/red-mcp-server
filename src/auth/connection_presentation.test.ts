import assert from "node:assert/strict";
import test from "node:test";

import {
  getApiKeyExpirationMs,
  redServerConfig,
} from "../config/server_config.js";
import {
  buildApiKeyRefusalMessage,
  buildConfirmConnectionCustomerMessage,
  buildCompaniesStayConnectedUserMessage,
  buildConnectionRefPresentationFields,
  buildListCompanyContextsCustomerMessage,
  formatCredentialTtlForUser,
  getCredentialTtlMinutes,
  isDevModeEnabled,
  shouldShowDeveloperConnectionDetails,
  CONNECTION_REF_ASSISTANT_INSTRUCTION,
  CONNECTION_REF_PRESENTATION_HINT,
} from "./connection_presentation.js";

test("formatCredentialTtlForUser returns about 4 hours when TTL is 240 minutes", () => {
  assert.equal(formatCredentialTtlForUser(240), "about 4 hours");
});

test("formatCredentialTtlForUser returns about 2 hours when TTL is 120 minutes", () => {
  assert.equal(formatCredentialTtlForUser(120), "about 2 hours");
});

test("getCredentialTtlMinutes uses server config default", () => {
  assert.ok(getCredentialTtlMinutes() > 0);
});

test("customerMessage does not include raw redconn_ value", () => {
  const message = buildConfirmConnectionCustomerMessage({
    connectedCompanies: ["Company B", "Company C"],
    failedCompanies: [
      {
        companyName: "Company A",
        connected: false,
        reason: "invalid_or_expired_api_key",
        message:
          "Company A was not connected because the credential could not be validated.",
      },
    ],
    connectionExpiresAt: Date.now() + 240 * 60_000,
  });

  assert.equal(message.includes("redconn_"), false);
  assert.equal(message.includes("connectionRef"), false);
  assert.match(message, /Company A was not connected/i);
  assert.match(message, /Company B/);
});

test("confirm presentation fields include instruction not to display connectionRef", () => {
  const fields = buildConnectionRefPresentationFields();

  assert.match(fields.assistantInstruction, /Do not show connectionRef/i);
  assert.match(fields.presentationHint, /Do not display them/i);
  assert.match(fields.connectionRefReminder, /Do not mention it to normal users/i);
});

test("list company contexts customer message does not mention connectionRef", () => {
  const empty = buildListCompanyContextsCustomerMessage([]);
  assert.equal(empty.includes("connectionRef"), false);
  assert.match(empty, /Start a fresh company connection/i);

  const connected = buildListCompanyContextsCustomerMessage(["Company B"]);
  assert.equal(connected.includes("connectionRef"), false);
  assert.match(connected, /Company B/);
});

test("normal user-facing templates derive session duration from configured TTL", () => {
  const expected = formatCredentialTtlForUser();
  assert.match(buildApiKeyRefusalMessage(), new RegExp(expected));
  assert.match(buildCompaniesStayConnectedUserMessage(), new RegExp(expected));
});

test("dev mode may expose technical connection details when explicitly requested", () => {
  assert.equal(shouldShowDeveloperConnectionDetails(false), isDevModeEnabled() || false);
  assert.equal(shouldShowDeveloperConnectionDetails(true), true);
});

test("isDevModeEnabled reflects server dev mode configuration", () => {
  assert.equal(typeof isDevModeEnabled(), "boolean");
});

test("connected company expiry phrase can use until wording", () => {
  const expiresAt = Date.parse("2030-06-01T15:30:00.000Z");
  const message = buildCompaniesStayConnectedUserMessage(expiresAt);
  assert.match(message, /until /i);
  assert.equal(message.includes("redconn_"), false);
});

test("assistant instruction constant matches presentation requirements", () => {
  assert.match(CONNECTION_REF_ASSISTANT_INSTRUCTION, /silently/i);
  assert.match(CONNECTION_REF_PRESENTATION_HINT, /Do not display/i);
});

test("connected company expiry aligns with configured credential TTL", () => {
  const now = Date.now();
  const expiresAt = now + getApiKeyExpirationMs();
  const expectedMinutes = redServerConfig.apiKeyTtlMinutes;

  assert.equal(Math.round((expiresAt - now) / 60_000), expectedMinutes);
  assert.match(buildCompaniesStayConnectedUserMessage(expiresAt), /until /i);
  assert.match(
    buildCompaniesStayConnectedUserMessage(),
    new RegExp(formatCredentialTtlForUser(expectedMinutes))
  );
});
