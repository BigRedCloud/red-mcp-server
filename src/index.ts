#!/usr/bin/env node

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllTools } from "./register_all_tools.js";
import { server } from "./server.js";

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
