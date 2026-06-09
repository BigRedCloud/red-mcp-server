import { z } from "zod";
import { brcFetch, companyNameSchema, jsonResponse } from "../../shared.js";
function buildListQuery(args) {
    const params = new URLSearchParams();
    if (args.page !== undefined)
        params.set("page", String(args.page));
    if (args.pageSize !== undefined)
        params.set("pageSize", String(args.pageSize));
    if (args.filter?.trim())
        params.set("$filter", args.filter.trim());
    if (args.orderBy?.trim())
        params.set("$orderby", args.orderBy.trim());
    if (args.top !== undefined)
        params.set("$top", String(args.top));
    if (args.skip !== undefined)
        params.set("$skip", String(args.skip));
    const query = params.toString();
    return query ? `?${query}` : "";
}
export function registerListTool(server, toolName, description, path) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(500).default(20),
        filter: z
            .string()
            .optional()
            .describe("Optional OData $filter expression, only if this endpoint supports filtering."),
        orderBy: z
            .string()
            .optional()
            .describe("Optional OData $orderby expression, only if this endpoint supports ordering."),
        top: z.number().int().positive().max(500).optional(),
        skip: z.number().int().min(0).optional(),
    }, async (args) => {
        const { companyName, page, pageSize, filter, orderBy, top, skip } = args;
        const query = buildListQuery({ page, pageSize, filter, orderBy, top, skip });
        const data = await brcFetch(companyName, `${path}${query}`);
        return jsonResponse(data);
    });
}
export function registerGetTool(server, toolName, description, path, itemName) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        id: z.union([z.string(), z.number()]).describe(`${itemName} id.`),
    }, async (args) => {
        const { companyName, id } = args;
        const data = await brcFetch(companyName, `${path}/${encodeURIComponent(String(id))}`);
        return jsonResponse(data);
    });
}
/** GET `{basePath}/{itemId}/{subPath}` — opening balances, account trans, quotes, etc. */
export function registerSubresourceGetTool(server, toolName, description, basePath, subPath, ownerLabel) {
    server.tool(toolName, description, {
        companyName: companyNameSchema,
        itemId: z.string().describe(`${ownerLabel} item id.`),
    }, async ({ companyName, itemId }) => {
        const data = await brcFetch(companyName, `${basePath}/${encodeURIComponent(itemId)}/${subPath}`);
        return jsonResponse(data);
    });
}
// Read/list tools ------------------------------------------------------------
export function registerTools(server) {
    // Accounts
    registerListTool(server, "brc_list_accounts", "Lists BRC accounts.", "/v1/accounts");
    // Customers
    registerListTool(server, "brc_list_customers", "Lists BRC customers.", "/v1/customers");
    registerGetTool(server, "brc_get_customer", "Gets one BRC customer by id.", "/v1/customers", "Customer");
    registerListTool(server, "brc_list_customers_without_dormant", "Lists BRC customers without dormant records.", "/v1/customers/GetWithoutDormant");
    // Suppliers
    registerListTool(server, "brc_list_suppliers", "Lists BRC suppliers.", "/v1/suppliers");
    registerGetTool(server, "brc_get_supplier", "Gets one BRC supplier by id.", "/v1/suppliers", "Supplier");
    // Products
    registerListTool(server, "brc_list_products", "Lists BRC products.", "/v1/products");
    registerListTool(server, "brc_list_product_types", "Lists BRC product types.", "/v1/productTypes");
    registerListTool(server, "brc_list_products_without_dormant", "Lists BRC products without dormant records.", "/v1/products/GetWithoutDormant");
    // Sales Entries
    registerListTool(server, "brc_list_sales_entries", "Lists BRC sales entries.", "/v1/salesEntries");
    registerGetTool(server, "brc_get_sales_entry", "Gets one BRC sales entry by id.", "/v1/salesEntries", "Sales entry");
    // Sales Invoices
    registerListTool(server, "brc_list_sales_invoices", "Lists BRC sales invoices.", "/v1/salesInvoices");
    registerGetTool(server, "brc_get_sales_invoice", "Gets one BRC sales invoice by id.", "/v1/salesInvoices", "Sales invoice");
    // Purchases
    registerListTool(server, "brc_list_purchases", "Lists BRC purchases.", "/v1/purchases");
    registerGetTool(server, "brc_get_purchase", "Gets one BRC purchase by id.", "/v1/purchases", "Purchase");
    // Analysis Categories
    registerListTool(server, "brc_list_analysis_categories", "Lists BRC analysis categories.", "/v1/analysisCategories");
    // VAT Rates
    registerListTool(server, "brc_list_vat_rates", "Lists BRC VAT rates.", "/v1/vatRates");
    registerListTool(server, "brc_list_vat_analysis_types", "Lists BRC VAT analysis types.", "/v1/vatAnalysisTypes");
    registerListTool(server, "brc_list_vat_categories", "Lists BRC VAT categories.", "/v1/vatCategories");
    registerListTool(server, "brc_list_vat_types", "Lists BRC VAT types.", "/v1/vatTypes");
    // Company Settings
    registerListTool(server, "brc_list_company_settings", "Lists BRC company settings.", "/v1/companySettings");
    // Category Types
    registerListTool(server, "brc_list_category_types", "Lists BRC category types.", "/v1/categoryTypes");
    // Owner Type Groups
    registerListTool(server, "brc_list_owner_type_groups", "Lists BRC owner type groups.", "/v1/ownerTypeGroups");
    registerListTool(server, "brc_list_owner_types", "Lists BRC owner types.", "/v1/ownerTypes");
    // User Defined Fields
    registerListTool(server, "brc_list_user_defined_fields", "Lists BRC user defined fields.", "/v1/userDefinedFields");
    // Book Transaction Types
    registerListTool(server, "brc_list_book_tran_types", "Lists BRC book transaction types.", "/v1/bookTranTypes");
    // Nominal Accounts
    registerListTool(server, "brc_list_nominal_accounts", "Lists BRC nominal accounts.", "/v1/nominalAccounts");
    registerGetTool(server, "brc_get_nominal_account_ledger_by_id", "Gets one BRC nominal account by id.", "/v1/nominalAccounts", "Nominal account");
    // Quotes
    registerListTool(server, "brc_list_quotes", "Lists BRC quotes.", "/v1/quotes");
    registerGetTool(server, "brc_get_quote", "Gets one BRC quote by id.", "/v1/quotes", "Quote");
    // Sales Credit Notes
    registerListTool(server, "brc_list_sales_credit_notes", "Lists BRC sales credit notes.", "/v1/salesCreditNotes");
    registerGetTool(server, "brc_get_sales_credit_note", "Gets one BRC sales credit note by id.", "/v1/salesCreditNotes", "Sales credit note");
    // Sales Reps
    registerListTool(server, "brc_list_sales_reps", "Lists BRC sales reps.", "/v1/salesReps");
    registerGetTool(server, "brc_get_sales_rep", "Gets one BRC sales rep by id.", "/v1/salesReps", "Sales rep");
}
