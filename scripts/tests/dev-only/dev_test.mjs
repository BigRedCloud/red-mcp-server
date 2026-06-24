#!/usr/bin/env node

/**
 * BRC MCP write/update legacy manual regression.
 *
 * Creates temporary test records in BRC and attempts to delete them.
 *
 * Requires explicit confirmation:
 *   BRC_ALLOW_DEV_WRITE_TESTS=true
 *
 * Recommended run:
 *   npm run build
 *   $env:BRC_ALLOW_DEV_WRITE_TESTS="true"
 *   $env:BRC_TEST_COMPANY="JasonsCompany"
 *   $env:BRC_TEST_API_KEY="<from secure store>"
 *   $env:BRC_TEST_DATE="2015-01-15"
 *   npm run test:dev:legacy
 *
 * Bank account write tools and email send tools are excluded unless explicitly enabled.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { requireEnvFlag, requireTestConnectionEnv, DEFAULT_TEST_SERVER_ENTRY } from "../lib/connection_env.mjs";
import { buildRegistryReport, buildSetupFailedRegistryReport, writeJsonReport, safeJsonForReport } from "../lib/registry_report.mjs";
import { redactSensitive } from "../lib/redact.mjs";
import { classifyToolForRegression } from "../lib/tool_classification.mjs";
import {
  AUTH_PREFLIGHT_TOOL,
  isUnauthorizedToolResult,
  printAuthFailure,
} from "../lib/auth_preflight.mjs";

requireEnvFlag(
  "BRC_ALLOW_DEV_WRITE_TESTS",
  "Refusing to run write legacy regression. Set BRC_ALLOW_DEV_WRITE_TESTS=true to confirm."
);

const { companyName: COMPANY_NAME } = requireTestConnectionEnv({
  label: "write legacy regression",
});

process.env.BRC_ALLOW_READ_SKILLS ??= "true";
process.env.BRC_ALLOW_UPDATE_SKILLS ??= "true";
process.env.BRC_ALLOW_DELETE_SKILLS ??= "true";
process.env.BRC_ALLOW_EMAIL_SKILLS ??= "true";
process.env.BRC_ALLOW_BATCH_SKILLS ??= "true";
process.env.BRC_ALLOW_DEV_MODE ??= "false";

const ALLOW_BANK_WRITES =
  process.env.BRC_ALLOW_BANK_WRITE_TESTS?.trim().toLowerCase() === "true";
const ALLOW_EMAIL_IN_DEV =
  process.env.BRC_ALLOW_EMAIL_TESTS?.trim().toLowerCase() === "true";

/** Bank write tools — excluded unless BRC_ALLOW_BANK_WRITE_TESTS=true. */
const EXCLUDED_BANK_TOOLS = [
  "brc_get_bank_account",
  "brc_create_bank_account",
  "brc_update_bank_account",
  "brc_delete_bank_account",
  "brc_batch_bank_accounts",
];

/** Email send tools — use test:email:legacy unless BRC_ALLOW_EMAIL_TESTS=true. */
const EXCLUDED_EMAIL_TOOLS = [
  "brc_send_sales_invoice_email",
  "brc_send_email_statement",
  "brc_send_quote_email",
];

const ALL_EXCLUDED_TOOLS = [
  ...(ALLOW_BANK_WRITES ? [] : EXCLUDED_BANK_TOOLS),
  ...(ALLOW_EMAIL_IN_DEV ? [] : EXCLUDED_EMAIL_TOOLS),
];

const EXCLUDED_TOOLS_NOTE =
  "Bank account write tools and email send tools are excluded unless BRC_ALLOW_BANK_WRITE_TESTS / BRC_ALLOW_EMAIL_TESTS are true.";

function recordExcluded(tool, details = EXCLUDED_TOOLS_NOTE) {
  results.push({
    tool,
    status: "SKIPPED",
    args: null,
    details,
  });
  console.log(`- ${tool}: SKIPPED`);
}

const SERVER_ENTRY = process.env.BRC_MCP_SERVER_ENTRY || DEFAULT_TEST_SERVER_ENTRY;
const MANUAL_TEST_DATE = process.env.BRC_TEST_DATE || "";

const stamp = Date.now().toString().slice(-7);
const TEST_MARKER = `MCP TEST DEMO LD ${stamp}`;
const today = new Date().toISOString().slice(0, 10);

function isFinancialYearOld(dateInfo) {
  if (!dateInfo?.end) return false;

  const todayOnly = new Date().toISOString().slice(0, 10);
  return dateInfo.end < todayOnly;
}

function markerText(label) {
  return `${TEST_MARKER} - ${label}`;
}

const child = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: process.cwd(),
  env: process.env,
});

let nextId = 1;
let buffer = "";
const pending = new Map();
const results = [];
const created = {};
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
      // Ignore non-JSON stdout lines from the server.
    }
  }
});

function req(method, params = {}, timeoutMs = 45000) {
  const id = nextId++;

  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }) + "\n"
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
  return req(
    "tools/call",
    {
      name,
      arguments: args,
    },
    timeoutMs
  );
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

function hasNeedle(x, needle) {
  return JSON.stringify(x || {})
    .toLowerCase()
    .includes(String(needle).toLowerCase());
}

function firstBy(items, predicate) {
  return items.find(predicate) || items[0];
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function cashReceiptVatUnsupported(details) {
  const text = JSON.stringify(details || {}).toLowerCase();
  return (
    text.includes("vat on cash") ||
    text.includes("vat entries have to be attached")
  );
}

function buildCashReceiptVatPayload({
  stamp,
  testDate,
  cashReceiptCat,
  salesVat,
}) {
  const cashReceiptNet = 5;
  const cashReceiptVatPct = Number(salesVat?.percentage ?? 23);
  const cashReceiptVat = round2((cashReceiptNet * cashReceiptVatPct) / 100);
  const cashReceiptTotal = round2(cashReceiptNet + cashReceiptVat);

  return {
    id: 0,
    bookTranTypeId: 1,
    note: markerText("Cash Receipt"),
    entryDate: testDate,
    procDate: testDate,
    reference: `LDCR${stamp}`,
    total: cashReceiptTotal,
    totalNet: cashReceiptNet,
    totalVAT: cashReceiptVat,
    totalVat: cashReceiptVat,
    vatTypeId: 1,
    ledger: 0,
    unallocated: 0,
    customFields: [],
    detailCollection: [markerText("Cash Receipt")],
    acEntries: [
      {
        id: 0,
        accountCode: cashReceiptCat?.accountCode,
        analysisCategoryId: cashReceiptCat?.id,
        description: markerText("Cash receipt VAT split line"),
        value: cashReceiptTotal,
      },
    ],
    vatEntries: [
      {
        id: 0,
        vatRateId: salesVat?.id,
        percentage: cashReceiptVatPct,
        amount: cashReceiptTotal,
        vatAmount: cashReceiptVat,
        netAmount: cashReceiptNet,
      },
    ],
  };
}

function buildCashReceiptLedgerPayload({ stamp, testDate, customer }) {
  const total = 10;

  return {
    id: 0,
    bookTranTypeId: 1,
    note: markerText("Cash Receipt"),
    entryDate: testDate,
    procDate: testDate,
    reference: `LDCR${stamp}`,
    total,
    customerId: customer?.id,
    acCode: customer?.code,
    ledger: total,
    unallocated: 0,
    customFields: [],
    detailCollection: [markerText("Cash Receipt")],
    acEntries: [],
    vatEntries: [],
  };
}

async function runCashReceiptCreate({
  cashReceiptCat,
  salesVat,
  customer,
  testDate,
  skip,
  skipReason,
}) {
  if (skip) {
    results.push({
      tool: "brc_create_cash_receipt",
      status: "SKIPPED",
      args: { companyName: COMPANY_NAME },
      details: skipReason || "Skipped",
    });
    console.log("- brc_create_cash_receipt: SKIPPED");
    return { ok: false, payload: null };
  }

  const vatPayload = buildCashReceiptVatPayload({
    stamp,
    testDate,
    cashReceiptCat,
    salesVat,
  });
  const ledgerPayload = buildCashReceiptLedgerPayload({
    stamp,
    testDate,
    customer,
  });

  let mode = "vat-split";
  let payload = vatPayload;

  try {
    let raw = await call("brc_create_cash_receipt", {
      companyName: COMPANY_NAME,
      payload: vatPayload,
    });
    let data = parsed(raw);
    let status = isFail(raw, data) ? "FAIL" : "PASS";

    if (status === "FAIL" && cashReceiptVatUnsupported(data)) {
      mode = "ledger-fallback";
      payload = ledgerPayload;
      raw = await call("brc_create_cash_receipt", {
        companyName: COMPANY_NAME,
        payload: ledgerPayload,
      });
      data = parsed(raw);
      status = isFail(raw, data) ? "FAIL" : "PASS";
    }

    results.push({
      tool: "brc_create_cash_receipt",
      status,
      args: { companyName: COMPANY_NAME, mode },
      details: data,
    });
    console.log(`- brc_create_cash_receipt: ${status} (${mode})`);

    return { ok: status === "PASS", payload };
  } catch (e) {
    results.push({
      tool: "brc_create_cash_receipt",
      status: "FAIL",
      args: { companyName: COMPANY_NAME, mode },
      details: { message: e.message || String(e) },
    });
    console.log("- brc_create_cash_receipt: FAIL");
    return { ok: false, payload: null };
  }
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

    results.push({
      tool: name,
      status,
      args,
      details: d,
    });

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

async function list(name, pageSize = 200) {
  const r = await run(name, {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize,
  });

  return arr(r.data);
}

async function findIdFromList(listTool, predicate) {
  const items = await list(listTool, 300);
  const found = items.find(predicate);
  return idOf(found);
}

/**
 * Date helpers
 */

function toDateOnly(value) {
  if (!value) return null;

  const s = String(value);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);

  return m ? m[0] : null;
}

function addDays(dateOnly, days) {
  const d = new Date(`${dateOnly}T00:00:00Z`);

  if (Number.isNaN(d.getTime())) return null;

  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isDateOnlyInRange(dateOnly, startOnly, endOnly) {
  if (!dateOnly || !startOnly || !endOnly) return false;
  return dateOnly >= startOnly && dateOnly <= endOnly;
}

function collectDateCandidates(obj, path = []) {
  const out = [];

  if (!obj || typeof obj !== "object") return out;

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      out.push(...collectDateCandidates(v, [...path, String(i)]));
    });
    return out;
  }

  for (const [key, value] of Object.entries(obj)) {
    const nextPath = [...path, key];

    if (typeof value === "string" || typeof value === "number") {
      const date = toDateOnly(value);
      if (date) {
        out.push({
          key,
          path: nextPath.join("."),
          date,
        });
      }
    } else if (value && typeof value === "object") {
      out.push(...collectDateCandidates(value, nextPath));
    }
  }

  return out;
}

function scoreDateCandidate(candidate, kind) {
  const p = `${candidate.path}.${candidate.key}`.toLowerCase();
  let score = 0;

  if (p.includes("financial")) score += 8;
  if (p.includes("fyear") || p.includes("fy") || p.includes("year")) score += 6;
  if (p.includes("period")) score += 4;

  if (kind === "start") {
    if (p.includes("start")) score += 10;
    if (p.includes("from")) score += 8;
    if (p.includes("begin")) score += 6;
  } else {
    if (p.includes("end")) score += 10;
    if (p.includes("to")) score += 8;
    if (p.includes("finish")) score += 6;
  }

  if (
    p.includes("created") ||
    p.includes("updated") ||
    p.includes("modified")
  ) {
    score -= 20;
  }

  return score;
}

function findBestFinancialDate(...objects) {
  const candidates = objects.flatMap((obj) => collectDateCandidates(obj));

  const start = [...candidates]
    .map((c) => ({ ...c, score: scoreDateCandidate(c, "start") }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  const end = [...candidates]
    .map((c) => ({ ...c, score: scoreDateCandidate(c, "end") }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  return {
    start: start?.date || null,
    end: end?.date || null,
    startSource: start?.path || null,
    endSource: end?.path || null,
  };
}

function findNumberByLikelyKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return null;

  for (const [key, value] of Object.entries(obj)) {
    if (keys.includes(key) && Number(value)) return Number(value);

    if (value && typeof value === "object") {
      const found = findNumberByLikelyKeys(value, keys);
      if (found) return found;
    }
  }

  return null;
}

function deriveFinancialYearFromMonthYear(financialYearData, setupData) {
  const sources = [financialYearData, setupData];

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const startMonth =
      findNumberByLikelyKeys(source, [
        "startMonth",
        "firstMonth",
        "financialYearStartMonth",
        "fYearStartMonth",
      ]) || null;

    const startYear =
      findNumberByLikelyKeys(source, [
        "startYear",
        "financialYearStartYear",
        "fYearStartYear",
      ]) || null;

    if (startMonth >= 1 && startMonth <= 12 && startYear > 1900) {
      const start = `${startYear}-${pad2(startMonth)}-01`;

      const endMonth = startMonth === 1 ? 12 : startMonth - 1;
      const endYear = startMonth === 1 ? startYear : startYear + 1;
      const endDay = lastDayOfMonth(endYear, endMonth);
      const end = `${endYear}-${pad2(endMonth)}-${pad2(endDay)}`;

      return {
        start,
        end,
        startSource: "startYear/startMonth",
        endSource: "derived-from-startYear/startMonth",
      };
    }
  }

  return null;
}

function pickSafeTransactionDate(financialYearData, setupData) {
  if (MANUAL_TEST_DATE) {
    return {
      testDate: MANUAL_TEST_DATE,
      start: null,
      end: null,
      startSource: "BRC_TEST_DATE",
      endSource: null,
      method: "manual-env-override",
    };
  }

  const monthYearDerived = deriveFinancialYearFromMonthYear(
    financialYearData,
    setupData
  );

  if (monthYearDerived?.start) {
    const candidate =
      addDays(monthYearDerived.start, 10) || monthYearDerived.start;

    return {
      testDate: candidate,
      start: monthYearDerived.start,
      end: monthYearDerived.end,
      startSource: monthYearDerived.startSource,
      endSource: monthYearDerived.endSource,
      method: "derived-from-start-month-and-year",
    };
  }

  const { start, end, startSource, endSource } = findBestFinancialDate(
    financialYearData,
    setupData
  );

  if (start) {
    const candidate = addDays(start, 10) || start;

    if (!end || isDateOnlyInRange(candidate, start, end)) {
      return {
        testDate: candidate,
        start,
        end,
        startSource,
        endSource,
        method: "financial-year-start-plus-10-days",
      };
    }

    return {
      testDate: start,
      start,
      end,
      startSource,
      endSource,
      method: "financial-year-start",
    };
  }

  throw new Error(
    "Could not determine a safe transaction date from brc_get_financial_year/brc_get_company_setup_config. " +
      "Set BRC_TEST_DATE manually to a date inside the company's current financial year."
  );
}

/**
 * VAT safety test
 */

async function runVatProcessSafetyTests() {
  const name = "brc_process_vat_category_rates";

  if (!tools.has(name)) {
    results.push({
      tool: name,
      status: "MISSING",
      args: null,
      details: "Tool not registered",
    });
    console.log(`- ${name}: MISSING`);
    return;
  }

  const expectedA = "effectiveDate alone is not a valid BRC payload";
  const expectedB = "Set confirmProcess: true to run it";

  try {
    const rA = await call(name, {
      companyName: COMPANY_NAME,
      effectiveDate: today,
    });

    const tA = toolText(rA);

    const rB = await call(name, {
      companyName: COMPANY_NAME,
      vatCategoryRates: [
        {
          vatCategoryId: 1,
          vatRates: [
            {
              id: 0,
              percentage: 30,
              orderIndex: 0,
              isActive: true,
              isDefault: false,
              vatCategoryId: 1,
            },
          ],
        },
      ],
      confirmProcess: false,
    });

    const tB = toolText(rB);

    const passA = tA.includes(expectedA);
    const passB = tB.includes(expectedB);
    const status = passA && passB ? "PASS" : "FAIL";

    results.push({
      tool: name,
      status,
      args: {
        safetyTests: ["effectiveDate-only", "confirmProcess-false"],
      },
      details: {
        passA,
        passB,
        responseA: tA,
        responseB: tB,
        note: "Safety-validation only; confirmProcess:true was not used.",
      },
    });

    console.log(`- ${name}: ${status}`);
  } catch (e) {
    results.push({
      tool: name,
      status: "FAIL",
      args: {
        safetyTests: ["effectiveDate-only", "confirmProcess-false"],
      },
      details: {
        message: e.message || String(e),
      },
    });

    console.log(`- ${name}: FAIL`);
  }
}

/**
 * Batch quote payload
 */

function buildFullBatchQuoteItem(
  stamp,
  customer,
  product,
  rep,
  salesCat,
  salesVat,
  companyId,
  entryDate
) {
  const net = 10;
  const pct = salesVat?.percentage ?? 23;
  const vat = Math.round(((net * pct) / 100) * 100) / 100;
  const total = Math.round((net + vat) * 100) / 100;

  return {
    opCode: 1,
    item: {
      companyId,
      customerOwnerId: customer?.id,
      vatTypeId: 1,
      saleRepId: rep?.id,
      saleRepCode: rep?.code,
      saleInvoiceId: null,
      entryDate,
      procDate: entryDate,
      closedDate: null,
      reference: `LDBQ${stamp}`,
      poNumber: `LDBQ${stamp}`,
      ddNumber: `LDBQ${stamp}`,
      customerOwnerName: customer?.name,
      deliveryList: markerText("Batch quote delivery"),
      comments: markerText("Batch quote"),
      layoutType: 1,
      total,
      totalVat: vat,
      totalNet: net,
      note: markerText("Batch quote note"),
      acCode: customer?.code,
      productTrans: [
        {
          id: 0,
          companyId,
          percentage: pct,
          vatRateId: salesVat?.id,
          productId: product?.id,
          productCode: product?.stockCode || product?.code,
          quantity: 1,
          unitPrice: net,
          amount: total,
          vatAmount: vat,
          tranNotes: [markerText("Batch quote line")],
          acEntries: [
            {
              id: 0,
              companyId,
              accountCode: salesCat?.accountCode,
              analysisCategoryId: salesCat?.id,
              quoteProductTranId: 0,
              value: net,
            },
          ],
          vatAnalysisTypeId: 0,
        },
      ],
      deliveryTo: [markerText("Batch quote delivery")],
      customFields: [],
    },
  };
}

/**
 * Cleanup helpers
 */

const cleanupTargets = [
  ["brc_list_sales_credit_notes", "brc_delete_sales_credit_note", "sales credit notes"],
  ["brc_list_sales_invoices", "brc_delete_sales_invoice", "sales invoices"],
  ["brc_list_quotes", "brc_delete_quote", "quotes"],
  ["brc_list_sales_entries", "brc_delete_sales_entry", "sales entries"],
  ["brc_list_purchases", "brc_delete_purchase", "purchases"],
  ["brc_list_cash_receipts", "brc_delete_cash_receipt", "cash receipts"],
  ["brc_list_cash_payments", "brc_delete_cash_payment", "cash payments"],
  ["brc_list_payments", "brc_delete_payment", "payments"],
  ["brc_list_sales_reps", "brc_delete_sales_rep", "sales reps"],
  ["brc_list_suppliers", "brc_delete_supplier", "suppliers"],
  ["brc_list_products", "brc_delete_product", "products"],
  ["brc_list_customers", "brc_delete_customer", "customers"],
];

async function findRemainingTestData() {
  const remaining = [];

  for (const [listTool, , label] of cleanupTargets) {
    if (!tools.has(listTool)) continue;

    try {
      const result = await call(listTool, {
        companyName: COMPANY_NAME,
        page: 1,
        pageSize: 500,
      });

      const data = parsed(result);
      const items = arr(data);
      const matches = items.filter((item) => hasNeedle(item, TEST_MARKER));

      for (const match of matches) {
        remaining.push({
          area: label,
          listTool,
          id: idOf(match),
          match,
        });
      }
    } catch (error) {
      remaining.push({
        area: label,
        listTool,
        error: error.message || String(error),
      });
    }
  }

  return remaining;
}

async function cleanupRemainingByMarker() {
  for (let pass = 1; pass <= 3; pass++) {
    const remaining = await findRemainingTestData();

    if (remaining.length === 0) {
      console.log(`Cleanup pass ${pass}: no marker records found.`);
      return [];
    }

    console.log(
      `Cleanup pass ${pass}: found ${remaining.length} marker record(s), attempting deletion.`
    );

    for (const item of remaining) {
      const target = cleanupTargets.find(([listTool]) => listTool === item.listTool);

      if (!target || !item.id) continue;

      const [, deleteTool] = target;

      await run(
        deleteTool,
        {
          companyName: COMPANY_NAME,
          id: item.id,
          confirmDelete: true,
        },
        {
          timeoutMs: 120000,
        }
      );
    }
  }

  return findRemainingTestData();
}

/**
 * Main
 */

async function main() {
  console.log("Starting BRC MCP full coverage test...");
  console.log(`Company: ${COMPANY_NAME}`);
  console.log(`Test marker: ${TEST_MARKER}`);
  console.log(`Server entry: ${SERVER_ENTRY}`);
  console.log(
    "WARNING: This test creates temporary records in BRC and attempts to delete them during cleanup."
  );
  console.log(
    "After the run, search BRC for the marker above to confirm no records remain."
  );

  await req("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "brc-full-coverage-test",
      version: "3.2.0",
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

  console.log(`Loaded ${tools.size} tools.\n`);

  console.log("=== Excluded from test (bank account writes and email) ===");
  console.log("Bank account write tools:");
  for (const tool of EXCLUDED_BANK_TOOLS) {
    console.log(`- ${tool}`);
  }
  console.log("Email send tools:");
  for (const tool of EXCLUDED_EMAIL_TOOLS) {
    console.log(`- ${tool}`);
  }
  console.log(`Note: ${EXCLUDED_TOOLS_NOTE}\n`);

  console.log("=== Context ===");
  const contextsResult = await run("brc_list_company_contexts", {});
  const contextCompanies = arr(contextsResult.data?.companies ?? contextsResult.data);
  const connected = contextCompanies.some(
    (entry) =>
      String(entry?.companyName || entry?.name || "")
        .trim()
        .toLowerCase() === COMPANY_NAME.trim().toLowerCase() &&
      entry?.connected !== false
  );

  if (!connected) {
    console.error(
      `Company "${COMPANY_NAME}" is not connected. Set BRC_TEST_COMPANY and BRC_TEST_API_KEY — credentials are never logged.`
    );
    child.kill();
    process.exit(1);
  }

  console.log("\n=== Auth preflight ===");
  const preflightRaw = await call(AUTH_PREFLIGHT_TOOL, {
    companyName: COMPANY_NAME,
  });
  const preflightData = parsed(preflightRaw);
  const preflightText = toolText(preflightRaw);

  if (isUnauthorizedToolResult(preflightRaw, preflightData, preflightText)) {
    printAuthFailure(COMPANY_NAME);

    const allToolNames = [...tools].sort();
    const report = buildSetupFailedRegistryReport(
      allToolNames,
      [
        {
          tool: AUTH_PREFLIGHT_TOOL,
          status: "FAIL",
          args: { companyName: COMPANY_NAME },
          details: preflightData,
        },
      ],
      "unauthorized",
      { allowBankWrites: ALLOW_BANK_WRITES }
    );

    const summary = [
      "BRC MCP WRITE LEGACY REGRESSION SUMMARY",
      "=======================================",
      `Company: ${COMPANY_NAME}`,
      `Registered tools: ${report.classified.length}`,
      `Setup: setup_failed (unauthorized)`,
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
    ].join("\n");

    writeJsonReport("./reports/dev_test_results.json", {
      companyName: COMPANY_NAME,
      registeredTools: report.classified.length,
      categoryCounts: report.categoryCounts,
      statusCounts: report.statusCounts,
      setup: report.setup,
      classifiedTools: report.classified,
    });
    fs.writeFileSync("./reports/dev_test_summary.txt", summary);
    console.log("\n" + summary);

    child.kill();
    process.exit(1);
  }

  console.log(`- ${AUTH_PREFLIGHT_TOOL}: PASS`);

  await run("brc_list_company_contexts", {});

  console.log("\n=== Lookup tools ===");
  const lookupTools = [
    "brc_list_customers",
    "brc_list_customers_without_dormant",
    "brc_list_products",
    "brc_list_products_without_dormant",
    "brc_list_product_types",
    "brc_list_suppliers",
    "brc_list_sales_reps",
    "brc_list_sales_entries",
    "brc_list_sales_invoices",
    "brc_list_sales_credit_notes",
    "brc_list_purchases",
    "brc_list_quotes",
    "brc_list_cash_receipts",
    "brc_list_payments",
    "brc_list_cash_payments",
    "brc_list_bank_accounts",
    "brc_list_accounts",
    "brc_list_analysis_categories",
    "brc_list_category_types",
    "brc_list_owner_type_groups",
    "brc_list_owner_types",
    "brc_list_user_defined_fields",
    "brc_list_book_tran_types",
    "brc_list_vat_rates",
    "brc_list_vat_analysis_types",
    "brc_list_vat_categories",
    "brc_list_vat_types",
    "brc_get_company_options",
    "brc_get_company_setup_config",
    "brc_get_financial_year",
    "brc_list_company_settings",
    "brc_list_sales",
  ];

  for (const tool of lookupTools) {
    await run(tool, { companyName: COMPANY_NAME });
  }

  console.log("\n=== Nominal account tools ===");
  const nominalListResult = await run("brc_list_nominal_accounts", {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize: 20,
  });

  const nominalItems = arr(nominalListResult.data);
  const nominalSales =
    nominalItems.find((x) => String(x?.code) === "000") || nominalItems[0];
  const nominalId = String(nominalSales?.id || "");

  await run(
    "brc_get_nominal_account_ledger_by_id",
    {
      companyName: COMPANY_NAME,
      id: nominalId,
    },
    {
      skip: !nominalId,
      reason: "No nominal account id found",
    }
  );

  await run(
    "brc_get_nom_ac_ledger_by_ids",
    {
      companyName: COMPANY_NAME,
      ids: String(nominalId),
    },
    {
      skip: !nominalId,
      reason: "No nominal account id found",
    }
  );

  await run("brc_grouped_nominal_accounts_report", {
    companyName: COMPANY_NAME,
  });

  await run("brc_multi_company_nom_ac_report", {
    companyNames: [COMPANY_NAME],
  });

  await run(
    "brc_get_company_logo",
    {
      companyName: COMPANY_NAME,
    },
    {
      skip: true,
      reason: "Optional; this company may not have a logo configured.",
    }
  );

  await runVatProcessSafetyTests();

  console.log("\n=== Financial year date selection ===");
  const financialYearForDate = await run("brc_get_financial_year", {
    companyName: COMPANY_NAME,
  });

  const setupConfigForDate = await run("brc_get_company_setup_config", {
    companyName: COMPANY_NAME,
  });

  const dateInfo = pickSafeTransactionDate(
    financialYearForDate.data,
    setupConfigForDate.data
  );

  const testDate = dateInfo.testDate;

  console.log(
    `Using transaction date ${testDate} for ${COMPANY_NAME} ` +
      `(${dateInfo.method}; start=${dateInfo.start || "unknown"}, ` +
      `end=${dateInfo.end || "unknown"}).`
  );

  console.log("\n=== Deployment and audit tools ===");
  await run("brc_getting_started", {});
  await run("brc_get_deployment_policy", {});
  await run("brc_get_company_api_key_status", { companyName: COMPANY_NAME });
  await run("brc_get_company_api_key_status", {});
  await run("brc_validate_transaction_date", {
    companyName: COMPANY_NAME,
    transactionDate: testDate,
  });
  await run("brc_company_readiness_check", {
    companyName: COMPANY_NAME,
  });
  await run("brc_list_audit_log", {});

  console.log("\n=== Reference data for write tests ===");

  const customers = await list("brc_list_customers");
  const products = await list("brc_list_products");
  const suppliers = await list("brc_list_suppliers");
  const reps = await list("brc_list_sales_reps");
  const banks = await list("brc_list_bank_accounts");
  const cats = await list("brc_list_analysis_categories");
  const vatRates = await list("brc_list_vat_rates");

  const customer = firstBy(customers, (x) => x?.id && x?.code);
  const product = firstBy(products, (x) => x?.id && (x?.stockCode || x?.code));
  const supplier = firstBy(suppliers, (x) => x?.id && x?.code);
  const rep = firstBy(reps, (x) => x?.id && x?.code);
  const bank = firstBy(banks, (x) => x?.id && (x?.acCode || x?.code));

  const salesCat =
    firstBy(cats, (x) => x?.accountCode === "SA01") ||
    firstBy(cats, (x) => String(x?.accountCode || "").startsWith("SA"));

  const purchaseCat =
    firstBy(cats, (x) => x?.accountCode === "PU02") ||
    firstBy(cats, (x) => String(x?.accountCode || "").startsWith("PU"));

  const cashPaymentCat =
    firstBy(cats, (x) => x?.accountCode === "CP01") ||
    firstBy(cats, (x) => String(x?.accountCode || "").startsWith("CP"));

  const salesVat =
    firstBy(vatRates, (x) => x?.vatCategoryId === 3 && x?.isDefault) ||
    firstBy(vatRates, (x) => x?.vatCategoryId === 3) ||
    vatRates[0];

  const purchaseVat =
    firstBy(vatRates, (x) => x?.vatCategoryId === 2 && x?.isDefault) ||
    firstBy(vatRates, (x) => x?.vatCategoryId === 2) ||
    vatRates[0];

  const companyId =
    rep?.companyId ||
    customer?.companyId ||
    supplier?.companyId ||
    product?.companyId;

  console.log(`Customer: ${customer?.id || "missing"} ${customer?.code || ""}`);
  console.log(
    `Product: ${product?.id || "missing"} ${
      product?.stockCode || product?.code || ""
    }`
  );
  console.log(`Supplier: ${supplier?.id || "missing"} ${supplier?.code || ""}`);
  console.log(`Sales rep: ${rep?.id || "missing"} ${rep?.code || ""}`);
  console.log(
    `Bank: ${bank?.id || "missing"} ${bank?.acCode || bank?.code || ""}`
  );
  console.log(
    `Sales category: ${salesCat?.id || "missing"} ${
      salesCat?.accountCode || ""
    }`
  );
  console.log(
    `Purchase category: ${purchaseCat?.id || "missing"} ${
      purchaseCat?.accountCode || ""
    }`
  );
  console.log(`Sales VAT: ${salesVat?.id || "missing"} ${salesVat?.percentage ?? ""}`);
  console.log(
    `Purchase VAT: ${purchaseVat?.id || "missing"} ${purchaseVat?.percentage ?? ""}`
  );

  console.log("\n=== Customer CRUD ===");

  const customerPayload = {
    code: `LD${stamp}`,
    name: markerText("Customer"),
    email: `mcp.test.demo.ld.customer.${stamp}@example.com`,
    phone: "0890000000",
    address: [markerText("Customer address")],
    vatType: 1,
  };

  await run("brc_create_customer", {
    companyName: COMPANY_NAME,
    payload: customerPayload,
  });

  created.customerId = await findIdFromList("brc_list_customers", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_customer",
    {
      companyName: COMPANY_NAME,
      id: created.customerId,
    },
    {
      skip: !created.customerId,
      reason: "No created customer id found",
    }
  );

  await run(
    "brc_update_customer",
    {
      companyName: COMPANY_NAME,
      id: created.customerId,
      updates: {
        name: markerText("Updated Customer"),
      },
    },
    {
      skip: !created.customerId,
      reason: "No created customer id found",
    }
  );

  console.log("\n=== Product CRUD ===");

  const productPayload = {
    code: `LDPR${stamp}`,
    details: markerText("Product"),
    unitPrice: 22,
    productTypeId: 4,
    vatRateId: salesVat?.id,
    vatAnalysisTypeId: 1,
    hasDefaultVatRate: true,
  };

  await run(
    "brc_create_product",
    {
      companyName: COMPANY_NAME,
      payload: productPayload,
    },
    {
      skip: !salesVat,
      reason: "Missing VAT rate for product",
    }
  );

  created.productId = await findIdFromList("brc_list_products", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_product",
    {
      companyName: COMPANY_NAME,
      id: created.productId,
    },
    {
      skip: !created.productId,
      reason: "No created product id found",
    }
  );

  await run(
    "brc_update_product",
    {
      companyName: COMPANY_NAME,
      id: created.productId,
      updates: {
        details: [markerText("Updated Product")],
        unitPrice: 25,
      },
    },
    {
      skip: !created.productId,
      reason: "No created product id found",
    }
  );

  console.log("\n=== Supplier CRUD ===");

  const supplierPayload = {
    code: `LDS${stamp}`,
    name: markerText("Supplier"),
    email: `mcp.test.demo.ld.supplier.${stamp}@example.com`,
    phone: "0890000001",
    address: [markerText("Supplier address")],
    vatType: 1,
  };

  await run("brc_create_supplier", {
    companyName: COMPANY_NAME,
    payload: supplierPayload,
  });

  created.supplierId = await findIdFromList("brc_list_suppliers", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_supplier",
    {
      companyName: COMPANY_NAME,
      id: created.supplierId,
    },
    {
      skip: !created.supplierId,
      reason: "No created supplier id found",
    }
  );

  await run(
    "brc_update_supplier",
    {
      companyName: COMPANY_NAME,
      id: created.supplierId,
      payload: {
        name: markerText("Updated Supplier"),
      },
    },
    {
      skip: !created.supplierId,
      reason: "No created supplier id found",
    }
  );

  console.log("\n=== Sales rep CRUD ===");

  await run("brc_create_sales_rep", {
    companyName: COMPANY_NAME,
    code: `LDR${stamp}`,
    name: markerText("Sales Rep"),
  });

  created.salesRepId = await findIdFromList("brc_list_sales_reps", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_sales_rep",
    {
      companyName: COMPANY_NAME,
      id: created.salesRepId,
    },
    {
      skip: !created.salesRepId,
      reason: "No created sales rep id found",
    }
  );

  await run(
    "brc_update_sales_rep",
    {
      companyName: COMPANY_NAME,
      id: String(created.salesRepId),
      name: markerText("Updated Sales Rep"),
    },
    {
      skip: !created.salesRepId,
      reason: "No created sales rep id found",
    }
  );

  console.log("\n=== Payment / cash tools ===");

  const paymentBase = {
    note: markerText("Payment"),
    entryDate: testDate,
    procDate: testDate,
    total: 12,
    bankAccountId: bank?.id,
    bankAccountCode: bank?.acCode || bank?.code,
    supplierId: supplier?.id,
    acCode: supplier?.code,
  };

  await run(
    "brc_create_payment",
    {
      companyName: COMPANY_NAME,
      ...paymentBase,
    },
    {
      skip: !bank?.id || !supplier?.id,
      reason: "Missing bank account or supplier for payment",
    }
  );

  created.paymentId = await findIdFromList("brc_list_payments", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_payment",
    {
      companyName: COMPANY_NAME,
      id: created.paymentId,
    },
    {
      skip: !created.paymentId,
      reason: "No created payment id found",
    }
  );

  await run(
    "brc_update_payment",
    {
      companyName: COMPANY_NAME,
      id: created.paymentId,
      updates: {
        note: markerText("Updated Payment"),
      },
    },
    {
      skip: !created.paymentId,
      reason: "No created payment id found",
    }
  );

  const cashPayBase = {
    note: markerText("Cash Payment"),
    entryDate: testDate,
    procDate: testDate,
    total: 12,
    analysisCategoryId: cashPaymentCat?.id,
    accountCode: cashPaymentCat?.accountCode,
    description: markerText("Cash expense"),
  };

  await run(
    "brc_create_cash_payment",
    {
      companyName: COMPANY_NAME,
      ...cashPayBase,
    },
    {
      skip: !cashPaymentCat,
      reason: "Missing cash payment category",
    }
  );

  created.cashPaymentId = await findIdFromList("brc_list_cash_payments", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_cash_payment",
    {
      companyName: COMPANY_NAME,
      id: created.cashPaymentId,
    },
    {
      skip: !created.cashPaymentId,
      reason: "No created cash payment id found",
    }
  );

  await run(
    "brc_update_cash_payment",
    {
      companyName: COMPANY_NAME,
      id: created.cashPaymentId,
      updates: {
        note: markerText("Updated Cash Payment"),
      },
    },
    {
      skip: !created.cashPaymentId,
      reason: "No created cash payment id found",
    }
  );
  const cashReceiptCat =
    firstBy(cats, (x) => String(x?.accountCode || "").startsWith("CR")) ||
    firstBy(cats, (x) =>
      String(x?.description || "").toLowerCase().includes("cash receipt")
    ) ||
    salesCat;

  const cashReceiptCreate = await runCashReceiptCreate({
    cashReceiptCat,
    salesVat,
    customer,
    testDate,
    skip: !cashReceiptCat || !customer?.id,
    skipReason: "Missing cash receipt category or customer for ledger fallback",
  });

  const cashReceiptPayload = cashReceiptCreate.payload;

  created.cashReceiptId = cashReceiptCreate.ok
    ? await findIdFromList("brc_list_cash_receipts", (x) =>
        hasNeedle(x, TEST_MARKER) || hasNeedle(x, `LDCR${stamp}`)
      )
    : null;

  await run(
    "brc_get_cash_receipt",
    {
      companyName: COMPANY_NAME,
      id: created.cashReceiptId,
    },
    {
      skip: !created.cashReceiptId,
      reason: "No created cash receipt id found",
    }
  );

  await run(
    "brc_update_cash_receipt",
    {
      companyName: COMPANY_NAME,
      id: created.cashReceiptId,
      updates: {
        note: markerText("Updated Cash Receipt"),
      },
    },
    {
      skip: !created.cashReceiptId,
      reason: "No created cash receipt id found",
    }
  );

  console.log("\n=== Purchase / sales entry ===");
  const purchaseArgs = {
    supplierId: String(supplier?.id),
    acCode: supplier?.code,
    note: markerText("Purchase"),
    entryDate: testDate,
    procDate: testDate,
    bookTranTypeId: 4,
    analysisCategoryId: purchaseCat?.id,
    accountCode: purchaseCat?.accountCode,
    description: markerText("Purchase line"),
    netAmount: 10,
    vatRateId: purchaseVat?.id,
    vatPercentage: purchaseVat?.percentage,
    reference: `LDPUR${stamp}`,
  };
  
  const purchaseGenRefArgs = {
    ...purchaseArgs,
    supplierId: supplier?.id,
  };

  await run(
    "brc_create_purchase",
    {
      companyName: COMPANY_NAME,
      ...purchaseArgs,
    },
    {
      skip: !supplier || !purchaseCat || !purchaseVat,
      reason: "Missing purchase reference data",
    }
  );

  await run(
    "brc_create_purchase_gen_ref",
    {
      companyName: COMPANY_NAME,
      ...purchaseGenRefArgs,
      note: markerText("Purchase Gen Ref"),
    },
    {
      skip: !supplier || !purchaseCat || !purchaseVat,
      reason: "Missing purchase reference data",
    }
  );

  created.purchaseId = await findIdFromList("brc_list_purchases", (x) =>
    hasNeedle(x, TEST_MARKER) || hasNeedle(x, `LDPUR${stamp}`)
  );

  await run(
    "brc_get_purchase",
    {
      companyName: COMPANY_NAME,
      id: created.purchaseId,
    },
    {
      skip: !created.purchaseId,
      reason: "No purchase id found",
    }
  );

  await run(
    "brc_update_purchase",
    {
      companyName: COMPANY_NAME,
      id: created.purchaseId,
      note: markerText("Updated Purchase"),
    },
    {
      skip: !created.purchaseId,
      reason: "No purchase id found",
    }
  );

  const salesArgs = {
    customerId: customer?.id,
    acCode: customer?.code,
    note: markerText("Sales Entry"),
    entryDate: testDate,
    procDate: testDate,
    bookTranTypeId: 5,
    analysisCategoryId: salesCat?.id,
    accountCode: salesCat?.accountCode,
    description: markerText("Sales line"),
    netAmount: 10,
    vatRateId: salesVat?.id,
    vatPercentage: salesVat?.percentage,
  };

  await run(
    "brc_create_sales_entry",
    {
      companyName: COMPANY_NAME,
      ...salesArgs,
    },
    {
      skip: !customer || !salesCat || !salesVat,
      reason: "Missing sales reference data",
    }
  );

  created.salesEntryId = await findIdFromList("brc_list_sales_entries", (x) =>
    hasNeedle(x, TEST_MARKER)
  );

  await run(
    "brc_get_sales_entry",
    {
      companyName: COMPANY_NAME,
      id: created.salesEntryId,
    },
    {
      skip: !created.salesEntryId,
      reason: "No sales entry id found",
    }
  );

  await run(
    "brc_update_sales_entry",
    {
      companyName: COMPANY_NAME,
      id: created.salesEntryId,
      note: markerText("Updated Sales Entry"),
    },
    {
      skip: !created.salesEntryId,
      reason: "No sales entry id found",
    }
  );

  console.log("\n=== Quote / invoice / credit note ===");

  const quoteArgs = {
    companyId,
    customerOwnerId: customer?.id,
    acCode: customer?.code,
    customerOwnerName: customer?.name,
    comments: `Invoice generation quote ${stamp}`,
    entryDate: testDate,
    procDate: testDate,
    saleRepId: rep?.id,
    saleRepCode: rep?.code,
    productId: product?.id,
    productCode: product?.stockCode || product?.code,
    quantity: 1,
    unitPrice: 10,
    vatRateId: salesVat?.id,
    vatPercentage: salesVat?.percentage,
    tranNote: `Invoice generation quote line ${stamp}`,
    analysisCategoryId: salesCat?.id,
    accountCode: salesCat?.accountCode,
  };

  await run(
    "brc_create_quote",
    {
      companyName: COMPANY_NAME,
      ...quoteArgs,
      reference: `LDQ${stamp}`,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing quote reference data",
    }
  );

  await run(
    "brc_create_quote_gen_ref",
    {
      companyName: COMPANY_NAME,
      ...quoteArgs,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing quote reference data",
    }
  );

  created.quoteId = await findIdFromList("brc_list_quotes", (x) =>
    hasNeedle(x, `LDQ${stamp}`)
  );

  await run(
    "brc_get_quote",
    {
      companyName: COMPANY_NAME,
      id: created.quoteId,
    },
    {
      skip: !created.quoteId,
      reason: "No quote id found",
    }
  );

  await run(
    "brc_update_quote",
    {
      companyName: COMPANY_NAME,
      id: created.quoteId,
      note: `Updated invoice generation quote ${stamp}`,
    },
    {
      skip: !created.quoteId,
      reason: "No quote id found",
    }
  );

  const deleteQuoteArgs = {
    ...quoteArgs,
    comments: markerText("Delete Test Quote"),
    tranNote: markerText("Delete Test Quote Line"),
  };

  await run(
    "brc_create_quote_gen_ref",
    {
      companyName: COMPANY_NAME,
      ...deleteQuoteArgs,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing quote reference data for delete test",
      timeoutMs: 90000,
    }
  );

  created.deleteQuoteId = await findIdFromList("brc_list_quotes", (x) =>
    hasNeedle(x, markerText("Delete Test Quote"))
  );

  await run(
    "brc_close_quote",
    {
      companyName: COMPANY_NAME,
      id: created.quoteId,
    },
    {
      skip: !created.quoteId,
      reason: "No quote id found",
    }
  );

  await run(
    "brc_reopen_quote",
    {
      companyName: COMPANY_NAME,
      id: created.quoteId,
    },
    {
      skip: !created.quoteId,
      reason: "No quote id found",
    }
  );
  
  const skipQuoteToInvoice =
  !created.quoteId || isFinancialYearOld(dateInfo);

await run(
  "brc_generate_sales_invoice_from_quote",
  {
    companyName: COMPANY_NAME,
    quoteId: created.quoteId,
    entryDate: testDate,
    procDate: testDate,
  },
  {
    skip: skipQuoteToInvoice,
    reason: !created.quoteId
      ? "No quote id found"
      : "Skipped because this BRC endpoint appears to use the company's current/internal transaction date, and this company financial year is historical.",
    timeoutMs: 90000,
  }
);

  const invoiceArgs = {
    ...salesArgs,
    bookTranTypeId: 6,
    productId: product?.id,
    productCode: product?.stockCode || product?.code,
    quantity: 1,
    unitPrice: 10,
    netAmount: 10,
    saleRepId: rep?.id,
    saleRepCode: rep?.code,
    reference: `LDINV${stamp}`,
    note: markerText("Invoice"),
  };

  const createSalesInvoiceResult = await run(
    "brc_create_sales_invoice",
    {
      companyName: COMPANY_NAME,
      ...invoiceArgs,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing invoice reference data",
    }
  );

  const invoiceGenPayload = {
    ...(createSalesInvoiceResult.data?.payloadSent || invoiceArgs),
    reference: `LDIGR${stamp}`,
    note: markerText("Invoice Gen Ref"),
  };
  
  const createSalesInvoiceGenRefResult = await run(
    "brc_create_sales_invoice_gen_ref",
    {
      companyName: COMPANY_NAME,
      payload: invoiceGenPayload,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing invoice gen ref data",
    }
  );
  
  created.salesInvoiceGenRefId = await findIdFromList(
    "brc_list_sales_invoices",
    (x) =>
      hasNeedle(x, `LDIGR${stamp}`) ||
      hasNeedle(x, markerText("Invoice Gen Ref"))
  );
  created.salesInvoiceId = await findIdFromList(
    "brc_list_sales_invoices",
    (x) =>
      hasNeedle(x, `LDINV${stamp}`) ||
      hasNeedle(x, markerText("Invoice"))
  );

  await run(
    "brc_get_sales_invoice",
    {
      companyName: COMPANY_NAME,
      id: created.salesInvoiceId,
    },
    {
      skip: !created.salesInvoiceId,
      reason: "No invoice id found",
    }
  );

  await run(
    "brc_update_sales_invoice",
    {
      companyName: COMPANY_NAME,
      id: created.salesInvoiceId,
      note: markerText("Updated Invoice"),
    },
    {
      skip: !created.salesInvoiceId,
      reason: "No invoice id found",
    }
  );

  const cnArgs = {
    ...invoiceArgs,
    bookTranTypeId: 7,
    reference: `LDCN${stamp}`,
    note: markerText("Credit Note"),
  };

  const createSalesCreditNoteResult = await run(
    "brc_create_sales_credit_note",
    {
      companyName: COMPANY_NAME,
      ...cnArgs,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing credit note reference data",
    }
  );

  const creditNoteGenPayload = {
    ...(createSalesCreditNoteResult.data?.payloadSent || cnArgs),
    reference: `LDCNGR${stamp}`,
    note: markerText("Credit Note Gen Ref"),
  };
  
  const createSalesCreditNoteGenRefResult = await run(
    "brc_create_sales_credit_note_gen_ref",
    {
      companyName: COMPANY_NAME,
      payload: creditNoteGenPayload,
    },
    {
      skip: !customer || !product || !salesCat || !salesVat,
      reason: "Missing credit note gen ref data",
    }
  );
  
  created.salesCreditNoteGenRefId = await findIdFromList(
    "brc_list_sales_credit_notes",
    (x) =>
      hasNeedle(x, `LDCNGR${stamp}`) ||
      hasNeedle(x, markerText("Credit Note Gen Ref"))
  );
  created.salesCreditNoteId = await findIdFromList(
    "brc_list_sales_credit_notes",
    (x) =>
      hasNeedle(x, `LDCN${stamp}`) ||
      hasNeedle(x, markerText("Credit Note"))
  );

  await run(
    "brc_get_sales_credit_note",
    {
      companyName: COMPANY_NAME,
      id: created.salesCreditNoteId,
    },
    {
      skip: !created.salesCreditNoteId,
      reason: "No credit note id found",
    }
  );

  await run(
    "brc_update_sales_credit_note",
    {
      companyName: COMPANY_NAME,
      id: created.salesCreditNoteId,
      note: markerText("Updated Credit Note"),
    },
    {
      skip: !created.salesCreditNoteId,
      reason: "No credit note id found",
    }
  );

  console.log("\n=== Batch tools ===");

  const batchTests = [
    [
      "brc_batch_customers",
      [
        {
          opCode: 1,
          item: {
            code: `LDBC${stamp}`,
            name: markerText("Batch Customer"),
            email: `mcp.test.demo.ld.batch.customer.${stamp}@example.com`,
            phone: "0890000000",
            address: [markerText("Batch Customer Address")],
            vatType: 1,
          },
        },
      ],
    ],
    [
      "brc_batch_products",
      [
        {
          opCode: 1,
          item: {
            code: `LDBP${stamp}`,
            details: markerText("Batch Product"),
            unitPrice: 11,
            productTypeId: 4,
            vatRateId: salesVat?.id,
            vatAnalysisTypeId: 1,
          },
        },
      ],
    ],
    [
      "brc_batch_suppliers",
      [
        {
          opCode: 1,
          item: {
            code: `LDBS${stamp}`,
            name: markerText("Batch Supplier"),
            email: `mcp.test.demo.ld.batch.supplier.${stamp}@example.com`,
            phone: "0890000001",
            vatType: 1,
          },
        },
      ],
    ],
    [
      "brc_batch_sales_reps",
      [
        {
          opCode: 1,
          item: {
            code: `LDBR${stamp}`,
            name: markerText("Batch Sales Rep"),
          },
        },
      ],
    ],
    [
      "brc_batch_cash_receipts",
      cashReceiptPayload
        ? [
            {
              opCode: 1,
              item: {
                ...cashReceiptPayload,
                id: 0,
                note: markerText("Batch Cash Receipt"),
                reference: `LDBCR${stamp}`,
                detailCollection: [markerText("Batch Cash Receipt")],
              },
            },
          ]
        : null,
    ],
    [
      "brc_batch_cash_payments",
      [
        {
          opCode: 1,
          item: {
            ...cashPayBase,
            note: markerText("Batch Cash Payment"),
            total: 10,
            description: markerText("Batch Cash Expense"),
          },
        },
      ],
    ],
    [
      "brc_batch_payments",
      bank?.id && supplier?.id
        ? [
            {
              opCode: 1,
              item: {
                ...paymentBase,
                note: markerText("Batch Payment"),
                total: 10,
              },
            },
          ]
        : null,
    ],
    ["brc_batch_purchases", [{ opCode: 1, item: { ...purchaseArgs, note: markerText("Batch Purchase") } }]],
    ["brc_batch_sales_entries", [{ opCode: 1, item: { ...salesArgs, note: markerText("Batch Sales Entry") } }]],
    ["brc_batch_sales_invoices", [{ opCode: 1, item: { ...invoiceArgs, reference: `LDBINV${stamp}`, note: markerText("Batch Invoice") } }]],
    ["brc_batch_sales_credit_notes", [{ opCode: 1, item: { ...cnArgs, reference: `LDBCN${stamp}`, note: markerText("Batch Credit Note") } }]],
    [
      "brc_batch_quotes",
      [
        buildFullBatchQuoteItem(
          stamp,
          customer,
          product,
          rep,
          salesCat,
          salesVat,
          companyId,
          testDate
        ),
      ],
    ],
  ];

  for (const [tool, items] of batchTests) {
    if (ALL_EXCLUDED_TOOLS.includes(tool)) {
      recordExcluded(tool);
      continue;
    }

    if (!items) {
      results.push({
        tool,
        status: "SKIPPED",
        args: { companyName: COMPANY_NAME },
        details: "Skipped because cash receipt create did not produce a reusable payload",
      });
      console.log(`- ${tool}: SKIPPED`);
      continue;
    }

    const timeoutMs = tool === "brc_batch_quotes" ? 90000 : 45000;

    await run(
      tool,
      {
        companyName: COMPANY_NAME,
        items,
      },
      {
        timeoutMs,
      }
    );
  }

  console.log("\n=== Detail/reference tools ===");

  await run(
    "brc_get_customer_opening_balance",
    {
      companyName: COMPANY_NAME,
      itemId: String(customer?.id),
    },
    {
      skip: !customer,
      reason: "Missing customer",
    }
  );

  await run(
    "brc_list_customer_op_bal_trans",
    {
      companyName: COMPANY_NAME,
      itemId: String(customer?.id),
    },
    {
      skip: !customer,
      reason: "Missing customer",
    }
  );

  await run(
    "brc_list_customer_account_trans",
    {
      companyName: COMPANY_NAME,
      itemId: String(customer?.id),
    },
    {
      skip: !customer,
      reason: "Missing customer",
    }
  );

  await run(
    "brc_list_customer_quotes",
    {
      companyName: COMPANY_NAME,
      itemId: String(customer?.id),
    },
    {
      skip: !customer,
      reason: "Missing customer",
    }
  );

  await run(
    "brc_get_supplier_opening_balance",
    {
      companyName: COMPANY_NAME,
      itemId: String(supplier?.id),
    },
    {
      skip: !supplier,
      reason: "Missing supplier",
    }
  );

  await run(
    "brc_list_supplier_op_bal_trans",
    {
      companyName: COMPANY_NAME,
      itemId: String(supplier?.id),
    },
    {
      skip: !supplier,
      reason: "Missing supplier",
    }
  );

  await run(
    "brc_list_supplier_account_trans",
    {
      companyName: COMPANY_NAME,
      itemId: String(supplier?.id),
    },
    {
      skip: !supplier,
      reason: "Missing supplier",
    }
  );

  console.log("\n=== Cleanup ===");

  const deletes = [
    ["brc_delete_sales_credit_note", created.salesCreditNoteGenRefId],
    ["brc_delete_sales_credit_note", created.salesCreditNoteId],
    ["brc_delete_sales_invoice", created.salesInvoiceGenRefId],
    ["brc_delete_sales_invoice", created.salesInvoiceId],
    ["brc_delete_quote", created.deleteQuoteId],
    ["brc_delete_sales_entry", created.salesEntryId],
    ["brc_delete_purchase", created.purchaseId],
    ["brc_delete_cash_receipt", created.cashReceiptId],
    ["brc_delete_cash_payment", created.cashPaymentId],
    ["brc_delete_payment", created.paymentId],
    ["brc_delete_sales_rep", created.salesRepId],
    ["brc_delete_supplier", created.supplierId],
    ["brc_delete_product", created.productId],
    ["brc_delete_customer", created.customerId],
  ];

  for (const [tool, id] of deletes) {
    await run(
      tool,
      {
        companyName: COMPANY_NAME,
        id,
        confirmDelete: true,
      },
      {
        skip: !id,
        reason: "No created id to delete",
        timeoutMs: 120000,
      }
    );
  }

  console.log("\n=== Cleanup verification ===");
  const finalRemaining = await cleanupRemainingByMarker();

  if (finalRemaining.length === 0) {
    console.log(
      `Cleanup verification PASS: no remaining records found for marker "${TEST_MARKER}".`
    );

    results.push({
      tool: "cleanup_verification",
      status: "PASS",
      args: { marker: TEST_MARKER },
      details: "No remaining test records found.",
    });
  } else {
    console.log(
      `Cleanup verification FAIL: ${finalRemaining.length} possible remaining record(s) found for marker "${TEST_MARKER}".`
    );
    console.log(JSON.stringify(finalRemaining, null, 2));

    results.push({
      tool: "cleanup_verification",
      status: "FAIL",
      args: { marker: TEST_MARKER },
      details: finalRemaining,
    });
  }

  console.log("\n=== Audit log cleanup ===");
  await run("brc_list_audit_log", { includeTechnicalDetails: true });
  await run("brc_clear_audit_log", { confirmClear: true });

  const allToolNames = [...tools].sort();

  for (const toolName of allToolNames) {
    if (results.some((entry) => entry.tool === toolName)) continue;
    if (ALL_EXCLUDED_TOOLS.includes(toolName)) {
      recordExcluded(toolName);
      continue;
    }

    const classification = classifyToolForRegression(toolName, {
      allowBankWrites: ALLOW_BANK_WRITES,
    });

    if (classification.category === "read-only") {
      results.push({
        tool: toolName,
        status: "SKIPPED",
        args: null,
        details: "Read-only tool — covered by test:readonly:legacy",
      });
      continue;
    }

    if (classification.category === "email") {
      results.push({
        tool: toolName,
        status: "SKIPPED",
        args: null,
        details: classification.skipReason,
      });
      continue;
    }

    results.push({
      tool: toolName,
      status: "SKIPPED",
      args: null,
      details: "Registered but not included in write legacy template",
    });
  }

  const report = buildRegistryReport(allToolNames, results, {
    allowBankWrites: ALLOW_BANK_WRITES,
  });

  const counts = report.statusCounts;

  const summary = [
    "BRC MCP WRITE LEGACY REGRESSION SUMMARY",
    "=======================================",
    `Company: ${COMPANY_NAME}`,
    `Test marker: ${TEST_MARKER}`,
    `Transaction date used: ${testDate}`,
    `Date selection method: ${dateInfo.method}`,
    `Registered tools: ${report.classified.length}`,
    `Total invocations: ${results.length}`,
    ...Object.entries(counts).map(([status, count]) => `${status}: ${count}`),
    "",
    "Classification:",
    ...Object.entries(report.categoryCounts).map(
      ([category, count]) => `- ${category}: ${count}`
    ),
    "",
    "Failures:",
    ...report.classified
      .filter((r) => r.status === "FAIL")
      .map((r) => `- ${r.tool}: ${safeJsonForReport(r.details)}`),
    "",
    "Skipped:",
    ...report.classified
      .filter((r) => r.status === "SKIPPED")
      .slice(0, 40)
      .map((r) => `- ${r.tool}: ${r.details || r.skipReason || ""}`),
    "",
    "Excluded unless explicitly enabled:",
    EXCLUDED_TOOLS_NOTE,
  ].join("\n");

  writeJsonReport(
    "./reports/dev_test_results.json",
    {
      companyName: COMPANY_NAME,
      testMarker: TEST_MARKER,
      transactionDateUsed: testDate,
      counts,
      categoryCounts: report.categoryCounts,
      classifiedTools: report.classified,
      created,
      results: redactSensitive(results),
      financialYearDateSelection: dateInfo,
    }
  );
  
  fs.writeFileSync(
    "./reports/dev_test_summary.txt",
    summary
  );

  console.log("\n" + summary);
  console.log(
    "\nSaved reports/dev_test_results.json and reports/dev_test_summary.txt"
  );

  child.kill();
}

main().catch((e) => {
  console.error("Test crashed:", e);

  try {
    child.kill();
  } catch {}

  process.exit(1);
});