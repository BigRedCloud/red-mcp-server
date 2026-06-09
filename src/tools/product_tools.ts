import type { ServerType } from "../server.js";
import { registerGetTool } from "./general/list_tools.js";
import {
  registerRawCreateTool,
  registerRawUpdateTool,
  registerRawDeleteTool,
} from "./general/crud_tools.js";

export function registerProductTools(server: ServerType) {

  // Products
  registerGetTool(server, "brc_get_product", "Gets one BRC product by id.", "/v1/products", "Product");
  registerRawCreateTool(server, "brc_create_product", "Creates a BRC product using a raw BRC payload.", "/v1/products");
  registerRawUpdateTool(server, "brc_update_product", "Updates a BRC product using merged fields.", "/v1/products", "Product");
  registerRawDeleteTool(server, "brc_delete_product", "Deletes a BRC product by id.", "/v1/products", "product");
}
