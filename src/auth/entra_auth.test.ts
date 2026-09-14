import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createEntraVerifier, verifyEntraAuthorization } from "./entra_auth.js";

test("Entra JWT validation is cryptographic and rejects invalid claims without leaking input", async () => {
  const tenant="11111111-1111-4111-8111-111111111111", oid="22222222-2222-4222-8222-222222222222";
  const issuer=`https://login.microsoftonline.com/${tenant}/v2.0`;
  const keys=await generateKeyPair("RS256");
  const jwk={...await exportJWK(keys.publicKey),kid:"test",alg:"RS256",use:"sig"};
  let calls=0;
  const mockFetch: typeof fetch=async input=>{calls++;return new Response(JSON.stringify(String(input).includes("openid-configuration")?{issuer,jwks_uri:`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`}:{keys:[jwk]}),{headers:{"content-type":"application/json"}});};
  const verify=createEntraVerifier({tenants:[tenant],audiences:["test-api"],scope:"access_as_user",clients:["test-client"]},mockFetch);
  const now=Math.floor(Date.now()/1000);
  const sign=(claims:Record<string,unknown>={},key=keys.privateKey)=>new SignJWT({tid:tenant,oid,sub:oid,iss:issuer,aud:"test-api",exp:now+600,nbf:now-5,iat:now,scp:"access_as_user",azp:"test-client",...claims}).setProtectedHeader({alg:"RS256",kid:"test"}).sign(key);
  assert.deepEqual(await verify(await sign()),{tenantId:tenant,objectId:oid});
  for(const claims of [{iss:"https://evil.example"},{aud:"other"},{exp:now-1},{nbf:now+600},{tid:"33333333-3333-4333-8333-333333333333"},{oid:""},{scp:""},{idtyp:"app"},{azp:"other"},{exp:undefined}]) {
    const token=await sign(claims);
    await assert.rejects(verify(token),error=>error instanceof Error && error.message==="Microsoft sign-in is required or the token is not valid." && !error.message.includes(token));
  }
  const other=await generateKeyPair("RS256");await assert.rejects(verify(await sign({},other.privateKey)));
  const hs=await new SignJWT({tid:tenant}).setProtectedHeader({alg:"HS256"}).sign(new Uint8Array(32));await assert.rejects(verify(hs));
  await assert.rejects(verifyEntraAuthorization(undefined));await assert.rejects(verify("invalid-token"));
  const id=await sign({nonce:"expected",scp:undefined,aud:"web-app"});
  assert.deepEqual(await verify(id,{audience:"web-app",nonce:"expected"}),{tenantId:tenant,objectId:oid});
  await assert.rejects(verify(id,{audience:"web-app",nonce:"wrong"}));
  assert.equal(calls,2,"metadata and JWKS are cached");
});
