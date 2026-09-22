// Explicit test/demo preload only. Production never imports this module.
import { TEST_TENANT, TEST_USER, TEST_OTHER, signFixtureJwt } from "./entra_fixture.js";
const jwk=JSON.parse(process.env.RED_ENTRA_TEST_PRIVATE_JWK ?? "null");
if (!jwk) throw new Error("Test fixture key required.");
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
globalThis.fetch=async (input,init)=>{
  const url=new URL(String(input));
  if(url.hostname==="login.microsoftonline.com") {
    if(url.pathname.endsWith("openid-configuration")) return json({issuer:`https://login.microsoftonline.com/${TEST_TENANT}/v2.0`,jwks_uri:`https://login.microsoftonline.com/${TEST_TENANT}/discovery/v2.0/keys`});
    if(url.pathname.endsWith("/keys")) return json({keys:[{kty:jwk.kty,n:jwk.n,e:jwk.e,kid:"test",alg:"RS256",use:"sig"}]});
    if(url.pathname.endsWith("/token")) {
      const params=new URLSearchParams(String(init?.body));const code=params.get("code")??"";
      return json({id_token:await signFixtureJwt(jwk,{aud:"test-web",nonce:code.replace(/^other:/,""),oid:code.startsWith("other:")?TEST_OTHER:TEST_USER})});
    }
  }
  if(url.hostname==="app.bigredcloud.com") {
    const authorization=new Headers(init?.headers).get("authorization")??"";
    const key=Buffer.from(authorization.replace(/^Basic /,""),"base64").toString().replace(/:$/,"");
    if(!key.startsWith("test-only-")) return json({error:"invalid"},401);
    const facadePath = /\/(suppliers|products|salesInvoices|purchases|accounts|quotes|salesCreditNotes|bankAccounts|cashPayments|cashReceipts|payments)(?:\/(\d+))?$/.exec(url.pathname);
    if (facadePath) {
      if (init?.method && init.method !== "GET") throw new Error("Facade must only read");
      const row = {Id: 1, Code: "ONE", Name: "Record for " + key};
      return json(facadePath[2] ? row : {Items: [row]});
    }
    if(url.pathname.includes("getFinancialYear")) return json({Id:1});
    if (/\/customers\/\d+$/.test(url.pathname)) {
      const Id=Number(url.pathname.split("/").at(-1));
      return json({Id,Name: `Customer ${Id}`,apiKey:key});
    }
    if(url.pathname.endsWith("/customers")) {
      const size=Number(url.searchParams.get("$top")??url.searchParams.get("pageSize")??20);
      const page=url.searchParams.has("$skip") ? Number(url.searchParams.get("$skip"))/size+1 : Number(url.searchParams.get("page")??1);
      if(key==="test-only-fail" && size!==1) return json({error:`never echo ${key}`},500);
      const all=Array.from({length:21},(_,i)=>i+1).map(Id=>({Id,Name:`Customer ${Id}`,Email:`customer${Id}@example.test`,apiKey:key,Token:"must-not-return"}));
      return json({Items:all.slice((page-1)*size,page*size),Count:21});
    }
  }
  throw new Error("Unexpected outbound request in SSO fixture.");
};
const {setValidationFetch}=await import("../auth/credential_validation.js");
setValidationFetch(globalThis.fetch);
