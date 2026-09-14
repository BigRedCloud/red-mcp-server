import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { listCopilotCustomers } from "./copilot_customers.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { getConnectionStore } from "./auth/connection_store.js";
import { encryptCredentialSecret, decryptCredentialSecret } from "./auth/credential_encryption.js";
test("customer cursors reject another connected owner, tampering and expiry; output redacts echoed secrets", async (t) => {
    const old = process.env.RED_CONNECT_ENCRYPTION_KEY;
    process.env.RED_CONNECT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    t.after(() => { if (old === undefined)
        delete process.env.RED_CONNECT_ENCRYPTION_KEY;
    else
        process.env.RED_CONNECT_ENCRYPTION_KEY = old; });
    const a = { tenantId: randomUUID(), objectId: randomUUID() }, b = { ...a, objectId: randomUUID() };
    const store = getConnectionStore().entra;
    for (const owner of [a, b]) {
        await store.createLink(owner);
        await store.saveCompanies(owner, [{ companyName: "A", apiKey: "synthetic-only-secret", expiresAt: Date.now() + 60_000 }]);
    }
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify({ Items: [{ Id: 1, Name: `synthetic-only-secret ${a.objectId}`, apiKey: "synthetic-only-secret" }], Count: 99 })); });
    const invoke = (owner, args) => entraRequestOwner.run(owner, () => listCopilotCustomers(args));
    assert.equal((await listCopilotCustomers({})).structuredContent.status, "authentication_required");
    assert.equal(calls, 0);
    const first = await invoke(a, { pageSize: 1 });
    assert.equal(calls, 3);
    assert.doesNotMatch(JSON.stringify(first), /synthetic-only-secret|apiKey/);
    assert.equal(JSON.stringify(first).includes(a.objectId), false);
    const cursor = String(first.structuredContent.nextCursor);
    assert.equal((await invoke(b, { cursor })).structuredContent.status, "invalid_cursor");
    assert.equal((await invoke(a, { cursor: cursor + "garbage" })).structuredContent.status, "invalid_cursor");
    const expired = JSON.parse(decryptCredentialSecret(cursor));
    expired.exp = Date.now() - 1;
    assert.equal((await invoke(a, { cursor: encryptCredentialSecret(JSON.stringify(expired)) })).structuredContent.status, "invalid_cursor");
    assert.equal((await invoke(a, { cursor, pageSize: 2 })).structuredContent.status, "invalid_cursor");
    assert.equal(calls, 3, "invalid continuations perform no BRC calls");
});
