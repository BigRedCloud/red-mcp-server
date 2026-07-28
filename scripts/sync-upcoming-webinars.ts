import { createConfiguredUpcomingWebinarsIndexContainer, syncUpcomingWebinarsIndex } from "../src/brc-edu/upcoming-webinars/upcoming-webinar-index-store.js";

async function main() {
  const container = createConfiguredUpcomingWebinarsIndexContainer();
  if (!container) {
    console.error("Upcoming webinars index storage is not configured.");
    process.exitCode = 1;
    return;
  }

  const result = await syncUpcomingWebinarsIndex(container);
  if (!result.ok) {
    console.error(result.error);
    console.error(
      result.preservedPreviousIndex
        ? "Previous upcoming webinars index preserved."
        : "No previous upcoming webinars index to preserve.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Upcoming webinars index saved with ${result.index.itemCount} sessions at ${result.index.generatedAt}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
