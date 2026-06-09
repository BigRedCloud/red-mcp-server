import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRC_MCP_SERVER_INSTRUCTIONS } from "./mcp_config.js";
export function createBrcMcpServer() {
    return new McpServer({
        name: "RED Connect",
        version: "1.4.0",
    }, {
        instructions: BRC_MCP_SERVER_INSTRUCTIONS,
    });
}
/** Singleton for stdio (local) entry point. */
export const server = createBrcMcpServer();
