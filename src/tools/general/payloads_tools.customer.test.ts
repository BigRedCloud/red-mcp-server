import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerLikePayload,
  buildMissingCustomerLikeInformationResponse,
  collectMissingCustomerLikeFields,
} from "./payloads_tools.js";

test("collectMissingCustomerLikeFields requires code and name", () => {
  assert.deepEqual(collectMissingCustomerLikeFields({}), ["code", "name"]);
  assert.deepEqual(collectMissingCustomerLikeFields({ code: "ACME" }), ["name"]);
  assert.deepEqual(collectMissingCustomerLikeFields({ name: "Acme Ltd" }), [
    "code",
  ]);
  assert.deepEqual(
    collectMissingCustomerLikeFields({ code: "ACME", name: "Acme Ltd" }),
    [],
  );
});

test("buildMissingCustomerLikeInformationResponse asks without inventing data", () => {
  const response = buildMissingCustomerLikeInformationResponse(
    ["code", "name"],
    1,
  );
  assert.equal(response.error, "missing_information");
  assert.equal(response.entity, "customer");
  assert.deepEqual(response.missingFields, ["code", "name"]);
  assert.match(response.message, /Do not invent/i);
  assert.match(response.message, /Test Address/i);
});

test("buildCustomerLikePayload omits empty optional fields", () => {
  const payload = buildCustomerLikePayload(
    {
      code: "ACME",
      name: "Acme Ltd",
      address: [],
      email: "  ",
      contact: "",
    },
    1,
  );

  assert.equal(payload.code, "ACME");
  assert.equal(payload.name, "Acme Ltd");
  assert.equal(payload.ownerTypeId, 1);
  assert.equal("address" in payload, false);
  assert.equal("email" in payload, false);
  assert.equal("contact" in payload, false);
  assert.equal("creditTerms" in payload, false);
  assert.equal("vatRegistered" in payload, false);
  assert.equal("additionalEmails" in payload, false);
});

test("buildCustomerLikePayload includes only explicitly provided credit/VAT flags", () => {
  const withFlags = buildCustomerLikePayload(
    {
      code: "ACME",
      name: "Acme Ltd",
      creditTerms: 30,
      vatRegistered: false,
      address: ["1 High Street", "Dublin"],
    },
    1,
  );

  assert.equal(withFlags.creditTerms, 30);
  assert.equal(withFlags.vatRegistered, false);
  assert.deepEqual(withFlags.address, ["1 High Street", "Dublin"]);
});

test("buildCustomerLikePayload does not invent address or credit terms by default", () => {
  const payload = buildCustomerLikePayload(
    { code: "ACME", name: "Acme Ltd" },
    1,
  );
  assert.equal(payload.address, undefined);
  assert.equal(payload.creditTerms, undefined);
  assert.equal(payload.vatRegistered, undefined);
});
