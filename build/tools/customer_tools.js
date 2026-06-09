import { registerRawCreateTool, registerRawDeleteTool, registerRawUpdateTool, } from "./general/crud_tools.js";
import { registerSubresourceGetTool } from "./general/list_tools.js";
export function registerCustomerTools(server) {
    registerRawCreateTool(server, "brc_create_customer", "Creates a BRC customer using a raw BRC payload.", "/v1/customers");
    registerRawUpdateTool(server, "brc_update_customer", "Updates a BRC customer using merged fields.", "/v1/customers", "Customer");
    registerRawDeleteTool(server, "brc_delete_customer", "Deletes a BRC customer by id.", "/v1/customers", "customer");
    registerSubresourceGetTool(server, "brc_get_customer_opening_balance", "Gets a customer's opening balance.", "/v1/customers", "openingBalance", "Customer");
    registerSubresourceGetTool(server, "brc_list_customer_op_bal_trans", "Gets a customer's opening balance transaction list.", "/v1/customers", "openingBalanceList", "Customer");
    registerSubresourceGetTool(server, "brc_list_customer_account_trans", "Gets a customer's account transactions.", "/v1/customers", "accountTrans", "Customer");
    registerSubresourceGetTool(server, "brc_list_customer_quotes", "Gets quotes for a specific customer.", "/v1/customers", "quotes", "Customer");
}
