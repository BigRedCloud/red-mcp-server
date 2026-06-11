import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrcMcpServerInstructions } from "./mcp_config.js";
import { getMaxBatchItems, redServerConfig } from "./server_config.js";
export function createBrcMcpServer() {
    return new McpServer({
        name: "Red",
        version: "1.4.0",
    }, {
        instructions: getBrcMcpServerInstructions(getMaxBatchItems(), redServerConfig.allowDevMode),
    });
}
/** Singleton for stdio (local) entry point. */
export const server = createBrcMcpServer();
