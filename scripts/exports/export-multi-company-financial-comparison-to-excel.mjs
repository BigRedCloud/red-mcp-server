import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import {
  companyApiContexts,
  EXPIRATION_TIME,
  fetchAllNominalAccounts,
  round2,
  toNumber,
} from "../../build/shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const exportsDir = join(root, "exports");
const outputPath =
  process.argv[2] ?? join(exportsDir, "multi-company-financial-comparison.xlsx");

const companies = [
  { name: "Company A", apiKey: process.env.BRC_COMPANY_A_API_KEY },
  { name: "Company B", apiKey: process.env.BRC_COMPANY_B_API_KEY },
  { name: "Company C", apiKey: process.env.BRC_COMPANY_C_API_KEY },
  { name: "Company D", apiKey: process.env.BRC_COMPANY_D_API_KEY },
];

function ytd(row) {
  let total = row.openingBalance ?? 0;
  for (let i = 1; i <= 12; i++) {
    total += row[`month${i}`] ?? 0;
  }
  return round2(total);
}

function resolveGroupKey(account) {
  const accountGroup = account.accountGroup ?? account.group;
  if (accountGroup !== undefined && accountGroup !== null && String(accountGroup).trim()) {
    return String(accountGroup).trim();
  }

  const accountType = account.accountType ?? account.type;
  if (accountType !== undefined && accountType !== null && String(accountType).trim()) {
    return String(accountType).trim();
  }

  return String(account.code ?? "Unknown").trim() || "Unknown";
}

function buildGroupedRows(nominalAccounts) {
  const groupedRows = new Map();

  for (const account of nominalAccounts) {
    const groupKey = resolveGroupKey(account);
    if (!groupedRows.has(groupKey)) {
      groupedRows.set(groupKey, {
        nominalCode: groupKey,
        nominalDescription: groupKey,
        accountType: account.type ?? account.accountType ?? null,
        openingBalance: 0,
        month1: 0,
        month2: 0,
        month3: 0,
        month4: 0,
        month5: 0,
        month6: 0,
        month7: 0,
        month8: 0,
        month9: 0,
        month10: 0,
        month11: 0,
        month12: 0,
      });
    }

    const row = groupedRows.get(groupKey);
    row.openingBalance += toNumber(account.oBalance);
    row.month1 += toNumber(account.month1);
    row.month2 += toNumber(account.month2);
    row.month3 += toNumber(account.month3);
    row.month4 += toNumber(account.month4);
    row.month5 += toNumber(account.month5);
    row.month6 += toNumber(account.month6);
    row.month7 += toNumber(account.month7);
    row.month8 += toNumber(account.month8);
    row.month9 += toNumber(account.month9);
    row.month10 += toNumber(account.month10);
    row.month11 += toNumber(account.month11);
    row.month12 += toNumber(account.month12);
  }

  return Array.from(groupedRows.values()).sort((a, b) =>
    a.nominalCode.localeCompare(b.nominalCode, undefined, { numeric: true })
  );
}

function activityLevel(companyName, accountCount, nonzeroCount) {
  if (nonzeroCount === 0) return "None — all balances zero (inactive/demo)";
  if (companyName === "Company A") return "Highest — active trading, large debtors & sales";
  if (companyName === "Company B") return "Low — small sales and debtor balance";
  if (companyName === "Company C") return "Moderate — strong opening position, modest current trading";
  return "Active";
}

function groupedRowToExcel(companyName, row) {
  return {
    Company: companyName,
    "Account Group": row.nominalCode,
    "Account Type": row.accountType ?? "",
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
    "YTD Total": ytd(row),
  };
}

async function loadCompanyData(company) {
  if (!company.apiKey) {
    throw new Error(
      `Missing API key for ${company.name}. Set BRC_COMPANY_A_API_KEY through BRC_COMPANY_D_API_KEY.`
    );
  }

  companyApiContexts.set(company.name.trim().toLowerCase(), {
    companyName: company.name,
    apiKey: company.apiKey,
    expiresAt: Date.now() + EXPIRATION_TIME,
  });

  const nominalAccounts = await fetchAllNominalAccounts(company.name);
  const groupedRows = buildGroupedRows(nominalAccounts);
  const standoutRows = nominalAccounts
    .filter((account) => Math.abs(toNumber(account.balance)) > 0.01)
    .sort(
      (a, b) =>
        Math.abs(toNumber(b.balance)) - Math.abs(toNumber(a.balance))
    )
    .map((account) => ({
      Company: company.name,
      Code: account.code ?? "",
      Description: account.description ?? "",
      Group: account.group ?? account.accountGroup ?? "",
      Balance: toNumber(account.balance),
    }));

  return {
    companyName: company.name,
    totalSourceAccounts: nominalAccounts.length,
    groupedRows,
    standoutRows,
    nonzeroCount: standoutRows.length,
  };
}

mkdirSync(exportsDir, { recursive: true });

const companyReports = [];
for (const company of companies) {
  companyReports.push(await loadCompanyData(company));
}

const overviewRows = companyReports.map((report) => ({
  Company: report.companyName,
  "Nominal Accounts": report.totalSourceAccounts,
  "Accounts With Balance": report.nonzeroCount,
  "Activity Level": activityLevel(
    report.companyName,
    report.totalSourceAccounts,
    report.nonzeroCount
  ),
}));

const allGroups = new Set();
for (const report of companyReports) {
  for (const row of report.groupedRows) {
    allGroups.add(row.nominalCode);
  }
}

const groupTotalRows = Array.from(allGroups)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((group) => {
    const row = { "Account Group": group };
    for (const report of companyReports) {
      const match = report.groupedRows.find((item) => item.nominalCode === group);
      row[report.companyName] = match ? ytd(match) : 0;
    }
    return row;
  })
  .filter((row) =>
    companyReports.some((report) => Math.abs(row[report.companyName] ?? 0) > 0.001)
  );

const standoutRows = companyReports.flatMap((report) => report.standoutRows);
const combinedGroupedRows = companyReports.flatMap((report) =>
  report.groupedRows.map((row) => groupedRowToExcel(report.companyName, row))
);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(overviewRows),
  "Overview"
);
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(groupTotalRows),
  "Group Totals"
);
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(standoutRows),
  "Standout Balances"
);
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(combinedGroupedRows),
  "Combined"
);

for (const report of companyReports) {
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      report.groupedRows.map((row) => groupedRowToExcel(report.companyName, row))
    ),
    report.companyName.slice(0, 31)
  );
}

XLSX.writeFile(workbook, outputPath);
console.log(
  JSON.stringify({
    outputPath,
    companyCount: companyReports.length,
    overviewRows: overviewRows.length,
    groupTotalRows: groupTotalRows.length,
    standoutRows: standoutRows.length,
    combinedGroupedRows: combinedGroupedRows.length,
  })
);
