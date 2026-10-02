import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const reportJsonPath = process.argv[2];
if (!reportJsonPath) throw new Error("Usage: node scripts/exports/export-combined-report.mjs <report-json-path> [output-xlsx-path]");

const outputPath =
  process.argv[3] ??
  path.resolve(projectRoot, "Multi-Company-Nominal-Accounts-Report.xlsx");

const report = JSON.parse(fs.readFileSync(reportJsonPath, "utf8"));

const headers = [
  "Company",
  "Nominal Code",
  "Nominal Description",
  "Opening Balance",
  "Month 1",
  "Month 2",
  "Month 3",
  "Month 4",
  "Month 5",
  "Month 6",
  "Month 7",
  "Month 8",
  "Month 9",
  "Month 10",
  "Month 11",
  "Month 12",
];

function rowToArray(companyName, row) {
  return [
    companyName,
    row.nominalCode,
    row.nominalDescription,
    row.openingBalance,
    row.month1,
    row.month2,
    row.month3,
    row.month4,
    row.month5,
    row.month6,
    row.month7,
    row.month8,
    row.month9,
    row.month10,
    row.month11,
    row.month12,
  ];
}

const combinedRows = [headers];
const sheets = {};

for (const company of report.companies) {
  const companyRows = [headers];
  for (const row of company.rows) {
    const arr = rowToArray(company.companyName, row);
    combinedRows.push(arr);
    companyRows.push(arr);
  }
  sheets[company.companyName] = companyRows;
}

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.aoa_to_sheet(combinedRows),
  "Combined"
);

for (const [sheetName, rows] of Object.entries(sheets)) {
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    sheetName.slice(0, 31)
  );
}

XLSX.writeFile(workbook, outputPath);
console.log(JSON.stringify({ outputPath, combinedRowCount: combinedRows.length - 1 }));
