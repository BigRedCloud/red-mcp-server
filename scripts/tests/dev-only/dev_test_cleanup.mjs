#!/usr/bin/env node
/**
 * Scan or delete leftover legacy regression records by marker.
 *
 * Usage:
 *   npm run leftovers:scan
 *   BRC_CONFIRM_DELETE=true npm run leftovers:delete
 *
 * Defaults to scan mode. Delete requires BRC_CONFIRM_DELETE=true.
 */

import fs from "node:fs";
import path from "node:path";
import { loadCompanyKeyMap, DEFAULT_TEST_SERVER_ENTRY } from "../lib/connection_env.mjs";
import { McpStdioClient, defaultRegressionServerEnv } from "../lib/mcp_client.mjs";
import { redactString } from "../lib/redact.mjs";

const ACTION = (process.argv[2] || process.env.BRC_LEFTOVERS_ACTION || "scan").toLowerCase();
const CONFIRM_DELETE = process.env.BRC_CONFIRM_DELETE === "true";
const PROFILE = (process.env.BRC_LEFTOVERS_PROFILE || "all").toLowerCase();
const PAGE_SIZE = Number(process.env.BRC_LEFTOVERS_PAGE_SIZE || 500);
const MARKER = process.env.BRC_TEST_MARKER?.trim() || "MCP TEST DEMO LD";

const DEFAULT_TEXT_NEEDLES = ["mcp", "mcp test demo ld", "lauren dwyer", "lauren", "dwyer"];
const TEXT_NEEDLES = [
  ...DEFAULT_TEXT_NEEDLES,
  ...(process.env.BRC_SEARCH_NEEDLES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  MARKER.toLowerCase(),
].filter((value, index, array) => array.indexOf(value) === index);

const CODE_FIELDS = [
  "code",
  "acCode",
  "stockCode",
  "reference",
  "ourCode",
  "eFTReference",
  "poNumber",
  "ddNumber",
];

const LIST_AREAS = [
  ["customers", "brc_list_customers", "brc_delete_customer"],
  ["products", "brc_list_products", "brc_delete_product"],
  ["suppliers", "brc_list_suppliers", "brc_delete_supplier"],
  ["sales reps", "brc_list_sales_reps", "brc_delete_sales_rep"],
  ["sales credit notes", "brc_list_sales_credit_notes", "brc_delete_sales_credit_note"],
  ["sales invoices", "brc_list_sales_invoices", "brc_delete_sales_invoice"],
  ["quotes", "brc_list_quotes", "brc_delete_quote"],
  ["sales entries", "brc_list_sales_entries", "brc_delete_sales_entry"],
  ["purchases", "brc_list_purchases", "brc_delete_purchase"],
  ["cash receipts", "brc_list_cash_receipts", "brc_delete_cash_receipt"],
  ["cash payments", "brc_list_cash_payments", "brc_delete_cash_payment"],
  ["payments", "brc_list_payments", "brc_delete_payment"],
  ["bank accounts", "brc_list_bank_accounts", null],
];

const DELETE_ORDER = [
  "brc_list_quotes",
  "brc_list_sales_invoices",
  "brc_list_sales_credit_notes",
  "brc_list_sales_entries",
  "brc_list_purchases",
  "brc_list_cash_receipts",
  "brc_list_cash_payments",
  "brc_list_payments",
  "brc_list_sales_reps",
  "brc_list_products",
  "brc_list_suppliers",
  "brc_list_customers",
];

function asText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).join(" ");
  return String(value);
}

function matchRecord(item) {
  const reasons = [];
  const blob = JSON.stringify(item || {}).toLowerCase();

  const useMcp = PROFILE === "all" || PROFILE === "mcp";
  const useText = PROFILE === "all" || PROFILE === "text";
  const useLd = PROFILE === "all" || PROFILE === "ld";

  if (useMcp && blob.includes("mcp")) reasons.push("mcp");
  if (useText) {
    for (const needle of TEXT_NEEDLES) {
      if (needle && blob.includes(needle)) reasons.push(`text:${needle}`);
    }
  }
  if (useLd) {
    for (const field of CODE_FIELDS) {
      const value = asText(item?.[field]);
      if (/^LD[A-Z0-9]/i.test(value)) reasons.push(`ld:${field}=${value}`);
    }
  }

  return [...new Set(reasons)];
}

function idOf(item) {
  return (
    item?.id ??
    item?.recordId ??
    item?.customerId ??
    item?.supplierId ??
    item?.productId ??
    item?.quoteId ??
    item?.salesInvoiceId ??
    item?.salesCreditNoteId ??
    item?.paymentId ??
    item?.cashPaymentId ??
    item?.cashReceiptId ??
    item?.purchaseId ??
    item?.salesEntryId
  );
}

function summaryRecord(area, listTool, item, reasons) {
  return {
    area,
    listTool,
    id: idOf(item),
    reasons,
    code: item?.code ?? item?.acCode ?? item?.stockCode,
    name: asText(item?.name ?? item?.details ?? item?.note).slice(0, 100),
    reference: item?.reference,
  };
}

async function runCompany(companyName, apiKey) {
  const client = new McpStdioClient({
    serverEntry: DEFAULT_TEST_SERVER_ENTRY,
    env: defaultRegressionServerEnv({
      BRC_TEST_COMPANY: companyName,
      BRC_TEST_API_KEY: apiKey,
      BRC_ALLOW_DELETE_SKILLS: ACTION === "delete" ? "true" : "false",
    }),
  });

  await client.init({ name: "legacy-leftovers", version: "2.0.0" });

  console.log(`\n=== ${companyName} ===`);

  const records = [];
  for (const [area, listTool] of LIST_AREAS) {
    if (!client.tools.has(listTool)) continue;

    const raw = await client.call(listTool, {
      companyName,
      page: 1,
      pageSize: PAGE_SIZE,
    });

    for (const item of client.arr(client.parsed(raw))) {
      const reasons = matchRecord(item);
      if (reasons.length === 0) continue;
      records.push(summaryRecord(area, listTool, item, reasons));
    }
  }

  console.log(`Found ${records.length} matching record(s) (profile: ${PROFILE}, marker: ${MARKER}).`);
  for (const record of records) {
    console.log(
      `  - ${record.area} id=${record.id} [${record.reasons.join(", ")}] ${record.code || ""} ${record.name || ""}`.trim()
    );
  }

  let deleteResults = [];
  let after = records;

  if (ACTION === "delete") {
    if (!CONFIRM_DELETE) {
      console.log("Delete skipped: set BRC_CONFIRM_DELETE=true to delete matches.");
    } else {
      const byList = new Map();
      for (const record of records) {
        if (!record.id || !record.listTool) continue;
        if (!byList.has(record.listTool)) byList.set(record.listTool, []);
        byList.get(record.listTool).push(record);
      }

      for (const listTool of DELETE_ORDER) {
        const batch = byList.get(listTool);
        if (!batch) continue;

        const deleteTool = LIST_AREAS.find(([, lt]) => lt === listTool)?.[2];
        if (!deleteTool || !client.tools.has(deleteTool)) continue;

        for (const record of batch) {
          try {
            const raw = await client.call(deleteTool, {
              companyName,
              id: record.id,
              confirmDelete: true,
            });
            const data = client.parsed(raw);
            deleteResults.push({
              ...record,
              deleteTool,
              status: client.isFailure(raw, data) ? "FAIL" : "PASS",
              detail: redactString(
                String(data?.message || data?.error || data?.rawText || "ok").slice(0, 160)
              ),
            });
          } catch (error) {
            deleteResults.push({
              ...record,
              deleteTool,
              status: "FAIL",
              detail: redactString(error.message || String(error)),
            });
          }
        }
      }

      after = [];
      for (const [area, listTool] of LIST_AREAS) {
        if (!client.tools.has(listTool)) continue;
        const raw = await client.call(listTool, {
          companyName,
          page: 1,
          pageSize: PAGE_SIZE,
        });
        for (const item of client.arr(client.parsed(raw))) {
          const reasons = matchRecord(item);
          if (reasons.length === 0) continue;
          after.push(summaryRecord(area, listTool, item, reasons));
        }
      }

      console.log(`After delete: ${after.length} matching record(s) remain.`);
    }
  }

  client.close();

  return {
    company: companyName,
    action: ACTION,
    profile: PROFILE,
    marker: MARKER,
    beforeCount: records.length,
    afterCount: after.length,
    recordsBefore: records,
    recordsAfter: after,
    deleteResults,
  };
}

async function main() {
  if (!["scan", "delete"].includes(ACTION)) {
    console.error(`Unknown action "${ACTION}". Use scan or delete.`);
    process.exit(1);
  }

  const companies = loadCompanyKeyMap();
  const names = Object.keys(companies);

  console.log(`Action: ${ACTION}`);
  console.log(`Companies: ${names.join(", ")}`);
  console.log(`Profile: ${PROFILE}`);
  console.log(`Marker: ${MARKER}`);

  const report = {
    generatedAt: new Date().toISOString(),
    action: ACTION,
    profile: PROFILE,
    marker: MARKER,
    companies: [],
  };

  let totalRemaining = 0;

  for (const companyName of names) {
    const result = await runCompany(companyName, companies[companyName]);
    report.companies.push(result);
    totalRemaining +=
      ACTION === "delete" && CONFIRM_DELETE ? result.afterCount : result.beforeCount;
  }

  const reportPath = process.env.BRC_LEFTOVERS_REPORT;
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport: ${reportPath}`);
  }

  console.log("\n=== SUMMARY ===");
  console.table(
    report.companies.map((entry) => ({
      company: entry.company,
      found: entry.beforeCount,
      remaining: entry.afterCount,
      deleted: entry.deleteResults.filter((item) => item.status === "PASS").length,
      failed: entry.deleteResults.filter((item) => item.status === "FAIL").length,
    }))
  );

  process.exit(totalRemaining > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error(redactString(error.message || String(error)));
  process.exit(1);
});
