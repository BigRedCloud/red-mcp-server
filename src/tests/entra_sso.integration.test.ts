import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createEntraFixture, TEST_OTHER, TEST_USER } from "./entra_fixture.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";

test("SSO HTTP: verified identity, secure browser linking, multiple companies, pagination, isolation and redaction",async t=>{
  const fixture=await createEntraFixture();const port=await getFreePort();
  const child=await startHttpTestServer(t,port,fixture.env,90_000);
  let logs="";child.stdout.on("data",c=>{logs+=c;});child.stderr.on("data",c=>{logs+=c;});
  const base=`http://127.0.0.1:${port}`;
  for (const path of ["/mcp/copilot", "/connect/sso/complete"]) {
    const malformed = await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:'{"apiKey":"synthetic-parser-secret", broken'});
    assert.equal(malformed.status,400);
    assert.doesNotMatch(await malformed.text(),/synthetic-parser-secret|SyntaxError/);
  }
  const transports = new Map<Client,StreamableHTTPClientTransport>();
  async function client(token?:string) {
    const c=new Client({name:"sso-test",version:"1"});t.after(()=>c.close());
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp/copilot`),{requestInit:{headers:token?{Authorization:`Bearer ${token}`}:{}}});
    transports.set(c,transport);await c.connect(transport);return c;
  }
  const anon=await client();assert.deepEqual((await anon.listTools()).tools.map(t=>t.name).sort(),["brc_copilot_connector_status","brc_copilot_list_all_customers"]);
  await assert.rejects(anon.callTool({name:"brc_copilot_list_all_customers",arguments:{}}));
  const invalid=await client("invalid-token");await assert.rejects(invalid.callTool({name:"brc_copilot_list_all_customers",arguments:{}}));
  const token=await fixture.token(),a=await client(token),b=await client(await fixture.token(TEST_OTHER));
  const invalidArguments=await a.callTool({name:"brc_copilot_list_all_customers",arguments:{apiKey:"must-never-be-used",tenantId:TEST_USER,connectionRef:"untrusted"}});
  assert.equal(invalidArguments.isError,true);
  assert.equal(JSON.stringify(invalidArguments).includes("must-never-be-used"),false);
  const needed: any=await a.callTool({name:"brc_copilot_list_all_customers",arguments:{}});
  assert.equal(needed.structuredContent?.status,"connection_required");
  const link=new URL(String(needed.structuredContent?.connectionUrl));assert.equal(link.origin,"https://red.example.test");assert.equal(link.pathname,"/connect");assert.equal(link.search,"");
  const linkToken=new URLSearchParams(link.hash.slice(1)).get("sso")!;
  async function signIn(other=false) {
    const start=await fetch(`${base}/connect/sso/start`,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded",origin:"https://red.example.test"},body:new URLSearchParams({link:linkToken})});
    assert.equal(start.status,303);const auth=new URL(start.headers.get("location")!);const cookie=start.headers.get("set-cookie")!.split(";")[0];
    const callback=await fetch(`${base}/connect/sso/callback`,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded",cookie},body:new URLSearchParams({state:auth.searchParams.get("state")!,code:(other?"other:":"")+auth.searchParams.get("nonce")!})});
    return callback;
  }
  assert.equal((await signIn(true)).status,401,"another Microsoft user cannot open this link");
  const callback=await signIn();assert.equal(callback.status,303);const cookie=callback.headers.get("set-cookie")!.split(";")[0];
  const page=await fetch(`${base}/connect?sso=1`,{headers:{cookie}});assert.equal(page.status,200);
  const html=await page.text();assert.doesNotMatch(html,/companyFile|<input[^>]*type="file"|telemetryClientId/);
  const csrf=/name="code" value="([^"]+)"/.exec(html)![1];
  assert.equal((await fetch(`${base}/connect?sso=1`,{headers:{cookie:cookie+"tampered"}})).status,401);
  assert.equal((await fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://evil.example"},body:new URLSearchParams({code:csrf})})).status,401);
  assert.equal((await fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://red.example.test"},body:new URLSearchParams({code:"wrong"})})).status,401);
  const form=new URLSearchParams({code:csrf});for(const [name,key] of [["A","a"],["B","b"],["C","fail"]]) {form.append("companyName",name);form.append("apiKey",`test-only-${key}`);}
  const complete=()=>fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://red.example.test"},body:form});
  const submissions=await Promise.all([complete(),complete()]);assert.deepEqual(submissions.map(r=>r.status).sort(),[200,401]);
  assert.equal((await fetch(`${base}/connect?sso=1`,{headers:{cookie}})).status,401);
  const first: any=await a.callTool({name:"brc_copilot_list_all_customers",arguments:{pageSize:2}});
  assert.ok(first.structuredContent?.nextCursor);
  const stolen: any=await b.callTool({name:"brc_copilot_list_all_customers",arguments:{cursor:first.structuredContent!.nextCursor}});
  assert.equal(stolen.structuredContent?.status,"connection_required");
  const second: any=await a.callTool({name:"brc_copilot_list_all_customers",arguments:{cursor:first.structuredContent!.nextCursor}});
  const groups=[...(first.structuredContent!.companies as Record<string,unknown>[]),...(second.structuredContent!.companies as Record<string,unknown>[])];
  assert.equal(groups.filter(g=>g.companyName==="A").flatMap(g=>g.customers as unknown[]).length,3);
  assert.equal(groups.filter(g=>g.companyName==="B").flatMap(g=>g.customers as unknown[]).length,3);
  assert.equal(groups.find(g=>g.companyName==="C")?.status,"company_unavailable");assert.equal(second.structuredContent!.complete,true);
  const replay = await fetch(`${base}/mcp/copilot`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-session-id":transports.get(a)!.sessionId!,authorization:`Bearer ${await fixture.token(TEST_OTHER)}`},body:JSON.stringify({jsonrpc:"2.0",id:99,method:"tools/call",params:{name:"brc_copilot_list_all_customers",arguments:{}}})});
  const replayBody=await replay.text();assert.match(replayBody,/connection_required/);assert.doesNotMatch(replayBody,/Customer 1/);
  const output=JSON.stringify([first,second,logs]);for(const secret of [token,TEST_USER,"test-only-a","test-only-b","test-only-fail","must-not-return","synthetic-parser-secret"]) assert.equal(output.includes(secret),false);
  assert.equal(((await b.callTool({name:"brc_copilot_list_all_customers",arguments:{}})).structuredContent as any)?.status,"connection_required");
});
