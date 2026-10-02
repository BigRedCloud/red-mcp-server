import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createEntraFixture, TEST_OTHER, TEST_USER } from "./entra_fixture.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";
test("company management is owner-scoped, confirmed, and leaves normal MCP unchanged", async (t) => {
    const fixture = await createEntraFixture();
    const port = await getFreePort();
    const child = await startHttpTestServer(t, port, fixture.env, 90_000);
    let logs = "";
    child.stdout.on("data", chunk => { logs += chunk; });
    child.stderr.on("data", chunk => { logs += chunk; });
    const base = `http://127.0.0.1:${port}`;
    const origin = "https://red.example.test";
    const transports = new Map();
    async function client(path, token) {
        const mcp = new Client({ name: "management-test", version: "1" });
        t.after(() => mcp.close());
        const transport = new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } });
        transports.set(mcp, transport);
        await mcp.connect(transport);
        return mcp;
    }
    const normal = await client("/mcp");
    const normalNames = (await normal.listTools()).tools.map(tool => tool.name);
    assert.equal(normalNames.length, 159);
    assert.equal(normalNames.includes("get_company_management_link"), false);
    const copilot = await client("/mcp/copilot", await fixture.token());
    const other = await client("/mcp/copilot", await fixture.token(TEST_OTHER));
    const listed = await copilot.listTools();
    assert.equal(listed.tools.length, 58);
    const descriptor = listed.tools.find(tool => tool.name === "get_company_management_link");
    assert.ok(descriptor);
    assert.equal(descriptor.annotations?.readOnlyHint, true);
    assert.equal(descriptor.annotations?.destructiveHint, false);
    const schema = descriptor.inputSchema;
    assert.deepEqual(schema.properties ?? {}, {});
    assert.equal(schema.additionalProperties, false);
    const needed = await copilot.callTool({ name: "search_customers", arguments: { query: "" } });
    assert.equal(needed.structuredContent.status, "connection_required");
    assert.match(String(needed.structuredContent.connectionUrl), /\/connect\?request=req_/);
    const link = await copilot.callTool({ name: "get_company_management_link", arguments: {} });
    assert.equal(link.structuredContent.status, "ok");
    assert.equal(new URL(link.structuredContent.managementUrl).pathname, "/manage-companies");
    assert.equal(new URL(link.structuredContent.managementUrl).search, "");
    assert.deepEqual(link.structuredContent.connectedCompanies, []);
    const extra = await copilot.callTool({ name: "get_company_management_link", arguments: { apiKey: "test-only-b" } });
    assert.equal(extra.isError, true);
    assert.equal(JSON.stringify(extra).includes("test-only-b"), false);
    assert.doesNotMatch(JSON.stringify(link), new RegExp(`${TEST_USER}|${TEST_OTHER}|enc:`));
    async function signIn(otherUser = false) {
        const start = await fetch(`${base}/manage-companies/start`, { method: "POST", redirect: "manual", headers: { origin } });
        assert.equal(start.status, 303);
        const auth = new URL(start.headers.get("location"));
        const startCookie = start.headers.get("set-cookie").split(";")[0];
        assert.match(startCookie, /^__Host-red-manage=/);
        const callback = await fetch(`${base}/connect/sso/callback`, {
            method: "POST", redirect: "manual", headers: { cookie: startCookie, "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ state: auth.searchParams.get("state"), code: `${otherUser ? "other:" : ""}${auth.searchParams.get("nonce")}` }),
        });
        assert.equal(callback.status, 303);
        assert.equal(new URL(callback.headers.get("location"), base).pathname, "/manage-companies");
        return callback.headers.get("set-cookie").split(";")[0];
    }
    let cookie = await signIn();
    const adopt = (response) => {
        const issued = response.headers.get("set-cookie");
        if (issued?.startsWith("__Host-red-manage="))
            cookie = issued.split(";")[0];
        return response;
    };
    const unauthenticated = await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ companyName: "Company B", confirm: "yes" }) });
    assert.equal(unauthenticated.status, 401);
    const malformed = await fetch(`${base}/manage-companies/companies`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"apiKey":"rejected-management-secret",' });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(await malformed.text(), /rejected-management-secret/);
    async function page(current = cookie) {
        const response = await fetch(`${base}/manage-companies`, { headers: { cookie: current } });
        assert.equal(response.status, 200);
        return response.text();
    }
    function csrfFrom(html) {
        return /name="csrfToken" value="([^"]+)"/.exec(html)[1];
    }
    function connected(html) {
        const list = /id="connected-companies">([\s\S]*?)<\/ul>/.exec(html);
        if (list)
            return list[1];
        return /id="connected-companies">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    }
    async function submit(current, fields, file) {
        const data = new FormData();
        data.append("csrfToken", csrfFrom(await page(current)));
        for (const [name, value] of fields)
            data.append(name, value);
        if (file)
            data.append("companyFile", new Blob([file.body], { type: "text/csv" }), file.name);
        else
            data.append("companyFile", new Blob([]), "");
        return fetch(`${base}/manage-companies/companies`, { method: "POST", headers: { cookie: current, origin }, body: data });
    }
    let html = await page();
    assert.match(html, /No Big Red Cloud companies are currently connected/);
    assert.equal((await fetch(`${base}/manage-companies?companyName=Company+B`, { headers: { cookie } })).status, 200);
    const manual = adopt(await submit(cookie, [["companyName", "Company B"], ["apiKey", "test-only-b"], ["companyName", "Company C"], ["apiKey", "test-only-c"], ["companyName", ""], ["apiKey", ""], ["companyName", ""], ["apiKey", ""], ["companyName", ""], ["apiKey", ""]]));
    assert.equal(manual.status, 200);
    html = await manual.text();
    assert.match(connected(html), /Company B/);
    assert.match(connected(html), /Company C/);
    assert.doesNotMatch(html, /test-only-b|test-only-c/);
    const rejected = await submit(cookie, [["companyName", "Company B"], ["apiKey", "rejected-management-secret"]]);
    assert.equal(rejected.status, 400);
    html = await rejected.text();
    assert.match(connected(html), /Company B/);
    assert.doesNotMatch(html, /rejected-management-secret/);
    const replaced = adopt(await submit(cookie, [["companyName", "Company B"], ["apiKey", "test-only-replaced"]]));
    assert.equal(replaced.status, 200);
    html = await replaced.text();
    assert.equal(connected(html).match(/<strong>Company B<\/strong>/g)?.length, 1);
    const csv = adopt(await submit(cookie, [["companyName", "Ignored manual"], ["apiKey", "ignored-manual-secret"]], { name: "companies.csv", body: 'companyName,apiKey\n"CSV <co>",test-only-d\nCompany D,test-only-e' }));
    assert.equal(csv.status, 200);
    html = await csv.text();
    assert.match(html, /CSV &lt;co&gt;/);
    assert.match(connected(html), /Company B/);
    assert.match(connected(html), /Company C/);
    assert.match(connected(html), /Company D/);
    assert.doesNotMatch(html, /Ignored manual|ignored-manual-secret|test-only-|<\/co>/);
    const tooMany = await submit(cookie, [], { name: "companies.csv", body: "companyName,apiKey\n" + "A,test-only-a\n".repeat(6) });
    assert.equal(tooMany.status, 400);
    assert.match(connected(await page()), /Company C/);
    const getDisconnect = await fetch(`${base}/manage-companies/disconnect?companyName=Company+C&confirm=yes`, { headers: { cookie } });
    assert.equal(getDisconnect.status, 404);
    assert.match(connected(await page()), /Company C/);
    const preview = await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrfFrom(html), companyName: "Company C" }) });
    assert.equal(preview.status, 200);
    const previewHtml = await preview.text();
    assert.match(previewHtml, /Disconnect Company C\?/);
    assert.match(previewHtml, /name="confirm" value="yes"/);
    assert.doesNotMatch(previewHtml, /<input[^>]*type="password"/);
    assert.match(connected(await page()), /Company C/);
    const wrongOrigin = await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrfFrom(html), companyName: "Company C", confirm: "yes" }) });
    assert.equal(wrongOrigin.status, 401);
    const wrongCsrf = await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: "wrong", companyName: "Company C", confirm: "yes" }) });
    assert.equal(wrongCsrf.status, 401);
    assert.match(connected(await page()), /Company C/);
    const csrf = csrfFrom(await page());
    const removed = adopt(await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf, companyName: "Company C", confirm: "yes" }) }));
    assert.equal(removed.status, 200);
    html = await removed.text();
    assert.match(html, /Company C has been disconnected/);
    assert.doesNotMatch(connected(html), /Company C/);
    assert.match(connected(html), /Company B/);
    assert.match(connected(html), /Company D/);
    const replay = await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf, companyName: "Company D", confirm: "yes" }) });
    assert.equal(replay.status, 401);
    assert.match(connected(await page()), /Company D/);
    const otherCookie = await signIn(true);
    const otherPage = await page(otherCookie);
    assert.match(otherPage, /No Big Red Cloud companies are currently connected/);
    assert.doesNotMatch(connected(otherPage), /Company B|Company D/);
    const forged = await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie: otherCookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrfFrom(otherPage), companyName: "Company B", confirm: "yes", tenantId: TEST_USER, objectId: TEST_USER }) });
    assert.match(await forged.text(), /not connected/);
    assert.match(connected(await page()), /Company B/);
    const otherAdd = await submit(otherCookie, [["companyName", "Foreign Co"], ["apiKey", "test-only-foreign"]]);
    assert.equal(otherAdd.status, 200);
    assert.match(connected(await otherAdd.text()), /Foreign Co/);
    assert.doesNotMatch(connected(await page()), /Foreign Co/);
    const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : undefined, headless: true });
    t.after(() => browser.close());
    const browserPage = await browser.newPage();
    await browserPage.route("**/*", async (route) => {
        if (route.request().method() === "POST") {
            const body = route.request().postData() ?? "";
            assert.match(body, /companyName=Company(?:\+|%20)B/);
            assert.doesNotMatch(body, /confirm=yes|test-only-/);
            await route.fulfill({ status: 200, body: "confirmation-shown" });
            return;
        }
        await route.fulfill({ status: 200, contentType: "text/html", body: await page() });
    });
    await browserPage.goto("https://red.example.test/manage-companies");
    assert.equal(await browserPage.locator(".company-entry:visible").count(), 1);
    await browserPage.locator("#add-company").click();
    assert.equal(await browserPage.locator(".company-entry:visible").count(), 2);
    const posted = browserPage.waitForResponse(response => response.request().method() === "POST");
    await browserPage.locator("form.disconnect-form", { has: browserPage.locator('input[value="Company B"]') }).locator("button").click();
    await posted;
    assert.match(await browserPage.locator("body").innerText(), /confirmation-shown/);
    for (const name of ["Company B", "CSV <co>", "Company D"]) {
        const current = await page();
        const response = adopt(await fetch(`${base}/manage-companies/disconnect`, { method: "POST", headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrfFrom(current), companyName: name, confirm: "yes" }) }));
        assert.equal(response.status, 200);
    }
    assert.match(await page(), /No Big Red Cloud companies are currently connected/);
    const after = await copilot.callTool({ name: "search_customers", arguments: { query: "" } });
    assert.equal(after.structuredContent.status, "connection_required");
    const refreshed = await copilot.callTool({ name: "get_company_management_link", arguments: {} });
    assert.deepEqual(refreshed.structuredContent.connectedCompanies, []);
    const otherStill = await other.callTool({ name: "search_customers", arguments: { query: "" } });
    assert.notEqual(otherStill.structuredContent.status, "connection_required");
    for (const secret of ["test-only-b", "test-only-c", "test-only-d", "test-only-e", "test-only-replaced", "test-only-foreign", "test-only-a", "rejected-management-secret", "ignored-manual-secret"]) {
        assert.equal(logs.includes(secret), false, secret);
    }
    const started = await normal.callTool({ name: "brc_start_company_connection", arguments: {} });
    const text = started.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const code = /[?]code=([A-Za-z0-9_-]+)/.exec(text)[1];
    const normalPage = await fetch(`${base}/connect?code=${code}`);
    const normalHtml = await normalPage.text();
    assert.match(normalHtml, /name="code"/);
    assert.doesNotMatch(normalHtml, /manage-companies|get_company_management_link/);
});
