/**
 * Company processing settings MCP tools.
 *
 * This file registers read-only Red tools for inspecting BRC company
 * processing/options settings. These settings affect VAT behaviour, gross/net
 * sales invoice handling, cash receipt VAT handling, payment terms, statements,
 * and transaction safety checks.
 *
 * The customer-facing tools return either a plain-English summary or structured
 * warnings for a specific transaction workflow. A dev-only diagnostic tool is
 * also registered here, but it is controlled by the deployment tool filter and
 * should only appear when dev/operator mode is enabled.
 */

import { z } from "zod";
import type { ServerType } from "../../server.js";
import { companyNameSchema, jsonResponse, textResponse } from "../../shared.js";
import {
  formatCompanyProcessingSettings,
  getCompanyProcessingSettings,
  getTransactionSafetyWarnings,
} from "../../guards/company_processing_settings.js";
import {
  formatCompanyReferenceSettings,
  getCompanyReferenceSettings,
} from "../../guards/company_reference_settings.js";
import { diagnoseCompanyProcessingSettings } from "../../dev_company_processing_settings_diagnostic.js";

export function registerCompanyProcessingSettingsTools(server: ServerType) {
  server.tool(
    "brc_get_company_processing_settings",
    [
      "Reads BRC company processing/options settings that affect VAT,",
      "cash receipts, payment terms, debtor statements, gross price entry,",
      "and transaction creation behaviour.",
      "Use this before VAT-sensitive write workflows where possible.",
      "These settings are read-only in Red; changes must be made in Big Red Cloud.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      includeRaw: z
        .boolean()
        .default(false)
        .describe(
          "If true, includes the raw BRC settings record for operator review. Customer-facing responses should normally leave this false."
        ),
    },
    async ({ companyName, includeRaw }) => {
      const settings = await getCompanyProcessingSettings(companyName);

      return includeRaw
        ? jsonResponse({
            message: "Company processing settings read from BRC.",
            companyName,
            settings,
          })
        : textResponse(formatCompanyProcessingSettings(settings));
    }
  );

  server.tool(
    "brc_get_company_reference_settings",
    [
      "Reads BRC reference auto-generation settings for sales, purchases, quotes,",
      "debtors journal, and creditors journal.",
      "Use this before preparing or creating quotes, invoices, purchases, or other reference-sensitive records.",
      "If Quotes is Unknown, do not assume auto-generate; ask for a quote reference or user confirmation first.",
      "These settings are read-only in Red; changes must be made in Big Red Cloud.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      includeRaw: z
        .boolean()
        .default(false)
        .describe(
          "If true, includes the raw BRC company setup record for operator review. Customer-facing responses should normally leave this false."
        ),
    },
    async ({ companyName, includeRaw }) => {
      const settings = await getCompanyReferenceSettings(companyName);

      return includeRaw
        ? jsonResponse({
            message: "Company reference settings read from BRC.",
            companyName,
            settings,
          })
        : textResponse(formatCompanyReferenceSettings(settings));
    }
  );

  server.tool(
    "brc_check_transaction_settings",
    [
      "Checks BRC company processing settings before a VAT-sensitive or",
      "payment-terms-sensitive transaction workflow.",
      "Returns warnings that should be shown before creating or changing records.",
    ].join(" "),
    {
      companyName: companyNameSchema,
      workflow: z
        .enum(["sales_invoice", "purchase", "cash_receipt", "statement"])
        .describe(
          "The workflow to check against the company processing settings."
        ),
    },
    async ({ companyName, workflow }) => {
      const settings = await getCompanyProcessingSettings(companyName);
      const warnings = getTransactionSafetyWarnings(settings, workflow);

      return jsonResponse({
        message: "Transaction settings checked.",
        companyName,
        workflow,
        warnings,
        settingsSummary: formatCompanyProcessingSettings(settings),
      });
    }
  );

  server.tool(
    "brc_dev_diagnose_company_processing_settings",
    [
      "Temporary dev-only operator diagnostic.",
      "Probes BRC endpoints used for company processing and options settings.",
      "Returns shallow redacted keys and value shapes only.",
      "Not registered in customer/staff mode.",
    ].join(" "),
    {
      companyName: companyNameSchema,
    },
    async ({ companyName }) =>
      jsonResponse(await diagnoseCompanyProcessingSettings(companyName))
  );
}