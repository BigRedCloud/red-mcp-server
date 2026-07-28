import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const enrichmentModulePath = join(projectRoot, "build", "edu", "brc_edu_enrichment.js");
const pathsModulePath = join(projectRoot, "build", "edu", "brc_edu_paths.js");

async function loadModules() {
  if (!existsSync(enrichmentModulePath) || !existsSync(pathsModulePath)) {
    throw new Error(
      "BRC Edu modules not built. Run `npm run build` before `npm run sync:brc-edu`.",
    );
  }

  const [enrichment, paths] = await Promise.all([
    import(pathToFileURL(enrichmentModulePath).href),
    import(pathToFileURL(pathsModulePath).href),
  ]);

  return { enrichment, paths };
}

async function main() {
  const { enrichment, paths } = await loadModules();
  const {
    enrichSupportEduRows,
    formatEnrichedEduCsv,
    normaliseSupportEduRows,
    parseSupportEduCsv,
  } = enrichment;
  const { getBrcEduEnrichedCsvPath, getBrcEduSupportCsvPath } = paths;

  const inputPath = getBrcEduSupportCsvPath(projectRoot);
  const outputPath = getBrcEduEnrichedCsvPath(projectRoot);

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
