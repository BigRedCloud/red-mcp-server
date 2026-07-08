import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadEnrichedEduResources, loadLocalEnrichedEduResources, resetEduResourcesCacheForTests, } from "./brc_edu_resources.js";
const GRAPH_ENV_KEYS = [
    "BRC_EDU_SOURCE",
    "BRC_EDU_CACHE_TTL_MINUTES",
    "BRC_EDU_ENRICHED_CSV_PATH",
    "BRC_EDU_GRAPH_TENANT_ID",
    "BRC_EDU_GRAPH_CLIENT_ID",
    "BRC_EDU_GRAPH_CLIENT_SECRET",
    "BRC_EDU_GRAPH_DRIVE_ID",
    "BRC_EDU_GRAPH_ITEM_ID",
];
const LOCAL_ENRICHED_CSV = [
    "title,url,helpRoutingCategory,keywords,description,isActive,contentType,source,lastReviewed,generatedFrom,needsReview",
    "Local fallback video,https://example.com/local,setup,setup local,Local fallback description,true,video,Big Red Cloud,2026-07-08,webinar_video_routing_index.csv,false",
].join("\n");
const SUPPORT_CSV = [
    "Video Title,Video URL,Help-Routing Category",
    "Graph setup guide,https://example.com/graph-setup,setup",
].join("\n");
function withEduEnv(values, run) {
    const previous = {};
    for (const key of GRAPH_ENV_KEYS) {
        previous[key] = process.env[key];
        if (key in values) {
            const next = values[key];
            if (next === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = next;
            }
        }
        else {
            delete process.env[key];
        }
    }
    resetEduResourcesCacheForTests();
    return Promise.resolve()
        .then(() => run())
        .finally(() => {
        for (const key of GRAPH_ENV_KEYS) {
            if (previous[key] === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = previous[key];
            }
        }
        resetEduResourcesCacheForTests();
    });
}
function createLocalFixture() {
    const baseDir = join(tmpdir(), `brc-edu-loader-${Date.now()}-${Math.random()}`);
    const enrichedCsvPath = join(baseDir, "test-enriched.csv");
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(enrichedCsvPath, LOCAL_ENRICHED_CSV, "utf8");
    return { baseDir, enrichedCsvPath };
}
function fixtureEnv(fixture) {
    return {
        BRC_EDU_ENRICHED_CSV_PATH: fixture.enrichedCsvPath,
    };
}
const GRAPH_ENV = {
    BRC_EDU_GRAPH_TENANT_ID: "tenant-123",
    BRC_EDU_GRAPH_CLIENT_ID: "client-456",
    BRC_EDU_GRAPH_CLIENT_SECRET: "super-secret-value",
    BRC_EDU_GRAPH_DRIVE_ID: "drive-789",
    BRC_EDU_GRAPH_ITEM_ID: "item-abc",
};
function createGraphFetchMock(options) {
    let callCount = 0;
    const fetchImpl = async (input) => {
        callCount += 1;
        const url = String(input);
        if (options?.fail) {
            return new Response("service unavailable", { status: 503 });
        }
        if (url.includes("/oauth2/v2.0/token")) {
            return new Response(JSON.stringify({ access_token: "graph-token-xyz" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (url.includes("/content")) {
            return new Response(SUPPORT_CSV, { status: 200 });
        }
        return new Response("not found", { status: 404 });
    };
    return {
        fetchImpl,
        getCallCount: () => callCount,
    };
}
test("loadLocalEnrichedEduResources reads local enriched CSV", async () => {
    const fixture = createLocalFixture();
    await withEduEnv({ BRC_EDU_SOURCE: "local", ...fixtureEnv(fixture) }, () => {
        const resources = loadLocalEnrichedEduResources(fixture.baseDir);
        assert.equal(resources.length, 1);
        assert.equal(resources[0]?.title, "Local fallback video");
        assert.equal(resources[0]?.url, "https://example.com/local");
    });
});
test("loadEnrichedEduResources uses local source by default", async () => {
    const fixture = createLocalFixture();
    await withEduEnv({ BRC_EDU_SOURCE: "local", ...fixtureEnv(fixture) }, async () => {
        const resources = await loadEnrichedEduResources(fixture.baseDir);
        assert.equal(resources.length, 1);
        assert.equal(resources[0]?.title, "Local fallback video");
    });
});
test("graph source downloads support CSV and enriches rows", async () => {
    const fixture = createLocalFixture();
    const { fetchImpl } = createGraphFetchMock();
    await withEduEnv({
        BRC_EDU_SOURCE: "graph",
        BRC_EDU_CACHE_TTL_MINUTES: "5",
        ...fixtureEnv(fixture),
        ...GRAPH_ENV,
    }, async () => {
        const resources = await loadEnrichedEduResources(fixture.baseDir, {
            now: 1_700_000_000_000,
            fetchImpl,
        });
        assert.equal(resources.length, 1);
        assert.equal(resources[0]?.title, "Graph setup guide");
        assert.equal(resources[0]?.url, "https://example.com/graph-setup");
        assert.equal(resources[0]?.helpRoutingCategory, "setup");
    });
});
test("graph source uses cache within TTL", async () => {
    const fixture = createLocalFixture();
    const { fetchImpl, getCallCount } = createGraphFetchMock();
    const now = 1_700_000_000_000;
    await withEduEnv({
        BRC_EDU_SOURCE: "graph",
        BRC_EDU_CACHE_TTL_MINUTES: "5",
        ...fixtureEnv(fixture),
        ...GRAPH_ENV,
    }, async () => {
        const first = await loadEnrichedEduResources(fixture.baseDir, { now, fetchImpl });
        const callsAfterFirst = getCallCount();
        const second = await loadEnrichedEduResources(fixture.baseDir, {
            now: now + 60_000,
            fetchImpl,
        });
        const callsAfterSecond = getCallCount();
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(first[0]?.title, second[0]?.title);
        assert.equal(callsAfterFirst, 2);
        assert.equal(callsAfterSecond, 2);
    });
});
test("graph failure falls back to local generated CSV", async () => {
    const fixture = createLocalFixture();
    const { fetchImpl } = createGraphFetchMock({ fail: true });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
        await withEduEnv({
            BRC_EDU_SOURCE: "graph",
            ...fixtureEnv(fixture),
            ...GRAPH_ENV,
        }, async () => {
            const resources = await loadEnrichedEduResources(fixture.baseDir, { fetchImpl });
            assert.equal(resources.length, 1);
            assert.equal(resources[0]?.title, "Local fallback video");
            assert.equal(warnings.some((message) => message.includes("Microsoft Graph load failed")), true);
            assert.equal(warnings.some((message) => message.includes("super-secret-value")), false);
        });
    }
    finally {
        console.warn = originalWarn;
    }
});
test("missing graph env vars falls back to local generated CSV", async () => {
    const fixture = createLocalFixture();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
        await withEduEnv({
            BRC_EDU_SOURCE: "graph",
            ...fixtureEnv(fixture),
            BRC_EDU_GRAPH_TENANT_ID: "tenant-123",
            BRC_EDU_GRAPH_CLIENT_ID: undefined,
            BRC_EDU_GRAPH_CLIENT_SECRET: undefined,
            BRC_EDU_GRAPH_DRIVE_ID: undefined,
            BRC_EDU_GRAPH_ITEM_ID: undefined,
        }, async () => {
            const resources = await loadEnrichedEduResources(fixture.baseDir);
            assert.equal(resources.length, 1);
            assert.equal(resources[0]?.title, "Local fallback video");
            assert.equal(warnings.some((message) => message.includes("configuration is incomplete")), true);
        });
    }
    finally {
        console.warn = originalWarn;
    }
});
