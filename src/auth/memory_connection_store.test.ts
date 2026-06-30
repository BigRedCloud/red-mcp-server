import assert from "node:assert/strict";
import test from "node:test";
import { MemoryConnectionStore } from "./memory_connection_store.js";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test("MemoryConnectionStore creates, completes and consumes pending connections", async () => {
  const store = new MemoryConnectionStore();
  const code = uniqueId("code");
  const connectionId = uniqueId("connection");

  await store.createPendingConnection({
    code,
    connectionId,
    expiresAt: Number.MAX_SAFE_INTEGER,
  });

  const pending = await store.getPendingConnection(code);
  assert.equal(pending?.connectionId, connectionId);
  assert.equal(pending?.used, false);

  const completed = await store.completePendingConnection(code);
  assert.equal(completed?.connectionId, connectionId);
  assert.equal(completed?.used, true);

  assert.equal(await store.getPendingConnection(code), null);
});

test("MemoryConnectionStore removes expired pending connections", async () => {
  const store = new MemoryConnectionStore();
  const code = uniqueId("expired-code");

  await store.createPendingConnection({
    code,
    connectionId: uniqueId("connection"),
    expiresAt: Date.now() - 1,
  });

  assert.equal(await store.getPendingConnection(code), null);
  assert.equal(await store.getConnectionByCode(code), null);
});

test("MemoryConnectionStore normalises session IDs and company names", async () => {
  const store = new MemoryConnectionStore();
  const connectionId = uniqueId("connection");

  await store.bindSessionToConnection("  session-a  ", connectionId);
  assert.equal(await store.getConnectionIdForSession("session-a"), connectionId);

  await store.saveConnectedCompanies(connectionId, [
    {
      companyName: " Company A ",
      apiKey: "secret-api-key",
      expiresAt: Date.now() + 60_000,
    },
  ]);

  const credential = await store.getCredentialForCompany(connectionId, "company a");
  assert.equal(credential?.companyName, "Company A");

  const companies = await store.listConnectedCompanies(connectionId);
  assert.equal(companies.length, 1);
  assert.equal(companies[0]?.companyName, "Company A");
});

test("MemoryConnectionStore only returns recent client claims", async () => {
  const store = new MemoryConnectionStore();
  const clientKey = uniqueId("client");
  const connectionId = uniqueId("connection");

  await store.recordClientClaim({
    clientKey,
    connectionId,
    claimedAt: Date.now(),
  });

  assert.equal(await store.getRecentClientClaim(clientKey, 60_000), connectionId);

  await store.recordClientClaim({
    clientKey,
    connectionId,
    claimedAt: Date.now() - 60_000,
  });

  assert.equal(await store.getRecentClientClaim(clientKey, 1), null);
});
