import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import {
  brcFetch,
  companyApiContexts,
  extractListItems,
  EXPIRATION_TIME,
  normaliseCompanyName,
  toNumber,
} from "../../build/shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const exportsDir = join(root, "exports");
const outputPath = join(exportsDir, "customer-balances-all-companies.xlsx");

const companies = [
  {
    name: "Company A",
    apiKey: process.env.BRC_COMPANY_A_API_KEY,
  },
  {
    name: "Company B",
    apiKey: process.env.BRC_COMPANY_B_API_KEY,
  },
  {
    name: "Company C",
    apiKey: process.env.BRC_COMPANY_C_API_KEY,
  },
  {
    name: "Company D",
    apiKey: process.env.BRC_COMPANY_D_API_KEY,
  },
];

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sumTransactions(items) {
  let total = 0;
  for (const item of items) {
    total += toNumber(item.debit) - toNumber(item.credit);
  }
  return round2(total);
}

async function fetchAllCustomers(companyName) {
  const all = [];

  for (let page = 1; page <= 100; page++) {
    const data = await brcFetch(
      companyName,
      `/v1/customers?page=${page}&pageSize=500`
    );
    const items = extractListItems(data);
    all.push(...items);

    const nextPageLink = data?.NextPageLink ?? data?.nextPageLink;
    if (!nextPageLink || items.length < 500) {
      break;
    }
  }

  return all;
}

async function fetchCustomerBalances(companyName, customer) {
  const itemId = String(customer.id);
  const [openingBalanceList, accountTrans] = await Promise.all([
    brcFetch(
      companyName,
      `/v1/customers/${encodeURIComponent(itemId)}/openingBalanceList`
    ),
    brcFetch(
      companyName,
      `/v1/customers/${encodeURIComponent(itemId)}/accountTrans`
    ),
  ]);

  const openingItems = Array.isArray(openingBalanceList)
    ? openingBalanceList
    : extractListItems(openingBalanceList);
  const accountItems = Array.isArray(accountTrans)
    ? accountTrans
    : extractListItems(accountTrans);

  const openingBalance = sumTransactions(openingItems);
  const transactionBalance = sumTransactions(accountItems);
  const currentBalance = round2(openingBalance + transactionBalance);

  return {
    Company: companyName,
    "Customer ID": customer.id,
    Code: customer.code ?? "",
    "Customer Name": customer.name ?? "",
    "Account Name": customer.accountName ?? "",
    "Opening Balance": openingBalance,
    "Current Balance": currentBalance,
  };
}

function registerCompany(name, apiKey) {
  if (!apiKey) {
    throw new Error(`Missing API key for ${name}.`);
  }

  companyApiContexts.set(normaliseCompanyName(name), {
    companyName: name,
    apiKey,
    expiresAt: Date.now() + EXPIRATION_TIME,
  });
}

mkdirSync(exportsDir, { recursive: true });

const allRows = [];
const rowsByCompany = new Map();

for (const company of companies) {
  registerCompany(company.name, company.apiKey);

  const customers = await fetchAllCustomers(company.name);
  const rows = [];

  for (const customer of customers) {
    rows.push(await fetchCustomerBalances(company.name, customer));
  }

  rowsByCompany.set(company.name, rows);
  allRows.push(...rows);

  console.log(`Fetched ${rows.length} customer(s) for ${company.name}.`);
}

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(allRows),
  "All Customers"
);

for (const [companyName, rows] of rowsByCompany) {
  const sheetName = companyName.replace(/[\\/*?:[\]]/g, "").slice(0, 31);
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows.length ? rows : [{ Company: companyName }]),
    sheetName
  );
}

XLSX.writeFile(workbook, outputPath);
console.log(`Exported ${allRows.length} customer row(s) to ${outputPath}`);
