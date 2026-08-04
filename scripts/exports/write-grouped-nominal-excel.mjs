import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exportsDir = join(__dirname, "..", "exports");

function toExcelRows(rows) {
  return rows.map((row) => ({
    "Nominal Code": row.nominalCode,
    "Nominal Description": row.nominalDescription,
    "Opening Balance": row.openingBalance,
    "Month 1": row.month1,
    "Month 2": row.month2,
    "Month 3": row.month3,
    "Month 4": row.month4,
    "Month 5": row.month5,
    "Month 6": row.month6,
    "Month 7": row.month7,
    "Month 8": row.month8,
    "Month 9": row.month9,
    "Month 10": row.month10,
    "Month 11": row.month11,
    "Month 12": row.month12,
  }));
}

function exportWorkbook(companyName, rows, outputPath) {
  const excelRows = toExcelRows(rows);
  const sheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Grouped Nominal Report");
  XLSX.writeFile(workbook, outputPath);
  console.log(`Exported ${excelRows.length} row(s) for ${companyName} -> ${outputPath}`);
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/write-grouped-nominal-excel.mjs <reports-json-path>");
  process.exit(1);
}

const reports = JSON.parse(
  await import("fs").then((fs) => fs.readFileSync(inputPath, "utf8"))
);

mkdirSync(exportsDir, { recursive: true });

for (const report of reports) {
  const slug = report.companyName.toLowerCase().replace(/\s+/g, "-");
  exportReport(
    report.companyName,
    report.rows,
    join(exportsDir, `grouped-nominal-report-${slug}.xlsx`)
  );
}

function exportReport(companyName, rows, outputPath) {
  exportWorkbook(companyName, rows, outputPath);
}
