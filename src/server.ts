import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrcMcpServerInstructions } from "./mcp_config.js";
import { getMaxBatchItems, redConnectServerConfig } from "./server_config.js";

export function createBrcMcpServer(): McpServer {
  return new McpServer(
    {
      name: "RED Connect",
      version: "1.4.0",
    },
    {
      instructions: getBrcMcpServerInstructions(
        getMaxBatchItems(),
        redConnectServerConfig.allowDevMode
      ),
    }
  );
}

/** Singleton for stdio (local) entry point. */
export const server = createBrcMcpServer();

export type ServerType = McpServer;
