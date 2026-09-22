import { advancePage, freshPaging, pagingArgs, pagingSchema } from "./copilot_paging.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { registerTools } from "./tools/general/list_tools.js";
import { registerProductTools } from "./tools/product_tools.js";
import { registerBankListTools } from "./tools/bank-payments/bank_tools.js";
import { registerCashPaymentTools } from "./tools/bank-payments/cash_payments_tools.js";
import { getToolMetadata } from "./tool_annotations.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { ownerKey } from "./auth/entra_store.js";
import { ensureConnectionStoreInitialized, getConnectionStore } from "./auth/connection_store.js";
import { decodeStoredApiKey } from "./auth/credential_secret.js";
import { encryptCredentialSecret } from "./auth/credential_encryption.js";
import { openSsoEnvelope } from "./auth/entra_browser.js";
import { normaliseCompanyName, resolveActiveMcpSessionId, runWithSessionKeyStore } from "./shared.js";
/** Facade mappings only: these do not register, replace or wrap any /mcp tool. */
export const COPILOT_ENTITIES = [
    { plural: "suppliers", singular: "supplier", label: "suppliers", idField: "supplierId", list: "brc_list_suppliers", get: "brc_get_supplier", ids: ["id", "supplierid"], codes: ["code", "suppliercode", "accode"], documents: false },
    { plural: "products", singular: "product", label: "products", idField: "productId", list: "brc_list_products", get: "brc_get_product", ids: ["id", "productid"], codes: ["stockcode", "code", "productcode"], documents: false },
    { plural: "sales_invoices", singular: "sales_invoice", label: "sales invoices", idField: "salesInvoiceId", list: "brc_list_sales_invoices", get: "brc_get_sales_invoice", ids: ["id", "salesinvoiceid", "invoiceid", "booktranid"], codes: ["reference", "invoicenumber"], documents: true },
    { plural: "purchases", singular: "purchase", label: "purchases", idField: "purchaseId", list: "brc_list_purchases", get: "brc_get_purchase", ids: ["id", "purchaseid", "booktranid"], codes: ["reference", "purchasenumber"], documents: true },
    { plural: "accounts", singular: "account", label: "accounts", idField: "accountId", list: "brc_list_accounts", get: null, ids: ["id", "accountid"], codes: ["code", "accountcode", "accode"], documents: false },
    { plural: "quotes", singular: "quote", label: "quotes", idField: "quoteId", list: "brc_list_quotes", get: "brc_get_quote", ids: ["id", "quoteid"], codes: ["reference"], documents: true },
    { plural: "sales_credit_notes", singular: "sales_credit_note", label: "sales credit notes", idField: "salesCreditNoteId", list: "brc_list_sales_credit_notes", get: "brc_get_sales_credit_note", ids: ["id", "salescreditnoteid", "creditnoteid", "booktranid"], codes: ["reference"], documents: true },
    { plural: "bank_accounts", singular: "bank_account", label: "bank accounts", idField: "bankAccountId", list: "brc_list_bank_accounts", get: "brc_get_bank_account", ids: ["id", "bankaccountid"], codes: ["accode", "code", "bankaccountcode"], documents: false },
    { plural: "cash_payments", singular: "cash_payment", label: "cash payments", idField: "cashPaymentId", list: "brc_list_cash_payments", get: "brc_get_cash_payment", ids: ["id", "cashpaymentid", "booktranid"], codes: ["reference"], documents: true },
    { plural: "cash_receipts", singular: "cash_receipt", label: "cash receipts", idField: "cashReceiptId", list: "brc_list_cash_receipts", get: "brc_get_cash_receipt", ids: ["id", "cashreceiptid", "booktranid"], codes: ["reference"], documents: true },
    { plural: "payments", singular: "payment", label: "payments", idField: "paymentId", list: "brc_list_payments", get: "brc_get_payment", ids: ["id", "paymentid", "booktranid"], codes: ["reference"], documents: true },
];
const supplierLedgers = new Set(["purchase", "cash_payment", "payment"]);
export const COPILOT_FEDERATED_TOOL_NAMES = new Set([
    "search_customers", "fetch_customer",
    ...COPILOT_ENTITIES.flatMap(entity => [`search_${entity.plural}`, `fetch_${entity.singular}`]),
]);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MAX_PAGES = 3;
const MAX_BYTES = 128_000;
const reply = (data, isError = false) => ({
    content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data,
    ...(isError ? { isError: true } : {}),
});
class FacadeError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const failure = (error) => error instanceof FacadeError
    ? reply({ status: error.status, message: error.message }, true)
    : reply({ status: "query_unavailable", message: "Could not query the accounting data. Retry the search or fetch." }, true);
let redHandlers;
function readers() {
    if (redHandlers)
        return redHandlers;
    const selected = new Set(COPILOT_ENTITIES.flatMap(entity => entity.get ? [entity.list, entity.get] : [entity.list]));
    const captured = new Map();
    // Capture original read callbacks into a private adapter. This object is never
    // passed to registerAllTools and never touches the normal SDK server.
    const collector = { tool(name, _description, schema, handler) {
            if (!selected.has(name))
                return;
            const { annotations: hints } = getToolMetadata(name);
            if (!hints.readOnlyHint || hints.destructiveHint)
                throw new Error(`Unsafe facade reader: ${name}`);
            captured.set(name, { schema: z.object(schema), call: handler });
        } };
    registerTools(collector);
    registerProductTools(collector);
    registerBankListTools(collector);
    registerCashPaymentTools(collector);
    if (captured.size !== selected.size)
        throw new Error("Incomplete facade readers");
    redHandlers = captured;
    return captured;
}
const cursorSchema = z.object({
    version: z.literal(2), binding: z.string(), index: z.number().int().nonnegative(),
    page: z.number().int().positive(), exp: z.number(), paging: pagingSchema, incomplete: z.boolean(),
}).strict();
const fold = (text) => text.trim().toLowerCase();
function value(row, names) {
    for (const name of names) {
        const entry = Object.entries(row).find(([key]) => key.toLowerCase() === name)?.[1];
        if ((typeof entry === "string" && entry.length > 0) || typeof entry === "number")
            return String(entry);
    }
    return undefined;
}
function detailTitle(row) {
    const details = Object.entries(row).find(([key]) => key.toLowerCase() === "details")?.[1];
    return typeof details === "string" ? details : Array.isArray(details) ? details.find(item => typeof item === "string" && item.trim()) : undefined;
}
function identifier(entity, row) {
    const id = value(row, entity.ids);
    if (entity.singular !== "account")
        return id;
    const code = value(row, entity.codes);
    return id !== undefined ? `id:${id}` : code !== undefined ? `code:${code}` : undefined;
}
async function scope(companyName) {
    const owner = entraRequestOwner.getStore();
    if (!owner)
        throw new FacadeError("authentication_required", "Sign in with Microsoft to query your linked companies.");
    // This HTTP-only facade deliberately has no legacy MCP session/connectionRef
    // scope. Fail closed if accidentally invoked inside such a scope.
    if (resolveActiveMcpSessionId())
        throw new FacadeError("query_unavailable", "A federated request context is required.");
    await ensureConnectionStoreInitialized();
    const all = await getConnectionStore().entra.listCompanies(owner);
    const companies = companyName === undefined ? all : all.filter(company => normaliseCompanyName(company.companyName) === normaliseCompanyName(companyName));
    if (!companies.length)
        throw new FacadeError(companyName ? "company_unavailable" : "connection_required", "Use search_customers with an empty query to discover or connect your linked companies.");
    const secrets = [owner.tenantId, owner.objectId];
    for (const company of all) {
        const key = decodeStoredApiKey(company.encryptedSecret);
        secrets.push(key, Buffer.from(`${key}:`).toString("base64"));
    }
    const clean = (text) => {
        for (const secret of secrets)
            if (secret)
                text = text.split(secret).join("[redacted]");
        return text.replace(/(?:Bearer|Basic)\s+\S+/gi, "[redacted]")
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]");
    };
    return { owner: ownerKey(owner), companies, clean };
}
function binding(context, purpose, parameters) {
    return createHash("sha256").update(JSON.stringify([
        context.owner, purpose, parameters,
        context.companies.map(company => [company.companyName, company.updatedAt, company.expiresAt]),
    ])).digest("hex");
}
function cursorFor(context, hash, supplied) {
    if (!supplied)
        return { version: 2, binding: hash, index: 0, page: 1, paging: freshPaging(), incomplete: false, exp: Date.now() + 600_000 };
    try {
        const cursor = cursorSchema.parse(JSON.parse(openSsoEnvelope(supplied)));
        if (cursor.binding !== hash || cursor.exp <= Date.now() || cursor.index >= context.companies.length)
            throw new Error("Invalid cursor");
        return cursor;
    }
    catch {
        throw new FacadeError("invalid_cursor", "Restart without nextCursor; keep the same query, company and filters when continuing.");
    }
}
async function read(context, index, tool, args) {
    const company = context.companies[index];
    if (company.expiresAt <= Date.now())
        throw new Error("Expired company");
    const contexts = new Map([[normaliseCompanyName(company.companyName), {
                companyName: company.companyName, apiKey: decodeStoredApiKey(company.encryptedSecret), expiresAt: company.expiresAt,
            }]]);
    const reader = readers().get(tool);
    if (!reader)
        throw new Error("Unknown reader");
    const result = await runWithSessionKeyStore(contexts, () => reader.call(reader.schema.parse({ ...args, companyName: company.companyName })));
    const text = result.content.find(item => item.type === "text")?.text;
    if (!text || Buffer.byteLength(text) > 2_000_000)
        throw new Error("Unsupported response");
    return JSON.parse(text);
}
function items(data, pageSize) {
    const object = data;
    const rows = Array.isArray(data) ? data : object?.Items ?? object?.items;
    if (!Array.isArray(rows) || rows.length > pageSize || rows.some(row => !row || typeof row !== "object" || Array.isArray(row)))
        throw new Error("Unsupported page");
    return rows;
}
const summaryFields = new Set([
    "id", "supplierid", "customerid", "productid", "salesinvoiceid", "invoiceid", "purchaseid", "accountid", "booktranid",
    "quoteid", "salescreditnoteid", "creditnoteid", "bankaccountid", "cashpaymentid", "cashreceiptid", "paymentid",
    "code", "suppliercode", "productcode", "customercode", "accountcode", "accode", "name", "suppliername", "customername", "productname", "description",
    "reference", "invoicenumber", "purchasenumber", "entrydate", "procdate", "date", "invoicedate", "purchasedate", "duedate",
    "stockcode", "details", "price", "unitprice", "grossunitprice", "accountname", "netamount", "vatamount", "grossamount",
    "note", "comments", "customerownername", "bankaccountcode", "bankaccountname", "amount", "totalnet", "totalvat", "unallocated",
    "email", "telephone", "phone", "balance", "total", "net", "vat", "gross", "unpaid", "dormant", "isdormant",
]);
const privateFields = /^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|password|secret|encryptedSecret|connectionRef|activeConnectionRef|connectionMetadata|connection|_meta|tenantId|objectId)$/i;
function sanitize(data, clean, depth = 0) {
    if (depth > 12)
        throw new Error("Record too deep");
    if (typeof data === "string") {
        if (data.length > 20_000)
            throw new Error("Field too large");
        return clean(data);
    }
    if (Array.isArray(data))
        return data.map(item => sanitize(item, clean, depth + 1));
    if (data && typeof data === "object")
        return Object.fromEntries(Object.entries(data)
            .filter(([key]) => !privateFields.test(key)).map(([key, item]) => [key, sanitize(item, clean, depth + 1)]));
    return data;
}
function matches(entity, row, args) {
    if (args.code && fold(value(row, entity.codes) ?? "") !== fold(args.code))
        return false;
    if (args.counterpartyCode && fold(value(row, supplierLedgers.has(entity.singular) ? ["suppliercode", "accode"] : ["customercode", "accode"]) ?? "") !== fold(args.counterpartyCode))
        return false;
    if (args.dateFrom || args.dateTo) {
        const date = value(row, ["entrydate", "invoicedate", "purchasedate", "procdate", "date"])?.slice(0, 10);
        if (!date || !z.iso.date().safeParse(date).success || (args.dateFrom && date < args.dateFrom) || (args.dateTo && date > args.dateTo))
            return false;
    }
    return !args.query.trim() || Object.values(row).flatMap(item => Array.isArray(item) ? item : [item]).some(item => (typeof item === "string" || typeof item === "number") && fold(String(item)).includes(fold(args.query)));
}
export async function searchCopilotEntity(entity, args) {
    try {
        if (args.dateFrom && args.dateTo && args.dateFrom > args.dateTo)
            throw new FacadeError("invalid_request", "dateFrom must be on or before dateTo.");
        const context = await scope(args.companyName);
        const pageSize = args.pageSize ?? 20;
        const hash = binding(context, `search_${entity.plural}`, [fold(args.query), fold(args.code ?? ""), fold(args.counterpartyCode ?? ""), args.dateFrom ?? "", args.dateTo ?? "", pageSize]);
        const cursor = cursorFor(context, hash, args.nextCursor);
        const results = [];
        const unavailableCompanies = [];
        const paginationWarnings = [];
        for (let count = 0; count < MAX_PAGES && cursor.index < context.companies.length; count++) {
            const companyName = context.clean(context.companies[cursor.index].companyName);
            try {
                const rows = items(await read(context, cursor.index, entity.list, { page: cursor.page, pageSize, ...pagingArgs(cursor.paging, pageSize) }), pageSize);
                const progress = advancePage(cursor.paging, rows, pageSize, row => identifier(entity, row));
                const pageResults = [];
                for (const row of progress.rows) {
                    const summary = sanitize(Object.fromEntries(Object.entries(row).filter(([key]) => summaryFields.has(key.toLowerCase())).map(([key, item]) => [key, Array.isArray(item) ? item.filter(value => typeof value === "string").slice(0, 5).map(value => value.slice(0, 1000)) : item])), context.clean);
                    if (!matches(entity, summary, args))
                        continue;
                    const id = identifier(entity, row);
                    const usableId = id !== undefined && id.length <= 256 && context.clean(id) === id && ![".", ".."].includes(id);
                    pageResults.push({ companyName, ...(usableId ? { [entity.idField]: id } : {}),
                        title: context.clean(value(summary, ["name", "suppliername", "customername", "accountname", "productname", "description", "comments", "note", "reference"]) ?? detailTitle(summary) ?? value(summary, entity.codes) ?? id ?? entity.singular),
                        record: summary, fetchAvailable: usableId });
                }
                if (Buffer.byteLength(JSON.stringify([...results, ...pageResults])) > MAX_BYTES) {
                    if (!results.length)
                        throw new Error("Page too large");
                    break; // Retry this unconsumed page on the next invocation.
                }
                results.push(...pageResults);
                cursor.paging = progress.state;
                if (progress.warning) {
                    paginationWarnings.push({ companyName, reason: progress.warning });
                    cursor.incomplete = true;
                }
                if (!progress.done)
                    cursor.page++;
                else {
                    cursor.index++;
                    cursor.page = 1;
                    cursor.paging = freshPaging();
                }
            }
            catch {
                unavailableCompanies.push(companyName);
                cursor.index++;
                cursor.page = 1;
                cursor.paging = freshPaging();
            }
        }
        const nextCursor = cursor.index < context.companies.length ? encryptCredentialSecret(JSON.stringify(cursor)) : undefined;
        return reply({ status: cursor.incomplete || unavailableCompanies.length ? "partial_failure" : "ok", results, unavailableCompanies, paginationWarnings,
            ...(nextCursor ? { nextCursor } : {}), complete: !nextCursor && !cursor.incomplete });
    }
    catch (error) {
        return failure(error);
    }
}
export async function fetchCopilotEntity(entity, args) {
    try {
        if ([".", ".."].includes(args.recordId))
            throw new FacadeError("invalid_request", "Use the exact identifier returned by search.");
        const context = await scope(args.companyName);
        let record;
        if (entity.get) {
            record = await read(context, 0, entity.get, { id: args.recordId });
            if (!record || typeof record !== "object" || Array.isArray(record) || identifier(entity, record) !== args.recordId)
                throw new Error("Unexpected record identity");
        }
        else {
            // /accounts has no audited get-by-ID tool. Look up an exact ID/code using
            // its existing list handler with documented OData offsets.
            if (!/^(?:id|code):.+/.test(args.recordId))
                throw new FacadeError("invalid_request", "Use the accountId returned by search_accounts (id:... or code:...).");
            const cursor = cursorFor(context, binding(context, "fetch_account", args.recordId), args.nextCursor);
            for (let count = 0; count < MAX_PAGES; count++) {
                const rows = items(await read(context, 0, entity.list, { page: cursor.page, pageSize: 50, ...pagingArgs(cursor.paging, 50) }), 50);
                const progress = advancePage(cursor.paging, rows, 50, row => identifier(entity, row));
                if (progress.warning)
                    throw new FacadeError(progress.warning, "The account list did not complete. Restart the lookup later.");
                const matching = rows.filter(row => identifier(entity, row) === args.recordId);
                if (matching.length > 1)
                    throw new FacadeError("ambiguous_record", "This identifier is not unique. Search again for an account with a unique ID.");
                if (matching.length === 1) {
                    record = matching[0];
                    break;
                }
                if (rows.length < 50)
                    return reply({ status: "not_found", companyName: context.clean(context.companies[0].companyName) }, true);
                cursor.paging = progress.state;
                cursor.page++;
            }
            if (!record)
                return reply({ status: "incomplete", message: "Continue with the same accountId and companyName to finish the lookup.", nextCursor: encryptCredentialSecret(JSON.stringify(cursor)) });
        }
        const safeRecord = sanitize(record, context.clean);
        if (Buffer.byteLength(JSON.stringify(safeRecord)) > MAX_BYTES)
            throw new Error("Record too large");
        return reply({ status: "ok", companyName: context.clean(context.companies[0].companyName), [entity.singular]: safeRecord });
    }
    catch (error) {
        return failure(error);
    }
}
/** Called only by the separate /mcp/copilot registry. */
export function registerCopilotAccountingFacade(server) {
    readers();
    for (const entity of COPILOT_ENTITIES) {
        server.registerTool(`search_${entity.plural}`, {
            title: `Search Big Red Cloud ${entity.label}`,
            description: `Search ${entity.label} by text${entity.documents ? ", transaction date or counterparty code" : " or exact code"} in linked companies. Empty query lists records. Continue with nextCursor even after an empty page.`,
            annotations,
            inputSchema: z.object({
                query: z.string().max(1000).describe("Text to match in record summaries; empty string lists records."),
                companyName: z.string().min(1).max(4000).optional().describe("Linked company name; omit to search all your linked companies."),
                ...(entity.documents ? {
                    counterpartyCode: z.string().min(1).max(256).optional().describe(supplierLedgers.has(entity.singular) ? "Exact supplier account code." : "Exact customer account code."),
                    dateFrom: z.iso.date().optional().describe("Inclusive earliest transaction date, YYYY-MM-DD."),
                    dateTo: z.iso.date().optional().describe("Inclusive latest transaction date, YYYY-MM-DD."),
                } : { code: z.string().min(1).max(256).optional().describe("Exact record code, matched without case sensitivity.") }),
                pageSize: z.number().int().min(1).max(50).optional().describe("Records examined per company page; default 20, at most three pages per call."),
                nextCursor: z.string().max(4096).optional().describe("Continuation from this search; keep the query, company, filters and pageSize unchanged."),
            }).strict(),
        }, args => searchCopilotEntity(entity, args));
        server.registerTool(`fetch_${entity.singular}`, {
            title: `Fetch Big Red Cloud ${entity.label === "purchases" ? "purchase" : entity.label.replace(/s$/, "")}`,
            description: `Retrieve one ${entity.label === "purchases" ? "purchase" : entity.label.replace(/s$/, "")} using its exact identifier and company from search_${entity.plural}.${entity.get ? "" : " Continue with nextCursor if an account lookup is incomplete."}`,
            annotations,
            inputSchema: z.object({
                [entity.idField]: z.string().min(1).max(256).describe(`Exact ${entity.idField} returned by search_${entity.plural}; not a document reference.${entity.get ? "" : " Accounts use id:... or code:... identifiers."}`),
                companyName: z.string().min(1).max(4000).describe("Company name returned with the search result; identifiers are company-scoped."),
                ...(!entity.get ? { nextCursor: z.string().max(4096).optional().describe("Continuation from an incomplete fetch_account; keep accountId and companyName unchanged.") } : {}),
            }).strict(),
        }, args => fetchCopilotEntity(entity, { companyName: args.companyName, recordId: args[entity.idField], nextCursor: args.nextCursor }));
    }
}
