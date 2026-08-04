import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { BRC_EDU_SYNC_SECRET_HEADER, enrichSupportCsvText, getBrcEduSyncedResourcesPath, handleBrcEduResourcesSyncRequest, loadSyncedEduResources, syncEduResourcesFromCsvText, } from "./brc_edu_synced_store.js";
const SYNC_ENV_KEYS = [
    "BRC_EDU_SYNC_SECRET",
    "BRC_EDU_SYNCED_RESOURCES_PATH",
];
const SUPPORT_CSV = [
    "Video Title,Video URL,Help-Routing Category",
    "Bank Feeds,https://example.com/bank-feeds,bank_feeds",
    "Setup guide,https://example.com/setup,setup",
].join("\n");
function withSyncEnv(values, run) {
    const previous = {};
    for (const key of SYNC_ENV_KEYS) {
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
    return Promise.resolve()
        .then(() => run())
        .finally(() => {
        for (const key of SYNC_ENV_KEYS) {
            if (previous[key] === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = previous[key];
            }
        }
    });
}
function createFixture() {
    const baseDir = join(tmpdir(), `brc-edu-sync-${Date.now()}-${Math.random()}`);
    const syncedPath = join(baseDir, "synced-resources.json");
    mkdirSync(baseDir, { recursive: true });
    return {
        baseDir,
        syncedPath,
        cleanup() {
            rmSync(baseDir, { recursive: true, force: true });
        },
    };
}
test("missing configured sync secret returns 503", async () => {
    const fixture = createFixture();
    try {
        await withSyncEnv({
            BRC_EDU_SYNC_SECRET: undefined,
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            const result = handleBrcEduResourcesSyncRequest({ csvText: SUPPORT_CSV }, "any-secret", fixture.baseDir);
            assert.equal(result.status, 503);
            assert.equal(result.body.ok, false);
            assert.match(result.body.error, /not configured/i);
        });
    }
    finally {
        fixture.cleanup();
    }
});
test("missing request sync secret returns 401", async () => {
    const fixture = createFixture();
    try {
        await withSyncEnv({
            BRC_EDU_SYNC_SECRET: "configured-secret",
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            const result = handleBrcEduResourcesSyncRequest({ csvText: SUPPORT_CSV }, undefined, fixture.baseDir);
            assert.equal(result.status, 401);
            assert.equal(result.body.ok, false);
        });
    }
    finally {
        fixture.cleanup();
    }
});
test("wrong request sync secret returns 401", async () => {
    const fixture = createFixture();
    try {
        await withSyncEnv({
            BRC_EDU_SYNC_SECRET: "configured-secret",
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            const result = handleBrcEduResourcesSyncRequest({ csvText: SUPPORT_CSV }, "wrong-secret", fixture.baseDir);
            assert.equal(result.status, 401);
            assert.equal(result.body.ok, false);
        });
    }
    finally {
        fixture.cleanup();
    }
});
test("missing csvText returns 400", async () => {
    const fixture = createFixture();
    try {
        await withSyncEnv({
            BRC_EDU_SYNC_SECRET: "configured-secret",
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            const missing = handleBrcEduResourcesSyncRequest({}, "configured-secret", fixture.baseDir);
            const empty = handleBrcEduResourcesSyncRequest({ csvText: "   " }, "configured-secret", fixture.baseDir);
            const wrongType = handleBrcEduResourcesSyncRequest({ csvText: 123 }, "configured-secret", fixture.baseDir);
            assert.equal(missing.status, 400);
            assert.equal(empty.status, 400);
            assert.equal(wrongType.status, 400);
            assert.match(missing.body.error, /csvText/i);
        });
    }
    finally {
        fixture.cleanup();
    }
});
test("valid CSV sync stores enriched resources", async () => {
    const fixture = createFixture();
    try {
        await withSyncEnv({
            BRC_EDU_SYNC_SECRET: "configured-secret",
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            const result = handleBrcEduResourcesSyncRequest({ csvText: SUPPORT_CSV }, "configured-secret", fixture.baseDir);
            assert.equal(result.status, 200);
            if (result.status !== 200) {
                return;
            }
            assert.equal(result.body.ok, true);
            assert.equal(result.body.rowsRead, 2);
            assert.equal(result.body.rowsEnriched, 2);
            assert.ok(result.body.storedAt);
            assert.equal(existsSync(fixture.syncedPath), true);
            const stored = JSON.parse(readFileSync(fixture.syncedPath, "utf8"));
            assert.equal(stored.resources.length, 2);
            assert.equal(stored.resources[0]?.title, "Bank Feeds");
            assert.equal(stored.resources[0]?.helpRoutingCategory, "bank_feeds");
            const loaded = loadSyncedEduResources(fixture.baseDir);
            assert.equal(loaded?.length, 2);
            assert.equal(loaded?.[0]?.title, "Bank Feeds");
        });
    }
    finally {
        fixture.cleanup();
    }
});
test("sync helper counts inactive and needsReview rows", async () => {
    const fixture = createFixture();
    const csvWithInactive = [
        "Video Title,Video URL,Help-Routing Category,active",
        "Active video,https://example.com/active,setup,true",
        "Inactive video,https://example.com/inactive,setup,false",
        "Low confidence,https://example.com/low,,true",
    ].join("\n");
    try {
        await withSyncEnv({
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            const enriched = enrichSupportCsvText(csvWithInactive);
            assert.equal(enriched.rowsRead, 3);
            assert.equal(enriched.inactiveRows, 1);
            assert.ok(enriched.needsReviewRows >= 1);
            const summary = syncEduResourcesFromCsvText(csvWithInactive, fixture.baseDir);
            assert.equal(summary.rowsEnriched, 3);
            assert.equal(summary.inactiveRows, 1);
        });
    }
    finally {
        fixture.cleanup();
    }
});
test("sync request handler does not log secrets", async () => {
    const fixture = createFixture();
    const secret = "super-secret-sync-value";
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    console.log = (...args) => {
        logs.push(args.map((arg) => String(arg)).join(" "));
    };
    console.error = (...args) => {
        logs.push(args.map((arg) => String(arg)).join(" "));
    };
    console.warn = (...args) => {
        logs.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
        await withSyncEnv({
            BRC_EDU_SYNC_SECRET: secret,
            BRC_EDU_SYNCED_RESOURCES_PATH: fixture.syncedPath,
        }, () => {
            handleBrcEduResourcesSyncRequest({ csvText: SUPPORT_CSV }, secret, fixture.baseDir);
            handleBrcEduResourcesSyncRequest({ csvText: SUPPORT_CSV }, "wrong-secret", fixture.baseDir);
        });
        const combined = logs.join("\n");
        assert.equal(combined.includes(secret), false);
        assert.equal(combined.includes(BRC_EDU_SYNC_SECRET_HEADER), false);
        assert.equal(combined.includes("x-red-edu-sync-secret"), false);
    }
    finally {
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
        fixture.cleanup();
    }
});
test("getBrcEduSyncedResourcesPath defaults under data/", async () => {
    await withSyncEnv({
        BRC_EDU_SYNCED_RESOURCES_PATH: undefined,
    }, () => {
        const path = getBrcEduSyncedResourcesPath("/project");
        assert.match(path.replace(/\\/g, "/"), /\/project\/data\/brc_edu_synced_resources\.json$/);
    });
});
