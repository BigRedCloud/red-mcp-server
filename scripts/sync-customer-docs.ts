import { createConfiguredCustomerDocsIndexContainer, syncCustomerDocumentationIndex } from "../src/brc-edu/customer-docs/customer-docs-index-store.js";

async function main() {
  const container = createConfiguredCustomerDocsIndexContainer();
  if (!container) {
    console.error("Customer docs index storage is not configured.");
    process.exitCode = 1;
    return;
  }

  const result = await syncCustomerDocumentationIndex(container);
  if (!result.ok) {
    console.error(result.error);
    console.error(
      result.preservedPreviousIndex
        ? "Previous customer docs index preserved."
        : "No previous customer docs index to preserve.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Customer docs index saved with ${result.index.itemCount} articles at ${result.index.generatedAt}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
