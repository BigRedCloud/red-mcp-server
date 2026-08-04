import "dotenv/config";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { getApiKeyExpirationMs } from "../../build/server_config.js";
import {
  brcFetch,
  companyApiContexts,
  extractListItems,
  normaliseCompanyName,
} from "../../build/shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const exportsDir = join(root, "exports");

const companyName = process.argv[2] ?? process.env.BRC_EXPORT_COMPANY ?? "JasonsDemo";
const apiKey =
  process.argv[3] ??
  process.env[`BRC_${companyName.replace(/\s+/g, "_").toUpperCase()}_API_KEY`] ??
  process.env.BRC_EXPORT_API_KEY;

const outputPath =
  process.argv[4] ??
  join(exportsDir, `${companyName.replace(/[^\w.-]+/g, "-")}-full-report.xlsx`);

const LIST_SECTIONS = [
  { sheet: "Accounts", path: "/v1/accounts" },
  { sheet: "Customers", path: "/v1/customers" },
  { sheet: "Customers Active", path: "/v1/customers/GetWithoutDormant" },
  { sheet: "Suppliers", path: "/v1/suppliers" },
  { sheet: "Products", path: "/v1/products" },
  { sheet: "Product Types", path: "/v1/productTypes" },
  { sheet: "Products Active", path: "/v1/products/GetWithoutDormant" },
  { sheet: "Sales Entries", path: "/v1/salesEntries" },
  { sheet: "Sales Invoices", path: "/v1/salesInvoices" },
  { sheet: "Sales Credit Notes", path: "/v1/salesCreditNotes" },
  { sheet: "Quotes", path: "/v1/quotes" },
  { sheet: "Sales Reps", path: "/v1/salesReps" },
  { sheet: "Purchases", path: "/v1/purchases" },
  { sheet: "Payments", path: "/v1/payments" },
  { sheet: "Cash Payments", path: "/v1/cashPayments" },
  { sheet: "Cash Receipts", path: "/v1/cashReceipts" },
  { sheet: "Bank Accounts", path: "/v1/bankAccounts" },
  { sheet: "Nominal Accounts", path: "/v1/nominalAccounts" },
  { sheet: "Analysis Categories", path: "/v1/analysisCategories" },
  { sheet: "Category Types", path: "/v1/categoryTypes" },
  { sheet: "VAT Rates", path: "/v1/vatRates" },
  { sheet: "VAT Analysis Types", path: "/v1/vatAnalysisTypes" },
  { sheet: "VAT Categories", path: "/v1/vatCategories" },
  { sheet: "VAT Types", path: "/v1/vatTypes" },
  { sheet: "Company Settings", path: "/v1/companySettings" },
  { sheet: "Owner Type Groups", path: "/v1/ownerTypeGroups" },
  { sheet: "Owner Types", path: "/v1/ownerTypes" },
  { sheet: "User Defined Fields", path: "/v1/userDefinedFields" },
  { sheet: "Book Tran Types", path: "/v1/bookTranTypes" },
  { sheet: "Sales", path: "/v1/sales" },
];

function registerCompany(name, key) {
  if (!key) {
    throw new Error(
      `Missing API key for "${name}". Pass it as the third argument or set BRC_EXPORT_API_KEY.`
    );
  }

  companyApiContexts.set(normaliseCompanyName(name), {
    companyName: name,
    apiKey: key,
    expiresAt: Date.now() + getApiKeyExpirationMs(),
  });
}

function flattenValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" && item !== null
          ? JSON.stringify(item)
          : String(item)
      )
      .join("; ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function flattenRecord(record, prefix = "") {
  const rows = {};

  for (const [key, value] of Object.entries(record ?? {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(rows, flattenRecord(value, fullKey));
    } else {
      rows[fullKey] = flattenValue(value);
    }
  }

  return rows;
}

function rowsFromItems(items) {
  return items.map((item) => flattenRecord(item));
}

function rowsFromObject(label, value) {
  if (value === null || value === undefined) {
    return [{ Section: label, Field: "(empty)", Value: "" }];
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return [{ Section: label, Field: "value", Value: flattenValue(value) }];
  }

  const rows = [];
  for (const [field, fieldValue] of Object.entries(value)) {
    if (fieldValue !== null && typeof fieldValue === "object" && !Array.isArray(fieldValue)) {
      for (const [nestedField, nestedValue] of Object.entries(fieldValue)) {
        rows.push({
          Section: label,
          Field: `${field}.${nestedField}`,
          Value: flattenValue(nestedValue),
        });
      }
    } else {
      rows.push({
        Section: label,
        Field: field,
        Value: flattenValue(fieldValue),
      });
    }
  }
  return rows;
}

async function fetchAllPages(name, path) {
  const all = [];

  for (let page = 1; page <= 100; page++) {
    const data = await brcFetch(name, `${path}?page=${page}&pageSize=500`);
    const items = extractListItems(data);
    all.push(...items);

    const nextPageLink = data?.NextPageLink ?? data?.nextPageLink;
    if (!nextPageLink || items.length < 500) {
      break;
    }
  }

  return all;
}

function appendSheet(workbook, sheetName, rows) {
  const safeName = sheetName.slice(0, 31);
  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["No records found"]]);
  XLSX.utils.book_append_sheet(workbook, sheet, safeName);
}

async function buildCompanySetupSheet(name) {
  const [setupConfig, companyOptions, financialYear, companySettings] =
    await Promise.all([
      brcFetch(name, "/v1/companySetupConfig"),
      brcFetch(name, "/v1/companySetupConfig/getCompanyOptions"),
      brcFetch(name, "/v1/companySetupConfig/getFinancialYear"),
      fetchAllPages(name, "/v1/companySettings"),
    ]);

  const rows = [
    ...rowsFromObject("General Details", setupConfig?.generalDetails ?? {}),
    ...rowsFromObject("Financial Year", setupConfig?.financialYear ?? financialYear ?? {}),
    ...rowsFromObject("Reference Settings", setupConfig?.referenceSettings ?? {}),
    ...rowsFromObject("Options", setupConfig?.options ?? companyOptions ?? {}),
  ];

  for (const setting of companySettings) {
    rows.push({
      Section: "Company Settings",
      Field: `id ${setting.id ?? ""}`,
      Value: flattenValue(setting.value ?? setting),
    });
  }

  return rows;
}

async function main() {
  registerCompany(companyName, apiKey);
  mkdirSync(exportsDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  const summary = [];

  console.log(`Building full BRC report for ${companyName}...`);

  const setupRows = await buildCompanySetupSheet(companyName);
  appendSheet(workbook, "Company Setup", setupRows);
  summary.push({ Sheet: "Company Setup", Records: setupRows.length });

  for (const section of LIST_SECTIONS) {
    process.stdout.write(`Fetching ${section.sheet}... `);
    try {
      const items = await fetchAllPages(companyName, section.path);
      const rows = rowsFromItems(items);
      appendSheet(workbook, section.sheet, rows);
      summary.push({ Sheet: section.sheet, Records: rows.length });
      console.log(`${rows.length} record(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendSheet(workbook, section.sheet, [{ Error: message }]);
      summary.push({ Sheet: section.sheet, Records: 0, Error: message });
      console.log(`failed (${message})`);
    }
  }

  appendSheet(workbook, "Summary", summary);
  XLSX.writeFile(workbook, outputPath);

  console.log(`\nExported report to ${outputPath}`);
  console.log(JSON.stringify({ companyName, outputPath, sheets: summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
