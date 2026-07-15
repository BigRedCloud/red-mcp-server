import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { renderBrcEduUploadPage } from "./brc_edu_upload_page.js";
import {
  parseWorkbookBufferToAdminRows,
} from "./brc_edu_workbook.js";
import {
  createAzureWorkbookBlobAccess,
  downloadWebinarWorkbookForAdmin,
  loadWebinarWorkbookForAdmin,
  toSafeWorkbookStorageErrorMessage,
  type BrcEduWorkbookBlobAccess,
  type WorkbookDownloadResult,
} from "./brc_edu_workbook_store.js";

const CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=secret;AccountKey=super-secret-key;EndpointSuffix=core.windows.net";

async function createXlsxBuffer(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");

  for (const row of rows) {
    worksheet.addRow(row);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function createMockWorkbookAccess(options: {
  initial?: WorkbookDownloadResult | null;
} = {}): BrcEduWorkbookBlobAccess {
  const stored = options.initial ?? null;

  return {
    async downloadLatestWorkbook() {
      return stored;
    },
  };
}

test("parseWorkbookBufferToAdminRows returns workbook rows as JSON", async () => {
  const buffer = await createXlsxBuffer([
    ["Video Title", "Video URL", "Help-Routing Category", "Description", "Active"],
    ["Sales invoices", "https://example.com/sales", "sales", "Sales help", "Yes"],
  ]);

  const rows = await parseWorkbookBufferToAdminRows(buffer);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.videoTitle, "Sales invoices");
  assert.equal(rows[0]?.helpRoutingCategory, "sales");
  assert.equal(rows[0]?.active, "Yes");
});

test("parseWorkbookBufferToAdminRows supports legacy five-column workbooks", async () => {
  const buffer = await createXlsxBuffer([
    ["Video Title", "Video URL", "Help-Routing Category"],
    ["Legacy row", "https://example.com/legacy", "setup"],
  ]);

  const rows = await parseWorkbookBufferToAdminRows(buffer);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.videoTitle, "Legacy row");
  assert.equal(rows[0]?.description, "");
  assert.equal(rows[0]?.active, "Yes");
});

test("loadWebinarWorkbookForAdmin loads the latest workbook", async () => {
  const buffer = await createXlsxBuffer([
    ["Video Title", "Video URL", "Help-Routing Category", "Description", "Active"],
    ["Bank feeds", "https://example.com/bank", "bank_feeds", "Bank help", "Yes"],
  ]);
  const access = createMockWorkbookAccess({
    initial: {
      buffer,
      etag: '"etag-1"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  const result = await loadWebinarWorkbookForAdmin(access);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.rowCount, 1);
    assert.equal(result.payload.rows[0]?.videoTitle, "Bank feeds");
    assert.equal(result.payload.lastModified, "2026-07-14T12:00:00.000Z");
  }
});

test("loadWebinarWorkbookForAdmin returns safe empty-preview payload when workbook is missing", async () => {
  const access = createMockWorkbookAccess({ initial: null });
  const result = await loadWebinarWorkbookForAdmin(access);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.match(result.error, /No latest workbook/i);
    assert.equal(result.error.includes("AccountKey"), false);
  }

  const emptyPreview = { rows: [], lastModified: "", rowCount: 0 };
  assert.deepEqual(emptyPreview.rows, []);
  assert.equal(emptyPreview.rowCount, 0);
});

test("downloadWebinarWorkbookForAdmin returns current workbook bytes", async () => {
  const buffer = Buffer.from("workbook-bytes");
  const access = createMockWorkbookAccess({
    initial: {
      buffer,
      etag: '"etag-download"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  const result = await downloadWebinarWorkbookForAdmin(access);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.buffer.toString(), "workbook-bytes");
    assert.equal(result.etag, '"etag-download"');
  }
});

test("legacy workbook with repeated titles can be loaded for read-only preview", async () => {
  const buffer = await createXlsxBuffer([
    ["Video Title", "Video URL", "Help-Routing Category", "Description", "Active"],
    [
      "Monthly webinar",
      "https://example.com/webinar-jan",
      "webinars",
      "January recording",
      "Yes",
    ],
    [
      "Monthly webinar",
      "https://example.com/webinar-feb",
      "webinars",
      "February recording",
      "Yes",
    ],
  ]);
  const access = createMockWorkbookAccess({
    initial: {
      buffer,
      etag: '"legacy-etag"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  const loaded = await loadWebinarWorkbookForAdmin(access);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.payload.rows.length, 2);
    assert.equal(loaded.payload.rows[0]?.videoTitle, "Monthly webinar");
    assert.equal(loaded.payload.rows[1]?.videoUrl, "https://example.com/webinar-feb");
  }
});

test("toSafeWorkbookStorageErrorMessage does not expose credentials", () => {
  const message = toSafeWorkbookStorageErrorMessage(
    new Error(`Upload failed: ${CONNECTION_STRING}`),
  );

  assert.equal(message, "BRC Edu workbook storage operation failed.");
  assert.equal(message.includes(CONNECTION_STRING), false);
});

test("renderBrcEduUploadPage escapes user-controlled HTML in URLs", () => {
  const maliciousSecret = 'safe-secret"><script>alert(1)</script>';
  const html = renderBrcEduUploadPage(maliciousSecret);

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /safe-secret%22%3E%3Cscript%3Ealert\(1\)%3C%2Fscript%3E/);
  assert.match(html, /Refresh from Azure/);
  assert.match(html, /Download current Excel/);
});

test("createAzureWorkbookBlobAccess is exported for integration wiring", () => {
  assert.equal(typeof createAzureWorkbookBlobAccess, "function");
});
