import { readFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const inputPath = join(root, "exports", "customers-data.json");
const outputPath = join(root, "exports", "customers.xlsx");

function flattenCustomer(c) {
  const bank = c.bank && typeof c.bank === "object" ? c.bank : {};
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    accountName: c.accountName ?? "",
    accountNumber: c.accountNumber ?? "",
    contact: c.contact ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    mobile: c.mobile ?? "",
    fax: c.fax ?? "",
    vatReg: c.vatReg ?? "",
    ourCode: c.ourCode ?? "",
    eFTReference: c.eFTReference ?? "",
    authCode: c.authCode ?? "",
    ownerTypeId: c.ownerTypeId,
    vatType: c.vatType,
    vatAnalysisTypeId: c.vatAnalysisTypeId,
    salesRepId: c.salesRepId ?? "",
    businessIdentifierCode: c.businessIdentifierCode ?? "",
    internationalBankAccountNumber: c.internationalBankAccountNumber ?? "",
    address: Array.isArray(c.address) ? c.address.join("; ") : "",
    delivery: Array.isArray(c.delivery) ? c.delivery.join("; ") : "",
    additionalEmails: Array.isArray(c.additionalEmails)
      ? c.additionalEmails.join("; ")
      : "",
    bankName: bank.name ?? "",
    bankBranch: bank.branch ?? "",
    bankSortCode: bank.sortCode ?? "",
    timestamp: c.timestamp ?? "",
  };
}

const raw = JSON.parse(readFileSync(inputPath, "utf8"));
const items = raw.Items ?? raw;
const rows = items.map(flattenCustomer);

mkdirSync(dirname(outputPath), { recursive: true });
const sheet = XLSX.utils.json_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Customers");
XLSX.writeFile(workbook, outputPath);

console.log(`Exported ${rows.length} customer(s) to ${outputPath}`);
