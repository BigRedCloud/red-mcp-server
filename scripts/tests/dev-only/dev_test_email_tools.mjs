#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";

const COMPANY_NAME =
  process.env.BRC_TEST_COMPANY ||
  process.env.BRC_TEST_COMPANY_NAME ||
  "Company C";
const API_KEY = process.env.BRC_TEST_API_KEY || "";
const SERVER_ENTRY =
  process.env.BRC_EMAIL_TEST_SERVER_ENTRY || "./build/index.email-test.js";

const FIXED_TO_ADDRESS = "laurendwyer@gmail.com";
const FIXED_FROM_ADDRESS = "lauren.dwyer@bigredbook.com";

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
      // Ignore non-JSON output.
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

function parseToolResult(result) {
  try {
    return JSON.parse(toolText(result));
  } catch {
    return { rawText: toolText(result) };
  }
}

function isFailure(result, data) {
  const text = toolText(result).toLowerCase();
  return Boolean(
    result?.isError ||
      data?.error ||
      data?.status === "error" ||
      text.includes("failed") ||
      text.includes("bad request") ||
      text.includes("internal server error") ||
      text.includes("validation")
  );
}

function arr(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function pickId(items) {
  if (!items.length) return null;
  return items[0]?.id ?? null;
}

async function run(name, args = {}, timeoutMs = 45000) {
  try {
    const raw = await call(name, args, timeoutMs);
    const data = parseToolResult(raw);
    const status = isFailure(raw, data) ? "FAIL" : "PASS";
    results.push({ tool: name, status, args, details: data });
    console.log(`- ${name}: ${status}`);
    return { status, data };
  } catch (error) {
    const data = { message: error?.message || String(error) };
    results.push({ tool: name, status: "FAIL", args, details: data });
    console.log(`- ${name}: FAIL`);
    return { status: "FAIL", data };
  }
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (/apikey|api_key|token|password|secret|authorization/i.test(key)) {
        out[key] = "<REDACTED>";
      } else {
        out[key] = redactSensitive(inner);
      }
    }
    return out;
  }
  return value;
}

async function main() {
  console.log("Starting dedicated BRC email tools test...");
  console.log(`Company: ${COMPANY_NAME}`);
  console.log(`Server entry: ${SERVER_ENTRY}`);
  console.log(`To address: ${FIXED_TO_ADDRESS}`);
  console.log(`From address: ${FIXED_FROM_ADDRESS}`);

  await req("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "brc-email-test",
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
  const tools = new Set((toolList.tools || []).map((t) => t.name));
  const requiredTools = [
    "brc_set_company_api_key",
    "brc_list_customers",
    "brc_list_sales_invoices",
    "brc_list_quotes",
    "brc_send_email_statement",
    "brc_send_sales_invoice_email",
    "brc_send_quote_email",
  ];

  const missingTools = requiredTools.filter((name) => !tools.has(name));
  if (missingTools.length) {
    throw new Error(
      `Missing required tools: ${missingTools.join(", ")}. ` +
        "Use the email test entry point so email tools are registered."
    );
  }

  await run("brc_set_company_api_key", {
    companyName: COMPANY_NAME,
    apiKey: API_KEY,
  });

  const customersResult = await run("brc_list_customers", {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize: 200,
  });
  const invoicesResult = await run("brc_list_sales_invoices", {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize: 200,
  });
  const quotesResult = await run("brc_list_quotes", {
    companyName: COMPANY_NAME,
    page: 1,
    pageSize: 200,
  });

  const customerId = pickId(arr(customersResult.data));
  const salesInvoiceId = pickId(arr(invoicesResult.data));
  const quoteId = pickId(arr(quotesResult.data));

  if (!customerId || !salesInvoiceId || !quoteId) {
    throw new Error(
      "Could not find required records to test email tools. " +
        "Ensure the company has at least one customer, one sales invoice, and one quote."
    );
  }

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(now.getDate() - 30);

  await run(
    "brc_send_email_statement",
    {
      companyName: COMPANY_NAME,
      customerId,
      fromAddress: FIXED_FROM_ADDRESS,
      toAddress: FIXED_TO_ADDRESS,
      fromPeriod: fromDate.toISOString(),
      toPeriod: now.toISOString(),
      messageBody:
        "Automated test: customer statement email endpoint via MCP email tool.",
      confirmSend: true,
    },
    90000
  );

  await run(
    "brc_send_sales_invoice_email",
    {
      companyName: COMPANY_NAME,
      salesInvoiceId,
      fromAddress: FIXED_FROM_ADDRESS,
      toAddress: FIXED_TO_ADDRESS,
      messageBody:
        "Automated test: sales invoice email endpoint via MCP email tool.",
      confirmSend: true,
    },
    90000
  );

  await run(
    "brc_send_quote_email",
    {
      companyName: COMPANY_NAME,
      quoteId,
      fromAddress: FIXED_FROM_ADDRESS,
      toAddress: FIXED_TO_ADDRESS,
      messageBody: "Automated test: quote email endpoint via MCP email tool.",
      confirmSend: true,
    },
    90000
  );

  await run("brc_clear_all_company_api_keys", {});

  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  const summary = [
    "BRC EMAIL TOOLS TEST SUMMARY",
    "============================",
    `Company: ${COMPANY_NAME}`,
    `To address: ${FIXED_TO_ADDRESS}`,
    `From address: ${FIXED_FROM_ADDRESS}`,
    `PASS: ${counts.PASS || 0}`,
    `FAIL: ${counts.FAIL || 0}`,
    "",
    "Failures:",
    ...results
      .filter((r) => r.status === "FAIL")
      .map((r) => `- ${r.tool}: ${JSON.stringify(r.details).slice(0, 900)}`),
  ].join("\n");

  fs.mkdirSync("./reports", { recursive: true });
  fs.writeFileSync(
    "./reports/email_test_results.json",
    JSON.stringify(
      redactSensitive({
        companyName: COMPANY_NAME,
        toAddress: FIXED_TO_ADDRESS,
        fromAddress: FIXED_FROM_ADDRESS,
        counts,
        selectedIds: { customerId, salesInvoiceId, quoteId },
        results,
      }),
      null,
      2
    )
  );
  fs.writeFileSync("./reports/email_test_summary.txt", summary);

  console.log("\n" + summary);
  console.log(
    "\nSaved reports/email_test_results.json and reports/email_test_summary.txt"
  );
  child.kill();
}

main().catch((error) => {
  console.error("Email test crashed:", error);
  try {
    child.kill();
  } catch {}
  process.exit(1);
});
