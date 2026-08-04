import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const freshdeskModulePaths = {
  client: join(projectRoot, "build", "brc-edu", "freshdesk", "freshdesk-client.js"),
  imageSync: join(projectRoot, "build", "brc-edu", "freshdesk", "image-sync.js"),
  indexStore: join(
    projectRoot,
    "build",
    "brc-edu",
    "freshdesk",
    "freshdesk-index-store.js",
  ),
  syncService: join(
    projectRoot,
    "build",
    "brc-edu",
    "freshdesk",
    "freshdesk-sync-service.js",
  ),
};

async function loadFreshdeskModules() {
  for (const modulePath of Object.values(freshdeskModulePaths)) {
    if (!existsSync(modulePath)) {
      throw new Error(
        "Freshdesk modules not built. Run `npm run build` before running this script.",
      );
    }
  }

  const [clientModule, imageSyncModule, indexStoreModule, syncServiceModule] =
    await Promise.all([
      import(pathToFileURL(freshdeskModulePaths.client).href),
      import(pathToFileURL(freshdeskModulePaths.imageSync).href),
      import(pathToFileURL(freshdeskModulePaths.indexStore).href),
      import(pathToFileURL(freshdeskModulePaths.syncService).href),
    ]);

  return {
    FreshdeskClient: clientModule.FreshdeskClient,
    createFreshdeskImageContainer: imageSyncModule.createFreshdeskImageContainer,
    createConfiguredFreshdeskIndexContainer:
      indexStoreModule.createConfiguredFreshdeskIndexContainer,
    loadFreshdeskArticlesIndex: indexStoreModule.loadFreshdeskArticlesIndex,
    saveFreshdeskArticlesIndex: indexStoreModule.saveFreshdeskArticlesIndex,
    syncFreshdeskKnowledgeBase: syncServiceModule.syncFreshdeskKnowledgeBase,
  };
}

async function main() {
  const {
    FreshdeskClient,
    createFreshdeskImageContainer,
    createConfiguredFreshdeskIndexContainer,
    loadFreshdeskArticlesIndex,
    saveFreshdeskArticlesIndex,
    syncFreshdeskKnowledgeBase,
  } = await loadFreshdeskModules();

  const baseUrl =
    process.env.FRESHDESK_BASE_URL ?? "https://bigredcloud.freshdesk.com";
  const apiKey = process.env.FRESHDESK_API_KEY?.trim();
  const kbStorageConnection =
    process.env.BRC_EDU_KB_STORAGE_CONNECTION?.trim();
  const imageContainerName =
    process.env.BRC_EDU_KB_IMAGE_CONTAINER?.trim() ?? "brc-edu-images";

  if (!apiKey) {
    throw new Error("FRESHDESK_API_KEY is not configured.");
  }

  if (!kbStorageConnection) {
    throw new Error("BRC_EDU_KB_STORAGE_CONNECTION is not configured.");
  }

  const indexContainer = createConfiguredFreshdeskIndexContainer();
  if (!indexContainer) {
    throw new Error(
      "BRC Edu resource storage is not configured. Set BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING and BRC_EDU_UPLOAD_CONTAINER.",
    );
  }

  const client = new FreshdeskClient(baseUrl, apiKey);
  const imageContainer = createFreshdeskImageContainer(
    kbStorageConnection,
    imageContainerName,
  );

  const syncResult = await syncFreshdeskKnowledgeBase(client, imageContainer);
  await saveFreshdeskArticlesIndex(indexContainer, syncResult);
  const loadedIndex = await loadFreshdeskArticlesIndex(indexContainer);

  if (!loadedIndex) {
    throw new Error("Freshdesk articles index was not found after upload.");
  }

  console.log({
    articleCount: loadedIndex.articleCount,
    failureCount: loadedIndex.failureCount,
    generatedAt: loadedIndex.generatedAt,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
