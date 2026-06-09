#!/usr/bin/env node
/**
 * Find or delete leftover test data across one or many BRC companies.
 *
 * Usage:
 *   npm run build
 *
 *   # Single company
 *   $env:BRC_TEST_COMPANY="Company C"
 *   $env:BRC_TEST_API_KEY="<key>"
 *   node scripts/tests/dev-only/dev_test_cleanup.mjs scan
 *
 *   # All companies in a JSON file (name -> apiKey, never commit this file)
 *   $env:BRC_COMPANY_KEYS_FILE="scripts/tests/dev-only/.company_keys.local.json"
 *   node scripts/tests/dev-only/company_leftovers.mjs scan
 *
 *   # Delete matches (requires BRC_CONFIRM_DELETE=true)
 *   $env:BRC_CONFIRM_DELETE="true"
 *   node scripts/tests/dev-only/company_leftovers.mjs delete
 *
 * Environment:
 *   BRC_LEFTOVERS_ACTION     scan | delete (default: first CLI arg or scan)
 *   BRC_CONFIRM_DELETE       must be "true" for delete
 *   BRC_COMPANY_KEYS_FILE    JSON { "Company A": "<key>", ... }
 *   BRC_COMPANY_KEYS_JSON    same as file, inline
 *   BRC_TEST_COMPANY         single company name
 *   BRC_TEST_API_KEY         single company key
 *   BRC_SEARCH_NEEDLES       comma-separated extra substrings (default includes mcp, lauren, dwyer)
 *   BRC_LEFTOVERS_PROFILE    all | mcp | text | ld (default: all)
 *   BRC_LEFTOVERS_REPORT     optional path for JSON report
 *   BRC_MCP_SERVER_ENTRY     default ./build/index.js
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SERVER_ENTRY = process.env.BRC_MCP_SERVER_ENTRY || "./build/index.js";
const ACTION = (process.argv[2] || process.env.BRC_LEFTOVERS_ACTION || "scan").toLowerCase();
const CONFIRM_DELETE = process.env.BRC_CONFIRM_DELETE === "true";
const PROFILE = (process.env.BRC_LEFTOVERS_PROFILE || "all").toLowerCase();
const PAGE_SIZE = Number(process.env.BRC_LEFTOVERS_PAGE_SIZE || 500);

const DEFAULT_TEXT_NEEDLES = ["mcp", "mcp test demo ld", "lauren dwyer", "lauren", "dwyer"];
const TEXT_NEEDLES = [
  ...DEFAULT_TEXT_NEEDLES,
  ...(process.env.BRC_SEARCH_NEEDLES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
].filter((v, i, a) => a.indexOf(v) === i);

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

/** Delete children before parents */
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

function loadCompanies() {
  const singleName = process.env.BRC_TEST_COMPANY || process.env.BRC_TEST_COMPANY_NAME;
  const singleKey = process.env.BRC_TEST_API_KEY || "";

  let fromFile = {};
  if (process.env.BRC_COMPANY_KEYS_JSON) {
    fromFile = JSON.parse(process.env.BRC_COMPANY_KEYS_JSON);
  } else if (process.env.BRC_COMPANY_KEYS_FILE) {
    fromFile = JSON.parse(fs.readFileSync(process.env.BRC_COMPANY_KEYS_FILE, "utf8"));
  }

  if (singleName && singleKey) {
    return { [singleName]: singleKey };
  }

  if (singleName && fromFile[singleName]) {
    return { [singleName]: fromFile[singleName] };
  }

  if (Object.keys(fromFile).length > 0) {
    return fromFile;
  }

  throw new Error(
    "Set BRC_COMPANY_KEYS_FILE, BRC_COMPANY_KEYS_JSON, or BRC_TEST_COMPANY + BRC_TEST_API_KEY"
  );
}

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

  if (useMcp && blob.includes("mcp")) {
    reasons.push("mcp");
  }

  if (useText) {
    for (const needle of TEXT_NEEDLES) {
      if (needle && blob.includes(needle)) {
        reasons.push(`text:${needle}`);
      }
    }
  }

  if (useLd) {
    for (const field of CODE_FIELDS) {
      const value = asText(item?.[field]);
      if (/^LD[A-Z0-9]/i.test(value)) {
        reasons.push(`ld:${field}=${value}`);
      }
    }
  }

  return [...new Set(reasons)];
}

function idOf(x) {
  return (
    x?.id ??
    x?.recordId ??
    x?.customerId ??
    x?.supplierId ??
    x?.productId ??
    x?.quoteId ??
    x?.salesInvoiceId ??
    x?.salesCreditNoteId ??
    x?.paymentId ??
    x?.cashPaymentId ??
    x?.cashReceiptId ??
    x?.purchaseId ??
    x?.salesEntryId
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
    email: item?.email,
  };
}

class McpClient {
  constructor() {
    this.child = spawn("node", [SERVER_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: process.env,
    });
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.tools = new Set();
    this.ready = false;

    this.child.stderr.on("data", (d) => {
      const t = d.toString().trim();
      if (t && !t.toLowerCase().includes("api key")) {
        console.error("[server]", t);
      }
    });

    this.child.stdout.on("data", (d) => {
      this.buffer += d.toString();
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) p.reject(msg.error);
            else p.resolve(msg.result);
          }
        } catch {
          /* ignore */
        }
      }
    });
  }

  req(method, params = {}, timeoutMs = 120000) {
    const id = this.nextId++;
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
    );
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  async init() {
    if (this.ready) return;
    await this.req("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "company-leftovers", version: "1.0.0" },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
    );
    const toolsResult = await this.req("tools/list", {});
    this.tools = new Set((toolsResult?.tools || []).map((t) => t.name));
    this.ready = true;
  }

  async call(name, args) {
    return this.req("tools/call", { name, arguments: args });
  }

  toolText(result) {
    return (result?.content || [])
      .map((p) => (p.type === "text" ? p.text : JSON.stringify(p)))
      .join("\n");
  }

  parsed(result) {
    try {
      return JSON.parse(this.toolText(result));
    } catch {
      return { rawText: this.toolText(result) };
    }
  }

  arr(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.Items)) return data.Items;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  isError(result, data) {
    return Boolean(
      result?.isError ||
        data?.error ||
        String(this.toolText(result)).toLowerCase().includes("failed")
    );
  }

  async setCompanyKey(companyName, apiKey) {
    await this.call("brc_set_company_api_key", { companyName, apiKey });
  }

  async scanCompany(companyName) {
    const records = [];

    for (const [area, listTool] of LIST_AREAS) {
      if (!this.tools.has(listTool)) continue;

      const raw = await this.call(listTool, {
        companyName,
        page: 1,
        pageSize: PAGE_SIZE,
      });

      for (const item of this.arr(this.parsed(raw))) {
        const reasons = matchRecord(item);
        if (reasons.length === 0) continue;
        records.push(summaryRecord(area, listTool, item, reasons));
      }
    }

    return records;
  }

  deleteToolForList(listTool) {
    return LIST_AREAS.find(([, lt]) => lt === listTool)?.[2] || null;
  }

  async deleteRecords(companyName, records) {
    const byList = new Map();
    for (const r of records) {
      if (!r.id || !r.listTool) continue;
      if (!byList.has(r.listTool)) byList.set(r.listTool, []);
      byList.get(r.listTool).push(r);
    }

    const results = [];
    for (const listTool of DELETE_ORDER) {
      const batch = byList.get(listTool);
      if (!batch) continue;

      const deleteTool = this.deleteToolForList(listTool);
      if (!deleteTool || !this.tools.has(deleteTool)) {
        for (const r of batch) {
          results.push({ ...r, deleteTool, status: "SKIP", detail: "No delete tool" });
        }
        continue;
      }

      for (const r of batch) {
        try {
          const raw = await this.call(deleteTool, {
            companyName,
            id: r.id,
            confirmDelete: true,
          });
          const data = this.parsed(raw);
          results.push({
            ...r,
            deleteTool,
            status: this.isError(raw, data) ? "FAIL" : "PASS",
            detail: String(data?.message || data?.error || data?.rawText || "ok").slice(0, 160),
          });
        } catch (e) {
          results.push({
            ...r,
            deleteTool,
            status: "FAIL",
            detail: e.message || String(e),
          });
        }
      }
    }

    return results;
  }

  close() {
    this.child.stdin.end();
  }
}

async function runCompany(client, companyName, apiKey) {
  console.log(`\n=== ${companyName} ===`);
  await client.setCompanyKey(companyName, apiKey);

  const before = await client.scanCompany(companyName);
  console.log(`Found ${before.length} matching record(s) (profile: ${PROFILE}).`);

  if (before.length > 0) {
    for (const r of before) {
      console.log(
        `  - ${r.area} id=${r.id} [${r.reasons.join(", ")}] ${r.code || ""} ${r.name || ""}`.trim()
      );
    }
  }

  let deleteResults = [];
  let after = before;

  if (ACTION === "delete") {
    if (!CONFIRM_DELETE) {
      console.log("Delete skipped: set BRC_CONFIRM_DELETE=true to delete matches.");
    } else {
      deleteResults = await client.deleteRecords(companyName, before);
      const failed = deleteResults.filter((r) => r.status === "FAIL");
      const passed = deleteResults.filter((r) => r.status === "PASS");
      console.log(`Deleted: ${passed.length} ok, ${failed.length} failed.`);
      for (const r of deleteResults) {
        console.log(`  - ${r.deleteTool} id=${r.id}: ${r.status}`);
      }
      after = await client.scanCompany(companyName);
      console.log(`After delete: ${after.length} matching record(s) remain.`);
    }
  }

  return {
    company: companyName,
    action: ACTION,
    profile: PROFILE,
    textNeedles: TEXT_NEEDLES,
    beforeCount: before.length,
    afterCount: after.length,
    recordsBefore: before,
    recordsAfter: after,
    deleteResults,
  };
}

async function main() {
  if (!["scan", "delete"].includes(ACTION)) {
    console.error(`Unknown action "${ACTION}". Use: scan | delete`);
    process.exit(1);
  }

  const companies = loadCompanies();
  const names = Object.keys(companies);

  console.log(`Action: ${ACTION}`);
  console.log(`Companies: ${names.join(", ")}`);
  console.log(`Profile: ${PROFILE}`);
  console.log(`Needles: ${TEXT_NEEDLES.join(", ")}`);

  const client = new McpClient();
  await client.init();

  const report = {
    generatedAt: new Date().toISOString(),
    action: ACTION,
    profile: PROFILE,
    companies: [],
  };

  let totalRemaining = 0;

  for (const companyName of names) {
    const result = await runCompany(client, companyName, companies[companyName]);
    report.companies.push(result);
    totalRemaining += ACTION === "delete" && CONFIRM_DELETE ? result.afterCount : result.beforeCount;
  }

  client.close();

  const reportPath = process.env.BRC_LEFTOVERS_REPORT;
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport: ${reportPath}`);
  }

  console.log("\n=== SUMMARY ===");
  console.table(
    report.companies.map((c) => ({
      company: c.company,
      found: c.beforeCount,
      remaining: c.afterCount,
      deleted: c.deleteResults.filter((d) => d.status === "PASS").length,
      failed: c.deleteResults.filter((d) => d.status === "FAIL").length,
    }))
  );

  const exitCode = totalRemaining > 0 ? 2 : 0;
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
