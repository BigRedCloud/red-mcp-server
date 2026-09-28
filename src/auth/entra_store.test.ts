import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
function env(t: TestContext, key: string, value: string) { const old=process.env[key]; process.env[key]=value; t.after(()=>{if(old===undefined) delete process.env[key]; else process.env[key]=old;}); }
import { randomUUID } from "node:crypto";
import { CosmosConnectionStore } from "./cosmos_connection_store.js";
import { MemoryConnectionStore } from "./memory_connection_store.js";
import { EntraConnectionStore, createMemorySsoBackend, type SsoRecord, SSO_LINK_TTL_MS, ownerKey } from "./entra_store.js";
import { decodeStoredApiKey } from "./credential_secret.js";

function cosmosFixture() {
  const backend=createMemorySsoBackend();
  const store=new CosmosConnectionStore("AccountEndpoint=https://localhost:8081/;AccountKey=ZmFrZQ==;","test","test");
  const conflict=(code:number)=>{throw {code};};
  // Exercise the real Cosmos adapter: create conflicts and ETag preconditions.
  (store as unknown as {container:unknown}).container={
    item:(id:string,pk:string)=>({read:async()=>{const resource=await backend.read(pk,id);return resource?{resource}:conflict(404);},replace:async(d:SsoRecord,options:{accessCondition:{type:string;condition:string}})=>{
      assert.equal(options.accessCondition.type,"IfMatch");return await backend.replace(d,options.accessCondition.condition)?{}:conflict(412);
    },delete:async(options:{accessCondition:{type:string;condition:string}})=>{
      assert.equal(options.accessCondition.type,"IfMatch");
      if(!await backend.read(pk,id)) conflict(404);
      return await backend.remove(pk,id,options.accessCondition.condition)?{}:conflict(412);
    }}),
    items:{
      create:async(d:SsoRecord)=>await backend.create(d)?{}:conflict(409),
      upsert:async(d:SsoRecord)=>{const old=await backend.read(d.pk,d.id);if(old)await backend.replace(d,old._etag!);else await backend.create(d);return {};},
      query:(q:{parameters:{name:string;value:string}[]},opts?:{partitionKey:string})=>({fetchAll:async()=>({resources:await backend.list(opts?.partitionKey ?? q.parameters.find(p=>p.name==="@pk")!.value)})})},
  };
  return store;
}
for(const kind of ["memory","cosmos"] as const) test(`${kind}: unique Entra ownership, atomic links, cross-user isolation and multiple encrypted companies`,async t=>{
  env(t, "RED_CONNECT_ENCRYPTION_KEY","test-only-generated-encryption-material");
  const implementation=kind==="memory"?new MemoryConnectionStore():cosmosFixture();
  const store=implementation.entra;
  const a={tenantId:randomUUID(),objectId:randomUUID()},b={...a,objectId:randomUUID()};
  const links=await Promise.all(Array.from({length:10},()=>store.createLink(a)));
  assert.equal(new Set(links).size,10);
  for(const token of links) assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.ok((await Promise.all(links.map(link=>store.checkLink(a,link)))).every(Boolean));
  assert.equal(await store.checkLink({...a,tenantId:randomUUID()},links[0],true),false);
  assert.equal(await store.checkLink(b,links[0],true),false);
  const tampered=(links[0][0]==="a"?"b":"a")+links[0].slice(1);
  assert.equal(await store.checkLink(a,tampered,true),false);
  const used=await Promise.all(Array.from({length:10},()=>store.checkLink(a,links[0],true)));
  assert.equal(used.filter(Boolean).length,1);
  assert.equal(await store.checkLink(a,links[0]),false);
  const companies=["A","B"].map(companyName=>({companyName,apiKey:`test-only-${companyName}`,expiresAt:Date.now()+60_000}));
  await store.saveCompanies(a,companies);
  const found=await store.listCompanies(a);
  assert.deepEqual(found.map(c=>c.companyName),["A","B"]);
  assert.equal(new Set(found.map(c=>c.connectionId)).size,1);
  assert.notEqual(found[0].connectionId,a.objectId);
  assert.ok(found.every(c=>c.encryptedSecret.startsWith("enc:")));
  assert.equal(decodeStoredApiKey(found[0].encryptedSecret),"test-only-A");
  assert.deepEqual(await store.listCompanies(b),[]);
  await assert.rejects(store.saveCompanies(b,companies));
  const legacy=implementation;
  await legacy.saveConnectedCompanies("anonymous-test",companies);
  assert.equal((await legacy.listConnectedCompanies("anonymous-test")).length,2);
  assert.deepEqual(await legacy.entra.listCompanies(b),[]);
  assert.deepEqual(await legacy.listConnectedCompanies(found[0].connectionId),[]);
});
test("SSO links expire at the exact deadline and unencrypted persistence fails closed",async t=>{
  let now=1000;const store=new EntraConnectionStore(createMemorySsoBackend(),()=>now);
  const owner={tenantId:randomUUID(),objectId:randomUUID()};const link=await store.createLink(owner);
  now+=SSO_LINK_TTL_MS;assert.equal(await store.checkLink(owner,link,true),false);
  env(t, "RED_CONNECT_ENCRYPTION_KEY","");env(t, "RED_CONNECT_COSMOS_CONNECTION_STRING","");
  await assert.rejects(store.saveCompanies(owner,[{companyName:"A",apiKey:"test-only",expiresAt:now+1000}]));
  assert.deepEqual(await store.listCompanies(owner),[]);
});

for (const kind of ["memory","cosmos"] as const) test(`${kind}: public pending requests require owner and consume atomically`,async()=>{
  const store=(kind==="memory"?new MemoryConnectionStore():cosmosFixture()).entra;
  const owner={tenantId:randomUUID(),objectId:randomUUID()},other={...owner,objectId:randomUUID()};
  const handle=await store.createPendingRequest(owner);
  assert.match(handle,/^req_[A-Za-z0-9_-]{43}$/);
  assert.equal(await store.checkLink(owner,handle,true),false);
  const secret=await store.createLink(owner);
  assert.equal(await store.checkPendingRequest(owner,secret,true),false);
  assert.equal(await store.checkPendingRequest(other,handle,true),false);
  assert.equal(await store.checkPendingRequest({...owner,tenantId:randomUUID()},handle,true),false);
  assert.equal(await store.checkPendingRequest(owner,"req_"+"x".repeat(43),true),false);
  assert.equal(await store.checkPendingRequest(owner,"malformed",true),false);
  const expiry=await store.pendingRequestExpiry(owner,handle);
  for(let i=0;i<3;i++) assert.equal(await store.checkPendingRequest(owner,handle),true);
  assert.equal(await store.pendingRequestExpiry(owner,handle),expiry);
  const results=await Promise.all(Array.from({length:10},()=>store.checkPendingRequest(owner,handle,true)));
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(await store.checkPendingRequest(owner,handle),false);
});
test("pending request original deadline is authoritative and records contain no credentials",async()=>{
  let now=1000;const backend=createMemorySsoBackend(),store=new EntraConnectionStore(backend,()=>now);
  const owner={tenantId:randomUUID(),objectId:randomUUID()},handle=await store.createPendingRequest(owner);
  const records=await backend.list("entra:"+ownerKey(owner));
  const pending=records.find(r=>r.type==="entraPendingRequest")!;
  assert.deepEqual(Object.keys(pending).sort(),["_etag","connectionId","expiresAt","id","ownerKey","pk","ttl","type","used"].sort());
  assert.ok(pending.id.startsWith("request:"));
  for(const value of [handle,owner.tenantId,owner.objectId]) assert.equal(JSON.stringify(records).includes(value),false);
  now+=SSO_LINK_TTL_MS-1;
  assert.equal(await store.checkPendingRequest(owner,handle),true);
  assert.equal(await store.pendingRequestExpiry(owner,handle),1000+SSO_LINK_TTL_MS);
  now++;
  assert.equal(await store.checkPendingRequest(owner,handle,true),false);
  assert.equal(await store.pendingRequestExpiry(owner,handle),null);
});

for (const kind of ["memory","cosmos"] as const) test(`${kind}: disconnect removes one owner company and replacement keeps the other`,async t=>{
  env(t, "RED_CONNECT_ENCRYPTION_KEY","test-only-generated-encryption-material");
  const store=(kind==="memory"?new MemoryConnectionStore():cosmosFixture()).entra;
  const a={tenantId:randomUUID(),objectId:randomUUID()},b={...a,objectId:randomUUID()};
  await store.createLink(a);await store.createLink(b);
  await store.saveCompanies(a,["Company B","Company C"].map(companyName=>({companyName,apiKey:`test-only-${companyName}`,expiresAt:Date.now()+60_000,credentialValidatedAt:5})));
  await store.saveCompanies(b,[{companyName:"Company B",apiKey:"test-only-other",expiresAt:Date.now()+60_000}]);
  const before=await store.listCompanies(a);
  await store.saveCompanies(a,[{companyName:"company b",apiKey:"test-only-replaced",expiresAt:Date.now()+90_000,credentialValidatedAt:9}]);
  const replaced=(await store.listCompanies(a)).find(company=>company.companyName.toLowerCase()==="company b")!;
  assert.equal(replaced.companyName,"company b");
  assert.equal(decodeStoredApiKey(replaced.encryptedSecret),"test-only-replaced");
  assert.equal(replaced.createdAt,before.find(company=>company.companyName==="Company B")!.createdAt);
  assert.deepEqual((await store.listCompanies(a)).map(company=>company.companyName.toLowerCase()).sort(),["company b","company c"]);
  assert.equal(await store.removeCompany(a,"Company B"),true);
  assert.deepEqual((await store.listCompanies(a)).map(company=>company.companyName),["Company C"]);
  assert.equal(decodeStoredApiKey((await store.listCompanies(a))[0].encryptedSecret),"test-only-Company C");
  assert.equal(await store.removeCompany(a,"Company B"),false);
  assert.equal(await store.removeCompany(a,"company:forged"),false);
  assert.equal(await store.removeCompany(a,"Company C"),true);
  assert.deepEqual(await store.listCompanies(a),[]);
  assert.equal((await store.listCompanies(b)).length,1);
  assert.equal(decodeStoredApiKey((await store.listCompanies(b))[0].encryptedSecret),"test-only-other");
  assert.equal(await store.removeCompany(b,"Company C"),false);
});
