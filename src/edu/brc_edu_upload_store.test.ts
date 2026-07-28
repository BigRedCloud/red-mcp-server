import assert from "node:assert/strict";
import test from "node:test";

import {
  BRC_EDU_UPLOAD_MAX_BYTES,
  buildBrcEduBlobNames,
  contentTypeForUploadExtension,
  handleBrcEduResourceUpload,
  resolveUploadExtension,
  validateBrcEduAdminUploadSecret,
  type BrcEduBlobUploader,
} from "./brc_edu_upload_store.js";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

function createMockUploader(): {
  uploader: BrcEduBlobUploader;
  uploads: Array<{ blobName: string; contentType: string; buffer: Buffer }>;
} {
  const uploads: Array<{ blobName: string; contentType: string; buffer: Buffer }> = [];

  return {
    uploads,
    uploader: {
      async upload(buffer: Buffer, blobName: string, contentType: string): Promise<void> {
        uploads.push({ blobName, contentType, buffer });
      },
    },
  };
}

test("validateBrcEduAdminUploadSecret returns 503 when admin secret is not configured", () => {
  restoreEnv();
  process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "";

  const result = validateBrcEduAdminUploadSecret("any-secret");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
  }
});

test("validateBrcEduAdminUploadSecret returns 401 for missing or wrong secret", () => {
  restoreEnv();
  process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "configured-secret";

  const missing = validateBrcEduAdminUploadSecret(undefined);
  const wrong = validateBrcEduAdminUploadSecret("wrong-secret");

  assert.equal(missing.ok, false);
  assert.equal(wrong.ok, false);
  if (!missing.ok) {
    assert.equal(missing.status, 401);
  }
  if (!wrong.ok) {
    assert.equal(wrong.status, 401);
  }
});

test("validateBrcEduAdminUploadSecret accepts the configured secret", () => {
  restoreEnv();
  process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "configured-secret";

  const result = validateBrcEduAdminUploadSecret("configured-secret");
  assert.equal(result.ok, true);
});

test("resolveUploadExtension accepts csv and xlsx only", () => {
  assert.equal(resolveUploadExtension("webinar_video_routing_index.csv"), "csv");
  assert.equal(resolveUploadExtension("WEBINAR_VIDEO_ROUTING_INDEX.XLSX"), "xlsx");
  assert.equal(resolveUploadExtension("notes.txt"), null);
  assert.equal(resolveUploadExtension("legacy.xls"), null);
});

test("buildBrcEduBlobNames uses latest and archive paths", () => {
  const names = buildBrcEduBlobNames("csv", new Date("2026-07-09T14:30:45.000Z"));

  assert.equal(names.latest, "brc-edu/latest/webinar_video_routing_index.csv");
  assert.equal(names.archive, "brc-edu/archive/webinar_video_routing_index_20260709_143045.csv");
});

test("handleBrcEduResourceUpload rejects missing file", async () => {
  const { uploader } = createMockUploader();

  const result = await handleBrcEduResourceUpload(undefined, uploader);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /required/i);
  }
});

test("handleBrcEduResourceUpload rejects invalid file type", async () => {
  const { uploader } = createMockUploader();

  const result = await handleBrcEduResourceUpload(
    {
      buffer: Buffer.from("hello"),
      originalname: "notes.txt",
      size: 5,
    },
    uploader,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /\.xlsx and \.csv/i);
  }
});

test("handleBrcEduResourceUpload rejects file over 5MB", async () => {
  const { uploader } = createMockUploader();

  const result = await handleBrcEduResourceUpload(
    {
      buffer: Buffer.alloc(BRC_EDU_UPLOAD_MAX_BYTES + 1),
      originalname: "webinar_video_routing_index.csv",
      size: BRC_EDU_UPLOAD_MAX_BYTES + 1,
    },
    uploader,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /5 MB/i);
  }
});

test("handleBrcEduResourceUpload stores csv latest and archive blobs", async () => {
  const { uploader, uploads } = createMockUploader();
  const buffer = Buffer.from("Video Title,Video URL,Help-Routing Category\n");

  const result = await handleBrcEduResourceUpload(
    {
      buffer,
      originalname: "webinar_video_routing_index.csv",
      mimetype: "text/csv",
      size: buffer.length,
    },
    uploader,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.extension, "csv");
    assert.equal(result.latestBlob, "brc-edu/latest/webinar_video_routing_index.csv");
    assert.match(result.archiveBlob, /^brc-edu\/archive\/webinar_video_routing_index_\d{8}_\d{6}\.csv$/);
  }

  assert.equal(uploads.length, 2);
  assert.deepEqual(
    uploads.map((entry) => entry.blobName),
    [result.ok ? result.latestBlob : "", result.ok ? result.archiveBlob : ""],
  );
  assert.equal(uploads[0]?.contentType, contentTypeForUploadExtension("csv"));
  assert.equal(uploads[1]?.contentType, contentTypeForUploadExtension("csv"));
});

test("handleBrcEduResourceUpload stores xlsx latest and archive blobs", async () => {
  const { uploader, uploads } = createMockUploader();
  const buffer = Buffer.from("xlsx-bytes");

  const result = await handleBrcEduResourceUpload(
    {
      buffer,
      originalname: "webinar_video_routing_index.xlsx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.length,
    },
    uploader,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.extension, "xlsx");
    assert.equal(result.latestBlob, "brc-edu/latest/webinar_video_routing_index.xlsx");
    assert.match(result.archiveBlob, /^brc-edu\/archive\/webinar_video_routing_index_\d{8}_\d{6}\.xlsx$/);
  }

  assert.equal(uploads.length, 2);
  assert.equal(uploads[0]?.contentType, contentTypeForUploadExtension("xlsx"));
});

test("handleBrcEduResourceUpload returns 503 when storage is not configured", async () => {
  restoreEnv();
  process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING = "";
  process.env.BRC_EDU_UPLOAD_CONTAINER = "";

  const result = await handleBrcEduResourceUpload({
    buffer: Buffer.from("Video Title,Video URL,Help-Routing Category\n"),
    originalname: "webinar_video_routing_index.csv",
    size: 42,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
  }
});
