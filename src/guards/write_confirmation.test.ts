import assert from "node:assert/strict";
import test from "node:test";

import { getBrcMcpServerInstructions } from "../config/mcp_config.js";
import { wrapWriteToolHandler } from "./write_confirmation.js";

function parseBody(result: unknown): Record<string, unknown> {
  const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
  return JSON.parse(text) as Record<string, unknown>;
}

const ANALYSED_CASH_RECEIPT = {
  companyName: "Company C",
  total: 12.3,
  note: "Analysed cash receipt",
  acEntries: [
    {
      accountCode: "CR02",
      analysisCategoryId: 4216690,
      description: "Cash sale",
      value: 12.3,
    },
  ],
  vatEntries: [
    {
      vatRateId: 1596277,
      percentage: 23,
      amount: 12.3,
    },
  ],
};

const CUSTOMER_CASH_RECEIPT = {
  companyName: "Company C",
  total: 50,
  note: "Customer cash receipt",
  customerId: 26540869,
  acCode: "878",
};

test("1. customer-ledger cash receipt requires confirmCounterpartyExplicit", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_cash_receipt", async () => {
    handlerCalled = true;
    return "posted";
  });

  const result = await wrapped(CUSTOMER_CASH_RECEIPT);
  const body = parseBody(result);

  assert.equal(body.status, "counterparty_confirmation_required");
  assert.equal(body.confirmationField, "confirmCounterpartyExplicit");
  assert.match(String(body.message), /customer/i);
  assert.equal(handlerCalled, false);
});

test("2. analysed cash receipt with acEntries does not require confirmCounterpartyExplicit", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_cash_receipt", async () => {
    handlerCalled = true;
    return "posted";
  });

  const result = await wrapped(ANALYSED_CASH_RECEIPT);
  const body = parseBody(result);

  assert.equal(body.status, "confirmation_required");
  assert.equal(body.confirmationField, "confirmWrite");
  assert.notEqual(body.status, "counterparty_confirmation_required");
  assert.equal(
    String(body.message).includes("which customer"),
    false,
    "analysed cash receipt must not ask the user to choose a customer"
  );
  assert.equal(handlerCalled, false);
});

test("3. analysed cash receipt still requires ordinary preview confirmWrite", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_cash_receipt", async () => {
    handlerCalled = true;
    return "posted";
  });

  const preview = parseBody(await wrapped(ANALYSED_CASH_RECEIPT));
  assert.equal(preview.status, "confirmation_required");
  assert.equal(handlerCalled, false);

  const posted = await wrapped({
    ...ANALYSED_CASH_RECEIPT,
    confirmWrite: true,
  });
  assert.equal(posted, "posted");
  assert.equal(handlerCalled, true);
});

test("4. cash receipt with neither customer nor analysis remains blocked", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_cash_receipt", async () => {
    handlerCalled = true;
    return "posted";
  });

  const result = await wrapped({
    companyName: "Company C",
    total: 12.3,
    note: "Incomplete cash receipt",
  });
  const body = parseBody(result);

  assert.equal(body.status, "counterparty_missing");
  assert.match(String(body.message), /analysis allocation|customer/i);
  assert.equal(handlerCalled, false);
});

test("5. batch analysed cash receipt does not require confirmCounterpartyExplicit", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_batch_cash_receipts", async () => {
    handlerCalled = true;
    return "posted";
  });

  const preview = parseBody(
    await wrapped({
      companyName: "Company C",
      items: [
        {
          item: {
            total: 12.3,
            note: "Batch analysed receipt",
            acEntries: [
              {
                accountCode: "CR02",
                analysisCategoryId: 4216690,
                description: "Cash sale",
                value: 12.3,
              },
            ],
          },
        },
      ],
    })
  );

  assert.equal(preview.status, "confirmation_required");
  assert.equal(preview.confirmationField, "confirmWrite");
  assert.equal(handlerCalled, false);

  const posted = await wrapped({
    companyName: "Company C",
    confirmWrite: true,
    items: [
      {
        item: {
          total: 12.3,
          note: "Batch analysed receipt",
          analysisCategoryId: 4216690,
          accountCode: "CR02",
          description: "Cash sale",
        },
      },
    ],
  });
  assert.equal(posted, "posted");
  assert.equal(handlerCalled, true);
});

test("5b. batch customer cash receipt still requires confirmCounterpartyExplicit", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_batch_cash_receipts", async () => {
    handlerCalled = true;
    return "posted";
  });

  const body = parseBody(
    await wrapped({
      companyName: "Company C",
      items: [{ item: { ...CUSTOMER_CASH_RECEIPT } }],
    })
  );

  assert.equal(body.status, "counterparty_confirmation_required");
  assert.equal(handlerCalled, false);
});

test("6. sales invoice counterparty confirmation remains unchanged", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_sales_invoice", async () => {
    handlerCalled = true;
    return "posted";
  });

  // Omit companyName so the Sales VAT preflight is skipped and this test
  // isolates counterparty confirmation behaviour only.
  const missing = parseBody(
    await wrapped({
      total: 10,
      note: "Invoice without customer",
    })
  );
  assert.equal(missing.status, "counterparty_missing");

  const needsConfirm = parseBody(
    await wrapped({
      customerId: 1,
      acCode: "CUST",
      total: 10,
    })
  );
  assert.equal(needsConfirm.status, "counterparty_confirmation_required");
  assert.equal(needsConfirm.confirmationField, "confirmCounterpartyExplicit");

  const preview = parseBody(
    await wrapped({
      customerId: 1,
      acCode: "CUST",
      total: 10,
      confirmCounterpartyExplicit: true,
    })
  );
  assert.equal(preview.status, "confirmation_required");
  assert.equal(preview.confirmationField, "confirmWrite");
  assert.equal(handlerCalled, false);
});

test("6b. purchase counterparty confirmation remains unchanged", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_purchase", async () => {
    handlerCalled = true;
    return "posted";
  });

  const body = parseBody(
    await wrapped({
      supplierId: 99,
      acCode: "SUP1",
      total: 20,
    })
  );

  assert.equal(body.status, "counterparty_confirmation_required");
  assert.equal(handlerCalled, false);
});

test("mcp instructions: analysed cash receipts do not always require a customer", () => {
  const instructions = getBrcMcpServerInstructions(50, false);

  assert.match(
    instructions,
    /only require explicit customer confirmation when the cash receipt actually uses a customer/i
  );
  assert.match(
    instructions,
    /Analysed cash receipts may instead use an explicitly supplied analysis allocation/i
  );
  assert.match(instructions, /do not invent a customer/i);
});
