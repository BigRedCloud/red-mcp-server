import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createEntraVerifier, verifyEntraAuthorization } from "./entra_auth.js";

const TEMPLATE = "https://login.microsoftonline.com/{tenantid}/v2.0";
const CONSUMER = "9188040d-6c67-4c5b-b112-36a304b66dad";
const issuerFor = (tenant: string) => `https://login.microsoftonline.com/${tenant}/v2.0`;

async function publishedKey(issuer?: string) {
  const keys = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(keys.publicKey), kid: "test", alg: "RS256", use: "sig", ...(issuer === undefined ? {} : { issuer }) };
  return { keys, jwk };
}

function verifier(jwks: JWK[], metadataIssuer = TEMPLATE) {
  let calls = 0;
  const mockFetch: typeof fetch = async input => {
    calls++;
    const body = String(input).includes("openid-configuration")
      ? { issuer: metadataIssuer, jwks_uri: "https://login.microsoftonline.com/organizations/discovery/v2.0/keys" }
      : { keys: jwks };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return { calls: () => calls, verify: createEntraVerifier({ audiences: ["test-api"], scope: "access_as_user", clients: ["test-client"] }, mockFetch) };
}

test("Entra JWT validation is cryptographic and rejects invalid claims without leaking input", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111", oid = "22222222-2222-4222-8222-222222222222";
  const issuer = issuerFor(tenant);
  const { keys, jwk } = await publishedKey(TEMPLATE);
  const { calls, verify } = verifier([jwk]);
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims: Record<string, unknown> = {}, key = keys.privateKey) => new SignJWT({ tid: tenant, oid, sub: oid, iss: issuer, aud: "test-api", exp: now + 600, nbf: now - 5, iat: now, scp: "access_as_user", azp: "test-client", ...claims }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(key);
  assert.deepEqual(await verify(await sign()), { tenantId: tenant, objectId: oid });
  assert.deepEqual(await verify(await sign({ tid: tenant.toUpperCase() })), { tenantId: tenant, objectId: oid });
  for (const claims of [{ iss: "https://evil.example" }, { aud: "other" }, { exp: now - 1 }, { nbf: now + 600 }, { tid: "33333333-3333-4333-8333-333333333333" }, { oid: "" }, { scp: "" }, { idtyp: "app" }, { azp: "other" }, { exp: undefined }]) {
    const token = await sign(claims);
    await assert.rejects(verify(token), error => error instanceof Error && error.message === "Microsoft sign-in is required or the token is not valid." && !error.message.includes(token));
  }
  const other = await generateKeyPair("RS256");
  await assert.rejects(verify(await sign({}, other.privateKey)));
  const hs = await new SignJWT({ tid: tenant }).setProtectedHeader({ alg: "HS256" }).sign(new Uint8Array(32));
  await assert.rejects(verify(hs));
  await assert.rejects(verifyEntraAuthorization(undefined));
  await assert.rejects(verify("invalid-token"));
  const id = await sign({ nonce: "expected", scp: undefined, aud: "web-app" });
  assert.deepEqual(await verify(id, { audience: "web-app", nonce: "expected" }), { tenantId: tenant, objectId: oid });
  await assert.rejects(verify(id, { audience: "web-app", nonce: "wrong" }));
  assert.equal(calls(), 2, "organizations metadata and JWKS are cached");
});

test("shared organizations JWK issuer succeeds for a matching organisational tenant", async () => {
  const home = "11111111-1111-4111-8111-111111111111";
  const customer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const oid = "22222222-2222-4222-8222-222222222222";
  const { keys, jwk } = await publishedKey(TEMPLATE);
  const { calls, verify } = verifier([jwk]);
  const now = Math.floor(Date.now() / 1000);
  const sign = (tid: string, claims: Record<string, unknown> = {}) => new SignJWT({ tid, oid, sub: oid, iss: issuerFor(tid.toLowerCase()), aud: "test-api", exp: now + 600, nbf: now - 5, iat: now, scp: "access_as_user", azp: "test-client", ...claims }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
  assert.deepEqual(await verify(await sign(home)), { tenantId: home, objectId: oid });
  assert.deepEqual(await verify(await sign(customer)), { tenantId: customer, objectId: oid });
  assert.deepEqual(await verify(await sign(customer, { nonce: "n", scp: undefined, aud: "web-client" }), { audience: "web-client", nonce: "n" }), { tenantId: customer, objectId: oid });
  assert.equal(calls(), 2, "one metadata fetch and one JWKS fetch serve every tenant");
  for (const iss of [
    "https://login.microsoftonline.com/organizations/v2.0",
    "https://login.microsoftonline.com/common/v2.0",
    "https://login.microsoftonline.com/consumers/v2.0",
    `https://sts.windows.net/${home}/`,
  ]) await assert.rejects(verify(await sign(home, { iss })));
  await assert.rejects(verify(await sign(customer, { iss: issuerFor(home) })));
  await assert.rejects(verify(await sign(CONSUMER)));
  await assert.rejects(verify(await sign("------------------------------------")));
  await assert.rejects(verify(await sign("111111111111111111111111111111111111")));
});

test("tenant-specific JWK issuer succeeds only for that exact tenant", async () => {
  const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const oid = "22222222-2222-4222-8222-222222222222";
  const { keys, jwk } = await publishedKey(issuerFor(tenant));
  const { verify } = verifier([jwk]);
  const now = Math.floor(Date.now() / 1000);
  const sign = (tid: string) => new SignJWT({ tid, oid, sub: oid, iss: issuerFor(tid), aud: "test-api", exp: now + 600, nbf: now - 5, iat: now, scp: "access_as_user", azp: "test-client" }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
  assert.deepEqual(await verify(await sign(tenant)), { tenantId: tenant, objectId: oid });
  await assert.rejects(verify(await sign(other)));
});

test("a valid signature from a published key issued for another tenant is rejected", async () => {
  const signerTenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tokenTenant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const oid = "22222222-2222-4222-8222-222222222222";
  const { keys, jwk } = await publishedKey(issuerFor(signerTenant));
  const { verify } = verifier([jwk]);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ tid: tokenTenant, oid, sub: oid, iss: issuerFor(tokenTenant), aud: "test-api", exp: now + 600, nbf: now - 5, iat: now, scp: "access_as_user", azp: "test-client" }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
  await assert.rejects(verify(token));
});

test("a valid signature from a JWK with no issuer is rejected", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111", oid = "22222222-2222-4222-8222-222222222222";
  const { keys, jwk } = await publishedKey();
  assert.equal("issuer" in jwk, false);
  const { verify } = verifier([jwk]);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ tid: tenant, oid, sub: oid, iss: issuerFor(tenant), aud: "test-api", exp: now + 600, nbf: now - 5, iat: now, scp: "access_as_user", azp: "test-client" }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
  await assert.rejects(verify(token));
});

test("organizations metadata must use the issuer template and a Microsoft JWKS host", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111", oid = "22222222-2222-4222-8222-222222222222";
  const { keys, jwk } = await publishedKey(TEMPLATE);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ tid: tenant, oid, sub: oid, iss: issuerFor(tenant), aud: "test-api", exp: now + 600, nbf: now - 5, iat: now, scp: "access_as_user", azp: "test-client" }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
  await assert.rejects(verifier([jwk], issuerFor(tenant)).verify(token));
  const evil: typeof fetch = async input => new Response(JSON.stringify(String(input).includes("openid-configuration")
    ? { issuer: TEMPLATE, jwks_uri: "https://evil.example/keys" }
    : { keys: [jwk] }), { headers: { "content-type": "application/json" } });
  await assert.rejects(createEntraVerifier({ audiences: ["test-api"], scope: "access_as_user", clients: ["test-client"] }, evil)(token));
});
