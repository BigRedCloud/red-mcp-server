#!/usr/bin/env node

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllTools } from "./register_all_tools.js";
import {
  ensureConnectionStoreInitialized,
  ensureLocalStdioSessionContext,
  LOCAL_STDIO_CONNECTION_ID,
} from "./auth/connection_store.js";
import { hydrateSessionKeyStoreFromConnectionStore } from "./auth/connection_persistence.js";
import { getCompanyApiContexts } from "./shared.js";
import { server } from "./server.js";

await ensureConnectionStoreInitialized();
await ensureLocalStdioSessionContext();
await hydrateSessionKeyStoreFromConnectionStore(
  LOCAL_STDIO_CONNECTION_ID,
  getCompanyApiContexts()
);

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
