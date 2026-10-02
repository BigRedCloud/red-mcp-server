// Tests must not inherit operator credentials or load a local .env file.
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of Object.keys(process.env)) {
  if (/^(BRC_|RED_|FRESHDESK_|APPLICATIONINSIGHTS_|MICROSOFT_PROVIDER_|OPENAI_APPS_|WEBSITE_)/.test(name)) {
    delete process.env[name];
  }
}
process.env.DOTENV_CONFIG_PATH = path.join(root, ".env.disabled-for-local-tests");
process.env.NODE_ENV = "test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = "";
