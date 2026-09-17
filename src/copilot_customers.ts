import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { ownerKey } from "./auth/entra_store.js";
import { getConnectionStore, ensureConnectionStoreInitialized } from "./auth/connection_store.js";
import { encryptCredentialSecret } from "./auth/credential_encryption.js";
import { decodeStoredApiKey } from "./auth/credential_secret.js";
import { openSsoEnvelope, ssoPublicBase } from "./auth/entra_browser.js";
import { brcFetch, runWithSessionKeyStore, type CompanyApiContext } from "./shared.js";
import { listBrcCustomers } from "./tools/general/list_tools.js";

const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false} as const;
const response = (data: Record<string,unknown>, isError = false) => ({ content:[{type:"text" as const,text:JSON.stringify(data)}],structuredContent:data,...(isError?{isError:true}:{}) });
type Cursor = {owner:string;snapshot:string;index:number;page:number;pageSize:number;exp:number;query?:string};
const fields = new Set(["id","customerid","code","customercode","name","customername","email","emailaddress","telephone","phone","address1","address2","address3","address4","postcode","country","contact","contactname","balance","dormant","isdormant"]);
function safeCustomer(item: unknown, clean: (value: string) => string) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Unsupported customer response.");
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) if (fields.has(key.toLowerCase())) {
    if (typeof value === "string") {
      if (value.length > 4000) throw new Error("Customer field is too large.");
      row[key] = clean(value);
    } else if (value === null || typeof value === "boolean" || typeof value === "number") row[key] = value;
  }
  return row;
}

function redactCustomerText(secrets: string[]) {
  return (value: string) => {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
    return text.replace(/Bearer\s+\S+/gi,"[redacted]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,"[redacted]");
  };
}

export async function listCopilotCustomers(args: {cursor?:string;pageSize?:number;query?:string}) {
  const owner = entraRequestOwner.getStore();
  if (!owner) return response({status:"authentication_required",message:"Sign in with Microsoft to list your customers."},true);
  try {
    await ensureConnectionStoreInitialized();
    const store = getConnectionStore().entra;
    const companies = await store.listCompanies(owner);
    if (!companies.length) {
      const base = ssoPublicBase();
      const request = await store.createPendingRequest(owner);
      return response({status:"connection_required",message:"Connect your Big Red Cloud companies securely using your Microsoft sign-in. Enter credentials only on the connection page.",connectionUrl:`${base}/connect?request=${request}`});
    }
    const snapshot = createHash("sha256").update(JSON.stringify(companies.map(c=>[c.companyName,c.updatedAt]))).digest("hex");
    const query = (args.query ?? "").trim().toLowerCase();
    let cursor: Cursor = {owner:ownerKey(owner),snapshot,index:0,page:1,pageSize:args.pageSize??20,exp:Date.now()+600_000,query};
    if (args.cursor) {
      try { cursor = JSON.parse(openSsoEnvelope(args.cursor)); } catch { return response({status:"invalid_cursor",message:"Restart the customer list."},true); }
      if ((cursor.query ?? "") !== query) return response({status:"invalid_cursor",message:"Restart the customer search when changing the query."},true);
      if (cursor.owner!==ownerKey(owner) || cursor.snapshot!==snapshot || cursor.exp<=Date.now() || !Number.isInteger(cursor.index) || cursor.index<0 || cursor.index>=companies.length || !Number.isInteger(cursor.page) || cursor.page<1 || !Number.isInteger(cursor.pageSize) || cursor.pageSize<1 || cursor.pageSize>50 || (args.pageSize!==undefined && args.pageSize!==cursor.pageSize)) return response({status:"invalid_cursor",message:"Restart the customer list."},true);
    }
    if (cursor.pageSize<1 || cursor.pageSize>50) return response({status:"invalid_request"},true);
    const secrets = [owner.tenantId,owner.objectId,...companies.flatMap(c=>{const key=decodeStoredApiKey(c.encryptedSecret);return [key,Buffer.from(`${key}:`).toString("base64")];})];
    const clean = redactCustomerText(secrets);
    const groups: Record<string,unknown>[] = [];
    // At most three BRC pages per invocation; cursor retains the next company/page.
    for(let requests=0;requests<3 && cursor.index<companies.length;requests++) {
      const company=companies[cursor.index];
      const group: Record<string,unknown>={companyName:clean(company.companyName),page:cursor.page,pageSize:cursor.pageSize};
      try {
        const contexts = new Map<string,CompanyApiContext>([[company.companyName.toLowerCase(), {companyName:company.companyName,apiKey:decodeStoredApiKey(company.encryptedSecret),expiresAt:company.expiresAt}]]);
        const data = await runWithSessionKeyStore(contexts,()=>listBrcCustomers(company.companyName,cursor.page,cursor.pageSize));
        const obj=data as Record<string,unknown>;
        const items = Array.isArray(data) ? data : obj?.Items ?? obj?.items;
        if (!Array.isArray(items) || items.length>cursor.pageSize) throw new Error("Unsupported customer response.");
        const safeItems=items.map(item=>safeCustomer(item,clean)).filter(row=>!query || Object.values(row).some(value=>
          (typeof value === "string" || typeof value === "number") && String(value).toLowerCase().includes(query)));
        if (Buffer.byteLength(JSON.stringify(safeItems)) > 128_000) throw new Error("Customer page is too large.");
        Object.assign(group,{status:"ok",customers:safeItems});
        // A full page always warrants a next-page check, independent of Count semantics.
        if(items.length===cursor.pageSize) cursor.page++; else {cursor.index++;cursor.page=1;}
      } catch {
        Object.assign(group,{status:"company_unavailable",message:"Could not list this company's customers. Retry this company by restarting the list.",customers:[]});
        cursor.index++;cursor.page=1;
      }
      groups.push(group);
    }
    const nextCursor = cursor.index<companies.length ? encryptCredentialSecret(JSON.stringify(cursor)) : undefined;
    return response({status:groups.some(g=>g.status!=="ok")?"partial_failure":"ok",companies:groups,...(nextCursor?{nextCursor}:{}),complete:!nextCursor});
  } catch { return response({status:"service_unavailable",message:"Customer listing is unavailable. Please try again."},true); }
}
export function registerCopilotCustomers(server: McpServer) {
  server.registerTool("search_customers", {
    title: "Search Big Red Cloud customers",
    description: "Search customers across Big Red Cloud companies linked to the signed-in Microsoft user. Supports bounded pagination.",
    annotations,
    inputSchema: z.object({
      query: z.string().max(1000).describe("Customer text to match; use an empty string to list customers."),
      nextCursor: z.string().max(4096).optional().describe("Continuation returned by the previous search; keep the same query."),
    }).strict(),
  }, ({query,nextCursor}) => listCopilotCustomers({query,cursor:nextCursor}));
  server.registerTool("fetch_customer", {
    title: "Fetch Big Red Cloud customer",
    description: "Fetch one Big Red Cloud customer by its exact customer identifier from companies linked to the signed-in Microsoft user.",
    annotations,
    inputSchema: z.object({
      customerId: z.string().min(1).max(256).describe("Exact customer Id or CustomerId returned by search_customers, as a string."),
      companyName: z.string().min(1).max(4000).describe("Company name returned with the customer by search_customers; customer IDs are company-scoped."),
    }).strict(),
  }, fetchCopilotCustomer);
}

export async function fetchCopilotCustomer(args: {customerId:string;companyName:string}) {
  const owner = entraRequestOwner.getStore();
  if (!owner) return response({status:"authentication_required",message:"Sign in with Microsoft to fetch a customer."},true);
  if (!args.customerId || args.customerId === "." || args.customerId === "..") return response({status:"invalid_request"},true);
  try {
    await ensureConnectionStoreInitialized();
    const companies = await getConnectionStore().entra.listCompanies(owner);
    const company = companies.find(item=>item.companyName === args.companyName);
    if (!company) return response({status:"customer_unavailable",message:"Search your linked companies for this customer first."},true);
    const secrets = [owner.tenantId,owner.objectId,...companies.flatMap(item=>{
      const key=decodeStoredApiKey(item.encryptedSecret);
      return [key,Buffer.from(`${key}:`).toString("base64")];
    })];
    const clean = redactCustomerText(secrets);
    const contexts = new Map<string,CompanyApiContext>([[company.companyName.toLowerCase(), {
      companyName:company.companyName,apiKey:decodeStoredApiKey(company.encryptedSecret),expiresAt:company.expiresAt,
    }]]);
    const data = await runWithSessionKeyStore(contexts,()=>brcFetch(company.companyName,
      `/v1/customers/${encodeURIComponent(args.customerId)}`,{signal:AbortSignal.timeout(15_000)}));
    const customer = safeCustomer(data,clean);
    const id = Object.entries(customer).find(([key])=>["id","customerid"].includes(key.toLowerCase()))?.[1];
    if (String(id) !== args.customerId || Buffer.byteLength(JSON.stringify(customer)) > 128_000) throw new Error("Unexpected customer response.");
    return response({status:"ok",companyName:clean(company.companyName),customer});
  } catch {
    return response({status:"customer_unavailable",message:"Could not fetch this customer. Search again and retry."},true);
  }
}
