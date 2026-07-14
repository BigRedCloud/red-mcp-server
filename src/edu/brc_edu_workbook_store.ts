import {
  BlobServiceClient,
  type BlobDownloadResponseParsed,
  RestError,
} from "@azure/storage-blob";

import {
  buildWorkbookBufferFromAdminRows,
  parseWorkbookBufferToAdminRows,
  validateWebinarAdminRows,
  validateWorkbookBufferSize,
  WEBINAR_WORKBOOK_LATEST_BLOB,
  type WebinarResourceAdminRow,
  type WebinarWorkbookPayload,
} from "./brc_edu_workbook.js";
import {
  buildBrcEduBlobNames,
  contentTypeForUploadExtension,
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
  uploadWorkbook(params: {
    latestBuffer: Buffer;
    archiveBuffer: Buffer;
    ifMatch?: string;
  }): Promise<
    | { ok: true; etag: string; latestBlob: string; archiveBlob: string }
    | { ok: false; status: 409; error: string }
    | { ok: false; status: 503; error: string }
  >;
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

    async uploadWorkbook({ latestBuffer, archiveBuffer, ifMatch }) {
      const blobNames = buildBrcEduBlobNames("xlsx");
      const contentType = contentTypeForUploadExtension("xlsx");
      const archiveClient = container.getBlockBlobClient(blobNames.archive);
      const latestClient = container.getBlockBlobClient(blobNames.latest);

      try {
        await archiveClient.uploadData(archiveBuffer, {
          blobHTTPHeaders: { blobContentType: contentType },
        });

        await latestClient.uploadData(latestBuffer, {
          blobHTTPHeaders: { blobContentType: contentType },
          conditions: ifMatch ? { ifMatch } : undefined,
        });

        const properties = await latestClient.getProperties();

        return {
          ok: true,
          etag: properties.etag ?? "",
          latestBlob: blobNames.latest,
          archiveBlob: blobNames.archive,
        };
      } catch (error) {
        if (error instanceof RestError && error.statusCode === 412) {
          return {
            ok: false,
            status: 409,
            error:
              "The workbook changed in Azure. Refresh from Azure before saving.",
          };
        }

        const message = toSafeWorkbookStorageErrorMessage(error);

        return {
          ok: false,
          status: 503,
          error: message,
        };
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
        etag: downloaded.etag,
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

export type SaveWebinarWorkbookRequest = {
  rows: WebinarResourceAdminRow[];
  ifMatch?: string;
};

export async function saveWebinarWorkbookForAdmin(
  request: SaveWebinarWorkbookRequest,
  access: BrcEduWorkbookBlobAccess | null = createConfiguredWorkbookBlobAccess(),
  now: Date = new Date(),
): Promise<
  | {
      ok: true;
      latestBlob: string;
      archiveBlob: string;
      etag: string;
      rowCount: number;
      lastModified: string;
    }
  | { ok: false; status: 400 | 409 | 503; error: string; errors?: string[] }
> {
  if (!access) {
    return {
      ok: false,
      status: 503,
      error: "BRC Edu upload storage is not configured.",
    };
  }

  const validation = validateWebinarAdminRows(request.rows);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      error: "Workbook validation failed.",
      errors: validation.errors,
    };
  }

  const latestBuffer = await buildWorkbookBufferFromAdminRows(request.rows);
  const sizeValidation = await validateWorkbookBufferSize(latestBuffer);
  if (!sizeValidation.ok) {
    return {
      ok: false,
      status: 400,
      error: sizeValidation.error,
    };
  }

  const archiveBuffer = latestBuffer;
  const uploadResult = await access.uploadWorkbook({
    latestBuffer,
    archiveBuffer,
    ifMatch: request.ifMatch?.trim() || undefined,
  });

  if (!uploadResult.ok) {
    return {
      ok: false,
      status: uploadResult.status,
      error: uploadResult.error,
    };
  }

  return {
    ok: true,
    latestBlob: uploadResult.latestBlob,
    archiveBlob: uploadResult.archiveBlob,
    etag: uploadResult.etag,
    rowCount: request.rows.length,
    lastModified: now.toISOString(),
  };
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
