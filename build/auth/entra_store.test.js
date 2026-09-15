import assert from "node:assert/strict";
import test from "node:test";
function env(t, key, value) { const old = process.env[key]; process.env[key] = value; t.after(() => { if (old === undefined)
    delete process.env[key];
else
    process.env[key] = old; }); }
import { randomUUID } from "node:crypto";
import { CosmosConnectionStore } from "./cosmos_connection_store.js";
import { MemoryConnectionStore } from "./memory_connection_store.js";
import { EntraConnectionStore, createMemorySsoBackend, SSO_LINK_TTL_MS, ownerKey } from "./entra_store.js";
import { decodeStoredApiKey } from "./credential_secret.js";
function cosmosFixture() {
    const backend = createMemorySsoBackend();
    const store = new CosmosConnectionStore("AccountEndpoint=https://localhost:8081/;AccountKey=ZmFrZQ==;", "test", "test");
    const conflict = (code) => { throw { code }; };
    // Exercise the real Cosmos adapter: create conflicts and ETag preconditions.
    store.container = {
        item: (id, pk) => ({ read: async () => { const resource = await backend.read(pk, id); return resource ? { resource } : conflict(404); }, replace: async (d, options) => {
                assert.equal(options.accessCondition.type, "IfMatch");
                return await backend.replace(d, options.accessCondition.condition) ? {} : conflict(412);
            } }),
        items: {
            create: async (d) => await backend.create(d) ? {} : conflict(409),
            upsert: async (d) => { const old = await backend.read(d.pk, d.id); if (old)
                await backend.replace(d, old._etag);
            else
                await backend.create(d); return {}; },
            query: (q, opts) => ({ fetchAll: async () => ({ resources: await backend.list(opts?.partitionKey ?? q.parameters.find(p => p.name === "@pk").value) }) })
        },
    };
    return store;
}
for (const kind of ["memory", "cosmos"])
    test(`${kind}: unique Entra ownership, atomic links, cross-user isolation and multiple encrypted companies`, async (t) => {
        env(t, "RED_CONNECT_ENCRYPTION_KEY", "test-only-generated-encryption-material");
        const implementation = kind === "memory" ? new MemoryConnectionStore() : cosmosFixture();
        const store = implementation.entra;
        const a = { tenantId: randomUUID(), objectId: randomUUID() }, b = { ...a, objectId: randomUUID() };
        const links = await Promise.all(Array.from({ length: 10 }, () => store.createLink(a)));
        assert.equal(new Set(links).size, 10);
        for (const token of links)
            assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        assert.ok((await Promise.all(links.map(link => store.checkLink(a, link)))).every(Boolean));
        assert.equal(await store.checkLink({ ...a, tenantId: randomUUID() }, links[0], true), false);
        assert.equal(await store.checkLink(b, links[0], true), false);
        const tampered = (links[0][0] === "a" ? "b" : "a") + links[0].slice(1);
        assert.equal(await store.checkLink(a, tampered, true), false);
        const used = await Promise.all(Array.from({ length: 10 }, () => store.checkLink(a, links[0], true)));
        assert.equal(used.filter(Boolean).length, 1);
        assert.equal(await store.checkLink(a, links[0]), false);
        const companies = ["A", "B"].map(companyName => ({ companyName, apiKey: `test-only-${companyName}`, expiresAt: Date.now() + 60_000 }));
        await store.saveCompanies(a, companies);
        const found = await store.listCompanies(a);
        assert.deepEqual(found.map(c => c.companyName), ["A", "B"]);
        assert.equal(new Set(found.map(c => c.connectionId)).size, 1);
        assert.notEqual(found[0].connectionId, a.objectId);
        assert.ok(found.every(c => c.encryptedSecret.startsWith("enc:")));
        assert.equal(decodeStoredApiKey(found[0].encryptedSecret), "test-only-A");
        assert.deepEqual(await store.listCompanies(b), []);
        await assert.rejects(store.saveCompanies(b, companies));
        const legacy = implementation;
        await legacy.saveConnectedCompanies("anonymous-test", companies);
        assert.equal((await legacy.listConnectedCompanies("anonymous-test")).length, 2);
        assert.deepEqual(await legacy.entra.listCompanies(b), []);
        assert.deepEqual(await legacy.listConnectedCompanies(found[0].connectionId), []);
    });
test("SSO links expire at the exact deadline and unencrypted persistence fails closed", async (t) => {
    let now = 1000;
    const store = new EntraConnectionStore(createMemorySsoBackend(), () => now);
    const owner = { tenantId: randomUUID(), objectId: randomUUID() };
    const link = await store.createLink(owner);
    now += SSO_LINK_TTL_MS;
    assert.equal(await store.checkLink(owner, link, true), false);
    env(t, "RED_CONNECT_ENCRYPTION_KEY", "");
    env(t, "RED_CONNECT_COSMOS_CONNECTION_STRING", "");
    await assert.rejects(store.saveCompanies(owner, [{ companyName: "A", apiKey: "test-only", expiresAt: now + 1000 }]));
    assert.deepEqual(await store.listCompanies(owner), []);
});
for (const kind of ["memory", "cosmos"])
    test(`${kind}: public pending requests require owner and consume atomically`, async () => {
        const store = (kind === "memory" ? new MemoryConnectionStore() : cosmosFixture()).entra;
        const owner = { tenantId: randomUUID(), objectId: randomUUID() }, other = { ...owner, objectId: randomUUID() };
        const handle = await store.createPendingRequest(owner);
        assert.match(handle, /^req_[A-Za-z0-9_-]{43}$/);
        assert.equal(await store.checkLink(owner, handle, true), false);
        const secret = await store.createLink(owner);
        assert.equal(await store.checkPendingRequest(owner, secret, true), false);
        assert.equal(await store.checkPendingRequest(other, handle, true), false);
        assert.equal(await store.checkPendingRequest({ ...owner, tenantId: randomUUID() }, handle, true), false);
        assert.equal(await store.checkPendingRequest(owner, "req_" + "x".repeat(43), true), false);
        assert.equal(await store.checkPendingRequest(owner, "malformed", true), false);
        const expiry = await store.pendingRequestExpiry(owner, handle);
        for (let i = 0; i < 3; i++)
            assert.equal(await store.checkPendingRequest(owner, handle), true);
        assert.equal(await store.pendingRequestExpiry(owner, handle), expiry);
        const results = await Promise.all(Array.from({ length: 10 }, () => store.checkPendingRequest(owner, handle, true)));
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(await store.checkPendingRequest(owner, handle), false);
    });
test("pending request original deadline is authoritative and records contain no credentials", async () => {
    let now = 1000;
    const backend = createMemorySsoBackend(), store = new EntraConnectionStore(backend, () => now);
    const owner = { tenantId: randomUUID(), objectId: randomUUID() }, handle = await store.createPendingRequest(owner);
    const records = await backend.list("entra:" + ownerKey(owner));
    const pending = records.find(r => r.type === "entraPendingRequest");
    assert.deepEqual(Object.keys(pending).sort(), ["_etag", "connectionId", "expiresAt", "id", "ownerKey", "pk", "ttl", "type", "used"].sort());
    assert.ok(pending.id.startsWith("request:"));
    for (const value of [handle, owner.tenantId, owner.objectId])
        assert.equal(JSON.stringify(records).includes(value), false);
    now += SSO_LINK_TTL_MS - 1;
    assert.equal(await store.checkPendingRequest(owner, handle), true);
    assert.equal(await store.pendingRequestExpiry(owner, handle), 1000 + SSO_LINK_TTL_MS);
    now++;
    assert.equal(await store.checkPendingRequest(owner, handle, true), false);
    assert.equal(await store.pendingRequestExpiry(owner, handle), null);
});
