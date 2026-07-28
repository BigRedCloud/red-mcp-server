/**
 * Shared Azure Blob storage configuration for BRC Edu help indexes and resources.
 * Prefer BRC_EDU_STORAGE_CONNECTION_STRING; BRC_EDU_STORAGE_CONNECTION is accepted
 * for compatibility with the Azure Function processor setting.
 */
export function getBrcEduUploadStorageConnectionString(): string | null {
  const connectionString =
    process.env.BRC_EDU_STORAGE_CONNECTION_STRING?.trim() ||
    process.env.BRC_EDU_STORAGE_CONNECTION?.trim();
  return connectionString || null;
}

export function getBrcEduUploadContainer(): string | null {
  const container = process.env.BRC_EDU_STORAGE_CONTAINER?.trim();
  return container || null;
}
