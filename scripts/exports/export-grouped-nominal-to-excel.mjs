import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import {
  companyApiContexts,
  fetchAllNominalAccounts,
  toNumber,
} from "../../build/shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const exportsDir = join(root, "exports");

const nominalGroups = {
  "008": { groupCode: "1000G", description: "Sales - BRB Accounts Software" },
  "1000": { groupCode: "1000G", description: "Sales - BRB Accounts Software" },
  "1010": { groupCode: "1000G", description: "Sales - BRB Accounts Software" },
  "1200": { groupCode: "1200G", description: "Sales - BRB Payroll Software" },
  "1790": { groupCode: "1200G", description: "Sales - BRB Payroll Software" },
  "1600": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1601": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1610": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1750": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1760": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1770": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1780": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  "1620": { groupCode: "1620G", description: "Cloud Sales" },
  "1621": { groupCode: "1620G", description: "Cloud Sales" },
  "1650": { groupCode: "1620G", description: "Cloud Sales" },
  "1630": { groupCode: "1630G", description: "Turbo Revenue - Subscriptions" },
  "1632": { groupCode: "1630G", description: "Turbo Revenue - Subscriptions" },
  "1690": { groupCode: "1990G", description: "Sales - Other" },
  "1800": { groupCode: "1990G", description: "Sales - Other" },
  "1820": { groupCode: "1990G", description: "Sales - Other" },
  "1850": { groupCode: "1990G", description: "Sales - Other" },
  "1900": { groupCode: "1990G", description: "Sales - Other" },
  "1980": { groupCode: "1990G", description: "Sales - Other" },
  "1985": { groupCode: "1990G", description: "Sales - Other" },
  "1986": { groupCode: "1990G", description: "Sales - Other" },
  "1990": { groupCode: "1990G", description: "Sales - Other" },
  "1991": { groupCode: "1990G", description: "Sales - Other" },
  "1995": { groupCode: "1990G", description: "Sales - Other" },
  "3000": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3001": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3002": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3003": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3004": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3005": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3006": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3010": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3011": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3012": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3013": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3015": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3020": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3030": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3040": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3050": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3055": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3056": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3100": { groupCode: "3000G", description: "Staff Salary and other costs" },
  "3500": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3501": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3502": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3503": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3504": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3505": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3506": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3507": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3510": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3511": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3512": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3513": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3514": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3520": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3530": { groupCode: "3500G", description: "Marketing & Advertising" },
  "3560": { groupCode: "3500G", description: "Marketing & Advertising" },
  "5000": { groupCode: "5000G", description: "Bank Interest" },
  "5001": { groupCode: "5000G", description: "Bank Interest" },
  "5002": { groupCode: "5000G", description: "Bank Interest" },
  "5003": { groupCode: "5000G", description: "Bank Interest" },
};

const companies = [
  {
    name: "Company A",
    apiKey: process.env.BRC_COMPANY_A_API_KEY,
    outputFile: "grouped-nominal-report-company-a.xlsx",
  },
  {
    name: "Company B",
    apiKey: process.env.BRC_COMPANY_B_API_KEY,
    outputFile: "grouped-nominal-report-company-b.xlsx",
  },
];

function buildGroupedReport(nominalAccounts) {
  const groupedRows = new Map();

  for (const account of nominalAccounts) {
    const rawCode = String(account.code ?? "").trim();
    if (!rawCode) continue;

    const group = nominalGroups[rawCode];
    const nominalCode = group?.groupCode ?? rawCode;
    const nominalDescription =
      group?.description ?? String(account.description ?? rawCode);

    if (!groupedRows.has(nominalCode)) {
      groupedRows.set(nominalCode, {
        "Nominal Code": nominalCode,
        "Nominal Description": nominalDescription,
        "Opening Balance": 0,
        "Month 1": 0,
        "Month 2": 0,
        "Month 3": 0,
        "Month 4": 0,
        "Month 5": 0,
        "Month 6": 0,
        "Month 7": 0,
        "Month 8": 0,
        "Month 9": 0,
        "Month 10": 0,
        "Month 11": 0,
        "Month 12": 0,
      });
    }

    const row = groupedRows.get(nominalCode);
    row["Opening Balance"] += toNumber(account.oBalance);
    row["Month 1"] += toNumber(account.month1);
    row["Month 2"] += toNumber(account.month2);
    row["Month 3"] += toNumber(account.month3);
    row["Month 4"] += toNumber(account.month4);
    row["Month 5"] += toNumber(account.month5);
    row["Month 6"] += toNumber(account.month6);
    row["Month 7"] += toNumber(account.month7);
    row["Month 8"] += toNumber(account.month8);
    row["Month 9"] += toNumber(account.month9);
    row["Month 10"] += toNumber(account.month10);
    row["Month 11"] += toNumber(account.month11);
    row["Month 12"] += toNumber(account.month12);
  }

  return Array.from(groupedRows.values()).sort((a, b) =>
    String(a["Nominal Code"]).localeCompare(String(b["Nominal Code"]), undefined, {
      numeric: true,
    })
  );
}

function exportReport(companyName, rows, outputPath) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Grouped Nominal Report");
  XLSX.writeFile(workbook, outputPath);
  console.log(
    `Exported ${rows.length} grouped row(s) for ${companyName} to ${outputPath}`
  );
}

mkdirSync(exportsDir, { recursive: true });

for (const company of companies) {
  if (!company.apiKey) {
    throw new Error(
      `Missing API key for ${company.name}. Set BRC_COMPANY_A_API_KEY / BRC_COMPANY_B_API_KEY.`
    );
  }

  companyApiContexts.set(company.name.trim().toLowerCase(), {
    companyName: company.name,
    apiKey: company.apiKey,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });

  const nominalAccounts = await fetchAllNominalAccounts(company.name);
  const rows = buildGroupedReport(nominalAccounts);
  exportReport(
    company.name,
    rows,
    join(exportsDir, company.outputFile)
  );
}
