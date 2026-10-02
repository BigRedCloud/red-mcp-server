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
  // Public help needs verified Microsoft identity, but no company link or BRC key.
  for (const name of ["search_help_resources", "get_red_help"]) {
    await assert.rejects(anon.callTool({name,arguments:{query:"bank reconciliation"}}));
    const help:any=await a.callTool({name,arguments:{query:"bank reconciliation"}});
    assert.equal(help.structuredContent.status,"ok",name);
    assert.equal(help.structuredContent.connectionUrl,undefined);
  }
  const missingHelp:any=await a.callTool({name:"fetch_help_resource",arguments:{resourceId:"recorded_webinar:missing-fixture"}});
  assert.equal(missingHelp.structuredContent.status,"resource_unavailable");
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
  const html=await page.text();assert.match(html,/name="companyFile"/);assert.doesNotMatch(html,/name="code"|telemetryClientId|confirmation code/i);
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
  assert.equal(await companyPage.locator('.company-entry:visible').count(),1);
  for (let i=2;i<=5;i++) {
    await companyPage.locator('#add-company').focus();
    await companyPage.keyboard.press('Enter');
    assert.equal(await companyPage.locator(`#companyName-${i-1}`).evaluate(el=>el===document.activeElement),true);
    assert.equal(await companyPage.locator('.company-entry:visible').count(),i);
  }
  assert.equal(await companyPage.locator('#add-company').isVisible(),false);
  await companyPage.locator('#companyName-0').fill('Browser company');
  await companyPage.locator('#apiKey-0').fill('browser-only-secret');
  const nativeComplete=companyPage.waitForResponse(r=>r.url().endsWith("/connect/sso/complete"));
  await companyPage.locator("button[type=submit]").click();
  assert.equal((await nativeComplete).status(),200);
  const anonymousPage=await fetch(base+"/connect?code=invalid-code");
  assert.doesNotMatch(await anonymousPage.text(),/id="sign-in"|Continue with Microsoft/);
  const csrf=/name="csrfToken" value="([^"]+)"/.exec(html)![1];
  assert.equal((await fetch(`${base}/connect?sso=1`,{headers:{cookie:cookie+"tampered"}})).status,401);
  assert.equal((await fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://evil.example"},body:new URLSearchParams({csrfToken:csrf})})).status,401);
  assert.equal((await fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",cookie,origin:"https://red.example.test"},body:new URLSearchParams({csrfToken:"wrong"})})).status,401);
  const form=new FormData();form.append("csrfToken",csrf);
  for(const [name,key] of [["A","test-only-a"],["B","test-only-b"],["C","test-only-fail"],["",""],["",""]]) {form.append("companyName",name);form.append("apiKey",key);}
  // Browsers submit an empty file part even when no CSV has been selected.
  form.append("companyFile",new Blob([]),"");
  const complete=()=>fetch(`${base}/connect/sso/complete`,{method:"POST",headers:{cookie,origin:"https://red.example.test"},body:form});
  const submissions=await Promise.all([complete(),complete()]);assert.deepEqual(submissions.map(r=>r.status).sort(),[200,401]);
  const successHtml=await submissions.find(r=>r.status===200)!.text();
  assert.match(successHtml,/<li><span aria-hidden="true">✓<\/span> A<\/li>/);
  assert.match(successHtml,/<li><span aria-hidden="true">✓<\/span> B<\/li>/);
  assert.match(successHtml,/Return to Microsoft Copilot and retry your question/);
  assert.doesNotMatch(successHtml,/test-only-|req_|tenantId|objectId|connectionId/);
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
    ["sales_entries","sales_entry","salesEntryId"],["account_owner_types",null,"ownerTypeId"],["account_owner_type_groups",null,"ownerTypeGroupId"],["user_defined_fields",null,"userDefinedFieldId"],
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
  const nominal: any = await a.callTool({name:"search_nominal_accounts",arguments:{query:"",companyName:"A"}});
  const fetchedNominal: any = await a.callTool({name:"fetch_nominal_account",arguments:{nominalAccountId:nominal.structuredContent.results[0].nominalAccountId,companyName:"A"}});
  assert.equal(fetchedNominal.structuredContent.status,"ok");
  assert.equal((await b.callTool({name:"fetch_nominal_account",arguments:{nominalAccountId:"1",companyName:"A"}})).isError,true);
  assert.doesNotMatch(JSON.stringify([accrual,ledger,year,fetchedNominal]), /test-only-/);
  const agedCustomer: any = await a.callTool({name:"get_customer_aged_balance",arguments:{customerId:"1",companyName:"A"}});
  assert.equal(agedCustomer.structuredContent.status,"ok");
  assert.equal(agedCustomer.structuredContent.aged_balance.currentMonth,10);
  assert.equal((await b.callTool({name:"get_customer_aged_balance",arguments:{customerId:"1",companyName:"A"}})).isError,true);
  const agedSupplier: any = await a.callTool({name:"get_supplier_aged_balance",arguments:{supplierId:"1",companyName:"A"}});
  assert.equal(agedSupplier.structuredContent.status,"ok");
  assert.equal((await b.callTool({name:"get_supplier_aged_balance",arguments:{supplierId:"1",companyName:"A"}})).isError,true);
  const allocated: any = await a.callTool({name:"get_allocated_transactions",arguments:{bookTranId:"1",companyName:"A"}});
  assert.equal(allocated.structuredContent.status,"ok");
  assert.equal(allocated.structuredContent.allocated_transactions.allocations[0].receiverReference,"INV001");
  assert.equal((await b.callTool({name:"get_allocated_transactions",arguments:{bookTranId:"1",companyName:"A"}})).isError,true);
  const candidates: any = await a.callTool({name:"get_allocation_candidates",arguments:{bookTranId:"1",companyName:"A"}});
  assert.equal(candidates.structuredContent.status,"ok");
  assert.equal(candidates.structuredContent.allocation_candidates.candidates[0].receiverReference,"INV002");
  assert.equal((await b.callTool({name:"get_allocation_candidates",arguments:{bookTranId:"1",companyName:"A"}})).isError,true);
  assert.doesNotMatch(JSON.stringify([agedCustomer,agedSupplier,allocated,candidates]), /test-only-/);
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
  // A fully rejected submission still consumes its link and names each failure safely.
  const failedNeeded:any=await b.callTool({name:"search_customers",arguments:{query:""}});
  const failedHandle=new URL(failedNeeded.structuredContent.connectionUrl).searchParams.get("request")!;
  const failedCallback=await signIn(true,failedHandle);
  const failedCookie=failedCallback.headers.get("set-cookie")!.split(";")[0];
  const failedPage=await fetch(base+"/connect?sso=1",{headers:{cookie:failedCookie}});
  const failedCsrf=/name="csrfToken" value="([^"]+)"/.exec(await failedPage.text())![1];
  const failedForm=new URLSearchParams({csrfToken:failedCsrf});
  for (const name of ['Rejected <A>', 'Rejected & B']) {
    failedForm.append("companyName",name);failedForm.append("apiKey","invalid-private-credential");
  }
  const submitFailed=()=>fetch(base+"/connect/sso/complete",{method:"POST",headers:{cookie:failedCookie,origin:"https://red.example.test","content-type":"application/x-www-form-urlencoded"},body:failedForm});
  const failedResponse=await submitFailed();assert.equal(failedResponse.status,400);
  const failedHtml=await failedResponse.text();
  assert.match(failedHtml,/<h2>Companies could not be connected<\/h2>/);
  assert.match(failedHtml,/Rejected &lt;A&gt;/);assert.match(failedHtml,/Rejected &amp; B/);
  assert.match(failedHtml,/request a new connection link to try again/);
  assert.doesNotMatch(failedHtml,/Companies connected|invalid-private-credential|tenantId|objectId|connectionId|req_|<A>/);
  assert.equal((await submitFailed()).status,401);
  assert.equal((await signIn(true,failedHandle)).status,401);
  assert.equal(logs.includes("invalid-private-credential"),false);
  const csvNeeded:any=await b.callTool({name:"search_customers",arguments:{query:""}});
  const csvHandle=new URL(csvNeeded.structuredContent.connectionUrl).searchParams.get("request")!;
  const csvCallback=await signIn(true,csvHandle);
  assert.equal(csvCallback.status,303);
  const csvCookie=csvCallback.headers.get("set-cookie")!.split(";")[0];
  const csvPage=await fetch(base+"/connect?sso=1",{headers:{cookie:csvCookie}});
  const csvHtml=await csvPage.text();
  const csvCsrf=/name="csrfToken" value="([^"]+)"/.exec(csvHtml)![1];
  async function postCsv(contents:string,filename="companies.csv",csrfToken=csvCsrf) {
    const data=new FormData();
    data.append("csrfToken",csrfToken);
    data.append("companyFile",new Blob([contents],{type:"text/csv"}),filename);
    data.append("companyName","Ignored manual company");
    data.append("apiKey","ignored-manual-secret");
    return fetch(base+"/connect/sso/complete",{method:"POST",headers:{cookie:csvCookie,origin:"https://red.example.test"},body:data});
  }
  assert.equal((await postCsv("companyName,apiKey\nA,test-only-a","companies.csv","wrong")).status,401);
  for (const [csv,filename,message] of [
    ['companyName,apiKey\nA,"csv-secret-malformed','companies.csv',/could not be read/],
    ['companyName,apiKey\n'+"A,csv-secret\n".repeat(6),'companies.csv',/five/],
    ['companyName,apiKey\nA,'+"x".repeat(1024*1024),'companies.csv',/too large/],
    ['companyName,apiKey\nA,csv-secret','companies.txt',/CSV file/],
  ] as const) {
    const rejected=await postCsv(csv,filename);
    assert.equal(rejected.status,400);
    const errorHtml=await rejected.text();assert.match(errorHtml,message);
    assert.match(errorHtml,/class="brand-bar"/);
    assert.doesNotMatch(errorHtml,/csv-secret|ignored-manual-secret|req_|tenantId|objectId/);
    assert.equal((await fetch(base+"/connect?sso=1",{headers:{cookie:csvCookie}})).status,200,"bad input must not consume the request");
  }
  const csvComplete=await postCsv('companyName,apiKey\n"CSV <company>",test-only-a\nCSV B,test-only-b\n"Rejected <CSV>",invalid-private-csv');
  assert.equal(csvComplete.status,200);
  const csvSuccess=await csvComplete.text();
  assert.match(csvSuccess,/CSV &lt;company&gt;/);assert.match(csvSuccess,/<li><span aria-hidden="true">✓<\/span> CSV B<\/li>/);
  assert.match(csvSuccess,/Could not connect:/);
  assert.match(csvSuccess,/Rejected &lt;CSV&gt;/);
  assert.match(csvSuccess,/request a new connection link to try again/);
  assert.doesNotMatch(csvSuccess,/test-only-|ignored-manual|invalid-private-csv|<company>|<CSV>|req_|tenantId|objectId|connectionId/);
  assert.equal(logs.includes("invalid-private-csv"),false);
  assert.equal((await postCsv('companyName,apiKey\nReplay,test-only-a')).status,401);
  const csvRead:any=await b.callTool({name:"search_suppliers",arguments:{query:"",companyName:"CSV B"}});
  assert.equal(csvRead.structuredContent.status,"ok","CSV companies use the existing owner-bound store");
  const csvDenied:any=await a.callTool({name:"search_suppliers",arguments:{query:"",companyName:"CSV B"}});
  assert.equal(csvDenied.isError,true);
  for(const secret of ["csv-secret","CSV <company>","ignored-manual-secret",csvHandle,"test-only-a","test-only-b"]) assert.equal(logs.includes(secret),false);

  // The existing anonymous /mcp page, CSV precedence and confirmation flow stay intact.
  const normal=new Client({name:"normal-connect-regression",version:"1"});t.after(()=>normal.close());
  await normal.connect(new StreamableHTTPClientTransport(new URL(base+"/mcp")));
  for (const useCsv of [false,true]) {
    const started:any=await normal.callTool({name:"brc_start_company_connection",arguments:{}});
    const text=started.content.filter((c:any)=>c.type==="text").map((c:any)=>c.text).join("\n");
    const normalCode=/[?]code=([A-Za-z0-9_-]+)/.exec(text)![1];
    const normalPage=await fetch(base+"/connect?code="+normalCode);
    assert.equal(normalPage.status,200);
    const normalHtml=await normalPage.text();
    assert.match(normalHtml,/name="code"/);assert.match(normalHtml,/name="companyFile"/);
    assert.doesNotMatch(normalHtml,/csrfToken|Sign in with Microsoft/);
    const normalForm=new FormData();normalForm.append("code",normalCode);
    normalForm.append("companyName","Legacy manual");normalForm.append("apiKey","test-only-a");
    if(useCsv) normalForm.append("companyFile",new Blob(['companyName,apiKey\nLegacy CSV,test-only-b'],{type:"text/csv"}),"companies.csv");
    const normalPost=await fetch(base+"/connect",{method:"POST",body:normalForm,redirect:"manual"});
    assert.equal(normalPost.status,303);
    const normalSuccess=await fetch(new URL(normalPost.headers.get("location")!,base));
    const normalSuccessHtml=await normalSuccess.text();
    assert.match(normalSuccessHtml,useCsv?/Legacy CSV/:/Legacy manual/);
    assert.doesNotMatch(normalSuccessHtml,/test-only-/);
    const confirmation=/id="confirmation-code">([^<]+)</.exec(normalSuccessHtml)![1];
    const confirmed:any=await normal.callTool({name:"brc_confirm_company_connection",arguments:{code:confirmation}});
    assert.notEqual(confirmed.isError,true);
    assert.match(JSON.stringify(confirmed),useCsv?/Legacy CSV/:/Legacy manual/);
  }

});
