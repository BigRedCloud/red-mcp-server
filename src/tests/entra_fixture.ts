import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import { randomBytes } from "node:crypto";
export const TEST_TENANT="11111111-1111-4111-8111-111111111111";
export const TEST_USER="22222222-2222-4222-8222-222222222222";
export const TEST_OTHER="33333333-3333-4333-8333-333333333333";
export async function createEntraFixture() {
  const keys=await generateKeyPair("RS256",{extractable:true});
  const jwk=await exportJWK(keys.privateKey);
  return {
    env:{NODE_OPTIONS:"--import=./build/tests/entra_mock_server.js",RED_ENTRA_TEST_PRIVATE_JWK:JSON.stringify(jwk),RED_ENTRA_ALLOWED_TENANTS:TEST_TENANT,RED_ENTRA_AUDIENCES:"test-api",RED_ENTRA_REQUIRED_SCOPE:"access_as_user",RED_ENTRA_ALLOWED_CLIENTS:"test-client",RED_ENTRA_PUBLIC_BASE_URL:"https://red.example.test",RED_ENTRA_WEB_CLIENT_ID:"test-web",RED_ENTRA_WEB_CLIENT_SECRET:"test-only-web-secret",RED_CONNECT_ENCRYPTION_KEY:randomBytes(32).toString("base64"),RED_CONNECT_CREDENTIAL_VALIDATION_DEBUG:"false"},
    token: (oid=TEST_USER) => signFixtureJwt(jwk,{oid}),
  };
}
export async function signFixtureJwt(jwk: JWK, claims: Record<string,unknown>={}) {
  const key=await importJWK(jwk,"RS256");const now=Math.floor(Date.now()/1000);
  return new SignJWT({iss:`https://login.microsoftonline.com/${TEST_TENANT}/v2.0`,aud:"test-api",tid:TEST_TENANT,oid:TEST_USER,sub:TEST_USER,exp:now+600,iat:now,nbf:now-5,scp:"access_as_user",azp:"test-client",...claims}).setProtectedHeader({alg:"RS256",kid:"test"}).sign(key);
}
