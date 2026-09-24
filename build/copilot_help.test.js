import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { COPILOT_HELP_NAMES, registerCopilotHelp } from "./copilot_help.js";
import { COPILOT_INSTRUCTIONS } from "./copilot_diagnostic.js";
import { entraRequestOwner } from "./auth/entra_auth.js";
import { registerHelpResourcesTools } from "./tools/edu/help_resources_tools.js";
import { resetEduResourcesCacheForTests } from "./edu/brc_edu_resources.js";
const owner = { tenantId: "help-test-tenant", objectId: "help-test-user" };
function setup(t, description = "Learn bank reconciliation step by step") {
    const dir = mkdtempSync(join(tmpdir(), "copilot-help-"));
    const csv = join(dir, "resources.csv");
    writeFileSync(csv, "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview\n" + `Bank reconciliation training,https://www.youtube.com/watch?v=abc123,banking,bank reconciliation,${description},true,video,Big Red Cloud,2026-09-01,fixture,false\n` + "Hidden reconciliation,https://www.youtube.com/watch?v=hidden,banking,bank reconciliation,Hidden,false,video,Big Red Cloud,2026-09-01,fixture,false\n");
    const env = { BRC_EDU_SOURCE: "local", BRC_EDU_ENRICHED_CSV_PATH: csv, BRC_EDU_SYNCED_RESOURCES_PATH: join(dir, "unused.json"), AZURE_STORAGE_CONNECTION_STRING: "", BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING: "" };
    const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    resetEduResourcesCacheForTests();
    t.after(() => { for (const [key, value] of Object.entries(old))
        if (value === undefined)
            delete process.env[key];
        else
            process.env[key] = value; resetEduResourcesCacheForTests(); rmSync(dir, { recursive: true, force: true }); });
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected external URL or BRC request"); });
    t.after(() => assert.equal(network.mock.callCount(), 0, "local help fixtures must not fetch BRC or per-resource URLs"));
    const tools = new Map();
    registerCopilotHelp({ registerTool(name, config, handler) { tools.set(name, { config, handler }); } });
    const invoke = (name, args) => entraRequestOwner.run(owner, () => tools.get(name).handler(tools.get(name).config.inputSchema.parse(args)));
    return { tools, invoke };
}
test("help tools have strict bounded read-only descriptors without company inputs", t => {
    const { tools } = setup(t);
    assert.deepEqual([...tools.keys()], [...COPILOT_HELP_NAMES]);
    for (const { config } of tools.values()) {
        assert.deepEqual(config.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        assert.ok(config.title.length > 10);
        assert.ok(config.description.length < 400);
        const schema = z.toJSONSchema(config.inputSchema);
        assert.equal(schema.additionalProperties, false);
        for (const key of ["companyName", "connectionRef", "url", "apiKey", "nextCursor"])
            assert.equal(key in schema.properties, false);
        assert.throws(() => config.inputSchema.parse({ query: "banking", companyName: "Foreign" }));
    }
    assert.match(COPILOT_INSTRUCTIONS, /Help needs no company connection/);
    assert.match(COPILOT_INSTRUCTIONS, /Do not use accounting tools for how-to/);
});
test("help search reuses production pipeline without a company or per-resource fetch", async (t) => {
    const f = setup(t);
    const raw = new Map();
    registerHelpResourcesTools({ tool(name, _d, schema, handler) { raw.set(name, { schema: z.object(schema), handler }); } });
    const normal = JSON.parse((await raw.get("brc_find_help_resources").handler({ question: "bank reconciliation", maxResults: 1 })).content[0].text);
    const result = (await f.invoke("search_help_resources", { query: "bank reconciliation", maxResults: 1 })).structuredContent;
    assert.equal(result.status, "ok");
    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0].resourceId, normal.resources[0].resourceId);
    assert.equal(result.resources[0].publicUrl, normal.resources[0].publicUrl);
    assert.doesNotMatch(JSON.stringify(result), /Hidden reconciliation|brc_start_company_connection|brc_get_help_resource_details|imageBlobNames|relevanceScore/);
    assert.equal(result.customerFacingSourcesMarkdown, normal.customerFacingSourcesMarkdown);
});
test("selected help resource details and direct help work for an owner with no connected companies", async (t) => {
    const f = setup(t);
    const help = (await f.invoke("get_red_help", { query: "how do I reconcile my bank account" })).structuredContent;
    assert.equal(help.status, "ok");
    assert.equal(help.helpMode, true);
    assert.ok(help.resources.length > 0);
    const resourceId = help.resources[0].resourceId;
    const detail = (await f.invoke("fetch_help_resource", { resourceId, question: "bank reconciliation" })).structuredContent;
    assert.equal(detail.status, "ok");
    assert.equal(detail.resourceId, resourceId);
    assert.equal(detail.imagePresentation, "links");
    assert.match(detail.instructions, /bank reconciliation/i);
    assert.equal(detail.publicUrl, help.resources[0].publicUrl);
    assert.equal(detail.redActionAvailable, undefined);
    assert.doesNotMatch(JSON.stringify(detail), /brc_|owner-a-key|connectionRef/);
});
test("help rejects arbitrary URLs and unauthenticated calls; unknown indexed resources fail safely", async (t) => {
    const f = setup(t);
    const fetch = f.tools.get("fetch_help_resource");
    for (const resourceId of ["https://example.com/secret", "file:///private", "freshdesk:https://example.com/private"])
        assert.throws(() => fetch.config.inputSchema.parse({ resourceId }));
    for (const [name, args] of [["search_help_resources", { query: "banking" }], ["get_red_help", { query: "banking" }], ["fetch_help_resource", { resourceId: "recorded_webinar:missing" }]])
        assert.equal((await f.tools.get(name).handler(args)).structuredContent.status, "authentication_required");
    assert.equal((await f.invoke("fetch_help_resource", { resourceId: "recorded_webinar:missing" })).structuredContent.status, "resource_unavailable");
});
test("help result size limit fails safely rather than truncating source links", async (t) => {
    const f = setup(t, "bank reconciliation " + "x".repeat(90_000));
    const result = await f.invoke("get_red_help", { query: "bank reconciliation" });
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 128_000);
    if (!result.isError) {
        const detail = await f.invoke("fetch_help_resource", { resourceId: result.structuredContent.resources[0].resourceId });
        assert.equal(detail.isError, true);
        assert.ok(Buffer.byteLength(JSON.stringify(detail)) < 1000);
    }
});
