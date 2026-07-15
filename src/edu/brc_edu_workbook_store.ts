import {
  BlobServiceClient,
  type BlobDownloadResponseParsed,
} from "@azure/storage-blob";

import {
  parseWorkbookBufferToAdminRows,
  WEBINAR_WORKBOOK_LATEST_BLOB,
  type WebinarWorkbookPayload,
} from "./brc_edu_workbook.js";
import {
  getBrcEduUploadContainer,
  getBrcEduUploadStorageConnectionString,
} from "./brc_edu_upload_store.js";

const SECRET_ERROR_PATTERNS = [
  /AccountKey=/i,
  /DefaultEndpointsProtocol=/i,
  /SharedAccessSignature/i,
  /\bsig=[A-Za-z0-9%+/=]+/i,
  /Authorization:\s*Basic/i,
  /Basic [A-Za-z0-9+/=]{8,}/,
];

export type WorkbookDownloadResult = {
  buffer: Buffer;
  etag: string;
  lastModified: string;
};

export interface BrcEduWorkbookBlobAccess {
  downloadLatestWorkbook(): Promise<WorkbookDownloadResult | null>;
}

export function toSafeWorkbookStorageErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of SECRET_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return "BRC Edu workbook storage operation failed.";
    }
  }

  return message;
}

async function readStreamToBuffer(
  stream: NodeJS.ReadableStream | undefined,
): Promise<Buffer> {
  if (!stream) {
    throw new Error("Workbook download failed.");
  }

  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export function createAzureWorkbookBlobAccess(
  connectionString: string,
  containerName: string,
): BrcEduWorkbookBlobAccess {
  const container = BlobServiceClient.fromConnectionString(
    connectionString,
  ).getContainerClient(containerName);

  return {
    async downloadLatestWorkbook() {
      const blobClient = container.getBlockBlobClient(WEBINAR_WORKBOOK_LATEST_BLOB);

      try {
        const exists = await blobClient.exists();
        if (!exists) {
          return null;
        }

        const properties = await blobClient.getProperties();
        const response: BlobDownloadResponseParsed = await blobClient.download(0);
        const buffer = await readStreamToBuffer(response.readableStreamBody);

        return {
          buffer,
          etag: properties.etag ?? "",
          lastModified:
            properties.lastModified?.toISOString() ?? new Date(0).toISOString(),
        };
      } catch (error) {
        throw new Error(toSafeWorkbookStorageErrorMessage(error));
      }
    },
  };
}

export function createConfiguredWorkbookBlobAccess(): BrcEduWorkbookBlobAccess | null {
  const connectionString = getBrcEduUploadStorageConnectionString();
  const containerName = getBrcEduUploadContainer();

  if (!connectionString || !containerName) {
    return null;
  }

  return createAzureWorkbookBlobAccess(connectionString, containerName);
}

export async function loadWebinarWorkbookForAdmin(
  access: BrcEduWorkbookBlobAccess | null = createConfiguredWorkbookBlobAccess(),
): Promise<
  | { ok: true; payload: WebinarWorkbookPayload }
  | { ok: false; status: 404 | 503; error: string }
> {
  if (!access) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu upload storage is not configured.",
    };
  }

  try {
    const downloaded = await access.downloadLatestWorkbook();
    if (!downloaded) {
      return {
        ok: false,
        status: 404,
        error: "No latest workbook was found.",
      };
    }

    const rows = await parseWorkbookBufferToAdminRows(downloaded.buffer);

    return {
      ok: true,
      payload: {
        rows,
        lastModified: downloaded.lastModified,
        rowCount: rows.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: toSafeWorkbookStorageErrorMessage(error),
    };
  }
}

export async function downloadWebinarWorkbookForAdmin(
  access: BrcEduWorkbookBlobAccess | null = createConfiguredWorkbookBlobAccess(),
): Promise<
  | { ok: true; buffer: Buffer; etag: string; lastModified: string }
  | { ok: false; status: 404 | 503; error: string }
> {
  if (!access) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu upload storage is not configured.",
    };
  }

  try {
    const downloaded = await access.downloadLatestWorkbook();
    if (!downloaded) {
      return {
        ok: false,
        status: 404,
        error: "No latest workbook was found.",
      };
    }

    return {
      ok: true,
      buffer: downloaded.buffer,
      etag: downloaded.etag,
      lastModified: downloaded.lastModified,
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: toSafeWorkbookStorageErrorMessage(error),
    };
  }
}
