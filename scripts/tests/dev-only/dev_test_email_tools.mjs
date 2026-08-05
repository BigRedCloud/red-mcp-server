#!/usr/bin/env node
/**
 * Legacy manual email MCP regression.
 *
 * Requires:
 *   BRC_ALLOW_EMAIL_TESTS=true
 *   BRC_TEST_COMPANY + BRC_TEST_API_KEY
 *   BRC_TEST_EMAIL_TO (safe test recipient — never a real customer email by default)
 *   BRC_TEST_EMAIL_FROM (optional)
 */

import fs from "node:fs";
import { McpStdioClient, defaultRegressionServerEnv } from "../lib/mcp_client.mjs";
import {
  requireEnvFlag,
  requireTestConnectionEnv,
  DEFAULT_TEST_SERVER_ENTRY,
  describeConnectionSetup,
} from "../lib/connection_env.mjs";
import { buildRegistryReport, buildSetupFailedRegistryReport, writeJsonReport, safeJsonForReport } from "../lib/registry_report.mjs";
import { EMAIL_SEND_TOOLS } from "../lib/tool_classification.mjs";
import { redactSensitive } from "../lib/redact.mjs";
import {
  AUTH_PREFLIGHT_TOOL,
  printAuthFailure,
  runAuthPreflight,
} from "../lib/auth_preflight.mjs";

requireEnvFlag(
  "BRC_ALLOW_EMAIL_TESTS",
  "Refusing to send email. Set BRC_ALLOW_EMAIL_TESTS=true to confirm."
);

const { companyName: COMPANY_NAME } = requireTestConnectionEnv({
  label: "email legacy regression",
});

const TO_ADDRESS = process.env.BRC_TEST_EMAIL_TO?.trim();
if (!TO_ADDRESS) {
  console.error(
    "Missing BRC_TEST_EMAIL_TO. Use a safe test mailbox — never a real customer email."
  );
  process.exit(1);
}

const FROM_ADDRESS =
  process.env.BRC_TEST_EMAIL_FROM?.trim() || "noreply@example.test";

const client = new McpStdioClient({
  serverEntry: DEFAULT_TEST_SERVER_ENTRY,
  env: defaultRegressionServerEnv({
    BRC_ALLOW_EMAIL_SKILLS: "true",
  }),
});

const results = [];

async function run(name, args = {}, timeoutMs = 90000) {
  if (!client.tools.has(name)) {
    results.push({
      tool: name,
      status: "MISSING",
      args,
      details: "Tool not registered",
    });
    console.log(`- ${name}: MISSING`);
    return { status: "MISSING", data: {} };
  }

  try {
    const raw = await client.call(name, args, timeoutMs);
    const data = client.parsed(raw);
    const status = client.isFailure(raw, data) ? "FAIL" : "PASS";
    results.push({ tool: name, status, args: redactSensitive(args), details: data });
    console.log(`- ${name}: ${status}`);
    return { status, data };
  } catch (error) {
    results.push({
      tool: name,
      status: "FAIL",
      args: redactSensitive(args),
      details: { message: error.message || String(error) },
    });
    console.log(`- ${name}: FAIL`);
    return { status: "FAIL", data: {} };
  }
}

function pickId(items) {
  if (!items.length) return null;
  return items[0]?.id ?? null;
}

async function main() {
  console.log("Starting BRC email legacy regression...");
  console.log(`Company: ${COMPANY_NAME}`);
  console.log(`Recipient: ${TO_ADDRESS.replace(/(.{2}).+(@.+)/, "$1***$2")}`);
  console.log("No credentials or API keys are printed.\n");

  await client.init({ name: "brc-email-legacy-regression", version: "2.0.0" });

  const contexts = await run("brc_list_company_contexts", {}, 45000);
  const companies = client.arr(contexts.data?.companies ?? contexts.data);
  const connected = companies.some(
    (entry) =>
      String(entry?.companyName || entry?.name || "")
        .trim()
        .toLowerCase() === COMPANY_NAME.trim().toLowerCase() &&
      entry?.connected !== false
  );

  if (!connected) {
    console.error(
      `Company "${COMPANY_NAME}" is not connected. Set BRC_TEST_COMPANY and BRC_TEST_API_KEY.`
    );
    client.close();
    process.exit(1);
  }

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
    printAuthFailure(COMPANY_NAME);

    const allToolNames = [...client.tools].sort();
    const report = buildSetupFailedRegistryReport(
      allToolNames,
      results,
      "unauthorized"
    );

    const summary = [
      "BRC EMAIL LEGACY REGRESSION SUMMARY",
      "=================================",
      `Company: ${COMPANY_NAME}`,
      `Registered tools: ${report.classified.length}`,
      `Setup: setup_failed (unauthorized)`,
      ...Object.entries(report.statusCounts).map(
        ([status, count]) => `${status}: ${count}`
      ),
    ].join("\n");

    writeJsonReport("./reports/email_test_results.json", {
      companyName: COMPANY_NAME,
      connection: describeConnectionSetup(COMPANY_NAME),
      registeredTools: report.classified.length,
      categoryCounts: report.categoryCounts,
      statusCounts: report.statusCounts,
      setup: report.setup,
      classifiedTools: report.classified,
      results: redactSensitive(results),
    });
    fs.writeFileSync("./reports/email_test_summary.txt", summary);
    console.log("\n" + summary);
    client.close();
    process.exit(1);
  }

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

  const customerId = pickId(client.arr(customersResult.data));
  const salesInvoiceId = pickId(client.arr(invoicesResult.data));
  const quoteId = pickId(client.arr(quotesResult.data));

  if (!customerId || !salesInvoiceId || !quoteId) {
    console.error(
      "Could not find required records. Ensure the test company has a customer, sales invoice, and quote."
    );
    client.close();
    process.exit(1);
  }

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(now.getDate() - 30);

  await run("brc_send_email_statement", {
    companyName: COMPANY_NAME,
    customerId,
    fromAddress: FROM_ADDRESS,
    toAddress: TO_ADDRESS,
    fromPeriod: fromDate.toISOString(),
    toPeriod: now.toISOString(),
    messageBody: "Legacy regression: customer statement email smoke test.",
    confirmSend: true,
  });

  await run("brc_send_sales_invoice_email", {
    companyName: COMPANY_NAME,
    salesInvoiceId,
    fromAddress: FROM_ADDRESS,
    toAddress: TO_ADDRESS,
    messageBody: "Legacy regression: sales invoice email smoke test.",
    confirmSend: true,
  });

  await run("brc_send_quote_email", {
    companyName: COMPANY_NAME,
    quoteId,
    fromAddress: FROM_ADDRESS,
    toAddress: TO_ADDRESS,
    messageBody: "Legacy regression: quote email smoke test.",
    confirmSend: true,
  });

  const allToolNames = [...client.tools].sort();
  for (const toolName of allToolNames) {
    if (results.some((entry) => entry.tool === toolName)) continue;
    results.push({
      tool: toolName,
      status: "SKIPPED",
      args: null,
      details: EMAIL_SEND_TOOLS.has(toolName)
        ? "Not invoked in this email smoke run"
        : "Non-email tool — covered by other legacy scripts",
    });
  }

  const report = buildRegistryReport(allToolNames, results);

  const summary = [
    "BRC EMAIL LEGACY REGRESSION SUMMARY",
    "=================================",
    `Company: ${COMPANY_NAME}`,
    `Registered tools: ${report.classified.length}`,
    `Recipient configured: yes (redacted in logs)`,
    ...Object.entries(report.statusCounts).map(
      ([status, count]) => `${status}: ${count}`
    ),
    "",
    "Failures:",
    ...report.classified
      .filter((entry) => entry.status === "FAIL")
      .map((entry) => `- ${entry.tool}: ${safeJsonForReport(entry.details)}`),
  ].join("\n");

  writeJsonReport("./reports/email_test_results.json", {
    companyName: COMPANY_NAME,
    connection: describeConnectionSetup(COMPANY_NAME),
    toAddressConfigured: true,
    fromAddress: FROM_ADDRESS,
    classifiedTools: report.classified,
    results: redactSensitive(results),
  });

  fs.writeFileSync("./reports/email_test_summary.txt", summary);
  console.log("\n" + summary);
  client.close();

  if ((report.statusCounts.FAIL || 0) > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Email legacy regression crashed:", error.message || error);
  try {
    client.close();
  } catch {}
  process.exit(1);
});
