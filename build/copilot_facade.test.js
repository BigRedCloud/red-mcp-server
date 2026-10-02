import { COPILOT_HELP_NAMES } from "./copilot_help.js";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { COPILOT_INSTRUCTIONS, registerCopilotDiagnosticTools } from "./copilot_diagnostic.js";
import { registerTools as registerListTools } from "./tools/general/list_tools.js";
import { registerAllTools } from "./register_all_tools.js";
import { COPILOT_FEDERATED_TOOL_NAMES } from "./copilot_facade.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { getConnectionStore } from "./auth/connection_store.js";
import { encryptCredentialSecret, decryptCredentialSecret } from "./auth/credential_encryption.js";
import { runWithHttpRequestSessionId, runWithSessionKeyStore } from "./shared.js";
const finalTranche = [
    ["sales_entries", "sales_entry", "salesEntryId", "salesEntries"],
    ["account_owner_types", null, "ownerTypeId", "ownerTypes"],
    ["account_owner_type_groups", null, "ownerTypeGroupId", "ownerTypeGroups"],
    ["user_defined_fields", null, "userDefinedFieldId", "userDefinedFields"],
];
const finalNames = finalTranche.flatMap(([plural, singular]) => singular ? [`search_${plural}`, `fetch_${singular}`] : [`search_${plural}`]);
const allocationContinuation = "When the user asks to continue or show remaining items, call this same tool using the exact nextCursor from its most recent response and the same bookTranId and companyName. Do not ask the user to copy the cursor. Omit nextCursor only for a new list.";
const nextTranche = [
    ["sales_reps", "sales_rep", "salesRepId", "salesReps"],
    ["nominal_journal_batches", "nominal_journal_batch", "nominalJournalBatchId", "nominalJournalBatches"],
    ["vat_types", null, "vatTypeId", "vatTypes"],
    ["vat_analysis_types", null, "vatAnalysisTypeId", "vatAnalysisTypes"],
    ["category_types", null, "categoryTypeId", "categoryTypes"],
    ["book_transaction_types", null, "bookTranTypeId", "bookTranTypes"],
];
const nextNames = nextTranche.flatMap(([plural, singular]) => singular ? [`search_${plural}`, `fetch_${singular}`] : [`search_${plural}`]);
const remainderNames = ["fetch_nominal_account"];
const gapNames = ["get_customer_aged_balance", "get_supplier_aged_balance", "get_allocated_transactions", "get_allocation_candidates"];
const original = [
    ["suppliers", "supplier", "supplierId", "suppliers"],
    ["products", "product", "productId", "products"],
    ["sales_invoices", "sales_invoice", "salesInvoiceId", "salesInvoices"],
    ["purchases", "purchase", "purchaseId", "purchases"],
    ["accounts", "account", "accountId", "accounts"],
];
const added = [
    ["quotes", "quote", "quoteId", "quotes"],
    ["sales_credit_notes", "sales_credit_note", "salesCreditNoteId", "salesCreditNotes"],
    ["bank_accounts", "bank_account", "bankAccountId", "bankAccounts"],
    ["cash_payments", "cash_payment", "cashPaymentId", "cashPayments"],
    ["cash_receipts", "cash_receipt", "cashReceiptId", "cashReceipts"],
    ["payments", "payment", "paymentId", "payments"],
];
const expected = [...original, ...added];
const originalNames = ["search_customers", "fetch_customer", ...original.flatMap(([plural, singular]) => [`search_${plural}`, `fetch_${singular}`])];
const existingNames = ["search_customers", "fetch_customer", ...expected.flatMap(([plural, singular]) => [`search_${plural}`, `fetch_${singular}`])];
const tranchePairs = [["accruals", "accrual"], ["prepayments", "prepayment"]];
const searchOnly = ["vat_rates", "vat_categories", "analysis_categories", "nominal_accounts"];
const purposeNames = ["search_customer_transactions", "search_supplier_transactions", "get_financial_year"];
const existingMeta = [
    ["suppliers", "supplier", "suppliers", false],
    ["products", "product", "products", false],
    ["sales_invoices", "sales_invoice", "sales invoices", true],
    ["purchases", "purchase", "purchases", true],
    ["accounts", "account", "accounts", false],
    ["quotes", "quote", "quotes", true],
    ["sales_credit_notes", "sales_credit_note", "sales credit notes", true],
    ["bank_accounts", "bank_account", "bank accounts", false],
    ["cash_payments", "cash_payment", "cash payments", true],
    ["cash_receipts", "cash_receipt", "cash receipts", true],
    ["payments", "payment", "payments", true],
];
function registry() {
    const tools = new Map();
    registerCopilotDiagnosticTools({ registerTool(name, config, handler) { tools.set(name, { config, handler }); } }, true);
    return tools;
}
async function fixture(t) {
    const original = { key: process.env.RED_CONNECT_ENCRYPTION_KEY, http: process.env.RED_CONNECT_HTTP_MODE };
    process.env.RED_CONNECT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.RED_CONNECT_HTTP_MODE = "true";
    t.after(() => {
        if (original.key === undefined)
            delete process.env.RED_CONNECT_ENCRYPTION_KEY;
        else
            process.env.RED_CONNECT_ENCRYPTION_KEY = original.key;
        if (original.http === undefined)
            delete process.env.RED_CONNECT_HTTP_MODE;
        else
            process.env.RED_CONNECT_HTTP_MODE = original.http;
    });
    const a = { tenantId: randomUUID(), objectId: randomUUID() }, b = { ...a, objectId: randomUUID() }, c = { ...a, tenantId: randomUUID() };
    const store = getConnectionStore().entra;
    for (const owner of [a, b, c])
        await store.createLink(owner);
    await store.saveCompanies(a, [{ companyName: "Shared", apiKey: "owner-a-key", expiresAt: Date.now() + 600_000 }]);
    await store.saveCompanies(b, [{ companyName: "Shared", apiKey: "owner-b-key", expiresAt: Date.now() + 600_000 }]);
    const tools = registry();
    const invoke = (owner, name, input) => {
        const tool = tools.get(name);
        const args = tool.config.inputSchema.parse(input);
        return owner ? entraRequestOwner.run(owner, () => tool.handler(args)) : tool.handler(args);
    };
    return { a, b, c, store, tools, invoke };
}
const historicalCustomerDescription = "Search customers across Big Red Cloud companies linked to the signed-in Microsoft user. Supports bounded pagination.";
const historicalCustomerSchema = z.object({
    query: z.string().max(1000).describe("Customer text to match; use an empty string to list customers."),
    nextCursor: z.string().max(4096).optional().describe("Continuation returned by the previous search; keep the same query."),
}).strict();
function hashedTool(name, config) {
    return {
        name, ...config,
        ...(name === "search_customers" ? { description: historicalCustomerDescription } : {}),
        inputSchema: z.toJSONSchema(name === "search_customers" ? historicalCustomerSchema : config.inputSchema),
    };
}
test("normal 159 descriptors remain identical; Copilot advertises exactly 58 strict read-only tools", () => {
    const normal = [];
    registerAllTools({ registerTool(name, config) { normal.push({ name, ...config, inputSchema: config.inputSchema ? z.toJSONSchema(z.object(config.inputSchema)) : undefined }); }, registerResource() { }, registerPrompt() { } }, { profile: "full" });
    assert.equal(normal.length, 159);
    assert.equal(createHash("sha256").update(JSON.stringify(normal.sort((a, b) => a.name.localeCompare(b.name)))).digest("hex"), "c5e420ed1f7e9f3201fadb283b72e4b90a00eb58c64bfd641d3c8cab0d684f6f");
    const allTools = registry();
    const tools = new Map([...allTools].filter(([name]) => !COPILOT_HELP_NAMES.includes(name) && name !== "search_product_types" && name !== "get_company_management_link"));
    assert.equal(allTools.size, 58);
    assert.equal(allTools.has("get_company_management_link"), true);
    assert.equal(allTools.has("search_product_types"), true);
    for (const name of COPILOT_HELP_NAMES)
        assert.equal(allTools.has(name), true, name);
    const prior56 = [...allTools].filter(([name]) => name !== "search_product_types" && name !== "get_company_management_link").map(([name, { config }]) => hashedTool(name, config)).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(prior56.length, 56);
    assert.equal(createHash("sha256").update(JSON.stringify(prior56)).digest("hex"), "531e5ba099c0f656d321df63c893f300036338c3ae686ef307361ffd4d8e764d");
    const names = [...existingNames, ...tranchePairs.flatMap(([plural, singular]) => [`search_${plural}`, `fetch_${singular}`]), ...searchOnly.map(plural => `search_${plural}`), ...purposeNames, ...nextNames, ...finalNames, ...remainderNames, ...gapNames].sort();
    assert.equal(tools.size, 53);
    // Normalize only the intentionally changed candidate description to retain the existing 52-descriptor lock.
    const current52 = [...tools].filter(([name]) => name !== "get_allocated_transactions").map(([name, { config }]) => hashedTool(name, config)).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(current52.length, 52);
    current52.find(tool => tool.name === "get_allocation_candidates").description = "Return unmatched transactions eligible to receive an allocation from the specified sender book transaction. These are possible allocations, not allocations already applied. Requires bookTranId and companyName. Use get_allocated_transactions for existing applications. Continue with nextCursor.";
    assert.equal(createHash("sha256").update(JSON.stringify(current52)).digest("hex"), "c7191ea7f3820b7d40db9e9120ddefc115a4a3da5918617a7eb8e96bab3fa6d7");
    const current49 = [...tools].filter(([name]) => !gapNames.includes(name)).map(([name, { config }]) => hashedTool(name, config)).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(current49.length, 49);
    assert.equal(createHash("sha256").update(JSON.stringify(current49)).digest("hex"), "57b3b243870c49293ae54f45734f917db1ab382b0026bd07b1143f3a09ed3ca6");
    const current = [...tools].filter(([name]) => !remainderNames.includes(name) && !gapNames.includes(name)).map(([name, { config }]) => hashedTool(name, config)).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(current.length, 48);
    assert.equal(createHash("sha256").update(JSON.stringify(current)).digest("hex"), "0826018dac5c81ce321e65e9ad54f3f408a916274352048c71bb177eb4cfcaa2");
    const locked = [...tools].filter(([name]) => !finalNames.includes(name) && !remainderNames.includes(name) && !gapNames.includes(name)).map(([name, { config }]) => hashedTool(name, config)).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(locked.length, 43);
    assert.equal(createHash("sha256").update(JSON.stringify(locked)).digest("hex"), "c6e6860b46851bb8ae4731853f504bf8f5ab0fdd089482fd44ae26f56c5fec4b");
    const priorDescriptors = [...tools].filter(([name]) => !nextNames.includes(name) && !finalNames.includes(name) && !remainderNames.includes(name) && !gapNames.includes(name)).map(([name, { config }]) => hashedTool(name, config)).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(priorDescriptors.length, 35);
    assert.equal(createHash("sha256").update(JSON.stringify(priorDescriptors)).digest("hex"), "c87254d84410000d20aea40cb44aec236fe0d8f1675202808cfc5b5300f361ec");
    assert.deepEqual([...tools.keys()].sort(), names);
    assert.deepEqual([...COPILOT_FEDERATED_TOOL_NAMES].sort(), [...names, ...COPILOT_HELP_NAMES, "search_product_types", "get_company_management_link"].sort());
    const productTypes = allTools.get("search_product_types").config;
    assert.equal(productTypes.title, "Search Big Red Cloud product types");
    assert.match(productTypes.description, /product-type|product classifications|configured/i);
    assert.match(productTypes.description, /search_products/);
    assert.deepEqual(productTypes.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.ok(productTypes.description.length < 400);
    assert.equal(allTools.has("fetch_product_type"), false);
    assert.equal("code" in productTypes.inputSchema.shape, false);
    assert.deepEqual(Object.keys(productTypes.inputSchema.shape), ["query", "companyName", "pageSize", "nextCursor"]);
    for (const name of COPILOT_HELP_NAMES)
        assert.ok(prior56.some(tool => tool.name === name), name);
    for (const name of originalNames)
        assert.equal(tools.has(name), true, name);
    for (const name of existingNames)
        assert.equal(tools.has(name), true, name);
    assert.equal(tools.has("fetch_vat_rate"), false);
    assert.equal(tools.has("fetch_nominal_account"), true);
    for (const name of gapNames)
        assert.equal(tools.has(name), true, name);
    for (const [name, { config }] of tools) {
        assert.match(name, /^(search|fetch|get)_/);
        assert.doesNotMatch(name, /^brc_/);
        assert.ok(config.title.length > 10);
        assert.ok(config.description.length < (["get_allocation_candidates", "get_allocated_transactions"].includes(name) ? 650 : 400));
        assert.deepEqual(config.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        const schema = z.toJSONSchema(config.inputSchema);
        assert.equal(schema.additionalProperties, false);
        for (const field of ["apiKey", "connectionRef", "tenantId", "objectId", "confirmWrite", "routeToken", "filter"])
            assert.equal(field in schema.properties, false, name);
    }
    for (const name of gapNames) {
        const config = tools.get(name).config;
        assert.doesNotMatch(`${config.title}\n${config.description}`, /opening balance/i, name);
    }
    for (const [plural, singular, label, documents] of existingMeta) {
        const search = tools.get(`search_${plural}`);
        assert.equal(search.config.title, `Search Big Red Cloud ${label}`);
        assert.equal(search.config.description, `Search ${label} by text${documents ? ", transaction date or counterparty code" : " or exact code"} in linked companies. Empty query lists records. Continue with nextCursor even after an empty page.`);
        const fetchTool = tools.get(`fetch_${singular}`);
        assert.equal(fetchTool.config.title, `Fetch Big Red Cloud ${label === "purchases" ? "purchase" : label.replace(/s$/, "")}`);
    }
    const customerSearch = tools.get("search_customers").config;
    assert.ok(customerSearch.description.length < 400);
    assert.match(customerSearch.description, /customers in Company A/);
    assert.match(customerSearch.description, /companyName="Company A", query=""/);
    assert.match(customerSearch.description, /find Paul in Company C/);
    assert.match(customerSearch.description, /companyName="Company C", query="Paul"/);
    assert.match(customerSearch.description, /find customer Paul/);
    assert.match(customerSearch.description, /omit companyName/);
    assert.deepEqual(Object.keys(customerSearch.inputSchema.shape), ["query", "companyName", "nextCursor"]);
    assert.equal(customerSearch.inputSchema.safeParse({ query: "" }).success, true);
    assert.equal(customerSearch.inputSchema.safeParse({ query: "Paul", companyName: "Company C" }).success, true);
    assert.match(customerSearch.inputSchema.shape.companyName.description, /Do not put company names in `query`/);
    assert.match(customerSearch.inputSchema.shape.query.description, /Do not put the Big Red Cloud company name here/);
    assert.deepEqual(Object.keys(tools.get("fetch_customer").config.inputSchema.shape), ["customerId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("search_suppliers").config.inputSchema.shape), ["query", "companyName", "code", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("fetch_supplier").config.inputSchema.shape), ["supplierId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("search_sales_invoices").config.inputSchema.shape), ["query", "companyName", "counterpartyCode", "dateFrom", "dateTo", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("fetch_account").config.inputSchema.shape), ["accountId", "companyName", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("search_quotes").config.inputSchema.shape), ["query", "companyName", "counterpartyCode", "dateFrom", "dateTo", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("fetch_quote").config.inputSchema.shape), ["quoteId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("search_bank_accounts").config.inputSchema.shape), ["query", "companyName", "code", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("fetch_bank_account").config.inputSchema.shape), ["bankAccountId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("search_accruals").config.inputSchema.shape), ["query", "companyName", "code", "dateFrom", "dateTo", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("fetch_accrual").config.inputSchema.shape), ["accrualId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("search_vat_rates").config.inputSchema.shape), ["query", "companyName", "code", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("search_customer_transactions").config.inputSchema.shape), ["customerId", "companyName", "query", "pageSize", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("get_financial_year").config.inputSchema.shape), ["companyName"]);
    assert.deepEqual(Object.keys(tools.get("fetch_nominal_account").config.inputSchema.shape), ["nominalAccountId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("get_customer_aged_balance").config.inputSchema.shape), ["customerId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("get_supplier_aged_balance").config.inputSchema.shape), ["supplierId", "companyName"]);
    assert.deepEqual(Object.keys(tools.get("get_allocated_transactions").config.inputSchema.shape), ["bookTranId", "companyName", "nextCursor"]);
    assert.deepEqual(Object.keys(tools.get("get_allocation_candidates").config.inputSchema.shape), ["bookTranId", "companyName", "nextCursor"]);
    assert.match(tools.get("get_allocation_candidates").config.description, /unmatched|eligible|possible/i);
    assert.ok(tools.get("get_allocation_candidates").config.description.endsWith(allocationContinuation));
    assert.match(tools.get("get_allocated_transactions").config.description, /already applied/);
    assert.ok(tools.get("get_allocated_transactions").config.description.endsWith(allocationContinuation));
    assert.equal("pageSize" in tools.get("get_allocated_transactions").config.inputSchema.shape, false);
});
test("search_product_types reuses brc_list_product_types without fan-out, fetch or write tools", async (t) => {
    const f = await fixture(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString(), "owner-a-key:");
        const url = new URL(String(input));
        calls.push(url);
        return new Response(JSON.stringify({
            Items: [
                { id: 4, description: "Stock", recordTypeGroupId: 3, ApiKey: "owner-a-key", timeStamp: "opaque" },
                { id: 5, description: "Service", recordTypeGroupId: 3 },
            ],
            Count: 2,
            NextPageLink: "",
        }));
    });
    const search = (await f.invoke(f.a, "search_product_types", { query: "", companyName: "Shared" })).structuredContent;
    assert.equal(search.status, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, "/api/v1/productTypes");
    assert.equal(calls[0].searchParams.get("page"), "1");
    assert.equal(calls[0].searchParams.get("pageSize"), "20");
    assert.equal(calls[0].searchParams.get("$top"), "20");
    assert.equal(calls[0].searchParams.get("$skip"), "0");
    assert.equal(calls[0].searchParams.get("$orderby"), "id asc");
    assert.equal(calls[0].searchParams.has("$filter"), false);
    assert.equal(search.results.length, 2);
    assert.equal(search.results[0].productTypeId, "4");
    assert.equal(search.results[0].title, "Stock");
    assert.equal(search.results[0].fetchAvailable, false);
    assert.equal(search.results[0].record.recordTypeGroupId, 3);
    assert.equal(search.results[0].record.ApiKey, undefined);
    assert.equal(search.results[0].record.timeStamp, undefined);
    assert.equal(search.complete, true);
    assert.doesNotMatch(JSON.stringify(search), /owner-a-key|ApiKey|Prospect|Customer|Supplier/);
    assert.equal(f.tools.has("fetch_product_type"), false);
    for (const name of ["brc_create_product", "brc_batch_products", "brc_open_edu_admin"])
        assert.equal(f.tools.has(name), false);
    assert.equal((await f.invoke(undefined, "search_product_types", { query: "", companyName: "Shared" })).structuredContent.status, "authentication_required");
    assert.equal((await f.invoke(f.c, "search_product_types", { query: "", companyName: "Shared" })).structuredContent.status, "company_unavailable");
    assert.equal((await f.invoke(f.a, "search_product_types", { query: "", companyName: "Foreign" })).structuredContent.status, "company_unavailable");
    assert.throws(() => f.tools.get("search_product_types").config.inputSchema.parse({ query: "", companyName: "Shared", connectionRef: "foreign" }));
    assert.equal(calls.length, 1);
});
test("search_product_types pages locally with deterministic id order and owner-bound cursors", async (t) => {
    const f = await fixture(t);
    const offsets = [];
    t.mock.method(globalThis, "fetch", async (input) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/api/v1/productTypes");
        assert.equal(url.searchParams.get("$orderby"), "id asc");
        const skip = Number(url.searchParams.get("$skip"));
        offsets.push(skip);
        const remaining = Math.max(0, Math.min(2, 7 - skip));
        return new Response(JSON.stringify({
            Items: Array.from({ length: remaining }, (_, i) => ({ id: skip + i + 1, description: `Type ${skip + i + 1}` })),
            Count: 7,
            NextPageLink: "",
        }));
    });
    const args = { query: "", companyName: "Shared", pageSize: 2 };
    const first = (await f.invoke(f.a, "search_product_types", args)).structuredContent;
    assert.equal(first.status, "ok");
    assert.equal(first.results.length, 6);
    assert.equal(first.complete, false);
    assert.deepEqual(first.results.map((row) => row.productTypeId), ["1", "2", "3", "4", "5", "6"]);
    assert.deepEqual(offsets, [0, 2, 4]);
    for (const owner of [f.b, f.c])
        assert.notEqual((await f.invoke(owner, "search_product_types", { ...args, nextCursor: first.nextCursor })).structuredContent.status, "ok");
    assert.equal((await f.invoke(f.a, "search_product_types", { ...args, query: "changed", nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
    const next = (await f.invoke(f.a, "search_product_types", { ...args, nextCursor: first.nextCursor })).structuredContent;
    assert.equal(next.complete, true);
    assert.deepEqual(offsets, [0, 2, 4, 6]);
    assert.equal(new Set([...first.results, ...next.results].map((row) => row.productTypeId)).size, 7);
    const filtered = (await f.invoke(f.a, "search_product_types", { query: "Type 2", companyName: "Shared" })).structuredContent;
    assert.equal(filtered.results.length, 1);
    assert.equal(filtered.results[0].productTypeId, "2");
});
test("each new facade reuses the correct list/get endpoint, scopes credentials, and sanitizes responses", async (t) => {
    const f = await fixture(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        assert.equal(init.method ?? "GET", "GET");
        const url = new URL(String(input));
        const key = Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString().slice(0, -1);
        calls.push({ url, key });
        const row = { Id: 7, Code: "ABC", Name: `Record ${key} ${f.a.objectId}`, EntryDate: "2026-01-02", AcCode: "ABC", ApiKey: key, nested: { Token: "private", detail: "Visible" } };
        return new Response(JSON.stringify(/\/7$/.test(url.pathname) ? row : { Items: [row] }));
    });
    for (const [plural, singular, idField, path] of expected) {
        const before = calls.length;
        const search = await f.invoke(f.a, `search_${plural}`, { query: "Record", companyName: "Shared" });
        assert.equal(search.structuredContent.status, "ok", plural);
        const row = search.structuredContent.results[0];
        assert.equal(row.companyName, "Shared");
        assert.equal(row[idField], singular === "account" ? "id:7" : "7");
        assert.equal(calls.length, before + 1, `${plural} search must not fan out to per-result fetches`);
        const listCall = calls.at(-1);
        assert.equal(listCall.url.pathname, `/api/v1/${path}`);
        assert.equal(listCall.url.searchParams.get("page"), "1");
        assert.equal(listCall.url.searchParams.get("pageSize"), "20");
        assert.equal(listCall.url.searchParams.get("$top"), "20");
        assert.equal(listCall.url.searchParams.get("$skip"), "0");
        assert.equal(listCall.url.searchParams.get("$orderby"), "id asc");
        assert.equal(listCall.key, "owner-a-key");
        const fetched = await f.invoke(f.a, `fetch_${singular}`, { [idField]: row[idField], companyName: "Shared" });
        assert.equal(fetched.structuredContent.status, "ok", singular);
        assert.equal(fetched.structuredContent[singular].Id, 7);
        assert.equal(calls.at(-1).url.pathname, `/api/v1/${path}${singular === "account" ? "" : "/7"}`);
        const output = JSON.stringify([search, fetched]);
        assert.doesNotMatch(output, /owner-a-key|ApiKey|private|Token/);
        assert.equal(output.includes(f.a.objectId), false);
        assert.equal(fetched.structuredContent[singular].nested.detail, "Visible");
    }
    calls.length = 0;
    await Promise.all([f.a, f.b].map(owner => f.invoke(owner, "search_suppliers", { query: "", companyName: "Shared" })));
    assert.deepEqual(calls.map(call => call.key).sort(), ["owner-a-key", "owner-b-key"]);
});
test("new facades reject absent/foreign owners, unknown companies, credential injection and legacy session scope", async (t) => {
    const f = await fixture(t);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No IO expected"); });
    for (const [plural, singular, idField] of expected) {
        for (const [name, args] of [[`search_${plural}`, { query: "", companyName: "Shared" }], [`fetch_${singular}`, { [idField]: "7", companyName: "Shared" }]]) {
            assert.equal((await f.invoke(undefined, name, args)).structuredContent.status, "authentication_required");
            assert.equal((await f.invoke(f.c, name, args)).structuredContent.status, "company_unavailable");
            assert.equal((await f.invoke(f.a, name, { ...args, companyName: "Foreign" })).isError, true);
            assert.throws(() => f.tools.get(name).config.inputSchema.parse({ ...args, connectionRef: "foreign", tenantId: f.a.tenantId }));
        }
    }
    const legacy = await runWithHttpRequestSessionId("legacy", () => runWithSessionKeyStore(new Map(), () => f.invoke(f.a, "search_products", { query: "" })));
    assert.equal(legacy.structuredContent.status, "query_unavailable");
    assert.equal(requests, 0);
});
test("bounded search continues after empty matches and binds cursor to owner, entity, filters and connection snapshot", async (t) => {
    const f = await fixture(t);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (input) => {
        requests++;
        const url = new URL(String(input)), page = Number(url.searchParams.get("$skip")) + 1;
        return new Response(JSON.stringify({ Items: page < 4 ? [{ Id: page, Name: "Other", Code: "A" }] : [] }));
    });
    const args = { query: "needle", companyName: "Shared", pageSize: 1 };
    const first = await f.invoke(f.a, "search_products", args);
    assert.equal(requests, 3);
    assert.deepEqual(first.structuredContent.results, []);
    assert.equal(first.structuredContent.complete, false);
    const cursor = first.structuredContent.nextCursor;
    for (const [owner, tool, changed] of [
        [f.b, "search_products", args], [f.a, "search_suppliers", args],
        [f.a, "search_products", { ...args, query: "different" }],
        [f.a, "search_products", { ...args, code: "A" }],
        [f.a, "search_products", { ...args, pageSize: 2 }],
    ])
        assert.equal((await f.invoke(owner, tool, { ...changed, nextCursor: cursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await f.invoke(f.a, "search_products", { ...args, nextCursor: cursor + "tampered" })).structuredContent.status, "invalid_cursor");
    const expired = JSON.parse(decryptCredentialSecret(cursor));
    expired.exp = Date.now() - 1;
    assert.equal((await f.invoke(f.a, "search_products", { ...args, nextCursor: encryptCredentialSecret(JSON.stringify(expired)) })).structuredContent.status, "invalid_cursor");
    assert.equal(requests, 3);
    const next = await f.invoke(f.a, "search_products", { ...args, nextCursor: cursor });
    assert.equal(next.structuredContent.complete, true);
    assert.equal(requests, 4);
    await f.store.saveCompanies(f.a, [{ companyName: "Shared", apiKey: "replacement", expiresAt: Date.now() + 700_000 }]);
    assert.equal((await f.invoke(f.a, "search_products", { ...args, nextCursor: cursor })).structuredContent.status, "invalid_cursor");
    assert.equal(requests, 4);
});
test("search filters are explicit, local, case-insensitive and date-inclusive; bad ranges fail before IO", async (t) => {
    const f = await fixture(t);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (input) => {
        requests++;
        assert.equal(new URL(String(input)).searchParams.has("$filter"), false);
        return new Response(JSON.stringify({ Items: [
                { Id: 1, Code: "ABC", Reference: "Wanted", AcCode: "C01", EntryDate: "2026-01-02T12:00:00" },
                { Id: 2, Code: "XYZ", Reference: "Wanted", AcCode: "C01", EntryDate: "2026-01-03" },
                { Id: 3, Code: "ABC", Reference: "Other", AcCode: "C02", EntryDate: "2026-01-02" },
            ] }));
    });
    const invoice = await f.invoke(f.a, "search_sales_invoices", { query: "wanted", counterpartyCode: "c01", dateFrom: "2026-01-02", dateTo: "2026-01-02" });
    assert.deepEqual(invoice.structuredContent.results.map((row) => row.salesInvoiceId), ["1"]);
    const product = await f.invoke(f.a, "search_products", { query: "wanted", code: "abc" });
    assert.deepEqual(product.structuredContent.results.map((row) => row.productId), ["1"]);
    assert.equal((await f.invoke(f.a, "search_purchases", { query: "", dateFrom: "2026-02-01", dateTo: "2026-01-01" })).structuredContent.status, "invalid_request");
    assert.equal(requests, 2);
    assert.throws(() => f.tools.get("search_purchases").config.inputSchema.parse({ query: "", dateFrom: "2026-02-30" }));
});
test("accounts fetch uses exact stable IDs/codes, bounded list continuation, and never invents a get endpoint", async (t) => {
    const f = await fixture(t);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (input) => {
        requests++;
        const url = new URL(String(input));
        assert.equal(url.pathname, "/api/v1/accounts");
        const page = Number(url.searchParams.get("$skip")) / 50 + 1;
        const rows = page < 4 ? Array.from({ length: 50 }, (_, index) => ({ Id: (page - 1) * 50 + index + 1, Code: "OTHER" })) : [{ Code: "TARGET", Name: "Account" }];
        return new Response(JSON.stringify({ Items: rows }));
    });
    const args = { companyName: "Shared", accountId: "code:TARGET" };
    const first = await f.invoke(f.a, "fetch_account", args);
    assert.equal(first.structuredContent.status, "incomplete");
    assert.equal(requests, 3);
    const nextCursor = first.structuredContent.nextCursor;
    assert.equal((await f.invoke(f.b, "fetch_account", { ...args, nextCursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await f.invoke(f.a, "fetch_account", { ...args, accountId: "id:2", nextCursor })).structuredContent.status, "invalid_cursor");
    assert.equal(requests, 3);
    const result = await f.invoke(f.a, "fetch_account", { ...args, nextCursor });
    assert.equal(result.structuredContent.account.Code, "TARGET");
    assert.equal(result.structuredContent.status, "ok");
    const notFound = await f.invoke(f.a, "fetch_account", { companyName: "Shared", accountId: "code:MISSING", nextCursor: undefined });
    const completed = await f.invoke(f.a, "fetch_account", { companyName: "Shared", accountId: "code:MISSING", nextCursor: notFound.structuredContent.nextCursor });
    assert.equal(completed.structuredContent.status, "not_found");
});
test("mismatched records, upstream errors and partial company failures never become successful fetches or secret-bearing errors", async (t) => {
    const f = await fixture(t);
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ Id: 999, error: "owner-a-key" })));
    assert.equal((await f.invoke(f.a, "fetch_supplier", { companyName: "Shared", supplierId: "7" })).isError, true);
    const partial = await f.invoke(f.a, "search_suppliers", { query: "" });
    assert.equal(partial.structuredContent.status, "partial_failure");
    assert.deepEqual(partial.structuredContent.unavailableCompanies, ["Shared"]);
    assert.equal(partial.structuredContent.complete, true);
    assert.equal(partial.structuredContent.nextCursor, undefined);
    assert.doesNotMatch(JSON.stringify(partial), /owner-a-key/);
});
for (const [plural, , idField] of expected) {
    test(`${plural} advances OData offsets across continuations without repeated records`, async (t) => {
        const f = await fixture(t);
        const offsets = [];
        t.mock.method(globalThis, "fetch", async (input) => {
            const url = new URL(String(input));
            const skip = Number(url.searchParams.get("$skip"));
            offsets.push(skip);
            assert.equal(url.searchParams.get("$top"), "2");
            return new Response(JSON.stringify({ Items: Array.from({ length: Math.max(0, Math.min(2, 7 - skip)) }, (_, i) => ({ Id: skip + i + 1, Name: "Summary", Code: "Code" })), Count: null, NextPageLink: null }));
        });
        const first = (await f.invoke(f.a, `search_${plural}`, { query: "", pageSize: 2 })).structuredContent;
        const next = (await f.invoke(f.a, `search_${plural}`, { query: "", pageSize: 2, nextCursor: first.nextCursor })).structuredContent;
        const rows = [...first.results, ...next.results];
        assert.equal(rows.length, 7);
        assert.equal(new Set(rows.map(row => row[idField])).size, 7);
        assert.deepEqual(offsets, [0, 2, 4, 6]);
        assert.equal(next.complete, true);
    });
    test(`${plural} stops an upstream that ignores offsets without repeating its first page`, async (t) => {
        const f = await fixture(t);
        let calls = 0;
        t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ Items: [{ Id: 1 }, { Id: 2 }], NextPageLink: "https://untrusted.invalid/next" })); });
        const result = (await f.invoke(f.a, `search_${plural}`, { query: "", pageSize: 2 })).structuredContent;
        assert.equal(calls, 2);
        assert.equal(result.results.length, 2);
        assert.equal(result.complete, false);
        assert.equal(result.nextCursor, undefined);
        assert.equal(result.paginationWarnings[0].reason, "pagination_stalled");
    });
}
test("quote, credit-note and bank-account search keep lightweight identifying fields without detail requests", async (t) => {
    const f = await fixture(t);
    const paths = [];
    t.mock.method(globalThis, "fetch", async (input) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        if (url.pathname.endsWith("/quotes"))
            return new Response(JSON.stringify({ Items: [{ Id: 9, Reference: "Q-9", AcCode: "C01", EntryDate: "2026-03-01", Total: 120, Comments: "Kitchen quote", customerOwnerName: "Ada", ApiKey: "secret", productTrans: [{ private: "omit" }] }] }));
        if (url.pathname.endsWith("/salesCreditNotes"))
            return new Response(JSON.stringify({ Items: [{ Id: 8, Reference: "CN-8", AcCode: "C01", EntryDate: "2026-03-02", Total: 15, Unpaid: 15, Note: "Return", lineItems: [{ private: "omit" }] }] }));
        if (url.pathname.endsWith("/bankAccounts"))
            return new Response(JSON.stringify({ Items: [{ Id: 3, AcCode: "1603", Details: "Current account", Balance: 500, internationalBankAccountNumber: "secret-iban" }] }));
        if (url.pathname.endsWith("/cashPayments"))
            return new Response(JSON.stringify({ Items: [{ Id: 4, AcCode: "S01", EntryDate: "2026-03-03", Total: 40, Note: "Supplier paid", bankAccountCode: "1603" }] }));
        if (url.pathname.endsWith("/cashReceipts"))
            return new Response(JSON.stringify({ Items: [{ Id: 5, AcCode: "C01", EntryDate: "2026-03-04", Total: 25, Note: "Customer receipt", Unallocated: 5 }] }));
        if (url.pathname.endsWith("/payments"))
            return new Response(JSON.stringify({ Items: [{ Id: 6, AcCode: "S01", Reference: "CHQ-6", EntryDate: "2026-03-05", Total: 80, bankAccountCode: "1603", Note: "Cheque" }] }));
        throw new Error(url.pathname);
    });
    const quote = (await f.invoke(f.a, "search_quotes", { query: "Kitchen", companyName: "Shared" })).structuredContent;
    assert.equal(quote.results[0].title, "Kitchen quote");
    assert.deepEqual(quote.results[0].record, { Id: 9, Reference: "Q-9", AcCode: "C01", EntryDate: "2026-03-01", Total: 120, Comments: "Kitchen quote", customerOwnerName: "Ada" });
    const credit = (await f.invoke(f.a, "search_sales_credit_notes", { query: "Return", companyName: "Shared" })).structuredContent;
    assert.equal(credit.results[0].salesCreditNoteId, "8");
    assert.equal(credit.results[0].record.Unpaid, 15);
    const bank = (await f.invoke(f.a, "search_bank_accounts", { query: "Current", code: "1603", companyName: "Shared" })).structuredContent;
    assert.equal(bank.results[0].title, "Current account");
    assert.deepEqual(bank.results[0].record, { Id: 3, AcCode: "1603", Details: "Current account", Balance: 500 });
    const payment = (await f.invoke(f.a, "search_cash_payments", { query: "Supplier", counterpartyCode: "s01", companyName: "Shared" })).structuredContent;
    assert.equal(payment.results[0].cashPaymentId, "4");
    assert.equal(payment.results[0].record.bankAccountCode, "1603");
    const receipt = (await f.invoke(f.a, "search_cash_receipts", { query: "receipt", dateFrom: "2026-03-04", dateTo: "2026-03-04", companyName: "Shared" })).structuredContent;
    assert.equal(receipt.results[0].record.Unallocated, 5);
    const cheque = (await f.invoke(f.a, "search_payments", { query: "Cheque", companyName: "Shared" })).structuredContent;
    assert.equal(cheque.results[0].title, "Cheque");
    assert.deepEqual(paths, ["/api/v1/quotes", "/api/v1/salesCreditNotes", "/api/v1/bankAccounts", "/api/v1/cashPayments", "/api/v1/cashReceipts", "/api/v1/payments"]);
});
test("product search retains and searches lightweight list details without detail requests", async (t) => {
    const f = await fixture(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input) => {
        calls++;
        assert.equal(new URL(String(input)).pathname, "/api/v1/products");
        return new Response(JSON.stringify({ Items: [{ id: 5023355, stockCode: "DEMO", unitPrice: 12.5, grossUnitPrice: false, details: ["Demo Product 1"], ApiKey: "secret", lineItems: [{ private: "omit" }] }] }));
    });
    const result = (await f.invoke(f.a, "search_products", { query: "Demo Product", code: "demo" })).structuredContent;
    assert.equal(calls, 1);
    assert.equal(result.results[0].title, "Demo Product 1");
    assert.deepEqual(result.results[0].record, { id: 5023355, stockCode: "DEMO", unitPrice: 12.5, grossUnitPrice: false, details: ["Demo Product 1"] });
});
test("customer continuation uses offsets and stops a stalled backend", async (t) => {
    const f = await fixture(t);
    const offsets = [];
    let stalled = false;
    t.mock.method(globalThis, "fetch", async (input) => {
        const url = new URL(String(input));
        const skip = Number(url.searchParams.get("$skip"));
        offsets.push(skip);
        assert.equal(url.searchParams.get("$top"), "20");
        return new Response(JSON.stringify({ Items: Array.from({ length: stalled ? 20 : Math.max(0, Math.min(20, 65 - skip)) }, (_, i) => ({ Id: (stalled ? 0 : skip) + i + 1, Name: "Customer", AcCode: "C001" })) }));
    });
    const first = (await f.invoke(f.a, "search_customers", { query: "" })).structuredContent;
    const next = (await f.invoke(f.a, "search_customers", { query: "", nextCursor: first.nextCursor })).structuredContent;
    const rows = [...first.companies, ...next.companies].flatMap(group => group.customers);
    assert.equal(rows.length, 65);
    assert.equal(new Set(rows.map(row => row.Id)).size, 65);
    assert.deepEqual(offsets, [0, 20, 40, 60]);
    stalled = true;
    offsets.length = 0;
    const stopped = (await f.invoke(f.a, "search_customers", { query: "" })).structuredContent;
    assert.deepEqual(offsets, [0, 20]);
    assert.equal(stopped.complete, false);
    assert.equal(stopped.nextCursor, undefined);
    assert.equal(stopped.companies.flatMap((group) => group.customers).length, 20);
});
test("account fetch terminates an ignored offset without claiming not found", async (t) => {
    const f = await fixture(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ Items: Array.from({ length: 50 }, (_, i) => ({ Id: i + 1 })) })); });
    const result = await f.invoke(f.a, "fetch_account", { companyName: "Shared", accountId: "id:999" });
    assert.equal(result.structuredContent.status, "pagination_stalled");
    assert.equal(calls, 2);
    assert.equal(result.isError, true);
});
test("empty final pages complete without stalling", async (t) => {
    const f = await fixture(t);
    const offsets = [];
    t.mock.method(globalThis, "fetch", async (input) => {
        const skip = Number(new URL(String(input)).searchParams.get("$skip"));
        offsets.push(skip);
        const items = skip === 0 ? [{ Id: 1, Name: "Item", Code: "X" }, { Id: 2, Name: "Item", Code: "X" }] : [];
        return new Response(JSON.stringify({ Items: items }));
    });
    const result = (await f.invoke(f.a, "search_suppliers", { query: "", pageSize: 2 })).structuredContent;
    assert.deepEqual(result.results.map((row) => row.supplierId), ["1", "2"]);
    assert.deepEqual(offsets, [0, 2]);
    assert.equal(result.complete, true);
    assert.equal(result.nextCursor, undefined);
    assert.deepEqual(result.paginationWarnings, []);
});
test("maximum-sized continuation remains accepted and detects repetition across calls", async (t) => {
    const f = await fixture(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
        const start = Math.min(calls++, 2) * 50;
        return new Response(JSON.stringify({ Items: Array.from({ length: 50 }, (_, i) => ({ Id: start + i + 1, Name: "Account summary" })) }));
    });
    const args = { query: "x".repeat(1000), pageSize: 50 };
    const first = (await f.invoke(f.a, "search_accounts", args)).structuredContent;
    assert.ok(first.nextCursor.length <= 4096);
    const next = (await f.invoke(f.a, "search_accounts", { ...args, nextCursor: first.nextCursor })).structuredContent;
    assert.equal(calls, 4);
    assert.equal(next.nextCursor, undefined);
    assert.equal(next.complete, false);
    assert.equal(next.paginationWarnings[0].reason, "pagination_stalled");
});
test("tranche wrappers reuse the audited list/get handlers without fetch fan-out", async (t) => {
    const f = await fixture(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        assert.equal(init.method ?? "GET", "GET");
        const url = new URL(String(input));
        const key = Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString().slice(0, -1);
        calls.push({ url, key });
        if (url.pathname.endsWith("/accountTrans")) {
            return new Response(JSON.stringify({ Items: [
                    { Id: 1, BookTranId: 11, Reference: "INV-1", Debit: 50, Credit: 0, BookTypeDesc: "Sales Invoice", ApiKey: key },
                    { Id: 2, BookTranId: 12, Reference: "REC-2", Debit: 0, Credit: 50, BookTypeDesc: "Cash Receipt" },
                ] }));
        }
        if (url.pathname.includes("getFinancialYear"))
            return new Response(JSON.stringify({ yearStart: "2026-01-01", yearEnd: "2026-12-31", ApiKey: key }));
        const row = { Id: 7, Code: "ABC", Name: "Rate 23", Percentage: 23, vatCategoryId: 1, AcCode: "4000", oBalance: 10, firstDetail: "March rent", EntryDate: "2026-03-01", Month1: 99, month2: 5, ApiKey: key };
        return new Response(JSON.stringify(/\/7$/.test(url.pathname) ? row : { Items: [row] }));
    });
    for (const [plural, singular, path, idField] of [
        ["accruals", "accrual", "accruals", "accrualId"],
        ["prepayments", "prepayment", "prepayments", "prepaymentId"],
    ]) {
        const before = calls.length;
        const search = await f.invoke(f.a, `search_${plural}`, { query: "rent", companyName: "Shared" });
        assert.equal(search.structuredContent.status, "ok", plural);
        assert.equal(search.structuredContent.results[0][idField], "7");
        assert.equal(search.structuredContent.results[0].fetchAvailable, true);
        assert.equal(search.structuredContent.results[0].record.Month1, undefined);
        assert.equal(search.structuredContent.results[0].record.firstDetail, "March rent");
        assert.equal(calls.length, before + 1, `${plural} search must not fan out`);
        assert.equal(calls.at(-1).url.pathname, `/api/v1/${path}`);
        assert.equal(calls.at(-1).url.searchParams.get("$top"), "20");
        assert.equal(calls.at(-1).url.searchParams.get("$skip"), "0");
        assert.equal(calls.at(-1).url.searchParams.has("page"), false);
        const fetched = await f.invoke(f.a, `fetch_${singular}`, { [idField]: "7", companyName: "Shared" });
        assert.equal(fetched.structuredContent.status, "ok", singular);
        assert.equal(fetched.structuredContent[singular].Id, 7);
        assert.equal(calls.at(-1).url.pathname, `/api/v1/${path}/7`);
    }
    for (const [plural, path, idField] of [
        ["vat_rates", "vatRates", "vatRateId"],
        ["vat_categories", "vatCategories", "vatCategoryId"],
        ["analysis_categories", "analysisCategories", "analysisCategoryId"],
        ["nominal_accounts", "nominalAccounts", "nominalAccountId"],
    ]) {
        const before = calls.length;
        const search = await f.invoke(f.a, `search_${plural}`, { query: "", companyName: "Shared" });
        assert.equal(search.structuredContent.status, "ok", plural);
        assert.equal(search.structuredContent.results[0][idField], "7");
        assert.equal(search.structuredContent.results[0].fetchAvailable, plural === "nominal_accounts");
        assert.equal(search.structuredContent.results[0].record.month2, undefined);
        assert.equal(calls.length, before + 1, `${plural} search must not fan out`);
        assert.equal(calls.at(-1).url.pathname, `/api/v1/${path}`);
        if (plural !== "nominal_accounts")
            assert.equal(toolsMissingFetch(f.tools, plural), true);
    }
    const fetchedNominal = await f.invoke(f.a, "fetch_nominal_account", { nominalAccountId: "7", companyName: "Shared" });
    assert.equal(fetchedNominal.structuredContent.status, "ok");
    assert.equal(fetchedNominal.structuredContent.nominal_account.Id, 7);
    assert.equal(fetchedNominal.structuredContent.nominal_account.month2, 5);
    assert.equal(calls.at(-1).url.pathname, "/api/v1/nominalAccounts/7");
    const ledger = await f.invoke(f.a, "search_customer_transactions", { customerId: "42", companyName: "Shared" });
    assert.equal(ledger.structuredContent.status, "ok");
    assert.equal(ledger.structuredContent.results.length, 2);
    assert.equal(ledger.structuredContent.results[0].fetchAvailable, false);
    assert.equal(ledger.structuredContent.results[0].bookTranId, "11");
    assert.equal(calls.filter(call => call.url.pathname === "/api/v1/customers/42/accountTrans").length, 1);
    const year = await f.invoke(f.a, "get_financial_year", { companyName: "Shared" });
    assert.equal(year.structuredContent.status, "ok");
    assert.equal(year.structuredContent.financial_year.yearStart, "2026-01-01");
    assert.doesNotMatch(JSON.stringify([ledger, year]), /owner-a-key|ApiKey/);
    function toolsMissingFetch(tools, plural) {
        return !tools.has(`fetch_${plural.replace(/s$/, "")}`) && !tools.has(`fetch_${plural.slice(0, -1)}`);
    }
});
test("tranche tools stay owner-scoped and reject credential injection", async (t) => {
    const f = await fixture(t);
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No IO expected"); });
    for (const [name, args] of [
        ["search_accruals", { query: "", companyName: "Shared" }],
        ["fetch_accrual", { accrualId: "7", companyName: "Shared" }],
        ["search_vat_rates", { query: "", companyName: "Shared" }],
        ["search_customer_transactions", { customerId: "42", companyName: "Shared" }],
        ["search_supplier_transactions", { supplierId: "9", companyName: "Shared" }],
        ["get_financial_year", { companyName: "Shared" }],
        ["fetch_nominal_account", { nominalAccountId: "7", companyName: "Shared" }],
        ["get_customer_aged_balance", { customerId: "42", companyName: "Shared" }],
        ["get_supplier_aged_balance", { supplierId: "9", companyName: "Shared" }],
        ["get_allocated_transactions", { bookTranId: "1001", companyName: "Shared" }],
        ["get_allocation_candidates", { bookTranId: "1001", companyName: "Shared" }],
    ]) {
        assert.equal((await f.invoke(undefined, name, args)).structuredContent.status, "authentication_required");
        assert.equal((await f.invoke(f.c, name, args)).structuredContent.status, "company_unavailable");
        assert.equal((await f.invoke(f.a, name, { ...args, companyName: "Foreign" })).isError, true);
        assert.throws(() => f.tools.get(name).config.inputSchema.parse({ ...args, connectionRef: "foreign", tenantId: f.a.tenantId }));
    }
    assert.equal(requests, 0);
});
test("accrual and VAT searches advance OData offsets; customer ledgers page locally from one GET", async (t) => {
    const f = await fixture(t);
    const offsets = [];
    t.mock.method(globalThis, "fetch", async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/accruals") || url.pathname.endsWith("/vatRates")) {
            const skip = Number(url.searchParams.get("$skip"));
            offsets.push(skip);
            assert.equal(url.searchParams.get("$top"), "2");
            return new Response(JSON.stringify({ Items: Array.from({ length: Math.max(0, Math.min(2, 7 - skip)) }, (_, i) => ({ Id: skip + i + 1, Name: "Row", Code: "X" })) }));
        }
        if (url.pathname.endsWith("/accountTrans")) {
            offsets.push(-1);
            return new Response(JSON.stringify({ Items: Array.from({ length: 7 }, (_, i) => ({ Id: i + 1, BookTranId: i + 1, Reference: `INV-${i + 1}`, Debit: i + 1 })) }));
        }
        throw new Error(url.pathname);
    });
    const first = (await f.invoke(f.a, "search_accruals", { query: "", pageSize: 2 })).structuredContent;
    const next = (await f.invoke(f.a, "search_accruals", { query: "", pageSize: 2, nextCursor: first.nextCursor })).structuredContent;
    assert.equal([...first.results, ...next.results].length, 7);
    assert.deepEqual(offsets, [0, 2, 4, 6]);
    offsets.length = 0;
    const vatFirst = (await f.invoke(f.a, "search_vat_rates", { query: "", pageSize: 2 })).structuredContent;
    const vatNext = (await f.invoke(f.a, "search_vat_rates", { query: "", pageSize: 2, nextCursor: vatFirst.nextCursor })).structuredContent;
    assert.equal([...vatFirst.results, ...vatNext.results].length, 7);
    offsets.length = 0;
    const ledgerFirst = (await f.invoke(f.a, "search_customer_transactions", { customerId: "42", companyName: "Shared", pageSize: 4 })).structuredContent;
    const ledgerNext = (await f.invoke(f.a, "search_customer_transactions", { customerId: "42", companyName: "Shared", pageSize: 4, nextCursor: ledgerFirst.nextCursor })).structuredContent;
    assert.equal(ledgerFirst.results.length, 4);
    assert.equal([...ledgerFirst.results, ...ledgerNext.results].length, 7);
    assert.equal(new Set([...ledgerFirst.results, ...ledgerNext.results].map((row) => row.bookTranId)).size, 7);
    assert.deepEqual(offsets, [-1, -1]);
    assert.equal(ledgerNext.complete, true);
    assert.equal((await f.invoke(f.b, "search_customer_transactions", { customerId: "42", companyName: "Shared", pageSize: 4, nextCursor: ledgerFirst.nextCursor })).structuredContent.status, "invalid_cursor");
});
for (const [tool, args, path, idField] of [
    ["search_nominal_accounts", { query: "", companyName: "Shared" }, "/api/v1/nominalAccounts", "nominalAccountId"],
    ["search_customer_transactions", { customerId: "26540869", companyName: "Shared" }, "/api/v1/customers/26540869/accountTrans", "bookTranId"],
    ["search_supplier_transactions", { supplierId: "987", companyName: "Shared" }, "/api/v1/suppliers/987/accountTrans", "bookTranId"],
]) {
    test(`${tool} accepts bare API arrays through the real RED handler and preserves exact arguments`, async (t) => {
        const f = await fixture(t);
        let calls = 0;
        t.mock.method(globalThis, "fetch", async (input, init) => {
            calls++;
            const url = new URL(String(input));
            assert.equal(url.pathname, path);
            assert.equal(init.method ?? "GET", "GET");
            if (tool === "search_nominal_accounts") {
                assert.equal(url.searchParams.get("$skip"), "0");
                assert.equal(url.searchParams.get("$top"), "20");
            }
            else
                assert.equal(url.search, "", "itemId belongs in the path; ledger endpoint has no paging arguments");
            return new Response(JSON.stringify([{ Id: 7, BookTranId: 11, Code: "4000", Name: "Sales", Debit: 50, ApiKey: "owner-a-key" }]));
        });
        const result = (await f.invoke(f.a, tool, args)).structuredContent;
        assert.equal(result.status, "ok");
        assert.equal(calls, 1);
        assert.equal(result.results[0][idField], tool === "search_nominal_accounts" ? "7" : "11");
        assert.equal(result.results[0].record.Name, "Sales");
        assert.equal(result.results[0].fetchAvailable, tool === "search_nominal_accounts");
        assert.doesNotMatch(JSON.stringify(result), /owner-a-key|connectionStatus|connectionRef|ApiKey/);
    });
    test(`${tool} rejects genuine upstream failures and malformed collections`, async (t) => {
        const f = await fixture(t);
        for (const payload of [null, { result: "not a collection" }, { result: [null] }, { result: { error: "owner-a-key" } }]) {
            t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload)));
            const result = await f.invoke(f.a, tool, args);
            assert.equal(result.structuredContent.status, tool === "search_nominal_accounts" ? "partial_failure" : "query_unavailable");
            assert.doesNotMatch(JSON.stringify(result), /owner-a-key/);
        }
        t.mock.method(globalThis, "fetch", async () => new Response("owner-a-key", { status: 500 }));
        const result = await f.invoke(f.a, tool, args);
        assert.equal(result.structuredContent.status, tool === "search_nominal_accounts" ? "partial_failure" : "query_unavailable");
        assert.doesNotMatch(JSON.stringify(result), /owner-a-key/);
    });
}
// Official v1 Swagger declares bare arrays for nominalAccounts and both accountTrans endpoints.
// https://app.bigredcloud.com/api/swagger/docs/v1
for (const party of ["customer", "supplier"]) {
    test(`${party} ledger documented arrays retain local continuation, filtering and owner binding`, async (t) => {
        const f = await fixture(t);
        let calls = 0;
        t.mock.method(globalThis, "fetch", async (input) => {
            calls++;
            assert.equal(new URL(String(input)).pathname, `/api/v1/${party}s/26540869/accountTrans`);
            return new Response(JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ id: i + 1, bookTranId: i + 11, bookTranTypeId: 0, bookTransactionReference: "O/Bal", bookTypeDesc: "Opening Balance", credit: 0, debit: 30, procDate: "2012-12-31T00:00:00" }))));
        });
        const args = { companyName: "Shared", [`${party}Id`]: "26540869", query: "Opening", pageSize: 4 };
        const first = (await f.invoke(f.a, `search_${party}_transactions`, args)).structuredContent;
        const second = (await f.invoke(f.a, `search_${party}_transactions`, { ...args, nextCursor: first.nextCursor })).structuredContent;
        assert.equal(calls, 2, "one list GET per invocation, no per-result fetches");
        assert.equal(first.results.length, 4);
        assert.equal(second.results.length, 3);
        assert.equal(second.complete, true);
        assert.equal(new Set([...first.results, ...second.results].map(row => row.bookTranId)).size, 7);
        assert.equal(second.results[0].record.debit, 30);
        assert.equal((await f.invoke(f.b, `search_${party}_transactions`, { ...args, nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
        assert.equal(calls, 2);
        t.mock.method(globalThis, "fetch", async () => new Response("[]"));
        const empty = (await f.invoke(f.a, `search_${party}_transactions`, args)).structuredContent;
        assert.equal(empty.status, "ok");
        assert.deepEqual(empty.results, []);
        assert.equal(empty.complete, true);
        t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(Array.from({ length: 2001 }, () => ({ id: 1 })))));
        assert.equal((await f.invoke(f.a, `search_${party}_transactions`, args)).structuredContent.status, "query_unavailable");
    });
}
test("nominal documented arrays preserve OData paging and local code filtering", async (t) => {
    const f = await fixture(t);
    const offsets = [];
    t.mock.method(globalThis, "fetch", async (input) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/api/v1/nominalAccounts");
        assert.equal(url.searchParams.has("$filter"), false, "nominal API forbids filtering");
        assert.equal(url.searchParams.get("$orderby"), "id asc");
        assert.equal(url.searchParams.get("$top"), "2");
        const skip = Number(url.searchParams.get("$skip"));
        offsets.push(skip);
        return new Response(JSON.stringify(Array.from({ length: Math.max(0, Math.min(2, 7 - skip)) }, (_, i) => ({ id: skip + i + 1, code: String(skip + i), description: "SALES", balance: 0, oBalance: 0, month1: 10, group: "Sales", type: "Profit and Loss" }))));
    });
    const args = { query: "", code: "6", pageSize: 2 };
    const first = (await f.invoke(f.a, "search_nominal_accounts", args)).structuredContent;
    assert.deepEqual(first.results, []);
    const next = (await f.invoke(f.a, "search_nominal_accounts", { ...args, nextCursor: first.nextCursor })).structuredContent;
    assert.deepEqual(offsets, [0, 2, 4, 6]);
    assert.equal(next.complete, true);
    assert.equal(next.results[0].record.description, "SALES");
    assert.equal(next.results[0].record.month1, undefined);
    assert.equal(next.results[0].nominalAccountId, "7");
    t.mock.method(globalThis, "fetch", async () => new Response("[]"));
    const empty = (await f.invoke(f.a, "search_nominal_accounts", args)).structuredContent;
    assert.equal(empty.status, "ok");
    assert.deepEqual(empty.results, []);
    assert.equal(empty.complete, true);
});
// Full documented NominalAccountDto; no fabricated Name/AcCode/Percentage fields.
const nominalDto = (id) => ({ id, accountGroupId: 13, code: String(id).padStart(3, "0"), description: "SALES", companyId: 0, timeStamp: "QUFBQUFBQUFDcXc9", balance: 0, oBalance: 0, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`month${i + 1}`, 0])), group: "Sales", type: "Profit and Loss" });
test("nominal normal handler and Copilot accept the same complete Swagger DTO page", async (t) => {
    const f = await fixture(t);
    let normal;
    registerListTools({ tool(name, _description, schema, handler) { if (name === "brc_list_nominal_accounts")
            normal = { schema: z.object(schema), handler }; } });
    const rows = Array.from({ length: 19 }, (_, i) => nominalDto(i + 1));
    const urls = [];
    t.mock.method(globalThis, "fetch", async (input) => { urls.push(String(input)); return new Response(JSON.stringify(rows)); });
    const args = normal.schema.parse({ companyName: "Shared", page: 1, pageSize: 20, top: 20, skip: 0, orderBy: "id asc" });
    const raw = await runWithSessionKeyStore(new Map([["shared", { companyName: "Shared", apiKey: "owner-a-key", expiresAt: Date.now() + 600_000 }]]), () => normal.handler(args));
    const parsed = JSON.parse(raw.content[0].text);
    assert.deepEqual(parsed.result, rows);
    assert.equal(parsed.connectionStatus, "active");
    const result = (await f.invoke(f.a, "search_nominal_accounts", { query: "", companyName: "Shared" })).structuredContent;
    assert.equal(result.status, "ok");
    assert.equal(result.results.length, 19);
    assert.equal(result.results[0].nominalAccountId, "1");
    assert.equal(result.results[0].title, "SALES");
    assert.equal(result.complete, true);
    assert.equal(urls[0], urls[1], "same API arguments through both handlers");
});
test("nominal oversized dump is locally paged without marking the company unavailable", async (t) => {
    const f = await fixture(t);
    let normal;
    registerListTools({ tool(name, _description, schema, handler) { if (name === "brc_list_nominal_accounts")
            normal = { schema: z.object(schema), handler }; } });
    const rows = Array.from({ length: 72 }, (_, i) => nominalDto(i + 1));
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(rows)));
    const raw = await runWithSessionKeyStore(new Map([["shared", { companyName: "Shared", apiKey: "owner-a-key", expiresAt: Date.now() + 600_000 }]]), () => normal.handler(normal.schema.parse({ companyName: "Shared", top: 20, skip: 0, orderBy: "id asc" })));
    assert.equal(JSON.parse(raw.content[0].text).result.length, 72);
    const args = { query: "", companyName: "Shared" };
    const first = (await f.invoke(f.a, "search_nominal_accounts", args)).structuredContent;
    assert.equal(first.status, "ok");
    assert.deepEqual(first.unavailableCompanies, []);
    assert.equal(first.results.length, 60);
    assert.equal(first.results[0].nominalAccountId, "1");
    assert.equal(first.results[59].nominalAccountId, "60");
    assert.equal(first.complete, false);
    assert.equal(first.nominalFailures, undefined);
    const next = (await f.invoke(f.a, "search_nominal_accounts", { ...args, nextCursor: first.nextCursor })).structuredContent;
    assert.equal(next.status, "ok");
    assert.equal(next.results.length, 12);
    assert.equal(next.results[0].nominalAccountId, "61");
    assert.equal(next.complete, true);
    assert.equal(next.nextCursor, undefined);
});
test("nominal diagnostics distinguish upstream failures without echoing raw errors or accounts", async (t) => {
    const f = await fixture(t);
    t.mock.method(globalThis, "fetch", async () => new Response("owner-a-key secret account values", { status: 500 }));
    const result = (await f.invoke(f.a, "search_nominal_accounts", { query: "" })).structuredContent;
    assert.equal(result.nominalFailures[0].stage, "handler");
    assert.equal(result.nominalFailures[0].reason, "upstream_request_failed");
    assert.doesNotMatch(JSON.stringify(result), /owner-a-key|secret account values/);
    t.mock.method(globalThis, "fetch", async () => { throw new Error("owner-a-key private network details"); });
    const unknown = (await f.invoke(f.a, "search_nominal_accounts", { query: "" })).structuredContent;
    assert.equal(unknown.nominalFailures[0].reason, "unclassified_failure");
    assert.doesNotMatch(JSON.stringify(unknown), /owner-a-key|private network/);
    const other = (await f.invoke(f.a, "search_suppliers", { query: "" })).structuredContent;
    assert.equal(other.nominalFailures, undefined);
});
// Selected from https://app.bigredcloud.com/api/swagger/docs/v1; intentionally include
// heavy journal lines to prove search projections do not return them.
function nextTrancheRow(path) {
    if (path === "salesEntries")
        return { id: 7, customerId: 70583, reference: "000001", details: "Sales entry", note: "Customer 1", acCode: "C001", entryDate: "2024-01-15", total: 700, totalNet: 636.36, totalVAT: 63.64, acEntries: [{ id: 1, value: 636.36 }], vatEntries: [{ id: 2, amount: 63.64 }], customFields: [{ id: 3, value: "detail" }], description: "Sales entry" };
    if (path === "ownerTypes")
        return { id: 1, description: "Prospect", recordTypeGroupId: 1 };
    if (path === "ownerTypeGroups")
        return { id: 1, description: "Customer" };
    if (path === "userDefinedFields")
        return { id: 1, description: "acudf_1_1", orderIndex: 1, categoryTypeId: 19 };
    if (path === "salesReps")
        return { id: 7, code: "SR0001", name: "Sales Rep 1", phone: "1234567890", email: "example@example.test", companyId: 123456, timeStamp: "opaque" };
    if (path === "nominalJournalBatches")
        return { id: 7, bookTranTypeId: 7, entryDate: "2024-01-15T00:00:00", procDate: "2024-01-15T00:00:00", total: 100, timestamp: "opaque", accountTransactions: [{ id: 1, acCode: "400", description: "Sales", reference: "NJ0001", debit: 100, credit: 0 }] };
    if (path === "vatTypes")
        return { id: 7, description: "VAT Exempt", code: "X", isOnlyZero: true, isNotApplicable: false };
    if (path === "vatAnalysisTypes")
        return { id: 0, description: "None" };
    if (path === "categoryTypes")
        return { id: 17, description: "Cash Receipts" };
    return { id: 1, description: "Cash Receipt", code: "" };
}
for (const [plural, singular, idField, path] of [...nextTranche, ...finalTranche]) {
    test(`next tranche ${plural}: correct handler, summary, real fetch and no fan-out`, async (t) => {
        const f = await fixture(t);
        const calls = [];
        const row = nextTrancheRow(path);
        t.mock.method(globalThis, "fetch", async (input, init) => {
            const url = new URL(String(input));
            calls.push(url);
            assert.equal(init.method ?? "GET", "GET");
            assert.equal(Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString(), "owner-a-key:");
            const data = { ...row, ApiKey: "owner-a-key" };
            return new Response(JSON.stringify(url.pathname.endsWith(`/${row.id}`) ? data : { Items: [data], Count: 1, NextPageLink: "" }));
        });
        const search = (await f.invoke(f.a, `search_${plural}`, { query: "", companyName: "Shared" })).structuredContent;
        assert.equal(search.status, "ok");
        assert.equal(search.results.length, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].pathname, `/api/v1/${path}`);
        assert.equal(calls[0].searchParams.get("$top"), "20");
        assert.equal(calls[0].searchParams.get("$skip"), "0");
        assert.equal(calls[0].searchParams.get("$orderby"), "id asc");
        assert.equal(calls[0].searchParams.has("$filter"), false);
        if (path === "nominalJournalBatches")
            assert.equal(calls[0].searchParams.has("page"), false);
        const result = search.results[0];
        assert.equal(result[idField], String(row.id));
        assert.equal(result.fetchAvailable, Boolean(singular));
        assert.equal(result.record.id, row.id);
        assert.equal(result.record.ApiKey, undefined);
        assert.equal(result.record.accountTransactions, undefined);
        assert.equal(result.record.timeStamp, undefined);
        if (path === "salesReps") {
            assert.equal(result.title, "Sales Rep 1");
            assert.equal(result.record.email, "example@example.test");
            assert.equal(result.record.code, "SR0001");
        }
        else if (path === "nominalJournalBatches") {
            assert.equal(result.title, "Journal batch 7 - 2024-01-15");
            assert.equal(result.record.total, 100);
        }
        else {
            assert.equal(result.record.description, row.description);
            if (path !== "salesEntries")
                assert.equal(result.title, row.description);
        }
        if (path === "ownerTypes")
            assert.equal(result.record.recordTypeGroupId, 1);
        if (path === "userDefinedFields") {
            assert.equal(result.record.orderIndex, 1);
            assert.equal(result.record.categoryTypeId, 19);
        }
        if (path === "salesEntries") {
            assert.equal(result.record.reference, "000001");
            assert.equal(result.record.total, 700);
            assert.equal(result.record.acEntries, undefined);
            assert.equal(result.record.vatEntries, undefined);
            assert.equal(result.record.customFields, undefined);
        }
        if (path === "vatTypes") {
            assert.equal(result.record.isOnlyZero, true);
            assert.equal(result.record.isNotApplicable, false);
        }
        if (singular) {
            const fetched = (await f.invoke(f.a, `fetch_${singular}`, { companyName: "Shared", [idField]: String(row.id) })).structuredContent;
            assert.equal(fetched.status, "ok");
            assert.equal(calls.length, 2);
            assert.equal(calls[1].pathname, `/api/v1/${path}/${row.id}`);
            if (path === "nominalJournalBatches")
                assert.equal(fetched[singular].accountTransactions[0].debit, 100);
            if (path === "salesEntries")
                assert.equal(fetched[singular].acEntries[0].value, 636.36);
            assert.doesNotMatch(JSON.stringify(fetched), /owner-a-key|ApiKey/);
        }
        else
            assert.equal(f.tools.has(`fetch_${plural.replace(/s$/, "")}`), false);
    });
    test(`next tranche ${plural}: paging and owner/company isolation`, async (t) => {
        const f = await fixture(t);
        const offsets = [];
        t.mock.method(globalThis, "fetch", async (input) => {
            const url = new URL(String(input));
            const skip = Number(url.searchParams.get("$skip"));
            offsets.push(skip);
            return new Response(JSON.stringify({ Items: Array.from({ length: Math.max(0, Math.min(2, 7 - skip)) }, (_, i) => ({ ...nextTrancheRow(path), id: skip + i + 1 })), Count: 7, NextPageLink: "" }));
        });
        const args = { query: "", companyName: "Shared", pageSize: 2 };
        const first = (await f.invoke(f.a, `search_${plural}`, args)).structuredContent;
        assert.equal(first.results.length, 6);
        assert.equal(first.complete, false);
        for (const owner of [f.b, f.c])
            assert.notEqual((await f.invoke(owner, `search_${plural}`, { ...args, nextCursor: first.nextCursor })).structuredContent.status, "ok");
        assert.equal((await f.invoke(f.a, `search_${plural}`, { ...args, query: "changed", nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
        assert.equal((await f.invoke(f.a, `search_${plural}`, { ...args, companyName: "Foreign" })).structuredContent.status, "company_unavailable");
        assert.equal((await f.invoke(undefined, `search_${plural}`, args)).structuredContent.status, "authentication_required");
        assert.deepEqual(offsets, [0, 2, 4]);
        const next = (await f.invoke(f.a, `search_${plural}`, { ...args, nextCursor: first.nextCursor })).structuredContent;
        assert.equal(next.complete, true);
        assert.deepEqual(offsets, [0, 2, 4, 6]);
        assert.equal(new Set([...first.results, ...next.results].map(row => row[idField])).size, 7);
        assert.throws(() => f.tools.get(`search_${plural}`).config.inputSchema.parse({ ...args, connectionRef: "foreign" }));
        if (singular) {
            for (const owner of [undefined, f.c])
                assert.equal((await f.invoke(owner, `fetch_${singular}`, { companyName: "Shared", [idField]: "7" })).isError, true);
            assert.equal((await f.invoke(f.a, `fetch_${singular}`, { companyName: "Foreign", [idField]: "7" })).isError, true);
            assert.deepEqual(offsets, [0, 2, 4, 6]);
        }
    });
}
test("journal search date filters are local and omit line detail text; references retain distinct schemas", async (t) => {
    const f = await fixture(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ Items: [nextTrancheRow("nominalJournalBatches")] })); });
    const args = { query: "", dateFrom: "2024-01-15", dateTo: "2024-01-15" };
    assert.equal((await f.invoke(f.a, "search_nominal_journal_batches", args)).structuredContent.results.length, 1);
    assert.equal((await f.invoke(f.a, "search_nominal_journal_batches", { ...args, query: "NJ0001" })).structuredContent.results.length, 0);
    assert.equal(calls, 2);
    for (const name of ["search_nominal_journal_batches", "search_vat_analysis_types", "search_category_types"])
        assert.equal("code" in f.tools.get(name).config.inputSchema.shape, false);
    assert.equal((await f.invoke(f.a, "search_nominal_journal_batches", { query: "", dateFrom: "2024-02-01", dateTo: "2024-01-01" })).structuredContent.status, "invalid_request");
    assert.equal(calls, 2);
});
for (const [plural, , , path] of finalTranche) {
    test(`final tranche ${plural}: local query filtering and repeated-page guard`, async (t) => {
        const f = await fixture(t);
        let calls = 0;
        t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ Items: [nextTrancheRow(path)] })); });
        const args = { query: "does-not-match" };
        const empty = (await f.invoke(f.a, `search_${plural}`, args)).structuredContent;
        assert.deepEqual(empty.results, []);
        assert.equal(empty.complete, true);
        assert.equal(calls, 1);
        const repeated = (await f.invoke(f.a, `search_${plural}`, { query: "", pageSize: 1 })).structuredContent;
        assert.equal(repeated.results.length, 1);
        assert.equal(repeated.nextCursor, undefined);
        assert.ok(repeated.paginationWarnings.length > 0);
        assert.ok(calls <= 4);
    });
}
test("sales-entry dates and customer code filter summaries without detail fan-out", async (t) => {
    const f = await fixture(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ Items: [nextTrancheRow("salesEntries")] })); });
    const args = { query: "", companyName: "Shared", counterpartyCode: "C001", dateFrom: "2024-01-15", dateTo: "2024-01-15" };
    assert.equal((await f.invoke(f.a, "search_sales_entries", args)).structuredContent.results.length, 1);
    assert.equal((await f.invoke(f.a, "search_sales_entries", { ...args, counterpartyCode: "OTHER" })).structuredContent.results.length, 0);
    assert.equal((await f.invoke(f.a, "search_sales_entries", { ...args, dateFrom: "2024-02-01", dateTo: "2024-02-01" })).structuredContent.results.length, 0);
    assert.equal(calls, 3);
});
test("fetch_nominal_account uses GET /v1/nominalAccounts/{id} and keeps monthly movements without changing search", async (t) => {
    const f = await fixture(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        const url = new URL(String(input));
        calls.push(url);
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString(), "owner-a-key:");
        const row = { ...nominalDto(7), ApiKey: "owner-a-key" };
        return new Response(JSON.stringify(url.pathname.endsWith("/7") ? row : Array.from({ length: 1 }, () => row)));
    });
    const search = (await f.invoke(f.a, "search_nominal_accounts", { query: "", companyName: "Shared" })).structuredContent;
    assert.equal(search.status, "ok");
    assert.equal(search.results[0].nominalAccountId, "7");
    assert.equal(search.results[0].fetchAvailable, true);
    assert.equal(search.results[0].record.month1, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, "/api/v1/nominalAccounts");
    const fetched = (await f.invoke(f.a, "fetch_nominal_account", { nominalAccountId: search.results[0].nominalAccountId, companyName: "Shared" })).structuredContent;
    assert.equal(fetched.status, "ok");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].pathname, "/api/v1/nominalAccounts/7");
    assert.equal(fetched.nominal_account.id, 7);
    assert.equal(fetched.nominal_account.month1, 0);
    assert.equal(fetched.nominal_account.code, "007");
    assert.equal(fetched.nominal_account.group, "Sales");
    assert.equal(fetched.nominal_account.ApiKey, undefined);
    assert.doesNotMatch(JSON.stringify(fetched), /owner-a-key|ApiKey/);
    assert.equal((await f.invoke(f.a, "fetch_nominal_account", { nominalAccountId: "8", companyName: "Shared" })).isError, true);
    assert.equal(calls.length, 3);
    for (const owner of [undefined, f.c])
        assert.equal((await f.invoke(owner, "fetch_nominal_account", { nominalAccountId: "7", companyName: "Shared" })).isError, true);
    assert.equal((await f.invoke(f.a, "fetch_nominal_account", { nominalAccountId: "7", companyName: "Foreign" })).isError, true);
    assert.equal(calls.length, 3);
    assert.throws(() => f.tools.get("fetch_nominal_account").config.inputSchema.parse({ nominalAccountId: "7", companyName: "Shared", connectionRef: "foreign" }));
});
const agedDto = { currentMonth: 10, oneMonthOld: 20, twoMonthsOld: 30, threeMonthsOld: 40, ApiKey: "owner-a-key" };
const allocationDto = {
    bookTran: { id: 1001, bookTranTypeId: 5, total: 500, unAllocated: 150, discount: 0, unAllocatedDiscount: 0, ownerId: 3001, ownerName: "Acme Ltd", ApiKey: "owner-a-key" },
    allocationResolvers: [
        { id: 5001, allocated: 200, discount: 10, date: "2026-06-03T00:00:00", bookTranId: 1001, bookTranIdReceiver: 2001, receiverReference: "INV001", receiverTotal: 250, receiverOutstanding: 40, receiverBookTranTypeId: 3, secret: "omit" },
    ],
};
test("aged balances use one GET per party and project period fields without opening-balance wording", async (t) => {
    const f = await fixture(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        const url = new URL(String(input));
        calls.push(url);
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(Buffer.from(init.headers.Authorization.replace("Basic ", ""), "base64").toString(), "owner-a-key:");
        return new Response(JSON.stringify(agedDto));
    });
    const customer = (await f.invoke(f.a, "get_customer_aged_balance", { customerId: "42", companyName: "Shared" })).structuredContent;
    assert.equal(customer.status, "ok");
    assert.equal(customer.customerId, "42");
    assert.deepEqual(customer.aged_balance, { currentMonth: 10, oneMonthOld: 20, twoMonthsOld: 30, threeMonthsOld: 40 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, "/api/v1/customers/42/openingBalance");
    const supplier = (await f.invoke(f.a, "get_supplier_aged_balance", { supplierId: "9", companyName: "Shared" })).structuredContent;
    assert.equal(supplier.status, "ok");
    assert.equal(supplier.supplierId, "9");
    assert.equal(supplier.aged_balance.threeMonthsOld, 40);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].pathname, "/api/v1/suppliers/9/openingBalance");
    assert.doesNotMatch(JSON.stringify([customer, supplier]), /owner-a-key|ApiKey|openingBalance|opening_balance/);
    assert.equal((await f.invoke(f.a, "get_customer_aged_balance", { customerId: "abc", companyName: "Shared" })).structuredContent.status, "invalid_request");
    assert.equal(calls.length, 2);
});
test("allocated transactions and allocation candidates use distinct GETs and are not confused", async (t) => {
    const f = await fixture(t);
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        const url = new URL(String(input));
        calls.push(url);
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(url.searchParams.get("bookTranId"), "1001");
        const allocated = url.pathname.endsWith("/allocated");
        return new Response(JSON.stringify({
            ...allocationDto,
            bookTran: { ...allocationDto.bookTran, unAllocated: allocated ? 150 : 350 },
            allocationResolvers: allocated ? allocationDto.allocationResolvers : [{ ...allocationDto.allocationResolvers[0], id: 0, allocated: 0, receiverReference: "INV002" }],
        }));
    });
    const applied = (await f.invoke(f.a, "get_allocated_transactions", { bookTranId: "1001", companyName: "Shared" })).structuredContent;
    assert.equal(applied.status, "ok");
    assert.equal(applied.bookTranId, "1001");
    assert.equal(applied.allocated_transactions.bookTran.unAllocated, 150);
    assert.equal(applied.allocated_transactions.allocations[0].receiverReference, "INV001");
    assert.equal(applied.allocated_transactions.allocations[0].secret, undefined);
    assert.equal(applied.allocation_candidates, undefined);
    assert.equal(applied.nextCursor, undefined);
    assert.equal(applied.complete, true);
    assert.equal(applied.allocated_transactions.truncated, undefined);
    assert.equal(calls[0].pathname, "/api/v1/allocationResolvers/allocated");
    const candidates = (await f.invoke(f.a, "get_allocation_candidates", { bookTranId: "1001", companyName: "Shared" })).structuredContent;
    assert.equal(candidates.status, "ok");
    assert.equal(candidates.complete, true);
    assert.equal(candidates.nextCursor, undefined);
    assert.equal(candidates.allocation_candidates.bookTran.unAllocated, 350);
    assert.equal(candidates.allocation_candidates.candidates[0].allocated, 0);
    assert.equal(candidates.allocation_candidates.candidates[0].receiverReference, "INV002");
    assert.equal(candidates.allocated_transactions, undefined);
    assert.equal(calls[1].pathname, "/api/v1/allocationResolvers");
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify([applied, candidates]), /owner-a-key|ApiKey|secret/);
    assert.equal((await f.invoke(f.a, "get_allocated_transactions", { bookTranId: "INV001", companyName: "Shared" })).structuredContent.status, "invalid_request");
    assert.equal(calls.length, 2);
});
test("allocation candidates page locally from one GET with bound continuation", async (t) => {
    const f = await fixture(t);
    const calls = [];
    const line = (i) => ({
        id: 9000 - i, allocated: 0, discount: 0, date: "2026-06-03T00:00:00", bookTranId: 1001,
        bookTranIdReceiver: 3000 - i, receiverReference: `INV${String(i).padStart(3, "0")}`,
        receiverTotal: 100 + i, receiverOutstanding: 100 + i, receiverBookTranTypeId: 3, secret: "omit", ApiKey: "owner-a-key",
    });
    const shuffled = [line(1), ...Array.from({ length: 45 }, (_, i) => line(45 - i))];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        const url = new URL(String(input));
        const key = Buffer.from(String(init.headers.Authorization.replace("Basic ", "")), "base64").toString();
        calls.push({ pathname: url.pathname, key, bookTranId: url.searchParams.get("bookTranId") });
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(url.search, "?bookTranId=1001", "candidates stay on one list GET; paging is local");
        if (key === "owner-b-key:") {
            return new Response(JSON.stringify({
                bookTran: { ...allocationDto.bookTran, unAllocated: 1, ownerName: "Other Ltd" },
                allocationResolvers: [{ ...line(99), bookTranId: 1001, receiverReference: "INV-B" }],
            }));
        }
        return new Response(JSON.stringify({
            bookTran: { ...allocationDto.bookTran, unAllocated: 350 },
            allocationResolvers: shuffled,
        }));
    });
    const args = { bookTranId: "1001", companyName: "Shared" };
    const first = (await f.invoke(f.a, "get_allocation_candidates", args)).structuredContent;
    assert.equal(first.status, "ok");
    assert.equal(first.complete, false);
    assert.equal(typeof first.nextCursor, "string");
    assert.ok(first.nextCursor.length <= 4096);
    assert.equal(first.allocation_candidates.candidates.length, 20);
    assert.equal(first.allocation_candidates.truncated, undefined);
    assert.equal(first.allocation_candidates.candidates[0].receiverReference, "INV045");
    assert.equal(first.allocation_candidates.candidates[0].bookTranIdReceiver, 2955);
    assert.equal(first.allocation_candidates.candidates[19].receiverReference, "INV026");
    assert.equal(first.allocation_candidates.candidates[0].secret, undefined);
    assert.equal(first.allocation_candidates.candidates[0].ApiKey, undefined);
    assert.deepEqual(Object.keys(first.allocation_candidates.candidates[0]).sort(), [
        "allocated", "bookTranId", "bookTranIdReceiver", "date", "discount", "id",
        "receiverBookTranTypeId", "receiverOutstanding", "receiverReference", "receiverTotal",
    ]);
    const next = (await f.invoke(f.a, "get_allocation_candidates", { ...args, nextCursor: first.nextCursor })).structuredContent;
    assert.equal(next.status, "ok");
    assert.equal(next.complete, false);
    assert.equal(next.allocation_candidates.candidates.length, 20);
    assert.equal(next.allocation_candidates.candidates[0].receiverReference, "INV025");
    assert.equal(next.allocation_candidates.candidates[19].receiverReference, "INV006");
    const last = (await f.invoke(f.a, "get_allocation_candidates", { ...args, nextCursor: next.nextCursor })).structuredContent;
    assert.equal(last.status, "ok");
    assert.equal(last.complete, true);
    assert.equal(last.nextCursor, undefined);
    assert.equal(last.allocation_candidates.candidates.length, 5);
    assert.equal(last.allocation_candidates.candidates[0].receiverReference, "INV005");
    assert.equal(last.allocation_candidates.candidates[4].receiverReference, "INV001");
    const pages = [...first.allocation_candidates.candidates, ...next.allocation_candidates.candidates, ...last.allocation_candidates.candidates];
    assert.equal(pages.length, 45);
    assert.equal(new Set(pages.map((row) => `${row.bookTranIdReceiver}:${row.id}`)).size, 45);
    assert.deepEqual(pages.map((row) => row.bookTranIdReceiver), pages.map((row) => row.bookTranIdReceiver).slice().sort((a, b) => a - b));
    assert.equal(calls.length, 3, "one list GET per page, no per-candidate fetches");
    assert.ok(calls.every(call => call.pathname === "/api/v1/allocationResolvers" && call.key === "owner-a-key:"));
    assert.equal((await f.invoke(f.b, "get_allocation_candidates", { ...args, nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await f.invoke(f.a, "get_allocation_candidates", { bookTranId: "1002", companyName: "Shared", nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await f.invoke(f.a, "get_allocation_candidates", { ...args, nextCursor: first.nextCursor + "tampered" })).structuredContent.status, "invalid_cursor");
    const expired = JSON.parse(decryptCredentialSecret(first.nextCursor));
    expired.exp = Date.now() - 1;
    assert.equal((await f.invoke(f.a, "get_allocation_candidates", { ...args, nextCursor: encryptCredentialSecret(JSON.stringify(expired)) })).structuredContent.status, "invalid_cursor");
    assert.equal(calls.length, 3);
    const other = (await f.invoke(f.b, "get_allocation_candidates", args)).structuredContent;
    assert.equal(other.status, "ok");
    assert.equal(other.allocation_candidates.candidates[0].receiverReference, "INV-B");
    assert.equal(calls.length, 4);
    assert.equal(calls[3].key, "owner-b-key:");
    assert.equal((await f.invoke(undefined, "get_allocation_candidates", args)).structuredContent.status, "authentication_required");
    assert.equal((await f.invoke(f.c, "get_allocation_candidates", args)).structuredContent.status, "company_unavailable");
    assert.equal((await f.invoke(f.a, "get_allocation_candidates", { ...args, companyName: "Foreign" })).isError, true);
    assert.equal(calls.length, 4);
});
test("allocated transactions page locally from one GET with bound continuation", async (t) => {
    const f = await fixture(t);
    const calls = [];
    const line = (i) => ({
        id: 8000 - i, allocated: 10 + i, discount: 0, date: "2026-06-03T00:00:00", bookTranId: 1001,
        bookTranIdReceiver: 4000 - i, receiverReference: `INV${String(i).padStart(3, "0")}`,
        receiverTotal: 200 + i, receiverOutstanding: 50, receiverBookTranTypeId: 3, secret: "omit", ApiKey: "owner-a-key",
    });
    const shuffled = [line(1), ...Array.from({ length: 45 }, (_, i) => line(45 - i))];
    t.mock.method(globalThis, "fetch", async (input, init) => {
        const url = new URL(String(input));
        const key = Buffer.from(String(init.headers.Authorization.replace("Basic ", "")), "base64").toString();
        calls.push({ pathname: url.pathname, key, bookTranId: url.searchParams.get("bookTranId") });
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(url.search, "?bookTranId=1001", "allocated stays on one list GET; paging is local");
        if (key === "owner-b-key:") {
            return new Response(JSON.stringify({
                bookTran: { ...allocationDto.bookTran, unAllocated: 1, ownerName: "Other Ltd" },
                allocationResolvers: [{ ...line(99), bookTranId: 1001, receiverReference: "INV-B" }],
            }));
        }
        return new Response(JSON.stringify({
            bookTran: { ...allocationDto.bookTran, unAllocated: 150 },
            allocationResolvers: shuffled,
        }));
    });
    const args = { bookTranId: "1001", companyName: "Shared" };
    const first = (await f.invoke(f.a, "get_allocated_transactions", args)).structuredContent;
    assert.equal(first.status, "ok");
    assert.equal(first.complete, false);
    assert.equal(typeof first.nextCursor, "string");
    assert.ok(first.nextCursor.length <= 4096);
    assert.equal(first.allocated_transactions.allocations.length, 20);
    assert.equal(first.allocated_transactions.truncated, undefined);
    assert.equal(first.allocated_transactions.allocations[0].receiverReference, "INV045");
    assert.equal(first.allocated_transactions.allocations[0].bookTranIdReceiver, 3955);
    assert.equal(first.allocated_transactions.allocations[19].receiverReference, "INV026");
    assert.equal(first.allocated_transactions.allocations[0].secret, undefined);
    assert.equal(first.allocated_transactions.allocations[0].ApiKey, undefined);
    assert.deepEqual(Object.keys(first.allocated_transactions.allocations[0]).sort(), [
        "allocated", "bookTranId", "bookTranIdReceiver", "date", "discount", "id",
        "receiverBookTranTypeId", "receiverOutstanding", "receiverReference", "receiverTotal",
    ]);
    const next = (await f.invoke(f.a, "get_allocated_transactions", { ...args, nextCursor: first.nextCursor })).structuredContent;
    assert.equal(next.status, "ok");
    assert.equal(next.complete, false);
    assert.equal(next.allocated_transactions.allocations.length, 20);
    assert.equal(next.allocated_transactions.allocations[0].receiverReference, "INV025");
    assert.equal(next.allocated_transactions.allocations[19].receiverReference, "INV006");
    const last = (await f.invoke(f.a, "get_allocated_transactions", { ...args, nextCursor: next.nextCursor })).structuredContent;
    assert.equal(last.status, "ok");
    assert.equal(last.complete, true);
    assert.equal(last.nextCursor, undefined);
    assert.equal(last.allocated_transactions.allocations.length, 5);
    assert.equal(last.allocated_transactions.allocations[0].receiverReference, "INV005");
    assert.equal(last.allocated_transactions.allocations[4].receiverReference, "INV001");
    const pages = [...first.allocated_transactions.allocations, ...next.allocated_transactions.allocations, ...last.allocated_transactions.allocations];
    assert.equal(pages.length, 45);
    assert.equal(new Set(pages.map((row) => `${row.bookTranIdReceiver}:${row.id}`)).size, 45);
    const receivers = pages.map((row) => row.bookTranIdReceiver);
    const ids = pages.map((row) => row.id);
    assert.deepEqual(receivers, receivers.slice().sort((a, b) => a - b));
    assert.deepEqual(ids, ids.slice().sort((a, b) => a - b));
    assert.equal(calls.length, 3, "one list GET per page, no per-allocation fetches");
    assert.ok(calls.every(call => call.pathname === "/api/v1/allocationResolvers/allocated" && call.key === "owner-a-key:"));
    assert.equal((await f.invoke(f.b, "get_allocated_transactions", { ...args, nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await f.invoke(f.a, "get_allocated_transactions", { bookTranId: "1002", companyName: "Shared", nextCursor: first.nextCursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await f.invoke(f.a, "get_allocated_transactions", { ...args, nextCursor: first.nextCursor + "tampered" })).structuredContent.status, "invalid_cursor");
    const expired = JSON.parse(decryptCredentialSecret(first.nextCursor));
    expired.exp = Date.now() - 1;
    assert.equal((await f.invoke(f.a, "get_allocated_transactions", { ...args, nextCursor: encryptCredentialSecret(JSON.stringify(expired)) })).structuredContent.status, "invalid_cursor");
    assert.equal(calls.length, 3);
    const other = (await f.invoke(f.b, "get_allocated_transactions", args)).structuredContent;
    assert.equal(other.status, "ok");
    assert.equal(other.allocated_transactions.allocations[0].receiverReference, "INV-B");
    assert.equal(calls.length, 4);
    assert.equal(calls[3].key, "owner-b-key:");
    assert.equal((await f.invoke(undefined, "get_allocated_transactions", args)).structuredContent.status, "authentication_required");
    assert.equal((await f.invoke(f.c, "get_allocated_transactions", args)).structuredContent.status, "company_unavailable");
    assert.equal((await f.invoke(f.a, "get_allocated_transactions", { ...args, companyName: "Foreign" })).isError, true);
    assert.equal(calls.length, 4);
});
test("allocated transactions complete in one call at or below page size and reject oversized dumps", async (t) => {
    const f = await fixture(t);
    let payloadCount = 20;
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input) => {
        calls++;
        const url = new URL(String(input));
        assert.equal(url.pathname, "/api/v1/allocationResolvers/allocated");
        assert.equal(url.search, "?bookTranId=1001");
        return new Response(JSON.stringify({
            bookTran: allocationDto.bookTran,
            allocationResolvers: Array.from({ length: payloadCount }, (_, i) => ({
                id: i + 1, allocated: 1, bookTranId: 1001, bookTranIdReceiver: i + 1, receiverReference: `INV${i + 1}`,
            })),
        }));
    });
    const full = (await f.invoke(f.a, "get_allocated_transactions", { bookTranId: "1001", companyName: "Shared" })).structuredContent;
    assert.equal(full.status, "ok");
    assert.equal(full.complete, true);
    assert.equal(full.nextCursor, undefined);
    assert.equal(full.allocated_transactions.allocations.length, 20);
    assert.equal(full.allocated_transactions.truncated, undefined);
    assert.equal(calls, 1);
    payloadCount = 2001;
    assert.equal((await f.invoke(f.a, "get_allocated_transactions", { bookTranId: "1001", companyName: "Shared" })).structuredContent.status, "query_unavailable");
    assert.equal(calls, 2);
});
test("Copilot profile explicitly continues allocation and search results across user turns", () => {
    for (const phrase of ["get_allocation_candidates/get_allocated_transactions", "nextCursor and complete:false", "continue, show more or show remaining results", "SAME RED tool", "exact previous nextCursor", "same companyName", "same resource identifier/query parameters", "including bookTranId and filters", "Do not ask the user to manually copy an opaque cursor", "do not automatically restart at page one"])
        assert.ok(COPILOT_INSTRUCTIONS.includes(phrase), phrase);
});
test("allocation descriptors retain exact schemas and routing text", () => {
    const tools = registry();
    for (const [name, list, prefix] of [
        ["get_allocation_candidates", "candidate", "Return unmatched transactions eligible to receive an allocation from the specified sender book transaction. These are possible allocations, not allocations already applied. Requires bookTranId and companyName. Use get_allocated_transactions for existing applications."],
        ["get_allocated_transactions", "allocated", "Return allocations already applied from one sender book transaction, such as a receipt or payment, to receiver invoices or credits. Requires bookTranId from a ledger or document search and companyName. Distinct from get_allocation_candidates, which lists unmatched eligible receivers."],
    ]) {
        const config = tools.get(name).config;
        assert.equal(config.description, `${prefix} ${allocationContinuation}`);
        assert.deepEqual(z.toJSONSchema(config.inputSchema), z.toJSONSchema(z.object({
            bookTranId: z.string().min(1).max(256).describe("Sender bookTranId from a ledger, invoice, receipt or payment search."),
            companyName: z.string().min(1).max(4000).describe("Company name that owns this book transaction."),
            nextCursor: z.string().max(4096).optional().describe(`Continuation from this ${list} list; keep bookTranId and companyName unchanged.`),
        }).strict()));
    }
});
