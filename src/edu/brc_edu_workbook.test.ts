import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import {
  normaliseSupportEduRows,
  parseSupportEduCsv,
} from "./brc_edu_enrichment.js";
import { renderBrcEduUploadPage } from "./brc_edu_upload_page.js";
import {
  adminRowsToSupportCsvText,
  buildWorkbookBufferFromAdminRows,
  parseWorkbookBufferToAdminRows,
  supportRowsFromAdminRows,
  validateWebinarAdminRows,
  type WebinarResourceAdminRow,
} from "./brc_edu_workbook.js";
import {
  createAzureWorkbookBlobAccess,
  downloadWebinarWorkbookForAdmin,
  loadWebinarWorkbookForAdmin,
  saveWebinarWorkbookForAdmin,
  toSafeWorkbookStorageErrorMessage,
  type BrcEduWorkbookBlobAccess,
  type WorkbookDownloadResult,
} from "./brc_edu_workbook_store.js";
import { xlsxBufferToCsvText } from "./brc_edu_xlsx.js";
import { WEBINAR_WORKBOOK_LATEST_BLOB } from "./brc_edu_workbook.js";

const CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=secret;AccountKey=super-secret-key;EndpointSuffix=core.windows.net";

function sampleRow(
  overrides: Partial<WebinarResourceAdminRow> = {},
): WebinarResourceAdminRow {
  return {
    videoTitle: "Bank feeds overview",
    videoUrl: "https://example.com/bank-feeds",
    helpRoutingCategory: "bank_feeds",
    description: "How bank feeds work",
    active: "Yes",
    ...overrides,
  };
}

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
  currentEtag?: string;
} = {}): {
  access: BrcEduWorkbookBlobAccess;
  uploads: Array<{ latest: Buffer; archive: Buffer; ifMatch?: string }>;
} {
  let stored = options.initial ?? null;
  const uploads: Array<{ latest: Buffer; archive: Buffer; ifMatch?: string }> =
    [];

  const access: BrcEduWorkbookBlobAccess = {
    async downloadLatestWorkbook() {
      return stored;
    },
    async uploadWorkbook({ latestBuffer, archiveBuffer, ifMatch }) {
      uploads.push({ latest: latestBuffer, archive: archiveBuffer, ifMatch });

      if (ifMatch && stored?.etag && ifMatch !== stored.etag) {
        return {
          ok: false,
          status: 409,
          error:
            "The workbook changed in Azure. Refresh from Azure before saving.",
        };
      }

      stored = {
        buffer: latestBuffer,
        etag: options.currentEtag ?? '"updated-etag"',
        lastModified: "2026-07-14T15:00:00.000Z",
      };

      return {
        ok: true,
        etag: stored.etag,
        latestBlob: WEBINAR_WORKBOOK_LATEST_BLOB,
        archiveBlob: "brc-edu/archive/webinar_video_routing_index_20260714_150000.xlsx",
      };
    },
  };

  return { access, uploads };
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
  const { access } = createMockWorkbookAccess({
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
    assert.equal(result.payload.etag, '"etag-1"');
    assert.equal(result.payload.rows[0]?.videoTitle, "Bank feeds");
  }
});

test("loadWebinarWorkbookForAdmin returns 404 when latest workbook is missing", async () => {
  const { access } = createMockWorkbookAccess({ initial: null });
  const result = await loadWebinarWorkbookForAdmin(access);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
  }
});

test("downloadWebinarWorkbookForAdmin returns current workbook bytes", async () => {
  const buffer = Buffer.from("workbook-bytes");
  const { access } = createMockWorkbookAccess({
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

test("saveWebinarWorkbookForAdmin saves valid edited rows", async () => {
  const { access, uploads } = createMockWorkbookAccess({
    initial: {
      buffer: Buffer.from("initial"),
      etag: '"etag-initial"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  const result = await saveWebinarWorkbookForAdmin(
    {
      rows: [sampleRow(), sampleRow({ videoTitle: "Sales invoices", videoUrl: "https://example.com/sales" })],
      ifMatch: '"etag-initial"',
    },
    access,
    new Date("2026-07-14T15:00:00.000Z"),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rowCount, 2);
    assert.equal(result.latestBlob, WEBINAR_WORKBOOK_LATEST_BLOB);
  }

  assert.equal(uploads.length, 1);
});

test("saveWebinarWorkbookForAdmin creates archive before replacing latest", async () => {
  const { access, uploads } = createMockWorkbookAccess({
    initial: {
      buffer: Buffer.from("initial"),
      etag: '"etag-initial"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  await saveWebinarWorkbookForAdmin(
    { rows: [sampleRow()], ifMatch: '"etag-initial"' },
    access,
  );

  assert.equal(uploads.length, 1);
  assert.ok(uploads[0]?.archive.byteLength > 0);
  assert.ok(uploads[0]?.latest.byteLength > 0);
});

test("validateWebinarAdminRows rejects invalid URL", () => {
  const result = validateWebinarAdminRows([
    sampleRow({ videoUrl: "not-a-url" }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /valid http or https URL/i);
  }
});

test("validateWebinarAdminRows rejects missing required field", () => {
  const result = validateWebinarAdminRows([
    sampleRow({ videoTitle: "  " }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /Video Title is required/i);
  }
});

test("validateWebinarAdminRows accepts same title with different URLs", () => {
  const result = validateWebinarAdminRows([
    sampleRow(),
    sampleRow({ videoUrl: "https://example.com/other" }),
  ]);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings.join(" "), /Duplicate Video Title/i);
  }
});

test("validateWebinarAdminRows rejects duplicate URL", () => {
  const result = validateWebinarAdminRows([
    sampleRow(),
    sampleRow({ videoTitle: "Different title" }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /Duplicate Video URL/i);
  }
});

test("validateWebinarAdminRows rejects same title and same URL as duplicate URL", () => {
  const result = validateWebinarAdminRows([
    sampleRow(),
    sampleRow(),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /Duplicate Video URL/i);
    assert.equal(result.errors.some((error) => /Duplicate Video Title/i.test(error)), false);
  }
});

test("validateWebinarAdminRows rejects duplicate URL case-insensitively", () => {
  const result = validateWebinarAdminRows([
    sampleRow({ videoUrl: "https://example.com/bank-feeds" }),
    sampleRow({
      videoTitle: "Different title",
      videoUrl: "  HTTPS://EXAMPLE.COM/bank-feeds  ",
    }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /Duplicate Video URL/i);
  }
});

test("legacy workbook with repeated titles can be loaded, edited and saved", async () => {
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
  const { access, uploads } = createMockWorkbookAccess({
    initial: {
      buffer,
      etag: '"legacy-etag"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  const loaded = await loadWebinarWorkbookForAdmin(access);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.equal(loaded.payload.rows.length, 2);
  assert.equal(loaded.payload.warnings?.length, 1);

  const editedRows = loaded.payload.rows.map((row, index) =>
    index === 1 ? { ...row, description: "Updated February notes" } : row,
  );

  const saved = await saveWebinarWorkbookForAdmin(
    { rows: editedRows, ifMatch: loaded.payload.etag },
    access,
  );

  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.rowCount, 2);
    assert.equal(saved.warnings.length, 1);
  }

  assert.equal(uploads.length, 1);
});

test("validateWebinarAdminRows rejects invalid Active value", () => {
  const result = validateWebinarAdminRows([
    sampleRow({ active: "maybe" }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join(" "), /Active must be Yes, No, True, or False/i);
  }
});

test("saveWebinarWorkbookForAdmin returns 409 for stale ETag", async () => {
  const { access } = createMockWorkbookAccess({
    initial: {
      buffer: Buffer.from("initial"),
      etag: '"etag-current"',
      lastModified: "2026-07-14T12:00:00.000Z",
    },
  });

  const result = await saveWebinarWorkbookForAdmin(
    { rows: [sampleRow()], ifMatch: '"etag-stale"' },
    access,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.error, /Refresh from Azure/i);
  }
});

test("toSafeWorkbookStorageErrorMessage does not expose credentials", () => {
  const message = toSafeWorkbookStorageErrorMessage(
    new Error(`Upload failed: ${CONNECTION_STRING}`),
  );

  assert.equal(message, "BRC Edu workbook storage operation failed.");
  assert.equal(message.includes(CONNECTION_STRING), false);
});

test("generated workbook round-trips through the support CSV parser", async () => {
  const rows = [
    sampleRow(),
    sampleRow({
      videoTitle: "Sales invoices",
      videoUrl: "https://example.com/sales",
      helpRoutingCategory: "sales",
    }),
  ];

  const csvText = await adminRowsToSupportCsvText(rows);
  const parsedRows = normaliseSupportEduRows(parseSupportEduCsv(csvText));

  assert.equal(parsedRows.length, 2);
  assert.equal(parsedRows[0]?.title, "Bank feeds overview");
  assert.equal(parsedRows[1]?.url, "https://example.com/sales");
});

test("supportRowsFromAdminRows remains compatible with five-column source files", () => {
  const rows = supportRowsFromAdminRows([
    {
      videoTitle: "Legacy title",
      videoUrl: "https://example.com/legacy",
      helpRoutingCategory: "setup",
      description: "",
      active: "Yes",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "Legacy title");
});

test("buildWorkbookBufferFromAdminRows round-trips optional columns", async () => {
  const rows = [
    sampleRow({
      resourceType: "webinar",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    }),
  ];

  const buffer = await buildWorkbookBufferFromAdminRows(rows);
  const parsed = await parseWorkbookBufferToAdminRows(buffer);

  assert.equal(parsed[0]?.resourceType, "webinar");
  assert.equal(parsed[0]?.startDate, "2026-01-01");
  assert.equal(parsed[0]?.endDate, "2026-12-31");
});

test("renderBrcEduUploadPage escapes user-controlled HTML", () => {
  const maliciousSecret = 'safe-secret"><script>alert(1)</script>';
  const html = renderBrcEduUploadPage(maliciousSecret);

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /safe-secret%22%3E%3Cscript%3Ealert\(1\)%3C%2Fscript%3E/);
  assert.match(html, /Refresh from Azure/);
  assert.match(html, /Save &amp; Publish/);
});

test("xlsxBufferToCsvText converts generated workbook to CSV text", async () => {
  const buffer = await buildWorkbookBufferFromAdminRows([sampleRow()]);
  const csvText = await xlsxBufferToCsvText(buffer);

  assert.match(csvText, /Video Title,Video URL,Help-Routing Category/);
  assert.match(csvText, /Bank feeds overview/);
});

test("createAzureWorkbookBlobAccess is exported for integration wiring", () => {
  assert.equal(typeof createAzureWorkbookBlobAccess, "function");
});
