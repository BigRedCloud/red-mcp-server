// Explicit test/demo preload only. Production never imports this module.
import { TEST_USER, TEST_OTHER, signFixtureJwt } from "./entra_fixture.js";
const jwk=JSON.parse(process.env.RED_ENTRA_TEST_PRIVATE_JWK ?? "null");
if (!jwk) throw new Error("Test fixture key required.");
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
globalThis.fetch=async (input,init)=>{
  const url=new URL(String(input));
  if(url.hostname==="login.microsoftonline.com") {
    if(url.pathname.endsWith("openid-configuration")) return json({issuer:"https://login.microsoftonline.com/{tenantid}/v2.0",jwks_uri:"https://login.microsoftonline.com/organizations/discovery/v2.0/keys"});
    if(url.pathname.endsWith("/keys")) return json({keys:[{kty:jwk.kty,n:jwk.n,e:jwk.e,kid:"test",alg:"RS256",use:"sig",issuer:"https://login.microsoftonline.com/{tenantid}/v2.0"}]});
    if(url.pathname.endsWith("/token")) {
      const params=new URLSearchParams(String(init?.body));const code=params.get("code")??"";
      return json({id_token:await signFixtureJwt(jwk,{aud:"test-web",nonce:code.replace(/^other:/,""),oid:code.startsWith("other:")?TEST_OTHER:TEST_USER})});
    }
  }
  if(url.hostname==="app.bigredcloud.com") {
    const authorization=new Headers(init?.headers).get("authorization")??"";
    const key=Buffer.from(authorization.replace(/^Basic /,""),"base64").toString().replace(/:$/,"");
    if(!key.startsWith("test-only-")) return json({error:"invalid"},401);
    if (url.pathname.endsWith("/nominalAccounts")) {
      if (url.searchParams.has("$filter")) return json({error:"Filtering is forbidden"},400);
      const rows=Array.from({length:21},(_,i)=>({id:i+1,accountGroupId:13,code:String(i+1).padStart(3,"0"),description:"SALES",companyId:0,timeStamp:"QUFBQUFBQUFDcXc9",balance:0,oBalance:0,...Object.fromEntries(Array.from({length:12},(_,month)=>[`month${month+1}`,0])),group:"Sales",type:"Profit and Loss"}));
      const skip=Number(url.searchParams.get("$skip")??0),top=Number(url.searchParams.get("$top")??rows.length);
      return json(rows.slice(skip,skip+top));
    }
    const finalPath=/\/(salesEntries|ownerTypes|ownerTypeGroups|userDefinedFields)(?:\/(\d+))?$/.exec(url.pathname);
    if(finalPath) {
      if(init?.method && init.method!=="GET") throw new Error("Facade must only read");
      const kind=finalPath[1];
      const row=kind==="salesEntries" ? {id:1,customerId:1,reference:"SE1",details:"Sales entry",entryDate:"2024-01-15",total:100,acEntries:[{value:100}],vatEntries:[]}
        : kind==="ownerTypes" ? {id:1,description:"Prospect",recordTypeGroupId:1}
        : kind==="ownerTypeGroups" ? {id:1,description:"Customer"}
        : {id:1,description:"acudf_1_1",orderIndex:1,categoryTypeId:19};
      const skip=Number(url.searchParams.get("$skip")??0),top=Number(url.searchParams.get("$top")??20);
      return json(finalPath[2]?row:{Items:[row].slice(skip,skip+top),Count:1,NextPageLink:""});
    }
    const nextPath=/\/(salesReps|nominalJournalBatches|vatTypes|vatAnalysisTypes|categoryTypes|bookTranTypes)(?:\/(\d+))?$/.exec(url.pathname);
    if(nextPath) {
      if(init?.method && init.method!=="GET") throw new Error("New facade tools must only read");
      const kind=nextPath[1];
      const row=kind==="salesReps" ? {id:1,code:"SR1",name:"Sales Representative",email:"rep@example.test"}
        : kind==="nominalJournalBatches" ? {id:1,entryDate:"2024-01-15T00:00:00",total:100,accountTransactions:[{acCode:"400",debit:100,credit:0}]}
        : kind==="vatTypes" ? {id:1,description:"Domestic",code:"",isOnlyZero:false,isNotApplicable:false}
        : kind==="vatAnalysisTypes" ? {id:0,description:"None"}
        : {id:1,description:"Cash Receipt"};
      return json(nextPath[2]?row:{Items:[row],Count:1,NextPageLink:""});
    }
    const facadePath = /\/(suppliers|products|salesInvoices|purchases|accounts|quotes|salesCreditNotes|bankAccounts|cashPayments|cashReceipts|payments|accruals|prepayments|vatRates|vatCategories|analysisCategories|nominalAccounts)(?:\/(\d+))?$/.exec(url.pathname);
    if (facadePath) {
      if (init?.method && init.method !== "GET") throw new Error("Facade must only read");
      const row = {Id: 1, Code: "ONE", Name: "Record for " + key, Percentage: 23, AcCode: "4000", oBalance: 0};
      return json(facadePath[2] ? row : facadePath[1] === "nominalAccounts" ? [row] : {Items: [row]});
    }
    if(url.pathname.includes("getFinancialYear")) return json({yearStart:"2026-01-01",yearEnd:"2026-12-31"});
    if (/\/(customers|suppliers)\/\d+\/openingBalance$/.test(url.pathname)) {
      return json({currentMonth:10,oneMonthOld:20,twoMonthsOld:30,threeMonthsOld:40,ApiKey:key});
    }
    if (/\/(customers|suppliers)\/\d+\/accountTrans$/.test(url.pathname)) {
      return json([{Id:1,BookTranId:1,Reference:"INV-1",Debit:10,Credit:0,BookTypeDesc:"Sales Invoice",ApiKey:key}]);
    }
    if (url.pathname.endsWith("/allocationResolvers/allocated") || url.pathname.endsWith("/allocationResolvers")) {
      if(init?.method && init.method!=="GET") throw new Error("Facade must only read");
      const allocated=url.pathname.endsWith("/allocated");
      return json({
        bookTran:{id:Number(url.searchParams.get("bookTranId")??1),bookTranTypeId:5,total:500,unAllocated:allocated?150:350,ownerId:1,ownerName:"Acme Ltd"},
        allocationResolvers:[{id:allocated?5001:0,allocated:allocated?200:0,discount:0,bookTranId:1,bookTranIdReceiver:2001,receiverReference:allocated?"INV001":"INV002",receiverTotal:250,receiverOutstanding:allocated?40:250,receiverBookTranTypeId:3}],
      });
    }
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
