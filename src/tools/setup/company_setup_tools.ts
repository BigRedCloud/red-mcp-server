import type {ServerType} from "../../server.js"
import {
    brcFetch,
    companyNameSchema,
    jsonResponse} from "../../shared.js";

export function registerCompanySetupTools(server:ServerType){
// Company setup tools --------------------------------------------------------

server.tool(
    "brc_get_company_setup_config",
    "Gets full BRC company setup configuration, including general details, financial year, reference settings, and processing options.",
    { companyName: companyNameSchema },
    async ({ companyName }) => {
      const data = await brcFetch(companyName, "/v1/companySetupConfig");
      return jsonResponse(data);
    }
  );
  server.tool(
    "brc_get_company_logo",
    "Gets the company logo from BRC.",
    {
      companyName: companyNameSchema,
    },
    async ({ companyName }) => {
      const data = await brcFetch(companyName, "/v1/companySetupConfig/getCompanyLogo");

      return jsonResponse({
        companyName,
        endpoint: "/v1/companySetupConfig/getCompanyLogo",
        data,
      });
    }
  );
  
  server.tool(
    "brc_get_financial_year",
    "Gets BRC company financial year.",
    { companyName: companyNameSchema },
    async ({ companyName }) => {
      const data = await brcFetch(companyName, "/v1/companySetupConfig/getFinancialYear");
      return jsonResponse(data);
    }
  );
  
  server.tool(
    "brc_get_company_options",
    "Gets raw BRC company processing/options settings, including nominal ledger, VAT on cash receipts, gross price entry, margin VAT, reverse charge VAT, VAT discrepancy tolerance, and ageing options. Read-only in Red; changes must be made in Big Red Cloud.",
    { companyName: companyNameSchema },
    async ({ companyName }) => {
      const data = await brcFetch(companyName, "/v1/companySetupConfig/getCompanyOptions");
      return jsonResponse(data);
    }
  );
}