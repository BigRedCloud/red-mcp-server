import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { EnrichedEduResource } from "./brc_edu_enrichment.js";
import {
  enrichSupportEduRows,
  normaliseSupportEduRows,
  parseSupportEduCsv,
} from "./brc_edu_enrichment.js";
import { resolveBrcEduCsvPath } from "./brc_edu_paths.js";

export const BRC_EDU_SYNC_SECRET_HEADER = "x-red-edu-sync-secret";
export const DEFAULT_BRC_EDU_SYNCED_RESOURCES_PATH = "data/brc_edu_synced_resources.json";

export type SyncedEduResourcesFile = {
  storedAt: string;
  resources: EnrichedEduResource[];
};

export type BrcEduSyncSummary = {
  ok: true;
  rowsRead: number;
  rowsEnriched: number;
  inactiveRows: number;
  needsReviewRows: number;
  storedAt: string;
};

export type BrcEduSyncErrorBody = {
  ok: false;
  error: string;
};

export type BrcEduSyncHttpResult =
  | { status: 200; body: BrcEduSyncSummary }
  | { status: 400 | 401 | 503; body: BrcEduSyncErrorBody };

export function getBrcEduSyncSecret(): string | null {
  const secret = process.env.BRC_EDU_SYNC_SECRET?.trim();
  return secret || null;
}

export function getBrcEduSyncedResourcesPath(baseDir: string = process.cwd()): string {
  return resolveBrcEduCsvPath(
    process.env.BRC_EDU_SYNCED_RESOURCES_PATH,
    DEFAULT_BRC_EDU_SYNCED_RESOURCES_PATH,
    baseDir,
  );
}

function asTrimmedString(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function isValidEnrichedEduResource(value: unknown): value is EnrichedEduResource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Boolean(asTrimmedString(record.title) && asTrimmedString(record.url));
}

export function parseSyncedEduResourcesPayload(
  payload: unknown,
): EnrichedEduResource[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const resources = (payload as SyncedEduResourcesFile).resources;
  if (!Array.isArray(resources)) {
    return null;
  }

  const parsed = resources.filter((resource) => isValidEnrichedEduResource(resource));
  return parsed.length > 0 ? parsed : null;
}

export function loadSyncedEduResources(baseDir: string = process.cwd()): EnrichedEduResource[] | null {
  const filePath = getBrcEduSyncedResourcesPath(baseDir);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const payload = JSON.parse(content) as unknown;
    return parseSyncedEduResourcesPayload(payload);
  } catch {
    return null;
  }
}

export function writeSyncedEduResources(
  resources: EnrichedEduResource[],
  baseDir: string = process.cwd(),
): SyncedEduResourcesFile {
  const filePath = getBrcEduSyncedResourcesPath(baseDir);
  const storedAt = new Date().toISOString();
  const payload: SyncedEduResourcesFile = {
    storedAt,
    resources,
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return payload;
}

export function enrichSupportCsvText(csvText: string): {
  rowsRead: number;
  resources: EnrichedEduResource[];
  inactiveRows: number;
  needsReviewRows: number;
} {
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

export function syncEduResourcesFromCsvText(
  csvText: string,
  baseDir: string = process.cwd(),
): BrcEduSyncSummary {
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

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function handleBrcEduResourcesSyncRequest(
  body: unknown,
  requestSecret: string | undefined,
  baseDir: string = process.cwd(),
): BrcEduSyncHttpResult {
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

  const csvText =
    body && typeof body === "object" ? (body as Record<string, unknown>).csvText : undefined;
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
