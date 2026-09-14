import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createEntraFixture } from "../build/tests/entra_fixture.js";
import { getFreePort, startHttpTestServer } from "../build/tests/http_test_server.js";

const cleanup=[];
const client=new Client({name:"sso-local-demo",version:"1"});
try {
  // Ephemeral signing/encryption keys and synthetic credentials only.
  const fixture=await createEntraFixture(),port=await getFreePort();
  await startHttpTestServer({after:fn=>cleanup.push(fn)},port,fixture.env,90_000);
  const base=`http://127.0.0.1:${port}`;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/copilot`),{requestInit:{headers:{Authorization:`Bearer ${await fixture.token()}`}}}));
  console.log("Tools:",(await client.listTools()).tools.map(t=>t.name));
  const needed=await client.callTool({name:"brc_copilot_list_all_customers",arguments:{}});
  assert.equal(needed.structuredContent.status,"connection_required");
  console.log("Before linking:",needed.structuredContent.status,"(secure link omitted from console)");
  const link=new URLSearchParams(new URL(needed.structuredContent.connectionUrl).hash.slice(1)).get("sso");
  const post=(path,body,cookie)=>fetch(`${base}${path}`,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded",origin:"https://red.example.test",...(cookie?{cookie}:{})},body});
  const start=await post("/connect/sso/start",new URLSearchParams({link}));
  assert.equal(start.status,303);
  const auth=new URL(start.headers.get("location"));
  const callback=await post("/connect/sso/callback",new URLSearchParams({state:auth.searchParams.get("state"),code:auth.searchParams.get("nonce")}),start.headers.get("set-cookie").split(";")[0]);
  assert.equal(callback.status,303);
  const cookie=callback.headers.get("set-cookie").split(";")[0];
  const html=await (await fetch(`${base}/connect?sso=1`,{headers:{cookie}})).text();
  const code=/name="code" value="([^"]+)"/.exec(html)[1];
  const form=new URLSearchParams({code});
  for(const name of ["A","B"]) {form.append("companyName",name);form.append("apiKey",`test-only-${name.toLowerCase()}`);}
  assert.equal((await post("/connect/sso/complete",form,cookie)).status,200);
  const result=await client.callTool({name:"brc_copilot_list_all_customers",arguments:{}});
  assert.equal(result.structuredContent.status,"ok");
  assert.equal(result.structuredContent.companies.length,2);
  console.log("After linking:",JSON.stringify(result.structuredContent,null,2));
} finally {
  await client.close();
  for(const fn of cleanup.reverse()) await fn();
}
