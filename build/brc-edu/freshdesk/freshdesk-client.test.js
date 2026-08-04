import assert from "node:assert/strict";
import test from "node:test";
import { FreshdeskClient } from "./freshdesk-client.js";
const API_KEY = "test-freshdesk-api-key-12345";
const BASE_URL = "https://example.freshdesk.com";
function withMockFetch(handler, run) {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
        const call = {
            url: String(input),
            init,
        };
        calls.push(call);
        return handler(call);
    };
    return run(calls).finally(() => {
        globalThis.fetch = originalFetch;
    });
}
test("FreshdeskClient rejects missing base URL", () => {
    assert.throws(() => new FreshdeskClient("   ", API_KEY), /Freshdesk base URL is required/);
});
test("FreshdeskClient rejects missing API key", () => {
    assert.throws(() => new FreshdeskClient(BASE_URL, "  "), /Freshdesk API key is required/);
});
test("FreshdeskClient builds the correct folders URL", async () => {
    await withMockFetch(() => new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    }), async (calls) => {
        const client = new FreshdeskClient(`${BASE_URL}/`, API_KEY);
        await client.getFolders(12);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, `${BASE_URL}/api/v2/solutions/categories/12/folders`);
    });
});
test("FreshdeskClient builds the correct articles URL", async () => {
    await withMockFetch(() => new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    }), async (calls) => {
        const client = new FreshdeskClient(BASE_URL, API_KEY);
        await client.getArticles(34);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, `${BASE_URL}/api/v2/solutions/folders/34/articles`);
    });
});
test("FreshdeskClient builds the correct single article URL", async () => {
    await withMockFetch(() => new Response(JSON.stringify({ id: 56 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    }), async (calls) => {
        const client = new FreshdeskClient(BASE_URL, API_KEY);
        await client.getArticle(56);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.url, `${BASE_URL}/api/v2/solutions/articles/56`);
    });
});
test("FreshdeskClient sends Accept application/json and Basic auth using apiKey:X", async () => {
    await withMockFetch(() => new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    }), async (calls) => {
        const client = new FreshdeskClient(BASE_URL, API_KEY);
        await client.getFolders(1);
        const headers = calls[0]?.init?.headers;
        const expectedAuth = `Basic ${Buffer.from(`${API_KEY}:X`, "utf8").toString("base64")}`;
        assert.equal(headers.Accept, "application/json");
        assert.equal(headers.Authorization, expectedAuth);
    });
});
test("FreshdeskClient returns parsed JSON on success", async () => {
    const payload = [{ id: 1, name: "General" }];
    await withMockFetch(() => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    }), async () => {
        const client = new FreshdeskClient(BASE_URL, API_KEY);
        const folders = await client.getFolders(1);
        assert.deepEqual(folders, payload);
    });
});
test("FreshdeskClient throws a safe error on non-2xx responses", async () => {
    await withMockFetch(() => new Response("Unauthorized", { status: 401 }), async () => {
        const client = new FreshdeskClient(BASE_URL, API_KEY);
        await assert.rejects(() => client.getArticle(99), /Freshdesk request failed with status 401/);
    });
});
test("FreshdeskClient never includes the API key or Authorization header in errors", async () => {
    const encodedCredentials = Buffer.from(`${API_KEY}:X`, "utf8").toString("base64");
    await withMockFetch(() => new Response(`Authorization: Basic ${encodedCredentials}`, {
        status: 403,
    }), async () => {
        const client = new FreshdeskClient(BASE_URL, API_KEY);
        try {
            await client.getArticles(1);
            assert.fail("Expected FreshdeskClient request to fail");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            assert.match(message, /Freshdesk request failed with status 403/);
            assert.equal(message.includes(API_KEY), false);
            assert.equal(message.includes(encodedCredentials), false);
            assert.equal(message.toLowerCase().includes("authorization"), false);
        }
    });
});
