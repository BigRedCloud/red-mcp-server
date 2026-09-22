import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { registerAllTools } from "./register_all_tools.js";
import { COPILOT_FEDERATED_READ_TOOLS } from "./copilot_read_tools.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { getConnectionStore } from "./auth/connection_store.js";
import { TOOL_ANNOTATIONS } from "./tool_annotations.js";

type Registration = { config: any; handler: (args: any) => Promise<any> };
function registry(federatedReadOnly: boolean) {
  const tools = new Map<string, Registration>();
  registerAllTools({
    registerTool(name: string, config: any, handler: any) { tools.set(name, { config, handler }); },
    registerResource() {}, registerPrompt() {},
  } as any, { profile: "full", federatedReadOnly });
  return tools;
}

test("federated catalogue is a fail-closed 70-query subset with original schemas and complete metadata", () => {
  const full = registry(false), reads = registry(true);
  assert.equal(full.size, 159);
  // Baseline from HEAD before this change: names, titles, descriptions, schemas
  // and annotations for every production tool, not just a count.
  const descriptors = [...full].map(([name, { config }]) => ({
    name, ...config, inputSchema: config.inputSchema ? z.toJSONSchema(z.object(config.inputSchema)) : undefined,
  })).sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(createHash("sha256").update(JSON.stringify(descriptors)).digest("hex"),
    "c5e420ed1f7e9f3201fadb283b72e4b90a00eb58c64bfd641d3c8cab0d684f6f");
  assert.equal(reads.size, 70);
  assert.deepEqual([...reads.keys()].sort(), [...COPILOT_FEDERATED_READ_TOOLS].sort());
  for (const [name, { config }] of reads) {
    assert.equal(TOOL_ANNOTATIONS[name as keyof typeof TOOL_ANNOTATIONS].readOnlyHint, true);
    assert.ok(config.title.trim());
    assert.ok(config.description.length < 500);
    assert.deepEqual(config.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const original = { ...full.get(name)!.config.inputSchema };
    delete original.connectionRef;
    assert.deepEqual(z.toJSONSchema(config.inputSchema), z.toJSONSchema(z.object(original).strict()), name);
    for (const field of ["connectionRef", "apiKey", "tenantId", "objectId", "routeToken"]) assert.equal(field in config.inputSchema.shape, false);
    assert.doesNotMatch(name, /(?:create|update|delete|brc_batch_|send|start|confirm|clear|route|support|readiness|help|deployment|api_key|company_context|admin)/);
  }
  for (const name of Object.keys(TOOL_ANNOTATIONS)) {
    if (!COPILOT_FEDERATED_READ_TOOLS.includes(name as any)) assert.equal(reads.has(name), false, name);
  }
});

test("every federated query rejects unverified owners and unlinked companies before business IO", async t => {
  const oldKey = process.env.RED_CONNECT_ENCRYPTION_KEY, oldHttp = process.env.RED_CONNECT_HTTP_MODE;
  process.env.RED_CONNECT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.RED_CONNECT_HTTP_MODE = "true";
  t.after(() => {
    if (oldKey === undefined) delete process.env.RED_CONNECT_ENCRYPTION_KEY; else process.env.RED_CONNECT_ENCRYPTION_KEY = oldKey;
    if (oldHttp === undefined) delete process.env.RED_CONNECT_HTTP_MODE; else process.env.RED_CONNECT_HTTP_MODE = oldHttp;
  });
  const owner = { tenantId: randomUUID(), objectId: randomUUID() };
  const other = { ...owner, objectId: randomUUID() };
  const otherTenant = { ...owner, tenantId: randomUUID() };
  const store = getConnectionStore().entra;
  for (const identity of [owner, other, otherTenant]) await store.createLink(identity);
  await store.saveCompanies(owner, [{ companyName: "Owned", apiKey: "owner-secret", expiresAt: Date.now() + 60_000 }]);
  await store.saveCompanies(other, [{ companyName: "Owned", apiKey: "other-secret", expiresAt: Date.now() + 60_000 }]);
  let calls = 0;
  const usedCredentials: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    calls++;
    assert.equal(init.method ?? "GET", "GET");
    const auth = init.headers.Authorization;
    usedCredentials.push(auth);
    return new Response(JSON.stringify({ Items: [{ Id: 1, Name: auth }] }));
  });
  const reads = registry(true);
  for (const [name, { handler }] of reads) {
    assert.equal((await handler({ companyName: "Owned" })).isError, true, name);
    assert.equal((await entraRequestOwner.run(otherTenant, () => handler({ companyName: "Owned" }))).isError, true, name);
    assert.equal((await entraRequestOwner.run(owner, () => handler({ companyName: "Unlinked" }))).isError, true, name);
  }
  assert.equal(calls, 0);
  const list = reads.get("brc_list_suppliers")!;
  const args = list.config.inputSchema.parse({ companyName: "Owned" });
  const results = await Promise.all([owner, other].map(identity => entraRequestOwner.run(identity, () => list.handler(args))));
  assert.equal(calls, 2);
  assert.deepEqual(usedCredentials.sort(), ["owner-secret", "other-secret"].map(key => `Basic ${Buffer.from(`${key}:`).toString("base64")}`).sort());
  for (const result of results) {
    assert.notEqual(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /owner-secret|other-secret/);
  }
  const multi = reads.get("brc_multi_company_nom_ac_report")!;
  assert.equal((await entraRequestOwner.run(owner, () => multi.handler({ companyNames: ["Owned", "Unlinked"] }))).isError, true);
  assert.equal(calls, 2, "multi-company authorization is atomic before any upstream call");
  assert.throws(() => list.config.inputSchema.parse({ companyName: "Owned", connectionRef: "foreign" }));

  function sample(schema: any): any {
    if (schema.default !== undefined) return schema.default;
    if (schema.enum) return schema.enum[0];
    if (schema.anyOf) return sample(schema.anyOf[0]);
    if (schema.type === "array") return [sample(schema.items)];
    if (schema.type === "number" || schema.type === "integer") return Math.max(1, schema.minimum ?? 1);
    if (schema.type === "boolean") return false;
    return "1";
  }
  // Exercise every audited business handler, not only its annotation. All
  // upstream requests must be GET and use the selected owner's credentials.
  for (const [name, { config, handler }] of reads) {
    const schema = z.toJSONSchema(config.inputSchema) as any;
    const input: Record<string, unknown> = {};
    for (const field of schema.required ?? []) input[field] = sample(schema.properties[field]);
    if (schema.properties.companyName) input.companyName = "Owned";
    if (schema.properties.companyNames) input.companyNames = ["Owned"];
    if (schema.properties.transactionDate) input.transactionDate = "2026-01-01";
    const before = calls;
    const result = await entraRequestOwner.run(owner, () => handler(config.inputSchema.parse(input)));
    assert.ok(calls > before, `${name}: expected accounting GET`);
    assert.notEqual(result.isError, true, `${name}: handler failed`);
    assert.ok(usedCredentials.slice(before).every(value => value === `Basic ${Buffer.from("owner-secret:").toString("base64")}`), name);
  }
});
