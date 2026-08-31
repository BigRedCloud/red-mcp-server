import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCredentialForCompany,
  fetchAllNominalAccounts,
  setApiKeyForCompany,
  type JsonRecord,
} from "../../shared.js";
import { registerTools as registerListTools } from "../general/list_tools.js";
import { buildGroupedNominalReport } from "./nominal_report_tools.js";

const COMPANY = "Nominal Report Test Company";

function nominalAccount(id: number, overrides: JsonRecord = {}): JsonRecord {
  return {
    id,
    code: String(1000 + id),
    description: `Nominal ${id}`,
    accountGroup: id % 2 === 0 ? "Sales" : "Overheads",
    accountType: id % 2 === 0 ? "Income" : "Expense",
    oBalance: 0,
    month1: 0,
    month2: 0,
    ...overrides,
  };
}

test("metadata-wrapped direct array returns all 72 accounts and preserves signed movements", async () => {
  const accounts = Array.from({ length: 72 }, (_, index) => nominalAccount(index + 1));
  accounts[0] = nominalAccount(1, { accountGroup: "Sales", oBalance: 100, month1: 25 });
  accounts[1] = nominalAccount(2, { accountGroup: "Sales", oBalance: -40, month1: -10 });
  accounts[2] = nominalAccount(3, { accountGroup: "Zero Balance", oBalance: 0, month1: 0 });

  const paths: string[] = [];
  const fetched = await fetchAllNominalAccounts(COMPANY, {
    brcFetch: async (_company, path) => {
      paths.push(path);
      return { result: accounts, connectionStatus: "active" };
    },
  });
  const grouped = buildGroupedNominalReport(fetched);

  assert.deepEqual(paths, ["/v1/nominalAccounts?page=1&pageSize=500"]);
  assert.equal(fetched.length, 72);
  assert.ok(grouped.length > 0);
  const sales = grouped.find((row) => row.nominalCode === "Sales");
  assert.ok(sales);
  assert.equal(sales.openingBalance, 60);
  assert.equal(sales.month1, 15);
  assert.ok(grouped.some((row) => row.nominalCode === "Zero Balance"));
});

test("supports direct arrays and BRC Items envelopes", async () => {
  const direct = await fetchAllNominalAccounts(COMPANY, {
    brcFetch: async () => [nominalAccount(1)],
  });
  assert.equal(direct.length, 1);

  const paths: string[] = [];
  const enveloped = await fetchAllNominalAccounts(COMPANY, {
    brcFetch: async (_company, path) => {
      paths.push(path);
      return path.includes("page=1")
        ? { Items: [nominalAccount(1), nominalAccount(2)], Count: 3, NextPageLink: "page=2" }
        : { Items: [nominalAccount(3)], Count: 3, NextPageLink: "" };
    },
  });
  assert.equal(enveloped.length, 3);
  assert.deepEqual(paths, [
    "/v1/nominalAccounts?page=1&pageSize=500",
    "/v1/nominalAccounts?page=2&pageSize=500",
  ]);
});

test("a full metadata-wrapped direct array is complete without a speculative second request", async () => {
  const accounts = Array.from({ length: 500 }, (_, index) => nominalAccount(index + 1));
  let calls = 0;
  const fetched = await fetchAllNominalAccounts(COMPANY, {
    brcFetch: async () => {
      calls += 1;
      return { result: accounts, connectionStatus: "active" };
    },
  });

  assert.equal(fetched.length, 500);
  assert.equal(calls, 1);
});

test("repeated accounting values on distinct pages are not mistaken for a repeated page", async () => {
  let page = 0;
  const fetched = await fetchAllNominalAccounts(COMPANY, {
    brcFetch: async () => {
      page += 1;
      const identicalValuesWithoutIds = {
        code: "1000",
        description: "Sales",
        accountGroup: "Sales",
        oBalance: 0,
        month1: 0,
      };
      return {
        Items: [identicalValuesWithoutIds],
        Count: 2,
        NextPageLink: page === 1 ? "page=2" : "",
      };
    },
  });

  assert.equal(fetched.length, 2);
  assert.equal(page, 2);
});

test("supports OData value envelopes across pages without adding filter or ordering", async () => {
  const paths: string[] = [];
  const fetched = await fetchAllNominalAccounts(COMPANY, {
    brcFetch: async (_company, path) => {
      paths.push(path);
      return path.includes("page=1")
        ? {
            value: [nominalAccount(1)],
            "@odata.count": 2,
            "@odata.nextLink": "/v1/nominalAccounts?page=2&pageSize=500",
          }
        : { value: [nominalAccount(2)], "@odata.count": 2 };
    },
  });

  assert.equal(fetched.length, 2);
  assert.equal(paths.every((path) => !path.includes("$filter") && !path.includes("$orderby")), true);
});

test("preserves PascalCase account fields, zero balances, debits, and credits", () => {
  const grouped = buildGroupedNominalReport([
    {
      Code: "1000",
      Description: "Sales",
      AccountGroup: "Sales",
      AccountType: "Income",
      OBalance: 50,
      Month1: 20,
    },
    {
      Code: "1001",
      Description: "Sales returns",
      AccountGroup: "Sales",
      AccountType: "Income",
      OBalance: -10,
      Month1: -5,
    },
    {
      Code: "2000",
      Description: "Zero account",
      AccountGroup: "Current Assets",
      AccountType: "Asset",
      OBalance: 0,
      Month1: 0,
    },
  ]);

  assert.equal(grouped.length, 2);
  const sales = grouped.find((row) => row.nominalCode === "Sales");
  assert.deepEqual(
    { openingBalance: sales?.openingBalance, month1: sales?.month1 },
    { openingBalance: 40, month1: 15 },
  );
  assert.ok(grouped.some((row) => row.nominalCode === "Current Assets"));
});

test("legitimate empty arrays and envelopes remain successful empty results", async () => {
  for (const response of [[], { result: [] }, { Items: [], Count: 0 }, { value: [], "@odata.count": 0 }]) {
    const fetched = await fetchAllNominalAccounts(COMPANY, {
      brcFetch: async () => response,
    });
    assert.deepEqual(fetched, []);
  }
});

test("upstream, malformed, and non-progressing pagination failures are surfaced", async () => {
  await assert.rejects(
    fetchAllNominalAccounts(COMPANY, {
      brcFetch: async () => {
        throw new Error("BRC API GET /v1/nominalAccounts failed: 500");
      },
    }),
    /500/,
  );
  await assert.rejects(
    fetchAllNominalAccounts(COMPANY, { brcFetch: async () => ({ Count: 72 }) }),
    /Unexpected nominal-accounts response/,
  );
  await assert.rejects(
    fetchAllNominalAccounts(COMPANY, { brcFetch: async () => "not-json" }),
    /Unexpected nominal-accounts response/,
  );
  await assert.rejects(
    fetchAllNominalAccounts(COMPANY, {
      brcFetch: async () => ({ Items: [nominalAccount(1)], Count: 2 }),
    }),
    /pagination did not advance/,
  );
});

test("brc_list_nominal_accounts keeps returning the raw BRC list response", async () => {
  let handler: ((args: Record<string, unknown>) => Promise<any>) | undefined;
  const recorder = {
    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      registeredHandler: (args: Record<string, unknown>) => Promise<any>,
    ) {
      if (name === "brc_list_nominal_accounts") handler = registeredHandler;
    },
  };
  registerListTools(recorder as never);
  assert.ok(handler);

  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  setApiKeyForCompany({ companyName: COMPANY, apiKey: "test-key", expiresAt: Date.now() + 60_000 });
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ Items: [nominalAccount(1)], Count: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await handler({ companyName: COMPANY, page: 1, pageSize: 20 });
    const body = JSON.parse(response.content[0].text) as JsonRecord;
    assert.equal((body.Items as unknown[]).length, 1);
    assert.match(requestedUrl, /\/v1\/nominalAccounts\?page=1&pageSize=20$/);
  } finally {
    globalThis.fetch = originalFetch;
    clearCredentialForCompany(COMPANY);
  }
});
