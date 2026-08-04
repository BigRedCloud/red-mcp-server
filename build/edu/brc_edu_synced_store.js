import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { enrichSupportEduRows, normaliseSupportEduRows, parseSupportEduCsv, } from "./brc_edu_enrichment.js";
import { resolveBrcEduCsvPath } from "./brc_edu_paths.js";
export const BRC_EDU_SYNC_SECRET_HEADER = "x-red-edu-sync-secret";
export const DEFAULT_BRC_EDU_SYNCED_RESOURCES_PATH = "data/brc_edu_synced_resources.json";
export function getBrcEduSyncSecret() {
    const secret = process.env.BRC_EDU_SYNC_SECRET?.trim();
    return secret || null;
}
export function getBrcEduSyncedResourcesPath(baseDir = process.cwd()) {
    return resolveBrcEduCsvPath(process.env.BRC_EDU_SYNCED_RESOURCES_PATH, DEFAULT_BRC_EDU_SYNCED_RESOURCES_PATH, baseDir);
}
function asTrimmedString(value) {
    if (value == null) {
        return "";
    }
    return String(value).trim();
}
function isValidEnrichedEduResource(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value;
    return Boolean(asTrimmedString(record.title) && asTrimmedString(record.url));
}
export function parseSyncedEduResourcesPayload(payload) {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const resources = payload.resources;
    if (!Array.isArray(resources)) {
        return null;
    }
    const parsed = resources.filter((resource) => isValidEnrichedEduResource(resource));
    return parsed.length > 0 ? parsed : null;
}
export function loadSyncedEduResources(baseDir = process.cwd()) {
    const filePath = getBrcEduSyncedResourcesPath(baseDir);
    if (!existsSync(filePath)) {
        return null;
    }
    try {
        const content = readFileSync(filePath, "utf8");
        const payload = JSON.parse(content);
        return parseSyncedEduResourcesPayload(payload);
    }
    catch {
        return null;
    }
}
export function writeSyncedEduResources(resources, baseDir = process.cwd()) {
    const filePath = getBrcEduSyncedResourcesPath(baseDir);
    const storedAt = new Date().toISOString();
    const payload = {
        storedAt,
        resources,
    };
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
}
export function enrichSupportCsvText(csvText) {
    const rawRows = parseSupportEduCsv(csvText);
    const supportRows = normaliseSupportEduRows(rawRows);
    const resources = enrichSupportEduRows(supportRows);
    return {
        rowsRead: rawRows.length,
        resources,
        inactiveRows: resources.filter((row) => row.isActive === false).length,
        needsReviewRows: resources.filter((row) => row.needsReview === true).length,
    };
}
export function syncEduResourcesFromCsvText(csvText, baseDir = process.cwd()) {
    const enriched = enrichSupportCsvText(csvText);
    const stored = writeSyncedEduResources(enriched.resources, baseDir);
    return {
        ok: true,
        rowsRead: enriched.rowsRead,
        rowsEnriched: enriched.resources.length,
        inactiveRows: enriched.inactiveRows,
        needsReviewRows: enriched.needsReviewRows,
        storedAt: stored.storedAt,
    };
}
function secretsMatch(expected, provided) {
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (expectedBuffer.length !== providedBuffer.length) {
        return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
}
export function handleBrcEduResourcesSyncRequest(body, requestSecret, baseDir = process.cwd()) {
    const configuredSecret = getBrcEduSyncSecret();
    if (!configuredSecret) {
        return {
            status: 503,
            body: {
                ok: false,
                error: "BRC Edu sync is not configured.",
            },
        };
    }
    const providedSecret = requestSecret?.trim() ?? "";
    if (!providedSecret || !secretsMatch(configuredSecret, providedSecret)) {
        return {
            status: 401,
            body: {
                ok: false,
                error: "Unauthorized.",
            },
        };
    }
    const csvText = body && typeof body === "object" ? body.csvText : undefined;
    if (typeof csvText !== "string" || !csvText.trim()) {
        return {
            status: 400,
            body: {
                ok: false,
                error: "csvText is required.",
            },
        };
    }
    const summary = syncEduResourcesFromCsvText(csvText, baseDir);
    return {
        status: 200,
        body: summary,
    };
}
