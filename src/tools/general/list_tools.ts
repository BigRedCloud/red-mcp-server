import { z } from "zod";
import type { ServerType } from "../../server.js";
import { brcFetch, companyNameSchema, jsonResponse } from "../../shared.js";

function buildListQuery(args: {
  page?: number;
  pageSize?: number;
  filter?: string;
  orderBy?: string;
  top?: number;
  skip?: number;
}) {
  const params = new URLSearchParams();
  if (args.page !== undefined) params.set("page", String(args.page));
  if (args.pageSize !== undefined) params.set("pageSize", String(args.pageSize));
  if (args.filter?.trim()) params.set("$filter", args.filter.trim());
  if (args.orderBy?.trim()) params.set("$orderby", args.orderBy.trim());
  if (args.top !== undefined) params.set("$top", String(args.top));
  if (args.skip !== undefined) params.set("$skip", String(args.skip));

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function registerListTool(
  server: ServerType,
  toolName: string,
  description: string,
  path: string
) {
  server.tool(
    toolName,
    description,
    {
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
    },
    async (args: {
      companyName: string;
      page: number;
      pageSize: number;
      filter?: string;
      orderBy?: string;
      top?: number;
      skip?: number;
    }) => {
      const { companyName, page, pageSize, filter, orderBy, top, skip } = args;
      const query = buildListQuery({ page, pageSize, filter, orderBy, top, skip });
      const data = await brcFetch(companyName, `${path}${query}`);
      return jsonResponse(data);
    }
  );
}

export function registerGetTool(
  server: ServerType,
  toolName: string,
  description: string,
  path: string,
  itemName: string
) {
  server.tool(
    toolName,
    description,
    {
      companyName: companyNameSchema,
      id: z.union([z.string(), z.number()]).describe(`${itemName} id.`),
    },
    async (args: { companyName: string; id: string | number }) => {
      const { companyName, id } = args;
      const data = await brcFetch(
        companyName,
        `${path}/${encodeURIComponent(String(id))}`
      );
      return jsonResponse(data);
    }
  );
}

/** GET `{basePath}/{itemId}/{subPath}` — opening balances, account trans, quotes, etc. */
export function registerSubresourceGetTool(
  server: ServerType,
  toolName: string,
  description: string,
  basePath: string,
  subPath: string,
  ownerLabel: string
) {
  server.tool(
    toolName,
    description,
    {
      companyName: companyNameSchema,
      itemId: z.string().describe(`${ownerLabel} item id.`),
    },
    async ({ companyName, itemId }) => {
      const data = await brcFetch(
        companyName,
        `${basePath}/${encodeURIComponent(itemId)}/${subPath}`
      );
      return jsonResponse(data);
    }
  );
}

// Read/list tools ------------------------------------------------------------
export function registerTools(server: ServerType) {
  // Accounts
  registerListTool(server, "brc_list_accounts", "Lists BRC accounts.", "/v1/accounts");

  // Customers
  registerListTool(server, "brc_list_customers", "Lists BRC customers.", "/v1/customers");
  registerGetTool(server, "brc_get_customer", "Gets one BRC customer by id.", "/v1/customers", "Customer");
  registerListTool(
    server,
    "brc_list_customers_without_dormant",
    "Lists BRC customers without dormant records.",
    "/v1/customers/GetWithoutDormant"
  );

  // Suppliers
  registerListTool(server, "brc_list_suppliers", "Lists BRC suppliers.", "/v1/suppliers");
  registerGetTool(server, "brc_get_supplier", "Gets one BRC supplier by id.", "/v1/suppliers", "Supplier");

  // Products
  registerListTool(server, "brc_list_products", "Lists BRC products.", "/v1/products");
  registerListTool(server, "brc_list_product_types", "Lists BRC product types.", "/v1/productTypes");
  registerListTool(
    server,
    "brc_list_products_without_dormant",
    "Lists BRC products without dormant records.",
    "/v1/products/GetWithoutDormant"
  );

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
  registerListTool(
    server,
    "brc_list_analysis_categories",
    "Lists BRC analysis categories. For sales invoice and sales credit note product lines, choose a Sales analysis category that matches the income type. Do not default to a CR/customer category such as CR01 Customer — CR categories are customer control categories, not sales categories. If no clearly correct Sales category stands out, ask the user instead of picking the first plausible-looking one.",
    "/v1/analysisCategories"
  );

  // VAT Rates
  registerListTool(
    server,
    "brc_list_vat_rates",
    "Lists BRC VAT rates. Each rate belongs to a VAT category via vatCategoryId (for example Sales, Purchases for Resale, Purchases not for Resale). For a sales invoice or sales credit note line, use a VAT rate whose vatCategoryId is a Sales VAT category, even if a purchase rate has the same percentage. Cross-reference brc_list_vat_categories to group rates by Sales vs Purchase category before choosing.",
    "/v1/vatRates"
  );
  registerListTool(server, "brc_list_vat_analysis_types", "Lists BRC VAT analysis types.", "/v1/vatAnalysisTypes");
  registerListTool(
    server,
    "brc_list_vat_categories",
    "Lists BRC VAT categories (for example Sales, Purchases for Resale, Purchases not for Resale). Use this to tell which VAT category a VAT rate belongs to. Sales invoices and sales credit notes must use VAT rates from a Sales VAT category, not a purchase category.",
    "/v1/vatCategories"
  );
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
  registerGetTool(
    server,
    "brc_get_nominal_account_ledger_by_id",
    "Gets one BRC nominal account by id.",
    "/v1/nominalAccounts",
    "Nominal account"
  );

  // Quotes
  registerListTool(server, "brc_list_quotes", "Lists BRC quotes.", "/v1/quotes");
  registerGetTool(server, "brc_get_quote", "Gets one BRC quote by id.", "/v1/quotes", "Quote");

  // Sales Credit Notes
  registerListTool(server, "brc_list_sales_credit_notes", "Lists BRC sales credit notes.", "/v1/salesCreditNotes");
  registerGetTool(
    server,
    "brc_get_sales_credit_note",
    "Gets one BRC sales credit note by id.",
    "/v1/salesCreditNotes",
    "Sales credit note"
  );

  // Sales Reps
  registerListTool(server, "brc_list_sales_reps", "Lists BRC sales reps.", "/v1/salesReps");
  registerGetTool(server, "brc_get_sales_rep", "Gets one BRC sales rep by id.", "/v1/salesReps", "Sales rep");
}
