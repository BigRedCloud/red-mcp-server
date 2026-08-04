import { getBrcEduUploadStorageConnectionString } from "../../edu/brc_edu_upload_store.js";

export const DEFAULT_FRESHDESK_KB_IMAGE_CONTAINER = "brc-edu-images";

export function getFreshdeskKbStorageConnectionString(): string | null {
  const kbConnection =
    process.env.BRC_EDU_KB_STORAGE_CONNECTION?.trim() ??
    process.env.BRC_EDU_KB_STORAGE_CONNECTION_STRING?.trim();

  if (kbConnection) {
    return kbConnection;
  }

  return getBrcEduUploadStorageConnectionString();
}

export function getFreshdeskKbImageContainerName(): string {
  return (
    process.env.BRC_EDU_KB_IMAGE_CONTAINER?.trim() ||
    DEFAULT_FRESHDESK_KB_IMAGE_CONTAINER
  );
}
