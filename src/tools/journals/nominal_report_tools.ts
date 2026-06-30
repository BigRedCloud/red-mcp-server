import {z} from "zod";
import type {ServerType} from "../../server.js"
import {
    brcFetch,
    fetchAllNominalAccounts,
    jsonResponse,
    companyNameSchema,
    toNumber,
    type JsonRecord,
  }  from "../../shared.js";


const nominalGroups: Record<string, { groupCode: string; description: string }> = {
    "008": { groupCode: "1000G", description: "Sales - BRB Accounts Software" },
    "1000": { groupCode: "1000G", description: "Sales - BRB Accounts Software" },
    "1010": { groupCode: "1000G", description: "Sales - BRB Accounts Software" },
  
    "1200": { groupCode: "1200G", description: "Sales - BRB Payroll Software" },
    "1790": { groupCode: "1200G", description: "Sales - BRB Payroll Software" },
  
    "1600": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
    "1601": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
    "1610": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
    "1750": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
    "1760": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
    "1770": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
    "1780": { groupCode: "1600G", description: "Sales - BRB Support Contracts" },
  
    "1620": { groupCode: "1620G", description: "Cloud Sales" },
    "1621": { groupCode: "1620G", description: "Cloud Sales" },
    "1650": { groupCode: "1620G", description: "Cloud Sales" },
  
    "1630": { groupCode: "1630G", description: "Turbo Revenue - Subscriptions" },
    "1632": { groupCode: "1630G", description: "Turbo Revenue - Subscriptions" },
  
    "1690": { groupCode: "1990G", description: "Sales - Other" },
    "1800": { groupCode: "1990G", description: "Sales - Other" },
    "1820": { groupCode: "1990G", description: "Sales - Other" },
    "1850": { groupCode: "1990G", description: "Sales - Other" },
    "1900": { groupCode: "1990G", description: "Sales - Other" },
    "1980": { groupCode: "1990G", description: "Sales - Other" },
    "1985": { groupCode: "1990G", description: "Sales - Other" },
    "1986": { groupCode: "1990G", description: "Sales - Other" },
    "1990": { groupCode: "1990G", description: "Sales - Other" },
    "1991": { groupCode: "1990G", description: "Sales - Other" },
    "1995": { groupCode: "1990G", description: "Sales - Other" },
  
    "3000": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3001": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3002": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3003": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3004": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3005": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3006": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3010": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3011": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3012": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3013": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3015": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3020": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3030": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3040": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3050": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3055": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3056": { groupCode: "3000G", description: "Staff Salary and other costs" },
    "3100": { groupCode: "3000G", description: "Staff Salary and other costs" },
  
    "3500": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3501": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3502": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3503": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3504": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3505": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3506": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3507": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3510": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3511": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3512": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3513": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3514": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3520": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3530": { groupCode: "3500G", description: "Marketing & Advertising" },
    "3560": { groupCode: "3500G", description: "Marketing & Advertising" },
  
    "5000": { groupCode: "5000G", description: "Bank Interest" },
    "5001": { groupCode: "5000G", description: "Bank Interest" },
    "5002": { groupCode: "5000G", description: "Bank Interest" },
    "5003": { groupCode: "5000G", description: "Bank Interest" },
};

type GroupedNominalRow = {
  nominalCode: string;
  nominalDescription: string;
  accountType: string | null;
  openingBalance: number;
  month1: number;
  month2: number;
  month3: number;
  month4: number;
  month5: number;
  month6: number;
  month7: number;
  month8: number;
  month9: number;
  month10: number;
  month11: number;
  month12: number;
};

function resolveNominalGroup(account: JsonRecord): {
  groupKey: string;
  groupDescription: string;
  accountType: string | null;
  groupedBy: string;
} {
  const accountGroup = account.accountGroup ?? account.group;
  const accountType = account.accountType ?? account.type;
  const rawCode = String(account.code ?? "").trim();

  if (accountGroup !== undefined && accountGroup !== null && String(accountGroup).trim()) {
    return {
      groupKey: String(accountGroup).trim(),
      groupDescription: String(accountGroup).trim(),
      accountType: accountType ? String(accountType) : null,
      groupedBy: account.accountGroup !== undefined ? "accountGroup" : "group",
    };
  }

  if (accountType !== undefined && accountType !== null && String(accountType).trim()) {
    return {
      groupKey: String(accountType).trim(),
      groupDescription: String(accountType).trim(),
      accountType: String(accountType),
      groupedBy: account.accountType !== undefined ? "accountType" : "type",
    };
  }

  const legacyGroup = rawCode ? nominalGroups[rawCode] : undefined;
  if (legacyGroup) {
    return {
      groupKey: legacyGroup.groupCode,
      groupDescription: legacyGroup.description,
      accountType: null,
      groupedBy: "legacyCodeMap",
    };
  }

  return {
    groupKey: rawCode || "Unknown",
    groupDescription: String(account.description ?? rawCode ?? "Unknown"),
    accountType: null,
    groupedBy: "code",
  };
}

function addAccountToGroupedRows(
  groupedRows: Map<string, GroupedNominalRow>,
  account: JsonRecord
) {
  const { groupKey, groupDescription, accountType } = resolveNominalGroup(account);
  if (!groupKey) return;

  if (!groupedRows.has(groupKey)) {
    groupedRows.set(groupKey, {
      nominalCode: groupKey,
      nominalDescription: groupDescription,
      accountType,
      openingBalance: 0,
      month1: 0,
      month2: 0,
      month3: 0,
      month4: 0,
      month5: 0,
      month6: 0,
      month7: 0,
      month8: 0,
      month9: 0,
      month10: 0,
      month11: 0,
      month12: 0,
    });
  }

  const row = groupedRows.get(groupKey)!;
  row.openingBalance += toNumber(account.oBalance);
  row.month1 += toNumber(account.month1);
  row.month2 += toNumber(account.month2);
  row.month3 += toNumber(account.month3);
  row.month4 += toNumber(account.month4);
  row.month5 += toNumber(account.month5);
  row.month6 += toNumber(account.month6);
  row.month7 += toNumber(account.month7);
  row.month8 += toNumber(account.month8);
  row.month9 += toNumber(account.month9);
  row.month10 += toNumber(account.month10);
  row.month11 += toNumber(account.month11);
  row.month12 += toNumber(account.month12);
}

function buildGroupedNominalReport(nominalAccounts: JsonRecord[]) {
  const groupedRows = new Map<string, GroupedNominalRow>();

  for (const account of nominalAccounts) {
    addAccountToGroupedRows(groupedRows, account);
  }

  return Array.from(groupedRows.values()).sort((a, b) =>
    a.nominalCode.localeCompare(b.nominalCode, undefined, { numeric: true })
  );
}

function detectGroupedByField(nominalAccounts: JsonRecord[]): string {
  for (const account of nominalAccounts) {
    const resolved = resolveNominalGroup(account);
    if (resolved.groupedBy !== "code" && resolved.groupedBy !== "legacyCodeMap") {
      return resolved.groupedBy;
    }
  }

  return nominalAccounts.length > 0 ? resolveNominalGroup(nominalAccounts[0]).groupedBy : "group";
}

export function registerNominalReportTools(server:ServerType){
  server.tool(
    "brc_get_nom_ac_ledger_by_ids",
    "Gets nominal accounts for specific ids by calling GET /v1/nominalAccounts/{id} for each id.",
    {
      companyName: companyNameSchema,
      ids: z.string().describe("Comma-separated nominal account ids."),
    },
    async ({ companyName, ids }) => {
      const idList = ids
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      const items: JsonRecord[] = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const id of idList) {
        try {
          const data = await brcFetch(
            companyName,
            `/v1/nominalAccounts/${encodeURIComponent(id)}`
          );
          items.push(data as JsonRecord);
        } catch (error) {
          errors.push({
            id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return jsonResponse({
        companyName,
        sourceEndpoint: "/v1/nominalAccounts/{id}",
        requestedCount: idList.length,
        count: items.length,
        items,
        ...(errors.length > 0 ? { errors } : {}),
      });
    }
  );
  server.tool(
    "brc_grouped_nominal_accounts_report",
    "Creates a grouped nominal accounts report from GET /v1/nominalAccounts, grouping by account group/type fields when available.",
    {
      companyName: companyNameSchema,
    },
    async ({ companyName }) => {
      const nominalAccounts = await fetchAllNominalAccounts(companyName);
      const report = buildGroupedNominalReport(nominalAccounts);

      return jsonResponse({
        companyName,
        reportName: "Grouped Nominal Accounts Report",
        sourceEndpoint: "/v1/nominalAccounts",
        groupedBy: detectGroupedByField(nominalAccounts),
        totalSourceAccounts: nominalAccounts.length,
        totalGroupedRows: report.length,
        columns: [
          "Nominal Code",
          "Nominal Description",
          "Account Type",
          "Opening Balance",
          "Month 1",
          "Month 2",
          "Month 3",
          "Month 4",
          "Month 5",
          "Month 6",
          "Month 7",
          "Month 8",
          "Month 9",
          "Month 10",
          "Month 11",
          "Month 12",
        ],
        rows: report,
      });
    }
  );
  server.tool(
    "brc_multi_company_nom_ac_report",
    "Creates a grouped nominal accounts report for multiple companies using GET /v1/nominalAccounts for each company.",
    {
      companyNames: z
        .array(companyNameSchema)
        .min(1)
        .describe("The company names to report on."),
    },
    async ({ companyNames }) => {
      const reports = [];

      for (const companyName of companyNames) {
        const nominalAccounts = await fetchAllNominalAccounts(companyName);
        const rows = buildGroupedNominalReport(nominalAccounts);

        reports.push({
          companyName,
          reportName: "Grouped Nominal Accounts Report",
          groupedBy: detectGroupedByField(nominalAccounts),
          totalSourceAccounts: nominalAccounts.length,
          rows,
        });
      }

      return jsonResponse({
        reportName: "Multi-Company Grouped Nominal Accounts Report",
        sourceEndpoint: "/v1/nominalAccounts",
        companyCount: companyNames.length,
        companies: reports,
      });
    }
  );
}