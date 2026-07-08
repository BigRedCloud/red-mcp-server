import assert from "node:assert/strict";
import test from "node:test";

import {
  BrcEduGraphError,
  downloadSupportCsvFromGraph,
  fetchGraphAccessToken,
  getBrcEduGraphConfig,
} from "./brc_edu_graph.js";

const GRAPH_CONFIG = {
  tenantId: "tenant-123",
  clientId: "client-456",
  clientSecret: "super-secret-value",
  driveId: "drive-789",
  itemId: "item-abc",
};

function withGraphEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void> | void,
): Promise<void> {
  const keys = [
    "BRC_EDU_GRAPH_TENANT_ID",
    "BRC_EDU_GRAPH_CLIENT_ID",
    "BRC_EDU_GRAPH_CLIENT_SECRET",
    "BRC_EDU_GRAPH_DRIVE_ID",
    "BRC_EDU_GRAPH_ITEM_ID",
  ] as const;
  const previous: Record<string, string | undefined> = {};

  for (const key of keys) {
    previous[key] = process.env[key];
    const next = values[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

test("getBrcEduGraphConfig returns null when any Graph env var is missing", async () => {
  await withGraphEnv(
    {
      BRC_EDU_GRAPH_TENANT_ID: "tenant",
      BRC_EDU_GRAPH_CLIENT_ID: "client",
      BRC_EDU_GRAPH_CLIENT_SECRET: "secret",
      BRC_EDU_GRAPH_DRIVE_ID: "drive",
      BRC_EDU_GRAPH_ITEM_ID: undefined,
    },
    () => {
      assert.equal(getBrcEduGraphConfig(), null);
    },
  );
});

test("getBrcEduGraphConfig returns config when all Graph env vars are set", async () => {
  await withGraphEnv(
    {
      BRC_EDU_GRAPH_TENANT_ID: GRAPH_CONFIG.tenantId,
      BRC_EDU_GRAPH_CLIENT_ID: GRAPH_CONFIG.clientId,
      BRC_EDU_GRAPH_CLIENT_SECRET: GRAPH_CONFIG.clientSecret,
      BRC_EDU_GRAPH_DRIVE_ID: GRAPH_CONFIG.driveId,
      BRC_EDU_GRAPH_ITEM_ID: GRAPH_CONFIG.itemId,
    },
    () => {
      assert.deepEqual(getBrcEduGraphConfig(), GRAPH_CONFIG);
    },
  );
});

test("fetchGraphAccessToken requests client credentials token", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ access_token: "graph-token-xyz" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const token = await fetchGraphAccessToken(GRAPH_CONFIG, fetchImpl);

  assert.equal(token, "graph-token-xyz");
  assert.equal(calls.length, 1);
  assert.equal(
    String(calls[0]?.input),
    "https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token",
  );
  assert.equal(calls[0]?.init?.method, "POST");
  assert.match(String(calls[0]?.init?.body), /grant_type=client_credentials/);
  assert.match(String(calls[0]?.init?.body), /scope=https%3A%2F%2Fgraph.microsoft.com%2F.default/);
});

test("fetchGraphAccessToken throws safe error when token request fails", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("unauthorized", { status: 401 });

  await assert.rejects(
    () => fetchGraphAccessToken(GRAPH_CONFIG, fetchImpl),
    (error: unknown) => {
      assert.ok(error instanceof BrcEduGraphError);
      assert.equal(error.message, "Microsoft Graph BRC Edu token request failed.");
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("downloadSupportCsvFromGraph downloads CSV content", async () => {
  const supportCsv = [
    "Video Title,Video URL,Help-Routing Category",
    "Setup guide,https://example.com/setup,setup",
  ].join("\n");
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/oauth2/v2.0/token")) {
      return new Response(JSON.stringify({ access_token: "graph-token-xyz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/drives/drive-789/items/item-abc/content")) {
      const authHeader =
        init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : (init?.headers as Record<string, string> | undefined)?.Authorization;
      assert.equal(authHeader, "Bearer graph-token-xyz");
      return new Response(supportCsv, { status: 200 });
    }

    return new Response("not found", { status: 404 });
  };

  const csvText = await downloadSupportCsvFromGraph(GRAPH_CONFIG, fetchImpl);

  assert.equal(csvText, supportCsv);
  assert.equal(calls.length, 2);
});

test("downloadSupportCsvFromGraph throws safe error when download fails", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth2/v2.0/token")) {
      return new Response(JSON.stringify({ access_token: "graph-token-xyz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("forbidden", { status: 403 });
  };

  await assert.rejects(
    () => downloadSupportCsvFromGraph(GRAPH_CONFIG, fetchImpl),
    (error: unknown) => {
      assert.ok(error instanceof BrcEduGraphError);
      assert.equal(error.message, "Microsoft Graph BRC Edu download failed.");
      assert.doesNotMatch(error.message, /graph-token-xyz/);
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
});

test("Graph errors do not include secrets in messages", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("network failure with super-secret-value");
  };

  await assert.rejects(
    () => fetchGraphAccessToken(GRAPH_CONFIG, fetchImpl),
    (error: unknown) => {
      assert.ok(error instanceof BrcEduGraphError);
      assert.equal(error.message, "Microsoft Graph BRC Edu token request failed.");
      assert.doesNotMatch(String(error), /super-secret-value/);
      return true;
    },
  );
});
