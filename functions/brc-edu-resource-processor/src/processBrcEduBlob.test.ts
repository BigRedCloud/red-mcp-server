import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { RED_BRC_EDU_SYNC_SECRET_HEADER } from "./constants.js";
import { processBrcEduBlob } from "./processBrcEduBlob.js";
import { formatRedSyncFailureMessage } from "./syncToRed.js";

const SAMPLE_CSV = [
  "Video Title,Video URL,Help-Routing Category",
  "Integration bank feeds,https://example.com/integration-bank-feeds,bank_feeds",
].join("\n");

type CapturedLog = {
  level: "info" | "error";
  message: string;
};

function createCapturingLogger(): {
  logger: { log: (level: "info" | "error", message: string) => void };
  entries: CapturedLog[];
} {
  const entries: CapturedLog[] = [];

  return {
    entries,
    logger: {
      log(level, message) {
        entries.push({ level, message });
      },
    },
  };
}

async function createXlsxBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");

  for (const row of rows) {
    worksheet.addRow(row);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

test("CSV blob posts csvText to Red", async () => {
  const { logger, entries } = createCapturingLogger();
  let postedBody: { csvText?: string } | undefined;
  let postedSecret: string | undefined;

  const fetchFn = (async (_url, init) => {
    postedSecret = (init?.headers as Record<string, string>)[RED_BRC_EDU_SYNC_SECRET_HEADER];
    postedBody = JSON.parse(String(init?.body)) as { csvText?: string };

    return new Response(
      JSON.stringify({
        ok: true,
        rowsRead: 1,
        rowsEnriched: 1,
        storedAt: "2026-07-09T12:00:00.000Z",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const outcome = await processBrcEduBlob({
    fileName: "webinar_video_routing_index.csv",
    buffer: Buffer.from(SAMPLE_CSV, "utf8"),
    endpoint: "https://red.example/internal/brc-edu/resources/sync",
    secret: "sync-secret-value",
    fetchFn,
    logger,
  });

  assert.equal(outcome, "synced");
  assert.equal(postedBody?.csvText, SAMPLE_CSV);
  assert.equal(postedSecret, "sync-secret-value");
  assert.equal(entries.some((entry) => entry.message.includes("synced successfully")), true);
  assert.equal(entries.some((entry) => entry.message.includes(SAMPLE_CSV)), false);
});

test("XLSX blob converts first worksheet to CSV and posts csvText", async () => {
  const { logger } = createCapturingLogger();
  let postedBody: { csvText?: string } | undefined;

  const fetchFn = (async (_url, init) => {
    postedBody = JSON.parse(String(init?.body)) as { csvText?: string };

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const xlsxBuffer = await createXlsxBuffer([
    ["Video Title", "Video URL", "Help-Routing Category"],
    ["Integration bank feeds", "https://example.com/integration-bank-feeds", "bank_feeds"],
  ]);

  const outcome = await processBrcEduBlob({
    fileName: "webinar_video_routing_index.xlsx",
    buffer: xlsxBuffer,
    endpoint: "https://red.example/internal/brc-edu/resources/sync",
    secret: "sync-secret-value",
    fetchFn,
    logger,
  });

  assert.equal(outcome, "synced");
  assert.ok(postedBody?.csvText?.includes("Video Title"));
  assert.ok(postedBody?.csvText?.includes("Integration bank feeds"));
  assert.ok(postedBody?.csvText?.includes("bank_feeds"));
});

test("unsupported file extension is ignored safely", async () => {
  const { logger, entries } = createCapturingLogger();
  let fetchCalled = false;

  const fetchFn = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const outcome = await processBrcEduBlob({
    fileName: "notes.txt",
    buffer: Buffer.from("hello"),
    endpoint: "https://red.example/internal/brc-edu/resources/sync",
    secret: "sync-secret-value",
    fetchFn,
    logger,
  });

  assert.equal(outcome, "ignored");
  assert.equal(fetchCalled, false);
  assert.equal(entries[0]?.level, "info");
  assert.match(entries[0]?.message ?? "", /Ignoring unsupported/i);
});

test("failed Red response logs a safe error", async () => {
  const { logger, entries } = createCapturingLogger();

  const fetchFn = (async () =>
    new Response(JSON.stringify({ ok: false, error: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const outcome = await processBrcEduBlob({
    fileName: "webinar_video_routing_index.csv",
    buffer: Buffer.from(SAMPLE_CSV, "utf8"),
    endpoint: "https://red.example/internal/brc-edu/resources/sync",
    secret: "sync-secret-value",
    fetchFn,
    logger,
  });

  assert.equal(outcome, "failed");
  const errorEntry = entries.find((entry) => entry.level === "error");
  assert.ok(errorEntry);
  assert.match(errorEntry?.message ?? "", /Red sync failed with status 401/i);
  assert.match(errorEntry?.message ?? "", /Unauthorized/i);
  assert.equal(errorEntry?.message.includes(SAMPLE_CSV), false);
});

test("secrets are not logged", async () => {
  const secret = "processor-sync-secret-value";
  const { logger, entries } = createCapturingLogger();

  const fetchFn = (async () =>
    new Response(JSON.stringify({ ok: false, error: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  await processBrcEduBlob({
    fileName: "webinar_video_routing_index.csv",
    buffer: Buffer.from(SAMPLE_CSV, "utf8"),
    endpoint: "https://red.example/internal/brc-edu/resources/sync",
    secret,
    fetchFn,
    logger,
  });

  const combined = entries.map((entry) => entry.message).join("\n");
  assert.equal(combined.includes(secret), false);
  assert.equal(combined.includes(RED_BRC_EDU_SYNC_SECRET_HEADER), false);
});

test("formatRedSyncFailureMessage returns a safe summary", () => {
  const message = formatRedSyncFailureMessage({
    ok: false,
    status: 503,
    body: { ok: false, error: "BRC Edu sync is not configured." },
  });

  assert.match(message, /status 503/i);
  assert.match(message, /not configured/i);
});
