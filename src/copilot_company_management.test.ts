import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { COMPANY_MANAGEMENT_DESCRIPTION, COMPANY_MANAGEMENT_TOOL, getCompanyManagementLink, registerCopilotCompanyManagement } from "./copilot_company_management.js";
import { COPILOT_INSTRUCTIONS, registerCopilotDiagnosticTools } from "./copilot_diagnostic.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { getConnectionStore } from "./auth/connection_store.js";
import { renderManageConfirmPage, renderManagePage, renderManageSignInPage } from "./auth/connection_page.js";
import { registerAllTools } from "./register_all_tools.js";

test("company management link is read-only, owner-scoped and free of credentials", async t => {
  const oldKey = process.env.RED_CONNECT_ENCRYPTION_KEY;
  const oldBase = process.env.RED_ENTRA_PUBLIC_BASE_URL;
  const oldStore = process.env.RED_CONNECT_CONNECTION_STORE;
  process.env.RED_CONNECT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.RED_ENTRA_PUBLIC_BASE_URL = "https://red.example.test";
  process.env.RED_CONNECT_CONNECTION_STORE = "memory";
  t.after(() => {
    if (oldKey === undefined) delete process.env.RED_CONNECT_ENCRYPTION_KEY; else process.env.RED_CONNECT_ENCRYPTION_KEY = oldKey;
    if (oldBase === undefined) delete process.env.RED_ENTRA_PUBLIC_BASE_URL; else process.env.RED_ENTRA_PUBLIC_BASE_URL = oldBase;
    if (oldStore === undefined) delete process.env.RED_CONNECT_CONNECTION_STORE; else process.env.RED_CONNECT_CONNECTION_STORE = oldStore;
  });
  const owner = { tenantId: randomUUID(), objectId: randomUUID() };
  const other = { ...owner, objectId: randomUUID() };
  const store = getConnectionStore().entra;
  await store.createLink(owner);
  await store.createLink(other);
  await store.saveCompanies(owner, [{ companyName: "Company B", apiKey: "management-secret", expiresAt: Date.now() + 60_000 }]);
  await store.saveCompanies(other, [{ companyName: "Company Other", apiKey: "other-management-secret", expiresAt: Date.now() + 60_000 }]);
  assert.equal((await getCompanyManagementLink()).structuredContent?.status, "authentication_required");
  const result = await entraRequestOwner.run(owner, () => getCompanyManagementLink());
  const body = result.structuredContent as { status: string; managementUrl: string; connectedCompanies: string[]; message: string };
  assert.equal(body.status, "ok");
  assert.equal(new URL(body.managementUrl).href, "https://red.example.test/manage-companies");
  assert.deepEqual(body.connectedCompanies, ["Company B"]);
  assert.match(body.message, /Open the RED company management page/);
  assert.deepEqual(Object.keys(body).sort(), ["connectedCompanies", "managementUrl", "message", "status"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("management-secret"), false);
  assert.equal(serialized.includes("other-management-secret"), false);
  assert.equal(serialized.includes(owner.tenantId), false);
  assert.equal(serialized.includes(owner.objectId), false);
  assert.equal(serialized.includes("Company Other"), false);
  assert.doesNotMatch(serialized, /enc:|tenantId|objectId|connectionId/);
});

test("management tool descriptor routes connection intents and stays out of normal MCP", () => {
  const tools = new Map<string, { config: any }>();
  registerCopilotDiagnosticTools({ registerTool(name: string, config: any) { tools.set(name, { config }); } } as any, true);
  const management = tools.get(COMPANY_MANAGEMENT_TOOL)!.config;
  assert.equal(tools.size, 58);
  assert.equal(management.title, "Get RED company management link");
  assert.equal(management.description, COMPANY_MANAGEMENT_DESCRIPTION);
  for (const phrase of ["connect my RED companies", "connect another company", "disconnect Company B", "manage my connected companies", "change my RED API key"]) {
    assert.match(management.description, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(management.description, /does not connect, update, or disconnect anything/);
  assert.deepEqual(management.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(Object.keys(management.inputSchema.shape), []);
  assert.throws(() => management.inputSchema.parse({ apiKey: "secret" }));
  assert.doesNotMatch(tools.get("search_customers")!.config.description, /get_company_management_link|disconnect Company B/);
  assert.match(tools.get("search_customers")!.config.description, /Search customers/);
  assert.match(COPILOT_INSTRUCTIONS, /get_company_management_link/);
  assert.ok(COPILOT_INSTRUCTIONS.length < 1000);
  const normal: string[] = [];
  registerAllTools({ registerTool(name: string) { normal.push(name); }, registerResource() {}, registerPrompt() {} } as any, { profile: "full" });
  assert.equal(normal.length, 159);
  assert.equal(normal.includes(COMPANY_MANAGEMENT_TOOL), false);
  const registered = new Map<string, unknown>();
  registerCopilotCompanyManagement({ registerTool(name: string, _config: unknown, handler: unknown) { registered.set(name, handler); } } as any);
  assert.deepEqual([...registered.keys()], [COMPANY_MANAGEMENT_TOOL]);
  assert.equal(z.object({}).strict().safeParse({ companyName: "A" }).success, false);
});

test("management pages escape names and require a second POST to disconnect", () => {
  const page = renderManagePage({ csrfToken: `csrf"secret`, companies: ["<script>alert(1)</script>"], notice: "<img>" });
  assert.match(page, /Manage your Big Red Cloud companies/);
  assert.match(page, /No Big Red Cloud companies are currently connected|id="connected-companies"/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page, /&lt;img&gt;/);
  assert.doesNotMatch(page, /<script>alert|<img>/);
  assert.doesNotMatch(page, /name="confirm"/);
  assert.match(page, /action="\/manage-companies\/disconnect"/);
  assert.match(page, /action="\/manage-companies\/companies"/);
  const confirm = renderManageConfirmPage({ csrfToken: "csrf", companyName: "<b>Company B</b>" });
  assert.match(confirm, /Disconnect &lt;b&gt;Company B&lt;\/b&gt;\?/);
  assert.match(confirm, /name="confirm" value="yes"/);
  assert.match(confirm, /href="\/manage-companies"/);
  assert.doesNotMatch(confirm, /<input[^>]+type="password"|name="apiKey"|<b>/);
  const signIn = renderManageSignInPage();
  assert.match(signIn, /action="\/manage-companies\/start"/);
  assert.doesNotMatch(signIn, /name="request"|name="apiKey"|tenantId|objectId/);
  const empty = renderManagePage({ csrfToken: "csrf", companies: [] });
  assert.match(empty, /No Big Red Cloud companies are currently connected/);
});
