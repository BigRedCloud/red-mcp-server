import assert from "node:assert/strict";
import test from "node:test";

import { wrapWriteToolHandler } from "../../guards/write_confirmation.js";
import {
  enforceReferenceSettingsOrThrow,
  type CompanyReferenceSettings,
} from "../../guards/company_reference_settings.js";
import {
  assertQuoteManualReferenceLengthOrThrow,
  buildQuoteCreatePayloadFromToolArgs,
  buildQuotePayload,
  normalizeBatchItems,
  QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE,
} from "../general/payloads_tools.js";
import {
  buildQuoteReferenceUpdatePayload,
  quoteManualReferenceSchema,
} from "./quotes_tools.js";

function parseBody(result: unknown): Record<string, unknown> {
  const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Note: BRC list-vs-get differences for Quote fields such as note/accountCode are
 * API representation differences and are not create failures.
 */
const DISPOSABLE_QUOTE_ARGS = {
  companyName: "Company C",
  companyId: 806559,
  reference: "BQ1234",
  customerOwnerId: 26540869,
  acCode: "878",
  customerOwnerName: "Paul Conroy Ltd",
  entryDate: "2026-08-13",
  procDate: "2026-08-13",
  vatTypeId: 1,
  layoutType: 1,
  comments: "DISPOSABLE QUOTE CREATE TEST",
  saleRepId: 153992,
  saleRepCode: "7777",
  productId: 5023355,
  productCode: "PR001",
  quantity: 1,
  unitPrice: 10,
  vatRateId: 1596277,
  vatPercentage: 23,
  tranNote: "DISPOSABLE QUOTE CREATE TEST",
  analysisCategoryId: 4216701,
  accountCode: "SA01",
  routeToken: "should-not-appear",
  connectionRef: "should-not-appear",
  apiKey: "should-not-appear",
} as const;

function assertNestedQuoteShape(preview: Record<string, unknown>): void {
  assert.equal(preview.companyId, 806559);
  assert.equal(preview.customerOwnerId, 26540869);
  assert.equal(preview.saleRepId, 153992);
  assert.equal(preview.totalNet, 10);
  assert.equal(preview.totalVat, 2.3);
  assert.equal(preview.total, 12.3);
  assert.equal("totalVAT" in preview, false, "Quotes must use totalVat, not totalVAT");

  assert.ok(Array.isArray(preview.productTrans));
  const line = (preview.productTrans as Record<string, unknown>[])[0]!;
  assert.equal(line.percentage, 23);
  assert.equal(line.vatRateId, 1596277);
  assert.equal(line.productId, 5023355);
  assert.equal(line.productCode, "PR001");
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 10);
  assert.equal(line.amount, 12.3);
  assert.equal(line.vatAmount, 2.3);
  assert.equal(line.vatAnalysisTypeId, 0);
  assert.deepEqual(line.tranNotes, ["DISPOSABLE QUOTE CREATE TEST"]);
  assert.equal("tranNote" in line, false, "Quote API uses tranNotes[], not singular tranNote");

  assert.ok(Array.isArray(line.acEntries));
  const entry = (line.acEntries as Record<string, unknown>[])[0]!;
  assert.equal(entry.accountCode, "SA01");
  assert.equal(entry.analysisCategoryId, 4216701);
  assert.equal(entry.value, 10);
}

test("buildQuotePayload disposable input matches nested Quote contract fields", () => {
  const payload = buildQuotePayload({ ...DISPOSABLE_QUOTE_ARGS });
  assertNestedQuoteShape(payload);
  assert.equal(payload.reference, "BQ1234");
  assert.equal(payload.acCode, "878");
  assert.equal(payload.customerOwnerName, "Paul Conroy Ltd");
  assert.equal(payload.saleRepCode, "7777");
  assert.equal(payload.vatTypeId, 1);
  assert.equal(payload.layoutType, 1);

  const line = (payload.productTrans as Record<string, unknown>[])[0]!;
  assert.equal(line.companyId, 806559);
  const entry = (line.acEntries as Record<string, unknown>[])[0]!;
  assert.equal(entry.companyId, 806559);
});

test("buildQuoteCreatePayloadFromToolArgs matches buildQuotePayload", () => {
  const fromHelper = buildQuoteCreatePayloadFromToolArgs({ ...DISPOSABLE_QUOTE_ARGS });
  const fromBuilder = buildQuotePayload({ ...DISPOSABLE_QUOTE_ARGS });
  assert.deepEqual(fromHelper, fromBuilder);
});

test("brc_create_quote confirmWrite=false returns nested payloadPreview and does not POST", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_quote", async () => {
    handlerCalled = true;
    return "posted";
  });

  const result = await wrapped({
    ...DISPOSABLE_QUOTE_ARGS,
    confirmCounterpartyExplicit: true,
    confirmWrite: false,
  });
  const body = parseBody(result);

  assert.equal(handlerCalled, false);
  assert.equal(body.status, "confirmation_required");
  assert.equal(body.confirmationRequired, true);
  assert.equal(body.endpoint, "POST /v1/quotes");
  assert.equal(body.confirmationField, "confirmWrite");

  const preview = body.payloadPreview as Record<string, unknown>;
  assertNestedQuoteShape(preview);
  assert.equal(preview.reference, "BQ1234");
  assert.equal("routeToken" in preview, false);
  assert.equal("connectionRef" in preview, false);
  assert.equal("apiKey" in preview, false);
  assert.equal("companyName" in preview, false);
  assert.equal("tranNote" in preview, false);
});

test("brc_create_quote confirmed path uses same nested payload shape as preview", async () => {
  const expected = buildQuoteCreatePayloadFromToolArgs({ ...DISPOSABLE_QUOTE_ARGS });
  let capturedArgs: Record<string, unknown> | undefined;

  const wrapped = wrapWriteToolHandler("brc_create_quote", async (args) => {
    capturedArgs = args as Record<string, unknown>;
    const payloadSent = buildQuoteCreatePayloadFromToolArgs(args as Record<string, unknown>);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "ok",
            payloadSent,
          }),
        },
      ],
    };
  });

  const previewResult = await wrapped({
    ...DISPOSABLE_QUOTE_ARGS,
    confirmCounterpartyExplicit: true,
    confirmWrite: false,
  });
  const previewBody = parseBody(previewResult);
  const preview = previewBody.payloadPreview as Record<string, unknown>;

  const postResult = await wrapped({
    ...DISPOSABLE_QUOTE_ARGS,
    confirmCounterpartyExplicit: true,
    confirmWrite: true,
  });
  const postBody = parseBody(postResult);
  const payloadSent = postBody.payloadSent as Record<string, unknown>;

  assert.ok(capturedArgs);
  assert.deepEqual(preview, expected);
  assert.deepEqual(payloadSent, expected);
  assert.deepEqual(payloadSent, preview);
  assert.equal("routeToken" in payloadSent, false);
  assert.equal("connectionRef" in payloadSent, false);
});

test("brc_create_quote_gen_ref preview uses generated-reference endpoint and omits absent reference", async () => {
  let handlerCalled = false;
  const wrapped = wrapWriteToolHandler("brc_create_quote_gen_ref", async () => {
    handlerCalled = true;
    return "posted";
  });

  const { reference: _reference, ...withoutReference } = DISPOSABLE_QUOTE_ARGS;
  const result = await wrapped({
    ...withoutReference,
    confirmCounterpartyExplicit: true,
    confirmWrite: false,
    confirmQuotesAutoGenerateInBrc: true,
  });
  const body = parseBody(result);

  assert.equal(handlerCalled, false);
  assert.equal(body.status, "confirmation_required");
  assert.equal(body.confirmationRequired, true);
  assert.equal(
    body.endpoint,
    "POST /v1/quotes/createQuoteWithGeneratingReference"
  );

  const preview = body.payloadPreview as Record<string, unknown>;
  assertNestedQuoteShape(preview);
  assert.equal("reference" in preview, false);
});

test("manual quote reference guard still requires a reference when Quotes are Manual", () => {
  const settings: CompanyReferenceSettings = {
    raw: {},
    quotesAutoGenerateReference: false,
  };

  assert.throws(
    () => enforceReferenceSettingsOrThrow(settings, "quote", {}, "manual"),
    /manual quote references/i
  );

  const ok = enforceReferenceSettingsOrThrow(
    settings,
    "quote",
    { reference: "BQ1234" },
    "manual"
  );
  assert.deepEqual(ok.warnings, []);
});

test("generated quote reference guard blocks gen-ref when Quotes are Manual", () => {
  const settings: CompanyReferenceSettings = {
    raw: {},
    quotesAutoGenerateReference: false,
  };

  assert.throws(
    () =>
      enforceReferenceSettingsOrThrow(settings, "quote", {}, "generated"),
    /manual quote references/i
  );
});

test("generated quote reference guard allows gen-ref when Quotes are Auto", () => {
  const settings: CompanyReferenceSettings = {
    raw: {},
    quotesAutoGenerateReference: true,
  };

  const result = enforceReferenceSettingsOrThrow(settings, "quote", {}, "generated");
  assert.deepEqual(result.warnings, []);
});

test("manual Quote reference accepts BQ1234 and 000001", () => {
  assert.doesNotThrow(() => assertQuoteManualReferenceLengthOrThrow("BQ1234"));
  assert.doesNotThrow(() => assertQuoteManualReferenceLengthOrThrow("000001"));
  assert.equal(quoteManualReferenceSchema.parse("BQ1234"), "BQ1234");
  assert.equal(quoteManualReferenceSchema.parse("000001"), "000001");

  const withBq = buildQuotePayload({ ...DISPOSABLE_QUOTE_ARGS, reference: "BQ1234" });
  assert.equal(withBq.reference, "BQ1234");
  const withZeros = buildQuotePayload({ ...DISPOSABLE_QUOTE_ARGS, reference: "000001" });
  assert.equal(withZeros.reference, "000001");
});

test("manual Quote reference rejects 7-character and long staging values", () => {
  assert.throws(
    () => assertQuoteManualReferenceLengthOrThrow("BQ12345"),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );
  assert.throws(
    () => assertQuoteManualReferenceLengthOrThrow("QUOTE-TEST-20260813-01"),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );

  const seven = quoteManualReferenceSchema.safeParse("BQ12345");
  assert.equal(seven.success, false);
  if (!seven.success) {
    assert.match(seven.error.issues[0]!.message, /6 characters or fewer/i);
  }

  const staging = quoteManualReferenceSchema.safeParse("QUOTE-TEST-20260813-01");
  assert.equal(staging.success, false);

  assert.throws(
    () =>
      buildQuotePayload({
        ...DISPOSABLE_QUOTE_ARGS,
        reference: "QUOTE-TEST-20260813-01",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );
});

test("batch Quote long reference is rejected before posting", () => {
  assert.throws(
    () =>
      normalizeBatchItems("/v1/quotes", [
        {
          opCode: 1,
          item: {
            ...DISPOSABLE_QUOTE_ARGS,
            reference: "QUOTE-TEST-20260813-01",
          },
        },
      ]),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );

  assert.throws(
    () =>
      normalizeBatchItems("/v1/quotes", [
        {
          opCode: 1,
          item: {
            companyId: 806559,
            customerOwnerId: 26540869,
            acCode: "878",
            customerOwnerName: "Paul Conroy Ltd",
            reference: "TOOLONG",
            productTrans: [{ productId: 1 }],
          },
        },
      ]),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );
});

test("update Quote long reference schema is rejected", () => {
  const result = quoteManualReferenceSchema.safeParse("QUOTE-TEST-20260813-01");
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(
      result.error.issues[0]!.message,
      QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
    );
  }

  assert.throws(
    () => assertQuoteManualReferenceLengthOrThrow("QUOTE-TEST-20260813-01"),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );
});

test("brc_update_quote reference-only update clones current Quote and patches reference", () => {
  const current = {
    id: 2892396,
    companyId: 806559,
    customerOwnerId: 26540869,
    vatTypeId: 1,
    saleRepId: 153992,
    saleRepCode: "7777",
    entryDate: "2026-08-13T00:00:00",
    procDate: "2026-08-13T00:00:00",
    closedDate: null,
    reference: "QT0001",
    customerOwnerName: "Paul Conroy Ltd",
    comments: "Keep comments",
    layoutType: 1,
    total: 12.3,
    totalVat: 2.3,
    totalNet: 10,
    note: null,
    acCode: "878",
    timeStamp: "ABC123timestamp=",
    productTrans: [
      {
        id: 100,
        companyId: 806559,
        percentage: 23,
        vatRateId: 1596277,
        productId: 5023355,
        productCode: "PR001",
        quantity: 1,
        unitPrice: 10,
        amount: 12.3,
        vatAmount: 2.3,
        tranNotes: ["Line note"],
        acEntries: [
          {
            id: 200,
            companyId: 806559,
            accountCode: "SA01",
            analysisCategoryId: 4216701,
            quoteProductTranId: 100,
            value: 10,
          },
        ],
        vatAnalysisTypeId: 0,
      },
    ],
  };

  const payload = buildQuoteReferenceUpdatePayload(current, "QT0002");

  assert.equal(payload.reference, "QT0002");
  assert.equal(payload.timeStamp, "ABC123timestamp=");
  assert.equal(payload.note, null);
  assert.equal(payload.comments, "Keep comments");
  assert.equal(payload.customerOwnerId, 26540869);
  assert.equal(payload.acCode, "878");
  assert.equal(payload.saleRepId, 153992);
  assert.equal(payload.saleRepCode, "7777");
  assert.equal(payload.totalNet, 10);
  assert.equal(payload.totalVat, 2.3);
  assert.equal(payload.total, 12.3);
  assert.equal(payload.closedDate, null);
  assert.deepEqual(payload.productTrans, current.productTrans);

  const line = (payload.productTrans as Record<string, unknown>[])[0]!;
  assert.ok(Array.isArray(line.acEntries));
  assert.deepEqual(line.acEntries, current.productTrans[0]!.acEntries);

  // Mutation safety: clone, do not rewrite the GET record in place.
  assert.equal(current.reference, "QT0001");
  assert.notEqual(payload.productTrans, current.productTrans);
});

test("brc_update_quote rejects reference longer than 6 characters before PUT body is built", () => {
  assert.throws(
    () =>
      buildQuoteReferenceUpdatePayload(
        { id: 1, reference: "QT0001", timeStamp: "ts" },
        "TOOLONG"
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE
  );
});