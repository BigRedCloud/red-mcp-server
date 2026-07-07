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
  buildConnectionExpiryMetadata,
  buildConnectionPresentationInstructions,
  buildListCompanyContextsCustomerMessage,
  buildListCompanyContextsExpiryFields,
  formatCredentialTtlForUser,
  formatExpiryTimezonePresentation,
  getCredentialTtlMinutes,
  isDevModeEnabled,
  selectEarliestCompanyExpiry,
  shouldShowDeveloperConnectionDetails,
  CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION,
  CONNECTION_REF_ASSISTANT_INSTRUCTION,
  CONNECTION_REF_PRESENTATION_HINT,
} from "./connection_presentation.js";

test("formatCredentialTtlForUser returns about 4 hours when TTL is 240 minutes", () => {
  assert.equal(formatCredentialTtlForUser(240), "about 4 hours");
});

test("formatCredentialTtlForUser returns about 2 hours when TTL is 120 minutes", () => {
  assert.equal(formatCredentialTtlForUser(120), "about 2 hours");
});

test("connectionDurationText is about 4 hours when TTL is 240 minutes", () => {
  assert.equal(formatCredentialTtlForUser(240), "about 4 hours");
  assert.equal(
    buildConnectionExpiryMetadata({
      earliestExpiresAtMs: Date.now() + 240 * 60_000,
      durationMinutes: 240,
    }).connectionDurationText,
    "about 4 hours"
  );
});

test("connectionDurationText is about 2 hours when TTL is 120 minutes", () => {
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
  const fields = buildConnectionPresentationInstructions();

  assert.match(fields.assistantInstruction, /Do not show connectionRef/i);
  assert.match(fields.presentationHint, /Do not display/i);
  assert.match(fields.connectionRefReminder, /Do not mention it to normal users/i);
  assert.match(fields.assistantInstruction, /Do not say you do not know the current time/i);
  assert.match(fields.assistantInstruction, /do not have a live clock when timeRemainingText is present/i);
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

test("expiryMessage includes both duration and exact expiry time", () => {
  const nowMs = Date.parse("2026-07-07T15:00:00.000Z");
  const expiresAtMs = Date.parse("2026-07-07T18:52:00.000Z");

  const metadata = buildConnectionExpiryMetadata({
    earliestExpiresAtMs: expiresAtMs,
    nowMs,
    timeZone: "Europe/Dublin",
  });

  assert.match(metadata.expiryMessage, /from confirmation/i);
  assert.equal(metadata.expiryMessage.includes("local time"), false);
  assert.match(metadata.expiryMessage, /IST|UTC\+1/i);
  assert.match(metadata.expiryMessage, /unless you start a new chat or reconnect/i);
  assert.match(metadata.expiryMessage, /remaining/i);
  assert.equal(metadata.expiryMessage.includes("redconn_"), false);
});

test("expiryTimeWithTimezoneText includes timezone abbreviation or offset", () => {
  const expiresAtMs = Date.parse("2026-07-07T18:16:00.000Z");
  const presentation = formatExpiryTimezonePresentation(
    expiresAtMs,
    "Europe/Dublin"
  );

  assert.match(presentation.expiryTimeWithTimezoneText, /7:16 PM IST \(UTC\+1\)/i);
  assert.equal(presentation.expiryTimezoneName, "Europe/Dublin");
  assert.equal(presentation.expiryTimezoneAbbreviation, "IST");
  assert.equal(presentation.expiryUtcOffset, "UTC+1");
  assert.match(presentation.expiryTimeText, /IST \(UTC\+1\)/i);
});

test("buildConnectionExpiryMetadata includes timeRemainingText when expiresAt exists", () => {
  const nowMs = Date.now();
  const expiresAtMs = nowMs + 222 * 60_000;

  const metadata = buildConnectionExpiryMetadata({
    earliestExpiresAtMs: expiresAtMs,
    nowMs,
    timeZone: "Europe/Dublin",
  });

  assert.ok(metadata.timeRemainingText);
  assert.match(metadata.timeRemainingText ?? "", /remaining/i);
  assert.equal(metadata.timeRemainingMinutes, 222);
  assert.equal(metadata.expiryMessage.includes("local time"), false);
  assert.ok(metadata.expiryTimeWithTimezoneText);
  assert.ok(metadata.expiryTimezoneAbbreviation);
  assert.ok(metadata.expiryUtcOffset);
});

test("list company contexts expiry fields include timeRemainingText", () => {
  const nowMs = Date.now();
  const metadata = buildListCompanyContextsExpiryFields(
    [
      {
        companyName: "Company B",
        expiresAtMs: nowMs + 180 * 60_000,
        connected: true,
      },
      {
        companyName: "Company C",
        expiresAtMs: nowMs + 240 * 60_000,
        connected: true,
      },
    ],
    nowMs
  );

  assert.ok(metadata);
  assert.match(metadata?.timeRemainingText ?? "", /remaining/i);
  assert.equal(metadata?.earliestExpiryApplies, true);
  assert.match(metadata?.earliestExpiryNote ?? "", /Company B/i);
});

test("multiple connected companies use the earliest expiresAt", () => {
  const nowMs = Date.now();
  const earliest = nowMs + 90 * 60_000;
  const later = nowMs + 240 * 60_000;

  const selection = selectEarliestCompanyExpiry([
    { companyName: "Company C", expiresAtMs: later, connected: true },
    { companyName: "Company B", expiresAtMs: earliest, connected: true },
  ]);

  assert.equal(selection.earliestExpiresAtMs, earliest);
  assert.equal(selection.earliestCompanyName, "Company B");
  assert.equal(selection.multipleDifferentExpiries, true);
});

test("expiry assistant instruction tells models to use metadata not current-time guessing", () => {
  assert.match(CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION, /connectionDurationText/i);
  assert.match(CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION, /timeRemainingText/i);
  assert.match(CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION, /expiryTimeWithTimezoneText/i);
  assert.match(
    CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION,
    /Do not say you do not know the current time/i
  );
  assert.match(
    CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION,
    /do not have a live clock when timeRemainingText is present/i
  );
  assert.match(CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION, /Do not ask the user to check their device clock/i);
  assert.match(CONNECTION_EXPIRY_ASSISTANT_INSTRUCTION, /Do not say local time on its own/i);
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
  const message = buildCompaniesStayConnectedUserMessage(expiresAt, now);
  assert.equal(message.includes("local time"), false);
  assert.match(message, /UTC[+-]\d|IST/i);
  assert.match(
    buildCompaniesStayConnectedUserMessage(undefined, now),
    new RegExp(formatCredentialTtlForUser(expectedMinutes))
  );
});
