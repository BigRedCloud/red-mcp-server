import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createEntraFixture } from "./entra_fixture.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";

test("normal browser: existing companies, manual/CSV add, confirmed disconnect and unchanged paste-back",async t=>{
  const fixture=await createEntraFixture(),port=await getFreePort();
  const child=await startHttpTestServer(t,port,fixture.env,90_000);
  let logs="";child.stdout.on("data",c=>logs+=c);child.stderr.on("data",c=>logs+=c);
  const base=`http://127.0.0.1:${port}`;
  const malformed=await fetch(base+"/connect/companies",{method:"POST",headers:{"content-type":"application/json"},body:'{"apiKey":"synthetic-body-secret", broken'});
  assert.equal(malformed.status,400);assert.doesNotMatch(await malformed.text(),/synthetic-body-secret|SyntaxError/);
  const client=new Client({name:"normal-browser-test",version:"1"});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(base+"/mcp")));
  async function start() {
    const result:any=await client.callTool({name:"brc_start_company_connection",arguments:{}});
    const text=result.content.filter((c:any)=>c.type==="text").map((c:any)=>c.text).join("\n");
    return /[?]code=([A-Za-z0-9_-]+)/.exec(text)![1];
  }
  const browser=await chromium.launch({channel:process.platform==="win32"?"msedge":undefined,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:900}});
  const token=await start();await page.goto(base+"/connect?code="+token);
  assert.equal(await page.locator('#companyName').isVisible(),true);
  await page.locator('#companyName').fill('Company A');await page.locator('#apiKey').fill('test-only-a');
  await Promise.all([page.waitForURL('**/connect/success/*'),page.getByRole('button',{name:'Connect companies',exact:true}).click()]);
  // Reopening a fresh pending link for the same MCP context loads existing companies.
  const secondToken=await start();await page.goto(base+"/connect?code="+secondToken);
  assert.match(await page.locator('.normal-companies').innerText(),/Company A/);
  await page.locator('.normal-add summary').focus();await page.keyboard.press('Enter');
  await page.locator('#companyName').fill('Company B');await page.locator('#apiKey').fill('test-only-b');
  await Promise.all([page.waitForURL('**/connect/success/*'),page.getByRole('button',{name:'Connect companies',exact:true}).click()]);
  const successUrl=page.url(),code=(await page.locator('#confirmation-code').innerText()).trim();
  assert.match(code,/^[a-f0-9]{32}$/);assert.notEqual(code,secondToken);
  assert.match(await page.locator('.normal-companies').innerText(),/Company A/);
  assert.match(await page.locator('.normal-companies').innerText(),/Company B/);
  assert.equal(await page.locator('#apiKey').inputValue(),'');
  await page.locator('.normal-add summary').click();
  await page.locator('#companyName').fill('Company C');await page.locator('#apiKey').fill('test-only-c');
  await Promise.all([page.waitForURL('**/connect/companies'),page.getByRole('button',{name:'Connect companies',exact:true}).click()]);
  assert.equal((await page.locator('#confirmation-code').innerText()).trim(),code);
  for(const name of ['Company A','Company B','Company C'])assert.ok((await page.locator('.normal-companies').innerText()).includes(name));
  // Legacy header aliases and CSV precedence still use the normal parser.
  await page.locator('.normal-add summary').click();
  await page.locator('#companyFile').setInputFiles({name:'companies.csv',mimeType:'text/csv',buffer:Buffer.from('Company Name,API Key\nCSV Company,test-only-d')});
  await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Connect companies',exact:true}).click()]);
  for(const name of ['Company A','Company B','Company C','CSV Company'])assert.ok((await page.locator('.normal-companies').innerText()).includes(name));
  assert.equal((await page.locator('#confirmation-code').innerText()).trim(),code);
  await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Disconnect Company B',exact:true}).click()]);
  assert.match(await page.locator('h2').innerText(),/Disconnect Company B\?/);
  await Promise.all([page.waitForURL(successUrl),page.getByRole('button',{name:'Disconnect Company B',exact:true}).click()]);
  const remaining=await page.locator('.normal-companies').innerText();assert.doesNotMatch(remaining,/Company B/);
  for(const name of ['Company A','Company C','CSV Company'])assert.ok(remaining.includes(name));
  assert.equal((await page.locator('#confirmation-code').innerText()).trim(),code);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.doesNotMatch(await page.content(),/test-only-[abcd]|Sign in with Microsoft|tenantId|objectId/);
  const confirmed:any=await client.callTool({name:'brc_confirm_company_connection',arguments:{code}});
  assert.notEqual(confirmed.isError,true);assert.match(JSON.stringify(confirmed),/Company A/);assert.doesNotMatch(JSON.stringify(confirmed),/Company B|test-only-/);
  const replay:any=await client.callTool({name:'brc_confirm_company_connection',arguments:{code}});
  assert.match(JSON.stringify(replay),/already been used|missing|incorrect/);
  await page.goto(successUrl);assert.equal(await page.locator('.normal-companies').count(),0,'management is unavailable after code redemption');
  assert.doesNotMatch(await page.locator('.company-list').first().innerText(),/Company B/);
  assert.match(await page.locator('.company-list').first().innerText(),/Company C/);
  for(const key of ['test-only-a','test-only-b','test-only-c','test-only-d','synthetic-body-secret'])assert.equal(logs.includes(key),false);
});
