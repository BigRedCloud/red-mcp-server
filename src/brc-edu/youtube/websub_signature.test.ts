import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { verifyWebSubSignature } from "./websub_signature.js";

test("WebSub checks exact bytes, supported signatures, malformed and missing authentication", () => {
  const body = Buffer.from("<feed>é</feed>");
  const secret = "test-only-subscription-secret";
  for (const algorithm of ["sha1", "sha256", "sha384", "sha512"]) {
    const signature = `${algorithm}=${createHmac(algorithm, secret).update(body).digest("hex")}`;
    assert.equal(verifyWebSubSignature(body, signature, secret), true);
    assert.equal(verifyWebSubSignature(Buffer.from("tampered"), signature, secret), false);
    assert.equal(verifyWebSubSignature(body, signature, "wrong"), false);
  }
  for (const signature of [undefined, "", "md5=00", "sha1=zz", "sha1=00"]) {
    assert.equal(verifyWebSubSignature(body, signature, secret), false);
  }
  assert.equal(verifyWebSubSignature(body, "sha1=" + "0".repeat(40), ""), false);
});
