import { app, type InvocationContext } from "@azure/functions";

import { BRC_EDU_BLOB_TRIGGER_PATH } from "./constants.js";
import { processBrcEduBlob } from "./processBrcEduBlob.js";

function resolveBlobFileName(context: InvocationContext): string {
  const triggerMetadata = context.triggerMetadata as Record<string, unknown> | undefined;
  const name = triggerMetadata?.name;

  if (typeof name === "string" && name.trim()) {
    return name;
  }

  const fileName = triggerMetadata?.fileName;
  if (typeof fileName === "string" && fileName.trim()) {
    return fileName;
  }

  return "unknown";
}

export async function brcEduResourceProcessor(
  blob: Buffer,
  context: InvocationContext,
): Promise<void> {
  const fileName = resolveBlobFileName(context);

  await processBrcEduBlob({
    fileName,
    buffer: blob,
    logger: {
      log(level, message) {
        if (level === "error") {
          context.error(message);
          return;
        }

        context.log(message);
      },
    },
  });
}

app.storageBlob("brcEduResourceProcessor", {
  path: BRC_EDU_BLOB_TRIGGER_PATH,
  connection: "AzureWebJobsStorage",
  handler: brcEduResourceProcessor,
});
