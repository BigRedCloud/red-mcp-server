import { Readable } from "node:stream";
import { BlobServiceClient, } from "@azure/storage-blob";
const SECRET_ERROR_PATTERNS = [
    /AccountKey=/i,
    /DefaultEndpointsProtocol=/i,
    /SharedAccessSignature/i,
    /\bsig=[A-Za-z0-9%+/=]+/i,
    /Authorization:\s*Basic/i,
    /Basic [A-Za-z0-9+/=]{8,}/,
];
export function toSafeVersionedIndexStorageError(error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const pattern of SECRET_ERROR_PATTERNS) {
        if (pattern.test(message)) {
            return "Help resource index storage operation failed.";
        }
    }
    return message;
}
async function readStreamToString(stream) {
    if (!stream) {
        throw new Error("Help resource index download failed.");
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
export function buildVersionedHelpIndex(items, generatedAt = new Date()) {
    return {
        generatedAt: generatedAt.toISOString(),
        itemCount: items.length,
        items,
    };
}
export function serializeVersionedHelpIndex(index) {
    return JSON.stringify(index, null, 2);
}
export function buildArchiveBlobPath(prefix, generatedAt) {
    const stamp = generatedAt
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+$/, "")
        .replace("T", "_");
    return `${prefix}_${stamp}.json`;
}
export async function loadVersionedHelpIndex(container, latestBlobPath, parseIndex) {
    const blobClient = container.getBlockBlobClient(latestBlobPath);
    try {
        const exists = await blobClient.exists();
        if (!exists) {
            return null;
        }
        const response = await blobClient.download(0);
        const text = await readStreamToString(response.readableStreamBody);
        const parsed = JSON.parse(text);
        return parseIndex(parsed);
    }
    catch (error) {
        throw new Error(toSafeVersionedIndexStorageError(error));
    }
}
export async function saveVersionedHelpIndex(container, config, index, options = {}) {
    const generatedAt = options.generatedAt ?? new Date(index.generatedAt);
    const body = serializeVersionedHelpIndex(index);
    const buffer = Buffer.from(body, "utf8");
    const latestClient = container.getBlockBlobClient(config.latestBlobPath);
    try {
        if (options.previousIndex) {
            const archivePath = buildArchiveBlobPath(config.archiveBlobPathPrefix, new Date(options.previousIndex.generatedAt));
            const archiveClient = container.getBlockBlobClient(archivePath);
            const archiveBody = serializeVersionedHelpIndex(options.previousIndex);
            await archiveClient.uploadData(Buffer.from(archiveBody, "utf8"), {
                blobHTTPHeaders: {
                    blobContentType: "application/json; charset=utf-8",
                    blobCacheControl: "no-store",
                },
            });
        }
        await latestClient.uploadData(buffer, {
            blobHTTPHeaders: {
                blobContentType: "application/json; charset=utf-8",
                blobCacheControl: "no-store",
            },
        });
    }
    catch (error) {
        throw new Error(toSafeVersionedIndexStorageError(error));
    }
    return index;
}
export function createReadableStreamFromBuffer(buffer) {
    return Readable.from([buffer]);
}
export function createHelpIndexContainer(connectionString, containerName) {
    return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
}
