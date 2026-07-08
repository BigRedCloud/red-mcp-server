import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const enrichmentModulePath = join(projectRoot, "build", "edu", "brc_edu_enrichment.js");

async function loadEnrichmentModule() {
  if (!existsSync(enrichmentModulePath)) {
    throw new Error(
      "Enrichment module not built. Run `npm run build` before `npm run sync:brc-edu`.",
    );
  }
  return import(pathToFileURL(enrichmentModulePath).href);
}

function resolvePath(envValue, defaultRelativePath) {
  const candidate = envValue?.trim() || defaultRelativePath;
  return resolve(projectRoot, candidate);
}

async function main() {
  const {
    enrichSupportEduRows,
    formatEnrichedEduCsv,
    normaliseSupportEduRows,
    parseSupportEduCsv,
  } = await loadEnrichmentModule();

  const inputPath = resolvePath(
    process.env.BRC_EDU_SUPPORT_CSV_PATH,
    "data/webinar_video_routing_index.csv",
  );
  const outputPath = resolvePath(
    process.env.BRC_EDU_ENRICHED_CSV_PATH,
    "data/_dev_only_video_routing_index_updated.csv",
  );

  if (!existsSync(inputPath)) {
    throw new Error(`Support CSV not found: ${inputPath}`);
  }

  const csvText = readFileSync(inputPath, "utf8");
  const rawRows = parseSupportEduCsv(csvText);
  const supportRows = normaliseSupportEduRows(rawRows);
  const enrichedRows = enrichSupportEduRows(supportRows);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, formatEnrichedEduCsv(enrichedRows), "utf8");

  const inactiveRows = enrichedRows.filter((row) => row.isActive === false).length;
  const needsReviewRows = enrichedRows.filter((row) => row.needsReview === true).length;

  console.log("BRC Edu CSV sync complete.");
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Rows read: ${rawRows.length}`);
  console.log(`Rows enriched: ${enrichedRows.length}`);
  console.log(`Inactive rows: ${inactiveRows}`);
  console.log(`Low confidence rows needing review: ${needsReviewRows}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
