import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
function env(t: TestContext, key: string, value: string) { const old=process.env[key]; process.env[key]=value; t.after(()=>{if(old===undefined) delete process.env[key]; else process.env[key]=old;}); }
import { randomUUID } from "node:crypto";
import { CosmosConnectionStore } from "./cosmos_connection_store.js";
import { MemoryConnectionStore } from "./memory_connection_store.js";
import { EntraConnectionStore, createMemorySsoBackend, type SsoRecord, SSO_LINK_TTL_MS } from "./entra_store.js";
import { decodeStoredApiKey } from "./credential_secret.js";

function cosmosFixture() {
  const backend=createMemorySsoBackend();
  const store=new CosmosConnectionStore("AccountEndpoint=https://localhost:8081/;AccountKey=ZmFrZQ==;","test","test");
  const conflict=(code:number)=>{throw {code};};
  // Exercise the real Cosmos adapter: create conflicts and ETag preconditions.
  (store as unknown as {container:unknown}).container={
    item:(id:string,pk:string)=>({read:async()=>{const resource=await backend.read(pk,id);return resource?{resource}:conflict(404);},replace:async(d:SsoRecord,options:{accessCondition:{type:string;condition:string}})=>{
      assert.equal(options.accessCondition.type,"IfMatch");return await backend.replace(d,options.accessCondition.condition)?{}:conflict(412);
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
