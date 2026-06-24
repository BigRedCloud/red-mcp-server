#!/usr/bin/env node
/**
 * Legacy manual read-only MCP regression.
 *
 * Run: npm run build && npm run test:readonly:legacy
 *
 * Requires BRC_TEST_COMPANY and BRC_TEST_API_KEY in the environment.
 * Credentials are seeded via the secure connection store — never logged.
 */

import fs from "node:fs";
import { McpStdioClient, defaultRegressionServerEnv } from "./lib/mcp_client.mjs";
import {
  requireTestConnectionEnv,
  DEFAULT_TEST_SERVER_ENTRY,
  describeConnectionSetup,
} from "./lib/connection_env.mjs";
import { classifyToolForRegression } from "./lib/tool_classification.mjs";
import {
  buildRegistryReport,
  buildSetupFailedRegistryReport,
  writeJsonReport,
  safeJsonForReport,
} from "./lib/registry_report.mjs";
import { redactSensitive } from "./lib/redact.mjs";
import {
  AUTH_PREFLIGHT_TOOL,
  printAuthFailure,
  runAuthPreflight,
} from "./lib/auth_preflight.mjs";

const { companyName: COMPANY_NAME } = requireTestConnectionEnv({
  label: "read-only legacy regression",
});

const SERVER_ENTRY = DEFAULT_TEST_SERVER_ENTRY;
const today = new Date().toISOString().slice(0, 10);

const client = new McpStdioClient({
  serverEntry: SERVER_ENTRY,
  env: defaultRegressionServerEnv(),
});

const results = [];
let tools = new Set();

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

const OPTIONAL_ALLOCATION_TOOLS = new Set([
  "brc_list_allocated_transactions",
  "brc_list_allocation_resolvers",
]);

const OPTIONAL_ALLOCATION_500_SKIP =
  "BRC API returned 500 for optional allocation resolver endpoint";

function isBrc500Response(data, text = "") {
  if (data?.statusCode === 500) {
    return true;
  }

  const blob = JSON.stringify(data ?? {}).toLowerCase();
  if (
    /500\s+internal server error/.test(blob) ||
    /"statuscode":500/.test(blob) ||
    /"status":500/.test(blob)
  ) {
    return true;
  }

  return /500\s+internal server error/i.test(text);
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
    const raw = await client.call(name, args, options.timeoutMs || 45000);
    const data = client.parsed(raw);
    const text = client.toolText(raw);

    if (
      OPTIONAL_ALLOCATION_TOOLS.has(name) &&
      client.isFailure(raw, data) &&
      isBrc500Response(data, text)
    ) {
      results.push({
        tool: name,
        status: "SKIPPED",
        args,
        details: {
          reason: OPTIONAL_ALLOCATION_500_SKIP,
          response: data,
        },
      });
      console.log(`- ${name}: SKIPPED (BRC 500)`);
      return { status: "SKIPPED", data, raw };
    }

    const status = client.isFailure(raw, data) ? "FAIL" : "PASS";

    results.push({ tool: name, status, args, details: data });
    console.log(`- ${name}: ${status}`);
    return { status, data, raw };
  } catch (error) {
    results.push({
      tool: name,
      status: "FAIL",
      args,
      details: { message: error.message || String(error) },
    });
    console.log(`- ${name}: FAIL`);
    return { status: "FAIL", data: { message: error.message || String(error) } };
  }
}

async function listTool(name, pageSize = 100) {
  const response = await run(name, {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize,
  });
  return arr(response.data);
}

async function listODataTool(name, top = 100) {
  const response = await run(name, {
    companyName: COMPANY_NAME,
    top,
  });
  return arr(response.data);
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

    case "brc_check_transaction_settings":
      return { ...company, workflow: "sales_invoice" };

    case "brc_list_allocation_resolvers":
    case "brc_list_allocated_transactions":
      return { ...company, bookTranId: refs.bookTranId };

    case "brc_list_accruals":
    case "brc_list_prepayments":
    case "brc_list_nominal_journal_batches":
      return { ...company, top: 100 };

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

    case "brc_get_accrual":
      return { ...company, id: refs.accrualId };
    case "brc_get_prepayment":
      return { ...company, id: refs.prepaymentId };
    case "brc_get_nominal_journal_batch":
      return { ...company, id: refs.nominalJournalBatchId };

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
    brc_get_accrual: "accrualId",
    brc_get_prepayment: "prepaymentId",
    brc_get_nominal_journal_batch: "nominalJournalBatchId",
    brc_get_nominal_account_ledger_by_id: "nominalId",
    brc_get_nom_ac_ledger_by_ids: "nominalId",
    brc_get_customer_opening_balance: "customerId",
    brc_list_customer_op_bal_trans: "customerId",
    brc_list_customer_account_trans: "customerId",
    brc_list_customer_quotes: "customerId",
    brc_get_supplier_opening_balance: "supplierId",
    brc_list_supplier_op_bal_trans: "supplierId",
    brc_list_supplier_account_trans: "supplierId",
    brc_list_allocation_resolvers: "bookTranId",
    brc_list_allocated_transactions: "bookTranId",
  };

  return map[toolName];
}

function hasRequiredRef(toolName, refs) {
  const field = requiredRefField(toolName);
  if (!field) return true;
  const value = refs[field];
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function recordSkippedNonReadonly(allToolNames) {
  const exercised = new Set(results.map((entry) => entry.tool));

  for (const toolName of allToolNames) {
    if (exercised.has(toolName)) continue;

    const classification = classifyToolForRegression(toolName);
    if (classification.category === "read-only") continue;

    results.push({
      tool: toolName,
      status: "SKIPPED",
      args: null,
      details:
        classification.skipReason ||
        `Not a read-only tool (${classification.category})`,
    });
  }
}

async function assertCompanyConnected() {
  const response = await run("brc_list_company_contexts", {});
  const companies = arr(response.data?.companies ?? response.data);
  const connected = companies.some(
    (entry) =>
      String(entry?.companyName || entry?.name || "")
        .trim()
        .toLowerCase() === COMPANY_NAME.trim().toLowerCase() &&
      entry?.connected !== false
  );

  if (!connected) {
    console.error(
      [
        `Company "${COMPANY_NAME}" is not connected in this MCP session.`,
        "",
        "Set BRC_TEST_COMPANY and BRC_TEST_API_KEY in your environment.",
        "The test server seeds credentials via the secure connection store only.",
        "",
        "This script never accepts credentials on the command line or in chat.",
      ].join("\n")
    );
    client.close();
    process.exit(1);
  }
}

function writeReports(report, setup) {
  const summary = [
    "BRC MCP READ-ONLY LEGACY REGRESSION SUMMARY",
    "===========================================",
    `Company: ${COMPANY_NAME}`,
    `Registered tools: ${report.classified.length}`,
    setup?.status === "setup_failed"
      ? `Setup: ${setup.status} (${setup.reason})`
      : `Connection: secure store seed (no credentials logged)`,
    "",
    "Classification:",
    ...Object.entries(report.categoryCounts).map(
      ([category, count]) => `- ${category}: ${count}`
    ),
    "",
    "Run status:",
    ...Object.entries(report.statusCounts).map(
      ([status, count]) => `- ${status}: ${count}`
    ),
    "",
    "Failures:",
    ...report.classified
      .filter((entry) => entry.status === "FAIL")
      .map(
        (entry) => `- ${entry.tool}: ${safeJsonForReport(entry.details)}`
      ),
  ].join("\n");

  writeJsonReport("./reports/readonly-tools-test-results.json", {
    companyName: COMPANY_NAME,
    connection: describeConnectionSetup(COMPANY_NAME),
    registeredTools: report.classified.length,
    registeredToolCount: report.classified.length,
    categoryCounts: report.categoryCounts,
    statusCounts: report.statusCounts,
    setup: setup ?? { status: "ok" },
    classifiedTools: report.classified,
    invocations: redactSensitive(results),
  });

  fs.writeFileSync("./reports/readonly-tools-test-summary.txt", summary);
  console.log("\n" + summary);
  console.log(
    "\nSaved reports/readonly-tools-test-results.json and reports/readonly-tools-test-summary.txt"
  );
}

async function finishSetupFailed(allToolNames, preflight) {
  recordSkippedNonReadonly(allToolNames);

  const preflightResults = [
    {
      tool: preflight.toolName,
      status: "FAIL",
      args: { companyName: COMPANY_NAME },
      details: preflight.data,
    },
  ];

  const report = buildSetupFailedRegistryReport(
    allToolNames,
    preflightResults,
    "unauthorized"
  );

  printAuthFailure(COMPANY_NAME);
  writeReports(report, report.setup);
  client.close();
  process.exit(1);
}

async function main() {
  console.log("Starting BRC MCP read-only legacy regression...");
  console.log(`Company: ${COMPANY_NAME}`);
  console.log(`Server entry: ${SERVER_ENTRY}`);
  console.log(
    "Read-only tools only — no create, update, delete, batch, or email.\n"
  );

  await client.init({
    name: "brc-readonly-legacy-regression",
    version: "2.0.0",
  });

  tools = client.tools;
  const allToolNames = [...tools].sort();

  console.log(`Discovered ${tools.size} registered tools.\n`);

  console.log("=== Session setup ===");
  await assertCompanyConnected();

  console.log("\n=== Auth preflight ===");
  const preflight = await runAuthPreflight(client, COMPANY_NAME);
  results.push({
    tool: preflight.toolName,
    status: preflight.unauthorized ? "FAIL" : preflight.ok ? "PASS" : "FAIL",
    args: { companyName: COMPANY_NAME },
    details: preflight.data,
  });
  console.log(
    `- ${preflight.toolName}: ${preflight.unauthorized ? "FAIL (unauthorized)" : preflight.ok ? "PASS" : "FAIL"}`
  );

  if (preflight.unauthorized) {
    await finishSetupFailed(allToolNames, preflight);
    return;
  }

  console.log("\n=== Loading reference ids (read-only lists) ===");
  const refs = { testDate: today };

  const fyText = JSON.stringify(preflight.data || {});
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
    accruals,
    prepayments,
    nominalJournalBatches,
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
    listODataTool("brc_list_accruals"),
    listODataTool("brc_list_prepayments"),
    listODataTool("brc_list_nominal_journal_batches"),
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
  refs.accrualId = firstId(accruals);
  refs.prepaymentId = firstId(prepayments);
  refs.nominalJournalBatchId = firstId(nominalJournalBatches);
  refs.bookTranId =
    refs.paymentId ||
    refs.salesInvoiceId ||
    refs.cashReceiptId ||
    refs.purchaseId ||
    refs.salesEntryId;

  console.log(
    `Refs: customer=${refs.customerId || "-"} product=${refs.productId || "-"} ` +
      `supplier=${refs.supplierId || "-"} nominal=${refs.nominalId || "-"} ` +
      `accrual=${refs.accrualId || "-"} prepayment=${refs.prepaymentId || "-"} ` +
      `nominalJournalBatch=${refs.nominalJournalBatchId || "-"} ` +
      `bookTranId=${refs.bookTranId || "-"} testDate=${refs.testDate}`
  );

  const readonlyTools = allToolNames
    .filter(
      (toolName) =>
        classifyToolForRegression(toolName).category === "read-only"
    )
    .sort((a, b) => toolSortRank(a) - toolSortRank(b) || a.localeCompare(b));

  const alreadyRun = new Set([
    AUTH_PREFLIGHT_TOOL,
    "brc_list_company_contexts",
    "brc_get_financial_year",
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
    "brc_list_accruals",
    "brc_list_prepayments",
    "brc_list_nominal_journal_batches",
  ]);

  console.log("\n=== Read-only tools ===");
  for (const toolName of readonlyTools) {
    if (alreadyRun.has(toolName)) continue;

    const args = buildArgs(toolName, refs);

    if (!hasRequiredRef(toolName, refs)) {
      await run(toolName, args, {
        skip: true,
        reason: "No reference id available",
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

  recordSkippedNonReadonly(allToolNames);

  const report = buildRegistryReport(allToolNames, results);
  writeReports(report, { status: "ok" });
  client.close();

  if ((report.statusCounts.FAIL || 0) > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Read-only legacy regression crashed:", error.message || error);
  try {
    client.close();
  } catch {}
  process.exit(1);
});
