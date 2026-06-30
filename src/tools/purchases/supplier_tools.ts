import type { ServerType } from "../../server.js";
import {
  registerRawCreateTool,
  registerRawDeleteTool,
  registerRawUpdateTool,
} from "../general/crud_tools.js";
import { registerSubresourceGetTool } from "../general/list_tools.js";

export function registerSupplierTools(server: ServerType) {
  registerRawCreateTool(
    server,
    "brc_create_supplier",
    "Creates a BRC supplier using a raw BRC payload. Does not create or update opening balance transactions. If the user provides an opening balance, warn them that it must be entered directly in Big Red Cloud.",
    "/v1/suppliers"
  );
  registerRawUpdateTool(
    server,
    "brc_update_supplier",
    "Updates a BRC supplier using merged fields.",
    "/v1/suppliers",
    "Supplier"
  );
  registerRawDeleteTool(
    server,
    "brc_delete_supplier",
    "Deletes a BRC supplier by id.",
    "/v1/suppliers",
    "supplier"
  );

  registerSubresourceGetTool(
    server,
    "brc_get_supplier_opening_balance",
    "Gets a supplier's opening balance.",
    "/v1/suppliers",
    "openingBalance",
    "Supplier"
  );
  registerSubresourceGetTool(
    server,
    "brc_list_supplier_op_bal_trans",
    "Gets a supplier's opening balance transaction list.",
    "/v1/suppliers",
    "openingBalanceList",
    "Supplier"
  );
  registerSubresourceGetTool(
    server,
    "brc_list_supplier_account_trans",
    "Gets a supplier's account transactions.",
    "/v1/suppliers",
    "accountTrans",
    "Supplier"
  );
}
