#!/usr/bin/env node
/**
 * Stdio MCP server entry for legacy regression scripts.
 * Seeds the in-memory connection store from BRC_TEST_* env vars (never logged).
 */
import "dotenv/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function importFromBuild(relativePath) {
  return import(pathToFileURL(join(repoRoot, relativePath)).href);
}

process.env.RED_CONNECT_CONNECTION_STORE ??= "memory";

const {
  ensureConnectionStoreInitialized,
  ensureLocalStdioSessionContext,
  LOCAL_STDIO_CONNECTION_ID,
  getConnectionStore,
} = await importFromBuild("build/auth/connection_store.js");

await ensureConnectionStoreInitialized();
await ensureLocalStdioSessionContext();

const companyName =
  process.env.BRC_TEST_COMPANY?.trim() ||
  process.env.BRC_TEST_COMPANY_NAME?.trim();
const apiKey = process.env.BRC_TEST_API_KEY?.trim();

if (companyName && apiKey) {
  const ttlMinutes = Number(process.env.BRC_API_KEY_TTL_MINUTES || 120);
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;

  await getConnectionStore().saveConnectedCompanies(LOCAL_STDIO_CONNECTION_ID, [
    {
      companyName,
      apiKey,
      expiresAt,
    },
  ]);
}

const { hydrateSessionKeyStoreFromConnectionStore } = await importFromBuild(
  "build/auth/connection_persistence.js"
);
const { getCompanyApiContexts } = await importFromBuild("build/shared.js");

await hydrateSessionKeyStoreFromConnectionStore(
  LOCAL_STDIO_CONNECTION_ID,
  getCompanyApiContexts()
);

const { registerAllTools } = await importFromBuild("build/register_all_tools.js");
const { server } = await importFromBuild("build/server.js");
const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
