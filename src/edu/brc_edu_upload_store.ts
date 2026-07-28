import { timingSafeEqual } from "node:crypto";

import { BlobServiceClient } from "@azure/storage-blob";

export const BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY = "secret";
export const BRC_EDU_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const BRC_EDU_UPLOAD_FIELD_NAME = "file";

export type AcceptedUploadExtension = "csv" | "xlsx";

export type BrcEduUploadAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export type BrcEduUploadHttpResult =
  | { ok: true; latestBlob: string; archiveBlob: string; extension: AcceptedUploadExtension }
  | { ok: false; status: 400 | 401 | 503; error: string };

export type BrcEduUploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
};

export interface BrcEduBlobUploader {
  upload(buffer: Buffer, blobName: string, contentType: string): Promise<void>;
}

export function getBrcEduAdminUploadSecret(): string | null {
  const secret = process.env.BRC_EDU_ADMIN_UPLOAD_SECRET?.trim();
  return secret || null;
}

export function getBrcEduUploadStorageConnectionString(): string | null {
  const connectionString = process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING?.trim();
  return connectionString || null;
}

export function getBrcEduUploadContainer(): string | null {
  const container = process.env.BRC_EDU_UPLOAD_CONTAINER?.trim();
  return container || null;
}

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function validateBrcEduAdminUploadSecret(
  providedSecret: string | undefined,
): BrcEduUploadAuthResult {
  const configuredSecret = getBrcEduAdminUploadSecret();
  if (!configuredSecret) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu admin upload is not configured.",
    };
  }

  const normalizedSecret = providedSecret?.trim() ?? "";
  if (!normalizedSecret || !secretsMatch(configuredSecret, normalizedSecret)) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized.",
    };
  }

  return { ok: true };
}

export function resolveUploadExtension(filename: string): AcceptedUploadExtension | null {
  const normalized = filename.trim().toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv";
  }

  if (normalized.endsWith(".xlsx")) {
    return "xlsx";
  }

  return null;
}

export function contentTypeForUploadExtension(extension: AcceptedUploadExtension): string {
  if (extension === "csv") {
    return "text/csv";
  }

  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function formatArchiveTimestamp(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

export function buildBrcEduBlobNames(
  extension: AcceptedUploadExtension,
  now: Date = new Date(),
): { latest: string; archive: string } {
  const timestamp = formatArchiveTimestamp(now);

  return {
    latest: `brc-edu/latest/webinar_video_routing_index.${extension}`,
    archive: `brc-edu/archive/webinar_video_routing_index_${timestamp}.${extension}`,
  };
}

export function createAzureBlobUploader(
  connectionString: string,
  containerName: string,
): BrcEduBlobUploader {
  const client = BlobServiceClient.fromConnectionString(connectionString);
  const container = client.getContainerClient(containerName);

  return {
    async upload(buffer: Buffer, blobName: string, contentType: string): Promise<void> {
      const blockBlob = container.getBlockBlobClient(blobName);
      await blockBlob.upload(buffer, buffer.length, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
      });
    },
  };
}

export function createConfiguredBrcEduBlobUploader(): BrcEduBlobUploader | null {
  const connectionString = getBrcEduUploadStorageConnectionString();
  const container = getBrcEduUploadContainer();

  if (!connectionString || !container) {
    return null;
  }

  return createAzureBlobUploader(connectionString, container);
}

export async function handleBrcEduResourceUpload(
  file: BrcEduUploadedFile | undefined,
  uploader: BrcEduBlobUploader | null = createConfiguredBrcEduBlobUploader(),
): Promise<BrcEduUploadHttpResult> {
  if (!file?.buffer?.length) {
    return {
      ok: false,
      status: 400,
      error: "A file is required.",
    };
  }

  if (!uploader) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu upload storage is not configured.",
    };
  }

  if (file.size > BRC_EDU_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "File exceeds the maximum size of 5 MB.",
    };
  }

  const extension = resolveUploadExtension(file.originalname);
  if (!extension) {
    return {
      ok: false,
      status: 400,
      error: "Only .xlsx and .csv files are accepted.",
    };
  }

  const blobNames = buildBrcEduBlobNames(extension);
  const contentType = contentTypeForUploadExtension(extension);

  await uploader.upload(file.buffer, blobNames.latest, contentType);
  await uploader.upload(file.buffer, blobNames.archive, contentType);

  return {
    ok: true,
    latestBlob: blobNames.latest,
    archiveBlob: blobNames.archive,
    extension,
  };
}
