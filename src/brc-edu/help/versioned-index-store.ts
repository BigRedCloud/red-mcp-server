import { Readable } from "node:stream";

import {
  BlobServiceClient,
  type ContainerClient,
} from "@azure/storage-blob";

const SECRET_ERROR_PATTERNS = [
  /AccountKey=/i,
  /DefaultEndpointsProtocol=/i,
  /SharedAccessSignature/i,
  /\bsig=[A-Za-z0-9%+/=]+/i,
  /Authorization:\s*Basic/i,
  /Basic [A-Za-z0-9+/=]{8,}/,
];

export function toSafeVersionedIndexStorageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of SECRET_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return "Help resource index storage operation failed.";
    }
  }

  return message;
}

async function readStreamToString(
  stream: NodeJS.ReadableStream | undefined,
): Promise<string> {
  if (!stream) {
    throw new Error("Help resource index download failed.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export type VersionedHelpIndex<T> = {
  generatedAt: string;
  itemCount: number;
  items: T[];
};

export function buildVersionedHelpIndex<T>(
  items: T[],
  generatedAt: Date = new Date(),
): VersionedHelpIndex<T> {
  return {
    generatedAt: generatedAt.toISOString(),
    itemCount: items.length,
    items,
  };
}

export function serializeVersionedHelpIndex<T>(
  index: VersionedHelpIndex<T>,
): string {
  return JSON.stringify(index, null, 2);
}

export type VersionedIndexStoreConfig = {
  latestBlobPath: string;
  archiveBlobPathPrefix: string;
};

export function buildArchiveBlobPath(prefix: string, generatedAt: Date): string {
  const stamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");

  return `${prefix}_${stamp}.json`;
}

export async function loadVersionedHelpIndex<T>(
  container: ContainerClient,
  latestBlobPath: string,
  parseIndex: (value: unknown) => VersionedHelpIndex<T> | null,
): Promise<VersionedHelpIndex<T> | null> {
  const blobClient = container.getBlockBlobClient(latestBlobPath);

  try {
    const exists = await blobClient.exists();
    if (!exists) {
      return null;
    }

    const response = await blobClient.download(0);
    const text = await readStreamToString(response.readableStreamBody);
    const parsed = JSON.parse(text) as unknown;
    return parseIndex(parsed);
  } catch (error) {
    throw new Error(toSafeVersionedIndexStorageError(error));
  }
}

export async function saveVersionedHelpIndex<T>(
  container: ContainerClient,
  config: VersionedIndexStoreConfig,
  index: VersionedHelpIndex<T>,
  options: {
    previousIndex?: VersionedHelpIndex<T> | null;
    generatedAt?: Date;
  } = {},
): Promise<VersionedHelpIndex<T>> {
  const generatedAt = options.generatedAt ?? new Date(index.generatedAt);
  const body = serializeVersionedHelpIndex(index);
  const buffer = Buffer.from(body, "utf8");
  const latestClient = container.getBlockBlobClient(config.latestBlobPath);

  try {
    if (options.previousIndex) {
      const archivePath = buildArchiveBlobPath(
        config.archiveBlobPathPrefix,
        new Date(options.previousIndex.generatedAt),
      );
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
  } catch (error) {
    throw new Error(toSafeVersionedIndexStorageError(error));
  }

  return index;
}

export function createReadableStreamFromBuffer(buffer: Buffer): Readable {
  return Readable.from([buffer]);
}

export function createHelpIndexContainer(
  connectionString: string,
  containerName: string,
): ContainerClient {
  return BlobServiceClient.fromConnectionString(connectionString).getContainerClient(
    containerName,
  );
}
