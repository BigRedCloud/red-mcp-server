import assert from "node:assert/strict";
import test from "node:test";
import { checkCustomerNameEmailMatch } from "./customer_email_check.js";

test("returns not_checked when name or email is missing or invalid", () => {
  assert.deepEqual(checkCustomerNameEmailMatch({ name: "Jamie Example" }), {
    status: "not_checked",
  });
  assert.deepEqual(checkCustomerNameEmailMatch({ name: "Jamie Example", email: "not-an-email" }), {
    status: "not_checked",
  });
});

test("accepts generic business email addresses", () => {
  assert.deepEqual(checkCustomerNameEmailMatch({ name: "Jamie Example", email: "accounts@example.com" }), {
    status: "ok",
  });
});

test("accepts plausible personal email formats", () => {
  assert.deepEqual(checkCustomerNameEmailMatch({ name: "Jamie Example", email: "jamieexample@example.com" }), {
    status: "ok",
  });
  assert.deepEqual(checkCustomerNameEmailMatch({ name: "Jamie Example", email: "jexample@example.com" }), {
    status: "ok",
  });
});

test("warns when the local part does not match the customer name", () => {
  const result = checkCustomerNameEmailMatch({
    name: "Jamie Example",
    email: "someoneelse@example.com",
  });

  assert.equal(result.status, "warning");
  assert.match(result.message ?? "", /Possible email\/name mismatch/);
});
