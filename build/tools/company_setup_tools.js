import { brcFetch, companyNameSchema, jsonResponse } from "../shared.js";
export function registerCompanySetupTools(server) {
    // Company setup tools --------------------------------------------------------
    server.tool("brc_get_company_setup_config", "Gets BRC company setup configuration.", { companyName: companyNameSchema }, async ({ companyName }) => {
        const data = await brcFetch(companyName, "/v1/companySetupConfig");
        return jsonResponse(data);
    });
    server.tool("brc_get_company_logo", "Gets the company logo from BRC.", {
        companyName: companyNameSchema,
    }, async ({ companyName }) => {
        const data = await brcFetch(companyName, "/v1/companySetupConfig/getCompanyLogo");
        return jsonResponse({
            companyName,
            endpoint: "/v1/companySetupConfig/getCompanyLogo",
            data,
        });
    });
    server.tool("brc_get_financial_year", "Gets BRC company financial year.", { companyName: companyNameSchema }, async ({ companyName }) => {
        const data = await brcFetch(companyName, "/v1/companySetupConfig/getFinancialYear");
        return jsonResponse(data);
    });
    server.tool("brc_get_company_options", "Gets BRC company options.", { companyName: companyNameSchema }, async ({ companyName }) => {
        const data = await brcFetch(companyName, "/v1/companySetupConfig/getCompanyOptions");
        return jsonResponse(data);
    });
}
