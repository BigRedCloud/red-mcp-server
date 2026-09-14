// Child-process test instrumentation: any company-store access or outbound
// fetch fails the integration test, even if application code catches the error.
import { MemoryConnectionStore } from "../../../build/auth/memory_connection_store.js";
const forbidden = (name) => () => {
  process.stderr.write(`DIAGNOSTIC_FORBIDDEN_IO:${name}\n`);
  throw new Error(`Diagnostic attempted ${name}`);
};
for (const name of Object.getOwnPropertyNames(MemoryConnectionStore.prototype)) {
  if (name !== "constructor" && name !== "initialize" && name !== "getStoreType") {
    MemoryConnectionStore.prototype[name] = forbidden(`company store ${name}`);
  }
}
globalThis.fetch = forbidden("outbound fetch");