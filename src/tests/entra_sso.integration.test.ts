import { COPILOT_FEDERATED_TOOL_NAMES } from "../copilot_facade.js";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
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
  const anon=await client();assert.deepEqual((await anon.listTools()).tools.map(t=>t.name).sort(),[...COPILOT_FEDERATED_TOOL_NAMES].sort());
  await assert.rejects(anon.callTool({name:"search_customers",arguments:{query:""}}));
  const invalid=await client("invalid-token");await assert.rejects(invalid.callTool({name:"search_customers",arguments:{query:""}}));
  const token=await fixture.token(),a=await client(token),b=await client(await fixture.token(TEST_OTHER));
  for (const caller of [anon, invalid]) {
    await assert.rejects(caller.callTool({name:"fetch_customer",arguments:{customerId:"1",companyName:"A"}}));
  }
  const invalidArguments=await a.callTool({name:"search_customers",arguments:{apiKey:"must-never-be-used",tenantId:TEST_USER,connectionRef:"untrusted"}});
  assert.equal(invalidArguments.isError,true);
  assert.equal(JSON.stringify(invalidArguments).includes("must-never-be-used"),false);
  const needed: any=await a.callTool({name:"search_customers",arguments:{query:""}});
  assert.equal(needed.structuredContent?.status,"connection_required");
  const link=new URL(String(needed.structuredContent?.connectionUrl));assert.equal(link.origin,"https://red.example.test");assert.equal(link.pathname,"/connect");assert.equal(link.hash,"");
  const linkToken=link.searchParams.get("request")!;
  // Use a real browser: manually supplying Origin masks referrer-policy defects.
  const browser=await chromium.launch({channel:process.platform==="win32"?"msedge":undefined,headless:true});
  t.after(()=>browser.close());
  const pageContext=await browser.newContext();
  const browserPage=await pageContext.newPage();
  const browserErrors:string[]=[];
  browserPage.on("console",m=>browserErrors.push(m.text()));
  browserPage.on("pageerror",e=>browserErrors.push(e.message));
  await browserPage.route("https://login.microsoftonline.com/**",route=>route.fulfill({status:200,contentType:"text/html",body:"Microsoft sign-in"}));
  await browserPage.route("https://red.example.test/**",async route=>{
    const request=route.request();
    if(request.resourceType()!=="document") { await route.fulfill({status:204,body:""}); return; }
    const url=new URL(request.url());
    const upstream=await route.fetch({url:base+url.pathname+url.search,maxRedirects:0});
    await route.fulfill({response:upstream});
  });
  for(const fragment of ["","?request=invalid","?request=req_"+"a".repeat(44)]) {
    await browserPage.goto("about:blank");
    await browserPage.goto("https://red.example.test/connect"+fragment);
    assert.equal(await browserPage.locator("#sign-in").isDisabled(),true);
    assert.equal(await browserPage.locator("#request").inputValue(),"");
    assert.equal(await browserPage.locator("#link-error").isVisible(),true);
    assert.equal(new URL(browserPage.url()).hash,"");
  }
  await browserPage.goto("about:blank");
  await browserPage.goto(link.toString());
  assert.equal(await browserPage.locator("#sign-in").isEnabled(),true);
  assert.ok((await browserPage.locator("#request").inputValue())===linkToken);
  assert.equal(browserPage.url(),"https://red.example.test/connect");
  const nativeStart=browserPage.waitForResponse(r=>r.url()==="https://red.example.test/connect/sso/start");
  const redirected=browserPage.waitForURL(url=>url.hostname==="login.microsoftonline.com",{waitUntil:"commit"});
  await browserPage.locator("#sign-in").click();
  const started=await nativeStart;
  assert.equal(started.status(),303);
  await redirected;
  await browserPage.waitForLoadState("load");
  assert.equal((await started.request().allHeaders()).origin,"https://red.example.test");
  assert.ok(new URLSearchParams(started.request().postData()!).get("request")===linkToken);
  for(const origin of ["null","https://evil.example"]) {
    const denied=await fetch(base+"/connect/sso/start",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",origin},body:new URLSearchParams({request:linkToken})});
    assert.equal(denied.status,401);
    assert.ok(!(await denied.text()).includes(linkToken));
  }
  async function signIn(other=false,handle=linkToken,badState=false,badCookie=false) {
    const start=await fetch(`${base}/connect/sso/start`,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded",origin:"https://red.example.test"},body:new URLSearchParams({request:handle})});
    assert.equal(start.status,303);const auth=new URL(start.headers.get("location")!);const cookie=start.headers.get("set-cookie")!.split(";")[0];
    const callback=await fetch(`${base}/connect/sso/callback`,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded",cookie:badCookie?cookie+"tampered":cookie},body:new URLSearchParams({state:badState?"wrong":auth.searchParams.get("state")!,code:(other?"other:":"")+auth.searchParams.get("nonce")!})});
    return callback;
  }
  for(let i=0;i<3;i++) {
    const scan:Response=await fetch(base+link.pathname+link.search);
    assert.equal(scan.status,200);
    assert.equal(scan.headers.get("set-cookie"),null);
  }
  const unknown="req_"+"x".repeat(43);
  const unknownPage=await fetch(base+"/connect?request="+unknown);
  assert.equal(unknownPage.status,200);
  assert.equal((await signIn(false,unknown)).status,401);
  assert.equal((await signIn(false,linkToken,true)).status,401);
  assert.equal((await signIn(false,linkToken,false,true)).status,401);
  assert.equal((await signIn(true)).status,401,"another Microsoft user cannot open this link");
  const callback=await signIn();assert.equal(callback.status,303);const cookie=callback.headers.get("set-cookie")!.split(";")[0];
  const page=await fetch(`${base}/connect?sso=1`,{headers:{cookie}});assert.equal(page.status,200);
  const html=await page.text();assert.doesNotMatch(html,/companyFile|<input[^>]*type="file"|telemetryClientId/);
  assert.equal(page.headers.get("referrer-policy"),"strict-origin");
  assert.doesNotMatch(html,/<meta[^>]+content="no-referrer"/);
  // Submit the actual rendered company form and verify browser-generated Origin.
  const companyPage=await pageContext.newPage();
  await companyPage.route("**/*",async route=>{
    if(route.request().resourceType()!=="document") { await route.fulfill({status:204,body:""}); return; }
    if(route.request().method()==="POST") {
      assert.equal((await route.request().allHeaders()).origin,"https://red.example.test");
      await route.fulfill({status:200,body:"Submission checked"});
    } else await route.fulfill({status:200,contentType:"text/html",headers:{"referrer-policy":page.headers.get("referrer-policy")!},body:html});
  });
  await companyPage.goto("https://red.example.test/connect?sso=1");
  const nativeComplete=companyPage.waitForResponse(r=>r.url().endsWith("/connect/sso/complete"));
  await companyPage.locator("form").evaluate((form:HTMLFormElement)=>form.submit());
  assert.equal((await nativeComplete).status(),200);
  const anonymousPage=await fetch(base+"/connect?code=invalid-code");
  assert.doesNotMatch(await anonymousPage.text(),/id="sign-in"|Continue with Microsoft/);
  const csrf=/name="code" value="([^"]+)"/.exec(html)![1];
  assert.equal((await fetch(`${base}/connect?sso=1`,{headers:{cookie:cookie+"tampered"}})).status,401);
  assert.equal((await fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://evil.example"},body:new URLSearchParams({code:csrf})})).status,401);
  assert.equal((await fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://red.example.test"},body:new URLSearchParams({code:"wrong"})})).status,401);
  const form=new URLSearchParams({code:csrf});for(const [name,key] of [["A","a"],["B","b"],["C","fail"]]) {form.append("companyName",name);form.append("apiKey",`test-only-${key}`);}
  const complete=()=>fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://red.example.test"},body:form});
  const submissions=await Promise.all([complete(),complete()]);assert.deepEqual(submissions.map(r=>r.status).sort(),[200,401]);
  assert.equal((await fetch(`${base}/connect?sso=1`,{headers:{cookie}})).status,401);
  assert.equal((await signIn()).status,401,"consumed request cannot reopen");
  const first: any=await a.callTool({name:"search_customers",arguments:{query:""}});
  assert.ok(first.structuredContent?.nextCursor);
  const stolen: any=await b.callTool({name:"search_customers",arguments:{query:"",nextCursor:first.structuredContent!.nextCursor}});
  assert.equal(stolen.structuredContent?.status,"connection_required");
  const second: any=await a.callTool({name:"search_customers",arguments:{query:"",nextCursor:first.structuredContent!.nextCursor}});
  const groups=[...(first.structuredContent!.companies as Record<string,unknown>[]),...(second.structuredContent!.companies as Record<string,unknown>[])];
  assert.equal(groups.filter(g=>g.companyName==="A").flatMap(g=>g.customers as unknown[]).length,21);
  assert.equal(groups.filter(g=>g.companyName==="B").flatMap(g=>g.customers as unknown[]).length,21);
  assert.equal(groups.find(g=>g.companyName==="C")?.status,"company_unavailable");assert.equal(second.structuredContent!.complete,true);
  const supplierQuery = await a.callTool({name:"search_suppliers",arguments:{query:"",companyName:"A"}});
  assert.notEqual(supplierQuery.isError, true);
  const forbiddenQuery = await b.callTool({name:"search_suppliers",arguments:{query:"",companyName:"A"}});
  assert.equal(forbiddenQuery.isError, true);
  assert.match(JSON.stringify(forbiddenQuery), /company_unavailable/);
  await assert.rejects(anon.callTool({name:"search_suppliers",arguments:{query:"",companyName:"A"}}));
  await assert.rejects(invalid.callTool({name:"search_suppliers",arguments:{query:"",companyName:"A"}}));
  for (const [plural, singular, idField] of [
    ["suppliers", "supplier", "supplierId"], ["products", "product", "productId"],
    ["sales_invoices", "sales_invoice", "salesInvoiceId"], ["purchases", "purchase", "purchaseId"],
    ["accounts", "account", "accountId"], ["quotes", "quote", "quoteId"],
    ["sales_credit_notes", "sales_credit_note", "salesCreditNoteId"], ["bank_accounts", "bank_account", "bankAccountId"],
    ["cash_payments", "cash_payment", "cashPaymentId"], ["cash_receipts", "cash_receipt", "cashReceiptId"],
    ["payments", "payment", "paymentId"],
  ]) {
    const search: any = await a.callTool({name:`search_${plural}`,arguments:{query:"",companyName:"A"}});
    assert.equal(search.structuredContent.status,"ok");
    const id = search.structuredContent.results[0][idField];
    const fetchRecord: any = await a.callTool({name:`fetch_${singular}`,arguments:{[idField]:id,companyName:"A"}});
    assert.equal(fetchRecord.structuredContent.status,"ok");
    assert.equal(fetchRecord.structuredContent[singular].Id,1);
    assert.doesNotMatch(JSON.stringify([search,fetchRecord]), /test-only-/);
    const denied = await b.callTool({name:`fetch_${singular}`,arguments:{[idField]:id,companyName:"A"}});
    assert.equal(denied.isError,true);
  }
  for (const name of ["search_accruals", "search_prepayments", "search_vat_rates", "search_vat_categories", "search_analysis_categories", "search_nominal_accounts"]) {
    const search: any = await a.callTool({name,arguments:{query:"",companyName:"A"}});
    assert.equal(search.structuredContent.status,"ok",name);
    assert.equal((await b.callTool({name,arguments:{query:"",companyName:"A"}})).isError,true);
  }
  const accrual: any = await a.callTool({name:"fetch_accrual",arguments:{accrualId:"1",companyName:"A"}});
  assert.equal(accrual.structuredContent.status,"ok");
  assert.equal(accrual.structuredContent.accrual.Id,1);
  const ledger: any = await a.callTool({name:"search_customer_transactions",arguments:{customerId:"1",companyName:"A"}});
  assert.equal(ledger.structuredContent.status,"ok");
  assert.equal(ledger.structuredContent.results[0].bookTranId,"1");
  assert.equal(ledger.structuredContent.results[0].fetchAvailable,false);
  const supplierLedger: any = await a.callTool({name:"search_supplier_transactions",arguments:{supplierId:"1",companyName:"A"}});
  assert.equal(supplierLedger.structuredContent.status,"ok");
  assert.equal(supplierLedger.structuredContent.results[0].bookTranId,"1");
  assert.equal((await b.callTool({name:"search_supplier_transactions",arguments:{supplierId:"1",companyName:"A"}})).isError,true);
  assert.equal((await b.callTool({name:"search_customer_transactions",arguments:{customerId:"1",companyName:"A"}})).isError,true);
  for(const [plural,singular,idField] of [
    ["sales_reps","sales_rep","salesRepId"],["nominal_journal_batches","nominal_journal_batch","nominalJournalBatchId"],
    ["vat_types",null,"vatTypeId"],["vat_analysis_types",null,"vatAnalysisTypeId"],["category_types",null,"categoryTypeId"],["book_transaction_types",null,"bookTranTypeId"],
  ] as const) {
    const result:any=await a.callTool({name:`search_${plural}`,arguments:{query:"",companyName:"A"}});
    assert.equal(result.structuredContent.status,"ok",plural);
    assert.equal(result.structuredContent.results.length,1,plural);
    assert.equal((await b.callTool({name:`search_${plural}`,arguments:{query:"",companyName:"A"}})).isError,true);
    if(singular) {
      const detail:any=await a.callTool({name:`fetch_${singular}`,arguments:{companyName:"A",[idField]:result.structuredContent.results[0][idField]}});
      assert.equal(detail.structuredContent.status,"ok",singular);
      assert.equal((await b.callTool({name:`fetch_${singular}`,arguments:{companyName:"A",[idField]:"1"}})).isError,true);
    }
  }
  const year: any = await a.callTool({name:"get_financial_year",arguments:{companyName:"A"}});
  assert.equal(year.structuredContent.status,"ok");
  assert.equal(year.structuredContent.financial_year.yearStart,"2026-01-01");
  assert.equal((await b.callTool({name:"get_financial_year",arguments:{companyName:"A"}})).isError,true);
  assert.doesNotMatch(JSON.stringify([accrual,ledger,year]), /test-only-/);
  const fetched: any=await a.callTool({name:"fetch_customer",arguments:{customerId:"1",companyName:"A"}});
  assert.equal(fetched.structuredContent?.status,"ok");
  assert.equal(fetched.structuredContent.customer.Id,1);
  assert.doesNotMatch(JSON.stringify(fetched),/test-only-|apiKey/);
  const forbidden: any=await b.callTool({name:"fetch_customer",arguments:{customerId:"1",companyName:"A"}});
  assert.equal(forbidden.structuredContent?.status,"customer_unavailable");
  assert.equal(forbidden.isError,true);
  const replay = await fetch(`${base}/mcp/copilot`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-session-id":transports.get(a)!.sessionId!,authorization:`Bearer ${await fixture.token(TEST_OTHER)}`},body:JSON.stringify({jsonrpc:"2.0",id:99,method:"tools/call",params:{name:"search_customers",arguments:{query:""}}})});
  const replayBody=await replay.text();assert.match(replayBody,/connection_required/);assert.doesNotMatch(replayBody,/Customer 1/);
  const output=JSON.stringify([first,second,logs]);for(const secret of [token,TEST_USER,"test-only-a","test-only-b","test-only-fail","must-not-return","synthetic-parser-secret"]) assert.equal(output.includes(secret),false);
  for(const secret of [linkToken,token,TEST_USER,TEST_OTHER,"test-only-a","test-only-b"]) assert.equal((logs+browserErrors.join("\n")).includes(secret),false);
  assert.equal(((await b.callTool({name:"search_customers",arguments:{query:""}})).structuredContent as any)?.status,"connection_required");
});
