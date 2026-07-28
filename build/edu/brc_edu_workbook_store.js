import { BlobServiceClient, RestError, } from "@azure/storage-blob";
import { buildWorkbookBufferFromAdminRows, parseWorkbookBufferToAdminRows, validateWebinarAdminRows, validateWorkbookBufferSize, WEBINAR_WORKBOOK_LATEST_BLOB, } from "./brc_edu_workbook.js";
import { buildBrcEduBlobNames, contentTypeForUploadExtension, getBrcEduUploadContainer, getBrcEduUploadStorageConnectionString, } from "./brc_edu_upload_store.js";
const SECRET_ERROR_PATTERNS = [
    /AccountKey=/i,
    /DefaultEndpointsProtocol=/i,
    /SharedAccessSignature/i,
    /\bsig=[A-Za-z0-9%+/=]+/i,
    /Authorization:\s*Basic/i,
    /Basic [A-Za-z0-9+/=]{8,}/,
];
export function toSafeWorkbookStorageErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const pattern of SECRET_ERROR_PATTERNS) {
        if (pattern.test(message)) {
            return "BRC Edu workbook storage operation failed.";
        }
    }
    return message;
}
async function readStreamToBuffer(stream) {
    if (!stream) {
        throw new Error("Workbook download failed.");
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
export function createAzureWorkbookBlobAccess(connectionString, containerName) {
    const container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
    return {
        async downloadLatestWorkbook() {
            const blobClient = container.getBlockBlobClient(WEBINAR_WORKBOOK_LATEST_BLOB);
            try {
                const exists = await blobClient.exists();
                if (!exists) {
                    return null;
                }
                const properties = await blobClient.getProperties();
                const response = await blobClient.download(0);
                const buffer = await readStreamToBuffer(response.readableStreamBody);
                return {
                    buffer,
                    etag: properties.etag ?? "",
                    lastModified: properties.lastModified?.toISOString() ?? new Date(0).toISOString(),
                };
            }
            catch (error) {
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
            }
            catch (error) {
                if (error instanceof RestError && error.statusCode === 412) {
                    return {
                        ok: false,
                        status: 409,
                        error: "The workbook changed in Azure. Refresh from Azure before saving.",
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
export function createConfiguredWorkbookBlobAccess() {
    const connectionString = getBrcEduUploadStorageConnectionString();
    const containerName = getBrcEduUploadContainer();
    if (!connectionString || !containerName) {
        return null;
    }
    return createAzureWorkbookBlobAccess(connectionString, containerName);
}
export async function loadWebinarWorkbookForAdmin(access = createConfiguredWorkbookBlobAccess()) {
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
        const validation = validateWebinarAdminRows(rows);
        return {
            ok: true,
            payload: {
                rows,
                etag: downloaded.etag,
                lastModified: downloaded.lastModified,
                rowCount: rows.length,
                ...(validation.warnings.length > 0
                    ? { warnings: validation.warnings }
                    : {}),
            },
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 503,
            error: toSafeWorkbookStorageErrorMessage(error),
        };
    }
}
export async function saveWebinarWorkbookForAdmin(request, access = createConfiguredWorkbookBlobAccess(), now = new Date()) {
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
        warnings: validation.warnings,
    };
}
export async function downloadWebinarWorkbookForAdmin(access = createConfiguredWorkbookBlobAccess()) {
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
    }
    catch (error) {
        return {
            ok: false,
            status: 503,
            error: toSafeWorkbookStorageErrorMessage(error),
        };
    }
}
