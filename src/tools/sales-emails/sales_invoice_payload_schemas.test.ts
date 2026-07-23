import assert from "node:assert/strict";
import test from "node:test";

import { enforceSalesProductLineProductIdOrThrow } from "../general/payloads_tools.js";
import {
  buildSalesVatCategoryContext,
  enforceSalesVatCategoryOrThrow,
  setSalesVatCategoryContextLoaderForTests,
} from "../../guards/sales_vat_category.js";
import { createSalesInvoiceWithGeneratingReference } from "./sales_entry_inv_tools.js";
import { validateGeneratedReferenceSalesInvoicePayload } from "./sales_invoice_payload_schemas.js";

type AnalysisEntry = {
  id?: number;
  accountCode: string;
  analysisCategoryId: number;
  description?: string;
  value: number;
};

type ProductLine = {
  id?: number;
  amount: number;
  amountNet: number;
  percentage: number;
  productId?: number;
  productCode: string;
  quantity: number;
  unitPrice: number;
  vat: number;
  vatRateId: number;
  vatAnalysisTypeId: number;
  useTaxInclusiveUnitPrice?: boolean;
  tranNotes: string[];
  acEntries?: AnalysisEntry[];
};

function analysisEntry(overrides: Partial<AnalysisEntry> & { value: number }): AnalysisEntry {
  return {
    id: 0,
    accountCode: "S01",
    analysisCategoryId: 10,
    description: "Line analysis",
    ...overrides,
  };
}

function productLine(
  overrides: Partial<ProductLine> & {
    amountNet: number;
    vat: number;
  }
): ProductLine {
  const quantity = overrides.quantity ?? 1;
  const amountNet = overrides.amountNet;
  const vat = overrides.vat;
  const amount = overrides.amount ?? amountNet + vat;
  const unitPrice =
    overrides.unitPrice ??
    (overrides.useTaxInclusiveUnitPrice ? amount / quantity : amountNet / quantity);

  return {
    id: 0,
    percentage: 23,
    productId: 5023355,
    productCode: "WID",
    vatRateId: 10,
    vatAnalysisTypeId: 1,
    useTaxInclusiveUnitPrice: false,
    tranNotes: ["Widget"],
    acEntries: [analysisEntry({ value: amountNet })],
    ...overrides,
    quantity,
    amountNet,
    vat,
    amount,
    unitPrice,
  };
}

function validInvoice(
  lines: ProductLine[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const totalNet = lines.reduce((sum, line) => sum + line.amountNet, 0);
  const totalVAT = lines.reduce((sum, line) => sum + line.vat, 0);
  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  return {
    customerId: 100,
    acCode: "CUST01",
    entryDate: "2026-07-01",
    procDate: "2026-07-01",
    saleRepId: 2,
    saleRepCode: "REP",
    bookTranTypeId: 6,
    totalNet,
    totalVAT,
    total,
    unpaid: total,
    useTaxInclusiveUnitPrice: false,
    vatTypeId: 1,
    id: 0,
    quoteId: 0,
    netGoods: 0,
    netServices: 0,
    customFields: [],
    productTrans: lines,
    ...overrides,
  };
}

function twoLineInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return validInvoice(
    [
      productLine({
        amountNet: 100,
        vat: 23,
        productId: 5023355,
        productCode: "A",
      }),
      productLine({
        amountNet: 50,
        vat: 11.5,
        productId: 5023356,
        productCode: "B",
        quantity: 2,
        unitPrice: 25,
      }),
    ],
    overrides
  );
}

function threeLineInvoice(): Record<string, unknown> {
  return validInvoice([
    productLine({ amountNet: 100, vat: 23, productCode: "A" }),
    productLine({
      amountNet: 40,
      vat: 9.2,
      productCode: "B",
      quantity: 2,
      unitPrice: 20,
    }),
    productLine({
      amountNet: 10,
      vat: 0,
      percentage: 0,
      productCode: "C",
      quantity: 1,
      unitPrice: 10,
    }),
  ]);
}

function parseResponseText(result: { content: Array<{ text: string }> }): Record<
  string,
  unknown
> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const VAT_CATEGORIES = {
  items: [
    { id: 1, name: "Sales" },
    { id: 2, name: "Purchases for Resale" },
  ],
};
const VAT_RATES = {
  items: [
    { id: 10, percentage: 23, vatCategoryId: 1 },
    { id: 20, percentage: 23, vatCategoryId: 2 },
  ],
};

test("valid two-line invoice passes schema validation", () => {
  const result = validateGeneratedReferenceSalesInvoicePayload(twoLineInvoice());
  assert.equal(result.valid, true);
});

test("valid three-line invoice passes schema validation", () => {
  const result = validateGeneratedReferenceSalesInvoicePayload(threeLineInvoice());
  assert.equal(result.valid, true);
});

test("missing productTrans returns a field error", () => {
  const payload = twoLineInvoice();
  delete payload.productTrans;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some((error) => error.field === "productTrans"),
    `expected productTrans error, got ${JSON.stringify(result.errors)}`
  );
});

test("product line missing acEntries returns a field error", () => {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Record<string, unknown>[];
  delete lines[0]!.acEntries;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some((error) => error.field === "productTrans.0.acEntries"),
    `expected productTrans.0.acEntries, got ${JSON.stringify(result.errors)}`
  );
});

test("missing productTrans.1.acEntries returns structured field error", () => {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Record<string, unknown>[];
  delete lines[1]!.acEntries;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some((error) => error.field === "productTrans.1.acEntries"),
    `expected productTrans.1.acEntries, got ${JSON.stringify(result.errors)}`
  );
});

test("empty productTrans.1.acEntries returns structured field error", () => {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Record<string, unknown>[];
  lines[1]!.acEntries = [];

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some((error) => error.field === "productTrans.1.acEntries"),
    `expected productTrans.1.acEntries, got ${JSON.stringify(result.errors)}`
  );
});

test("multiple invalid fields are returned together", () => {
  const payload = twoLineInvoice({
    totalNet: 999,
    totalVAT: 999,
    unpaid: 1,
  });

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  const fields = result.errors.map((error) => error.field);
  assert.ok(fields.includes("totalNet"));
  assert.ok(fields.includes("totalVAT"));
  assert.ok(fields.includes("unpaid"));
  assert.ok(result.errors.length >= 3);
});

test("analysis values not reconciling to amountNet are rejected", () => {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Array<{
    acEntries: Array<{ value: number }>;
    amountNet: number;
  }>;
  lines[0]!.acEntries[0]!.value = lines[0]!.amountNet + 5;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some(
      (error) =>
        error.field === "productTrans.0.acEntries" &&
        /amountNet/i.test(error.message)
    )
  );
});

test("line amount not equalling amountNet + VAT is rejected", () => {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Array<{ amount: number }>;
  lines[1]!.amount = 1;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some(
      (error) =>
        error.field === "productTrans.1.amount" &&
        /amountNet \+ vat/i.test(error.message)
    )
  );
});

test("incorrect header totalNet is rejected", () => {
  const result = validateGeneratedReferenceSalesInvoicePayload(
    twoLineInvoice({ totalNet: 1 })
  );
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }
  assert.ok(result.errors.some((error) => error.field === "totalNet"));
});

test("incorrect header totalVAT is rejected", () => {
  const result = validateGeneratedReferenceSalesInvoicePayload(
    twoLineInvoice({ totalVAT: 1 })
  );
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }
  assert.ok(result.errors.some((error) => error.field === "totalVAT"));
});

test("incorrect header total is rejected", () => {
  const result = validateGeneratedReferenceSalesInvoicePayload(
    twoLineInvoice({ total: 1, unpaid: 1 })
  );
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }
  assert.ok(result.errors.some((error) => error.field === "total"));
});

test("omitted unpaid is accepted", () => {
  const payload = twoLineInvoice();
  delete payload.unpaid;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, true);
});

test("supplied unpaid that differs from total is rejected", () => {
  const payload = twoLineInvoice();
  payload.unpaid = Number(payload.total) - 1;

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false);
  if (result.valid) {
    return;
  }
  assert.ok(result.errors.some((error) => error.field === "unpaid"));
});

function assertMissingLineFieldRejected(field: keyof ProductLine): void {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Record<string, unknown>[];
  delete lines[0]![field];

  const result = validateGeneratedReferenceSalesInvoicePayload(payload);
  assert.equal(result.valid, false, `expected missing ${field} to fail`);
  if (result.valid) {
    return;
  }

  assert.ok(
    result.errors.some((error) => error.field.includes(field)),
    `expected an error mentioning ${field}, got ${JSON.stringify(result.errors)}`
  );
}

test("missing productCode is rejected", () => {
  assertMissingLineFieldRejected("productCode");
});

test("missing percentage is rejected", () => {
  assertMissingLineFieldRejected("percentage");
});

test("missing vatRateId is rejected", () => {
  assertMissingLineFieldRejected("vatRateId");
});

test("missing vatAnalysisTypeId is rejected", () => {
  assertMissingLineFieldRejected("vatAnalysisTypeId");
});

test("missing tranNotes is rejected", () => {
  assertMissingLineFieldRejected("tranNotes");
});

test("invalid payload does not call brcJsonRequest", async () => {
  let brcJsonRequestCalled = false;

  const result = await createSalesInvoiceWithGeneratingReference(
    {
      companyName: "Test Co",
      payload: twoLineInvoice({ totalNet: 1 }),
    },
    {
      brcJsonRequest: async () => {
        brcJsonRequestCalled = true;
        return { ok: true };
      },
      resolveCustomerVatType: async () => 1,
      loadAndEnforceTransactionSettings: async () => ({
        raw: {},
        cashReceiptVatMode: "not_enabled",
        grossPriceSalesInvoicingEnabled: false,
      }),
      loadAndEnforceReferenceSettings: async () => ({
        settings: {
          raw: {},
          salesAutoGenerateReference: true,
        },
        warnings: [],
      }),
      enforceSalesVatCategoryOrThrow: async () => undefined,
    }
  );

  assert.equal(brcJsonRequestCalled, false);
  const body = parseResponseText(result);
  assert.equal(body.valid, false);
  assert.equal(body.companyName, "Test Co");
  assert.ok(Array.isArray(body.errors));
  assert.ok((body.errors as unknown[]).length > 0);
});

async function assertAcEntriesLineOneFailureDoesNotCallBrc(
  mutate: (lines: Record<string, unknown>[]) => void
): Promise<void> {
  let brcJsonRequestCalled = false;
  const payload = twoLineInvoice();
  mutate(payload.productTrans as Record<string, unknown>[]);

  let threw = false;
  let result: { content: Array<{ text: string }> } | undefined;
  try {
    result = await createSalesInvoiceWithGeneratingReference(
      {
        companyName: "Test Co",
        payload,
      },
      {
        brcJsonRequest: async () => {
          brcJsonRequestCalled = true;
          return { ok: true };
        },
        resolveCustomerVatType: async () => 1,
        loadAndEnforceTransactionSettings: async () => ({
          raw: {},
          cashReceiptVatMode: "not_enabled",
          grossPriceSalesInvoicingEnabled: false,
        }),
        loadAndEnforceReferenceSettings: async () => ({
          settings: {
            raw: {},
            salesAutoGenerateReference: true,
          },
          warnings: [],
        }),
        enforceSalesVatCategoryOrThrow: async () => undefined,
      }
    );
  } catch {
    threw = true;
  }

  assert.equal(threw, false, "handler must not throw for acEntries validation failures");
  assert.equal(brcJsonRequestCalled, false);
  assert.ok(result);
  const body = parseResponseText(result!);
  assert.equal(body.valid, false);
  assert.ok(Array.isArray(body.errors));
  assert.ok(
    (body.errors as Array<{ field: string }>).some(
      (error) => error.field === "productTrans.1.acEntries"
    ),
    `expected productTrans.1.acEntries in ${JSON.stringify(body.errors)}`
  );
}

test("missing productTrans.1.acEntries does not throw and does not call brcJsonRequest", async () => {
  await assertAcEntriesLineOneFailureDoesNotCallBrc((lines) => {
    delete lines[1]!.acEntries;
  });
});

test("empty productTrans.1.acEntries does not throw and does not call brcJsonRequest", async () => {
  await assertAcEntriesLineOneFailureDoesNotCallBrc((lines) => {
    lines[1]!.acEntries = [];
  });
});

test("write wrapper returns structured acEntries error before preview without calling handler", async () => {
  const { wrapWriteToolHandler } = await import(
    "../../guards/write_confirmation.js"
  );

  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler(
    "brc_create_sales_invoice_gen_ref",
    async () => {
      handlerCalled = true;
      return "posted";
    }
  );

  const payload = twoLineInvoice();
  (payload.productTrans as Record<string, unknown>[])[1]!.acEntries = [];

  // Omit companyName so Sales VAT preflight (network) is skipped; schema
  // validation must still return a structured response before preview.
  let threw = false;
  let result: unknown;
  try {
    result = await wrapped({
      payload,
    });
  } catch {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(handlerCalled, false);
  const body = parseResponseText(
    result as { content: Array<{ text: string }> }
  );
  assert.equal(body.valid, false);
  assert.ok(
    (body.errors as Array<{ field: string }>).some(
      (error) => error.field === "productTrans.1.acEntries"
    )
  );
});

test("existing placeholder product ID guard still works on multi-line payloads", () => {
  const payload = twoLineInvoice();
  const lines = payload.productTrans as Array<{ productId: number }>;
  lines[1]!.productId = 1;

  assert.throws(
    () => enforceSalesProductLineProductIdOrThrow(payload),
    /placeholder productId 1/
  );
});

test("existing Sales VAT guard still works on multi-line payloads", async () => {
  setSalesVatCategoryContextLoaderForTests(async () =>
    buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES)
  );

  try {
    const payload = twoLineInvoice();
    const lines = payload.productTrans as Array<{ vatRateId: number }>;
    lines[0]!.vatRateId = 20;

    await assert.rejects(
      async () => enforceSalesVatCategoryOrThrow("Test Co", payload),
      /Sales VAT|VAT category|purchase/i
    );
  } finally {
    setSalesVatCategoryContextLoaderForTests();
  }
});
