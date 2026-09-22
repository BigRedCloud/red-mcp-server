import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { registerCopilotDiagnosticTools } from "./copilot_diagnostic.js";
import { registerAllTools } from "./register_all_tools.js";
import { COPILOT_FEDERATED_TOOL_NAMES } from "./copilot_facade.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { getConnectionStore } from "./auth/connection_store.js";
import { encryptCredentialSecret, decryptCredentialSecret } from "./auth/credential_encryption.js";
import { runWithHttpRequestSessionId, runWithSessionKeyStore } from "./shared.js";
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
test("normal 159 descriptors remain identical; Copilot advertises exactly 35 strict read-only tools", () => {
    const normal = [];
    registerAllTools({ registerTool(name, config) { normal.push({ name, ...config, inputSchema: config.inputSchema ? z.toJSONSchema(z.object(config.inputSchema)) : undefined }); }, registerResource() { }, registerPrompt() { } }, { profile: "full" });
    assert.equal(normal.length, 159);
    assert.equal(createHash("sha256").update(JSON.stringify(normal.sort((a, b) => a.name.localeCompare(b.name)))).digest("hex"), "c5e420ed1f7e9f3201fadb283b72e4b90a00eb58c64bfd641d3c8cab0d684f6f");
    const tools = registry();
    const names = [...existingNames, ...tranchePairs.flatMap(([plural, singular]) => [`search_${plural}`, `fetch_${singular}`]), ...searchOnly.map(plural => `search_${plural}`), ...purposeNames].sort();
    assert.equal(tools.size, 35);
    assert.deepEqual([...tools.keys()].sort(), names);
    assert.deepEqual([...COPILOT_FEDERATED_TOOL_NAMES].sort(), names);
    for (const name of originalNames)
        assert.equal(tools.has(name), true, name);
    for (const name of existingNames)
        assert.equal(tools.has(name), true, name);
    assert.equal(tools.has("fetch_vat_rate"), false);
    assert.equal(tools.has("fetch_nominal_account"), false);
    for (const [name, { config }] of tools) {
        assert.match(name, /^(search|fetch|get)_/);
        assert.doesNotMatch(name, /^brc_/);
        assert.ok(config.title.length > 10);
        assert.ok(config.description.length < 400);
        assert.deepEqual(config.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        const schema = z.toJSONSchema(config.inputSchema);
        assert.equal(schema.additionalProperties, false);
        for (const field of ["apiKey", "connectionRef", "tenantId", "objectId", "confirmWrite", "routeToken", "filter"])
            assert.equal(field in schema.properties, false, name);
    }
    for (const [plural, singular, label, documents] of existingMeta) {
        const search = tools.get(`search_${plural}`);
        assert.equal(search.config.title, `Search Big Red Cloud ${label}`);
        assert.equal(search.config.description, `Search ${label} by text${documents ? ", transaction date or counterparty code" : " or exact code"} in linked companies. Empty query lists records. Continue with nextCursor even after an empty page.`);
        const fetchTool = tools.get(`fetch_${singular}`);
        assert.equal(fetchTool.config.title, `Fetch Big Red Cloud ${label === "purchases" ? "purchase" : label.replace(/s$/, "")}`);
    }
    assert.deepEqual(Object.keys(tools.get("search_customers").config.inputSchema.shape), ["query", "nextCursor"]);
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
        assert.equal(search.structuredContent.results[0].fetchAvailable, false);
        assert.equal(search.structuredContent.results[0].record.month2, undefined);
        assert.equal(calls.length, before + 1, `${plural} search must not fan out`);
        assert.equal(calls.at(-1).url.pathname, `/api/v1/${path}`);
        assert.equal(toolsMissingFetch(f.tools, plural), true);
    }
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
