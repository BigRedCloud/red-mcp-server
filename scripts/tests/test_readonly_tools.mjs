#!/usr/bin/env node
/**
 * BRC MCP read-only tools regression test.
 *
 * Exercises list, get, report, and deployment read/check tools only.
 * Does not create, update, delete, batch, email, or process VAT rates.
 *
 * Run:
 *   npm run build
 *   $env:BRC_TEST_COMPANY="Company C"
 *   $env:BRC_TEST_API_KEY="PASTE_KEY_HERE"
 *   node .\scripts\tests\test_readonly_tools.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

const COMPANY_NAME =
  process.env.BRC_TEST_COMPANY ||
  process.env.BRC_TEST_COMPANY_NAME ||
  "Company C";

const API_KEY = process.env.BRC_TEST_API_KEY || "";
const SERVER_ENTRY = process.env.BRC_MCP_SERVER_ENTRY || "./build/index.js";
const today = new Date().toISOString().slice(0, 10);

const WRITE_TOOL_PATTERNS = [
  /^brc_create_/,
  /^brc_update_/,
  /^brc_delete_/,
  /^brc_batch_/,
  /^brc_send_/,
  /^brc_close_/,
  /^brc_reopen_/,
  /^brc_generate_/,
  /^brc_process_/,
  /^brc_set_company_api_key$/,
  /^brc_clear_company_api_key$/,
  /^brc_clear_all_company_api_keys$/,
];

function isReadOnlyTool(name) {
  if (WRITE_TOOL_PATTERNS.some((pattern) => pattern.test(name))) {
    return false;
  }

  return (
    name.startsWith("brc_list_") ||
    name.startsWith("brc_get_") ||
    name === "brc_getting_started" ||
    name === "brc_get_deployment_policy" ||
    name === "brc_validate_transaction_date" ||
    name === "brc_company_readiness_check" ||
    name === "brc_grouped_nominal_accounts_report" ||
    name === "brc_multi_company_nom_ac_report"
  );
}

function toolSortRank(name) {
  if (name === "brc_getting_started" || name === "brc_get_deployment_policy") {
    return 0;
  }
  if (name === "brc_list_company_contexts") return 1;
  if (
    name === "brc_get_financial_year" ||
    name === "brc_get_company_setup_config"
  ) {
    return 2;
  }
  if (
    name === "brc_validate_transaction_date" ||
    name === "brc_company_readiness_check"
  ) {
    return 3;
  }
  if (name.startsWith("brc_list_")) return 4;
  if (name.startsWith("brc_get_")) return 5;
  if (name.includes("report")) return 6;
  return 7;
}

if (!API_KEY) {
  console.error("Missing BRC_TEST_API_KEY");
  process.exit(1);
}

const child = spawn("node", [SERVER_ENTRY], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: process.cwd(),
  env: process.env,
});

let nextId = 1;
let buffer = "";
const pending = new Map();
const results = [];
let tools = new Set();

child.stderr.on("data", (d) => {
  const t = d.toString().trim();
  if (t) console.error("[server]", t);
});

child.stdout.on("data", (d) => {
  buffer += d.toString();

  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;

    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
      }
    } catch {
      // Ignore non-JSON stdout.
    }
  }
});

function req(method, params = {}, timeoutMs = 45000) {
  const id = nextId++;
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
  );

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }
    }, timeoutMs);
  });
}

async function call(name, args = {}, timeoutMs = 45000) {
  return req("tools/call", { name, arguments: args }, timeoutMs);
}

function toolText(result) {
  if (!result?.content) return JSON.stringify(result);
  return result.content
    .map((part) => (part.type === "text" ? part.text : JSON.stringify(part)))
    .join("\n");
}

function parsed(result) {
  try {
    return JSON.parse(toolText(result));
  } catch {
    return { rawText: toolText(result) };
  }
}

function isFail(result, data) {
  const t = toolText(result).toLowerCase();
  return Boolean(
    result?.isError ||
      data?.error ||
      data?.status === "error" ||
      t.includes("failed") ||
      t.includes("bad request") ||
      t.includes("internal server error") ||
      t.includes("unprocessable") ||
      t.includes("validation")
  );
}

function arr(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
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

function firstId(items) {
  const found = items.find((x) => {
    const id = idOf(x);
    const n = Number(id);
    return id !== undefined && id !== null && Number.isFinite(n) && n > 0;
  });
  return idOf(found);
}

async function run(name, args = {}, options = {}) {
  if (!tools.has(name)) {
    results.push({
      tool: name,
      status: "MISSING",
      args,
      details: "Tool not registered",
    });
    console.log(`- ${name}: MISSING`);
    return {};
  }

  if (options.skip) {
    results.push({
      tool: name,
      status: "SKIPPED",
      args,
      details: options.reason || "Skipped",
    });
    console.log(`- ${name}: SKIPPED`);
    return {};
  }

  try {
    const r = await call(name, args, options.timeoutMs || 45000);
    const d = parsed(r);
    const status = isFail(r, d) ? "FAIL" : "PASS";

    results.push({ tool: name, status, args, details: d });
    console.log(`- ${name}: ${status}`);
    return { status, data: d, raw: r };
  } catch (e) {
    results.push({
      tool: name,
      status: "FAIL",
      args,
      details: { message: e.message || String(e) },
    });
    console.log(`- ${name}: FAIL`);
    return { status: "FAIL", data: { message: e.message || String(e) } };
  }
}

async function listTool(name, pageSize = 100) {
  const r = await run(name, {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize,
  });
  return arr(r.data);
}

function buildArgs(toolName, refs) {
  const company = { companyName: COMPANY_NAME };
  const listArgs = { ...company, page: 1, pageSize: 100 };

  switch (toolName) {
    case "brc_getting_started":
    case "brc_get_deployment_policy":
    case "brc_list_company_contexts":
      return {};

    case "brc_validate_transaction_date":
      return {
        ...company,
        transactionDate: refs.testDate || today,
      };

    case "brc_company_readiness_check":
      return company;

    case "brc_multi_company_nom_ac_report":
      return { companyNames: [COMPANY_NAME] };

    case "brc_grouped_nominal_accounts_report":
      return company;

    case "brc_get_nom_ac_ledger_by_ids":
      return {
        ...company,
        ids: String(refs.nominalId || ""),
      };

    case "brc_get_nominal_account_ledger_by_id":
      return { ...company, id: refs.nominalId };

    case "brc_get_customer":
      return { ...company, id: refs.customerId };
    case "brc_get_supplier":
      return { ...company, id: refs.supplierId };
    case "brc_get_product":
      return { ...company, id: refs.productId };
    case "brc_get_sales_rep":
      return { ...company, id: refs.salesRepId };
    case "brc_get_sales_entry":
      return { ...company, id: refs.salesEntryId };
    case "brc_get_sales_invoice":
      return { ...company, id: refs.salesInvoiceId };
    case "brc_get_sales_credit_note":
      return { ...company, id: refs.salesCreditNoteId };
    case "brc_get_purchase":
      return { ...company, id: refs.purchaseId };
    case "brc_get_quote":
      return { ...company, id: refs.quoteId };
    case "brc_get_payment":
      return { ...company, id: refs.paymentId };
    case "brc_get_cash_payment":
      return { ...company, id: refs.cashPaymentId };
    case "brc_get_cash_receipt":
      return { ...company, id: refs.cashReceiptId };
    case "brc_get_bank_account":
      return { ...company, id: refs.bankAccountId };

    case "brc_get_customer_opening_balance":
    case "brc_list_customer_op_bal_trans":
    case "brc_list_customer_account_trans":
    case "brc_list_customer_quotes":
      return { ...company, itemId: String(refs.customerId || "") };

    case "brc_get_supplier_opening_balance":
    case "brc_list_supplier_op_bal_trans":
    case "brc_list_supplier_account_trans":
      return { ...company, itemId: String(refs.supplierId || "") };

    default:
      if (toolName.startsWith("brc_list_")) {
        return listArgs;
      }
      if (toolName.startsWith("brc_get_")) {
        return company;
      }
      return company;
  }
}

function requiredRefField(toolName) {
  const map = {
    brc_get_customer: "customerId",
    brc_get_supplier: "supplierId",
    brc_get_product: "productId",
    brc_get_sales_rep: "salesRepId",
    brc_get_sales_entry: "salesEntryId",
    brc_get_sales_invoice: "salesInvoiceId",
    brc_get_sales_credit_note: "salesCreditNoteId",
    brc_get_purchase: "purchaseId",
    brc_get_quote: "quoteId",
    brc_get_payment: "paymentId",
    brc_get_cash_payment: "cashPaymentId",
    brc_get_cash_receipt: "cashReceiptId",
    brc_get_bank_account: "bankAccountId",
    brc_get_nominal_account_ledger_by_id: "nominalId",
    brc_get_nom_ac_ledger_by_ids: "nominalId",
    brc_get_customer_opening_balance: "customerId",
    brc_list_customer_op_bal_trans: "customerId",
    brc_list_customer_account_trans: "customerId",
    brc_list_customer_quotes: "customerId",
    brc_get_supplier_opening_balance: "supplierId",
    brc_list_supplier_op_bal_trans: "supplierId",
    brc_list_supplier_account_trans: "supplierId",
  };

  return map[toolName];
}

function hasRequiredRef(toolName, refs) {
  const field = requiredRefField(toolName);
  if (!field) return true;
  const value = refs[field];
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function writeReports(counts, readonlyTools, writeToolsSeen) {
  fs.mkdirSync("./reports", { recursive: true });

  const summary = [
    "BRC MCP READ-ONLY TOOLS TEST SUMMARY",
    "===================================",
    `Company: ${COMPANY_NAME}`,
    `Read-only tools tested: ${readonlyTools.length}`,
    `Write tools excluded: ${writeToolsSeen.length}`,
    `Total invocations: ${results.length}`,
    `PASS: ${counts.PASS || 0}`,
    `FAIL: ${counts.FAIL || 0}`,
    `SKIPPED: ${counts.SKIPPED || 0}`,
    `MISSING: ${counts.MISSING || 0}`,
    "",
    "Failures:",
    ...results
      .filter((r) => r.status === "FAIL")
      .map((r) => `- ${r.tool}: ${JSON.stringify(r.details).slice(0, 900)}`),
    "",
    "Skipped:",
    ...results
      .filter((r) => r.status === "SKIPPED")
      .map((r) => `- ${r.tool}: ${r.details}`),
  ].join("\n");

  fs.writeFileSync(
    "./reports/readonly-tools-test-results.json",
    JSON.stringify(
      {
        companyName: COMPANY_NAME,
        readonlyTools,
        excludedWriteTools: writeToolsSeen,
        counts,
        results,
      },
      null,
      2
    )
  );

  fs.writeFileSync("./reports/readonly-tools-test-summary.txt", summary);
  console.log("\n" + summary);
  console.log(
    "\nSaved reports/readonly-tools-test-results.json and reports/readonly-tools-test-summary.txt"
  );
}

async function main() {
  console.log("Starting BRC MCP read-only tools test...");
  console.log(`Company: ${COMPANY_NAME}`);
  console.log(`Server entry: ${SERVER_ENTRY}`);
  console.log(
    "This test only calls list/get/report/deployment read tools. No BRC records are created.\n"
  );

  await req("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "brc-readonly-tools-test",
      version: "1.0.0",
    },
  });

  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }) + "\n"
  );

  const toolList = await req("tools/list", {});
  tools = new Set((toolList.tools || []).map((t) => t.name));

  const allToolNames = [...tools].sort();
  const readonlyTools = allToolNames
    .filter(isReadOnlyTool)
    .sort((a, b) => toolSortRank(a) - toolSortRank(b) || a.localeCompare(b));
  const writeToolsSeen = allToolNames.filter((t) => !isReadOnlyTool(t));

  console.log(`Loaded ${tools.size} tools (${readonlyTools.length} read-only).\n`);

  console.log("=== Session setup ===");
  await run("brc_set_company_api_key", {
    companyName: COMPANY_NAME,
    apiKey: API_KEY,
  });
  await run("brc_list_company_contexts", {});

  console.log("\n=== Loading reference ids (read-only lists) ===");
  const refs = { testDate: today };

  const financialYear = await run("brc_get_financial_year", {
    companyName: COMPANY_NAME,
  });
  const fyText = JSON.stringify(financialYear.data || {});
  const fyStart = fyText.match(/"start"\s*:\s*"(\d{4}-\d{2}-\d{2})"/i)?.[1];
  if (fyStart) {
    refs.testDate = fyStart;
  }

  const [
    customers,
    suppliers,
    products,
    reps,
    salesEntries,
    salesInvoices,
    creditNotes,
    purchases,
    quotes,
    payments,
    cashPayments,
    cashReceipts,
    banks,
    nominalAccounts,
  ] = await Promise.all([
    listTool("brc_list_customers"),
    listTool("brc_list_suppliers"),
    listTool("brc_list_products"),
    listTool("brc_list_sales_reps"),
    listTool("brc_list_sales_entries"),
    listTool("brc_list_sales_invoices"),
    listTool("brc_list_sales_credit_notes"),
    listTool("brc_list_purchases"),
    listTool("brc_list_quotes"),
    listTool("brc_list_payments"),
    listTool("brc_list_cash_payments"),
    listTool("brc_list_cash_receipts"),
    listTool("brc_list_bank_accounts"),
    listTool("brc_list_nominal_accounts", 50),
  ]);

  refs.customerId = firstId(customers);
  refs.supplierId = firstId(suppliers);
  refs.productId = firstId(products);
  refs.salesRepId = firstId(reps);
  refs.salesEntryId = firstId(salesEntries);
  refs.salesInvoiceId = firstId(salesInvoices);
  refs.salesCreditNoteId = firstId(creditNotes);
  refs.purchaseId = firstId(purchases);
  refs.quoteId = firstId(quotes);
  refs.paymentId = firstId(payments);
  refs.cashPaymentId = firstId(cashPayments);
  refs.cashReceiptId = firstId(cashReceipts);
  refs.bankAccountId = firstId(banks);
  refs.nominalId =
    idOf(nominalAccounts.find((x) => String(x?.code) === "000")) ||
    firstId(nominalAccounts);

  console.log(
    `Refs: customer=${refs.customerId || "-"} product=${refs.productId || "-"} ` +
      `supplier=${refs.supplierId || "-"} nominal=${refs.nominalId || "-"} ` +
      `testDate=${refs.testDate}`
  );

  const alreadyRun = new Set([
    "brc_set_company_api_key",
    "brc_get_financial_year",
    ...[
      "brc_list_customers",
      "brc_list_suppliers",
      "brc_list_products",
      "brc_list_sales_reps",
      "brc_list_sales_entries",
      "brc_list_sales_invoices",
      "brc_list_sales_credit_notes",
      "brc_list_purchases",
      "brc_list_quotes",
      "brc_list_payments",
      "brc_list_cash_payments",
      "brc_list_cash_receipts",
      "brc_list_bank_accounts",
      "brc_list_nominal_accounts",
    ],
  ]);

  console.log("\n=== Read-only tools ===");
  for (const toolName of readonlyTools) {
    if (alreadyRun.has(toolName)) {
      continue;
    }

    const args = buildArgs(toolName, refs);

    if (!hasRequiredRef(toolName, refs)) {
      await run(toolName, args, {
        skip: true,
        reason: "No existing record id available in company data",
      });
      continue;
    }

    const options = {};
    if (toolName === "brc_get_company_logo") {
      options.reasonOnFail =
        "Optional; company may not have a logo configured.";
    }
    if (
      toolName === "brc_grouped_nominal_accounts_report" ||
      toolName === "brc_multi_company_nom_ac_report"
    ) {
      options.timeoutMs = 90000;
    }

    const outcome = await run(toolName, args, options);

    if (
      toolName === "brc_get_company_logo" &&
      outcome.status === "FAIL" &&
      options.reasonOnFail
    ) {
      const entry = results[results.length - 1];
      entry.status = "SKIPPED";
      entry.details = options.reasonOnFail;
      console.log(`- ${toolName}: SKIPPED (no logo)`);
    }
  }

  console.log("\n=== Session cleanup ===");
  await run("brc_clear_all_company_api_keys", {});
  await run("brc_list_company_contexts", {});

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  writeReports(counts, readonlyTools, writeToolsSeen);
  child.kill();

  if ((counts.FAIL || 0) > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test crashed:", e);
  try {
    child.kill();
  } catch {}
  process.exit(1);
});
