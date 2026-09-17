import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { fetchCopilotCustomer, listCopilotCustomers } from "./copilot_customers.js";
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
test("customer search bounds scans, lists with empty query and binds continuation to query", async (t) => {
    const old = process.env.RED_CONNECT_ENCRYPTION_KEY;
    process.env.RED_CONNECT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    t.after(() => { if (old === undefined)
        delete process.env.RED_CONNECT_ENCRYPTION_KEY;
    else
        process.env.RED_CONNECT_ENCRYPTION_KEY = old; });
    const owner = { tenantId: randomUUID(), objectId: randomUUID() };
    const oldHttpMode = process.env.RED_CONNECT_HTTP_MODE;
    process.env.RED_CONNECT_HTTP_MODE = "true";
    t.after(() => { if (oldHttpMode === undefined)
        delete process.env.RED_CONNECT_HTTP_MODE;
    else
        process.env.RED_CONNECT_HTTP_MODE = oldHttpMode; });
    await getConnectionStore().entra.createLink(owner);
    await getConnectionStore().entra.saveCompanies(owner, [{ companyName: "Search Co", apiKey: "search-test-secret", expiresAt: Date.now() + 60_000 }]);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input) => {
        calls++;
        const page = Number(new URL(String(input)).searchParams.get("page"));
        return new Response(JSON.stringify({ Items: page <= 3 ? Array.from({ length: 20 }, (_, i) => ({ Id: (page - 1) * 20 + i + 1, Name: "Other" })) : [{ Id: 61, Name: "Needle" }] }));
    });
    const invoke = (args) => entraRequestOwner.run(owner, () => listCopilotCustomers(args));
    const empty = await invoke({ query: "" });
    assert.equal(calls, 3);
    assert.equal(empty.structuredContent.companies.flatMap(g => g.customers).length, 60);
    const first = await invoke({ query: "needle" });
    assert.equal(calls, 6);
    assert.equal(first.structuredContent.companies.flatMap(g => g.customers).length, 0);
    assert.equal(first.structuredContent.complete, false);
    const cursor = String(first.structuredContent.nextCursor);
    assert.equal((await invoke({ query: "different", cursor })).structuredContent.status, "invalid_cursor");
    assert.equal(calls, 6);
    const next = await invoke({ query: "needle", cursor });
    assert.equal(calls, 7);
    assert.equal(next.structuredContent.companies[0].customers[0].Id, 61);
    assert.equal(next.structuredContent.complete, true);
});
test("customer fetch uses a linked company, exact ID and safe projection", async (t) => {
    const old = process.env.RED_CONNECT_ENCRYPTION_KEY;
    process.env.RED_CONNECT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    t.after(() => { if (old === undefined)
        delete process.env.RED_CONNECT_ENCRYPTION_KEY;
    else
        process.env.RED_CONNECT_ENCRYPTION_KEY = old; });
    const owner = { tenantId: randomUUID(), objectId: randomUUID() }, other = { ...owner, objectId: randomUUID() };
    const oldHttpMode = process.env.RED_CONNECT_HTTP_MODE;
    process.env.RED_CONNECT_HTTP_MODE = "true";
    t.after(() => { if (oldHttpMode === undefined)
        delete process.env.RED_CONNECT_HTTP_MODE;
    else
        process.env.RED_CONNECT_HTTP_MODE = oldHttpMode; });
    await getConnectionStore().entra.createLink(owner);
    await getConnectionStore().entra.saveCompanies(owner, [{ companyName: "Fetch Co", apiKey: "fetch-test-secret", expiresAt: Date.now() + 60_000 }]);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input, init) => {
        calls++;
        assert.equal(new URL(String(input)).pathname, "/api/v1/customers/1");
        assert.ok(!init?.method || init.method === "GET");
        return new Response(JSON.stringify({ Id: 1, Name: `Customer fetch-test-secret ${owner.objectId}`, apiKey: "fetch-test-secret" }));
    });
    const args = { customerId: "1", companyName: "Fetch Co" };
    assert.equal((await fetchCopilotCustomer(args)).structuredContent.status, "authentication_required");
    assert.equal((await entraRequestOwner.run(other, () => fetchCopilotCustomer(args))).structuredContent.status, "customer_unavailable");
    assert.equal((await entraRequestOwner.run(owner, () => fetchCopilotCustomer({ ...args, customerId: ".." }))).structuredContent.status, "invalid_request");
    assert.equal(calls, 0);
    const result = await entraRequestOwner.run(owner, () => fetchCopilotCustomer(args));
    assert.equal(result.structuredContent.status, "ok");
    assert.equal(result.structuredContent.customer.Id, 1);
    assert.doesNotMatch(JSON.stringify(result), /fetch-test-secret|apiKey/);
    assert.equal(JSON.stringify(result).includes(owner.objectId), false);
    assert.equal(calls, 1);
});
