import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrcMcpServerInstructions } from "./config/mcp_config.js";
import { getMaxBatchItems, redServerConfig } from "./config/server_config.js";
export function createBrcMcpServer(instructions) {
    return new McpServer({
        name: "Red",
        version: "1.6.1",
    }, {
        instructions: instructions ?? getBrcMcpServerInstructions(getMaxBatchItems(), redServerConfig.allowDevMode),
    });
}
/** Singleton for stdio (local) entry point. */
export const server = createBrcMcpServer();
