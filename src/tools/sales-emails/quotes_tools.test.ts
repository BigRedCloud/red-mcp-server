import assert from "node:assert/strict";
import test from "node:test";

import { wrapWriteToolHandler } from "../../guards/write_confirmation.js";
import {
  enforceReferenceSettingsOrThrow,
  type CompanyReferenceSettings,
} from "../../guards/company_reference_settings.js";
import {
  buildQuoteCreatePayloadFromToolArgs,
  buildQuotePayload,
} from "../general/payloads_tools.js";

function parseBody(result: unknown): Record<string, unknown> {
  const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
  return JSON.parse(text) as Record<string, unknown>;
}

const DISPOSABLE_QUOTE_ARGS = {
  companyName: "Company C",
  companyId: 806559,
  reference: "QUOTE-TEST-20260813-01",
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
  assert.equal(payload.reference, "QUOTE-TEST-20260813-01");
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
  assert.equal(preview.reference, "QUOTE-TEST-20260813-01");
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
    { reference: "QUOTE-TEST-20260813-01" },
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
