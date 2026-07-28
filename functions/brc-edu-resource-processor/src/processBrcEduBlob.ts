import {
  convertBrcEduBlobToCsvText,
  resolveBrcEduBlobExtension,
} from "./convertBlobToCsvText.js";
import {
  formatRedSyncFailureMessage,
  getRedBrcEduSyncEndpoint,
  getRedBrcEduSyncSecret,
  postCsvTextToRed,
} from "./syncToRed.js";

export type BrcEduProcessorLogLevel = "info" | "error";

export type BrcEduProcessorLogger = {
  log(level: BrcEduProcessorLogLevel, message: string): void;
};

export type BrcEduBlobProcessOutcome = "synced" | "ignored" | "failed";

export type ProcessBrcEduBlobOptions = {
  fileName: string;
  buffer: Buffer;
  endpoint?: string;
  secret?: string;
  fetchFn?: typeof fetch;
  logger?: BrcEduProcessorLogger;
};

function defaultLogger(): BrcEduProcessorLogger {
  return {
    log(level, message) {
      if (level === "error") {
        console.error(message);
        return;
      }

      console.log(message);
    },
  };
}

function safeProcessingError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function processBrcEduBlob(
  options: ProcessBrcEduBlobOptions,
): Promise<BrcEduBlobProcessOutcome> {
  const logger = options.logger ?? defaultLogger();
  const fileName = options.fileName.trim() || "unknown";
  const extension = resolveBrcEduBlobExtension(fileName);

  if (!extension) {
    logger.log("info", `Ignoring unsupported BRC Edu blob filename: ${fileName}`);
    return "ignored";
  }

  const endpoint = options.endpoint ?? getRedBrcEduSyncEndpoint();
  const secret = options.secret ?? getRedBrcEduSyncSecret();

  if (!endpoint || !secret) {
    logger.log("error", `BRC Edu sync configuration is missing for blob: ${fileName}`);
    return "failed";
  }

  let csvText: string;

  try {
    csvText = await convertBrcEduBlobToCsvText(options.buffer, extension);
  } catch (error) {
    logger.log(
      "error",
      `Failed to read BRC Edu blob ${fileName}: ${safeProcessingError(error)}`,
    );
    return "failed";
  }

  if (!csvText.trim()) {
    logger.log("error", `BRC Edu blob ${fileName} produced empty CSV text.`);
    return "failed";
  }

  const fetchFn = options.fetchFn ?? fetch;
  const syncResult = await postCsvTextToRed(csvText, endpoint, secret, fetchFn);

  if (!syncResult.ok) {
    logger.log("error", `BRC Edu blob ${fileName}: ${formatRedSyncFailureMessage(syncResult)}`);
    return "failed";
  }

  logger.log("info", `BRC Edu blob synced successfully: ${fileName}`);
  return "synced";
}
