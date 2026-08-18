import assert from "node:assert/strict";
import test from "node:test";
import { wrapWriteToolHandler } from "../../guards/write_confirmation.js";
import { enforceReferenceSettingsOrThrow, } from "../../guards/company_reference_settings.js";
import { assertQuoteManualReferenceLengthOrThrow, buildQuoteCreatePayloadFromToolArgs, buildQuotePayload, normalizeBatchItems, QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE, } from "../general/payloads_tools.js";
import { buildGenerateSalesInvoiceFromQuotePayload, buildQuoteCreateSuccessBody, buildQuoteDeletePreview, buildQuoteReferenceUpdatePayload, describeQuotePostDeleteVerification, extractCreatedQuoteId, quoteManualReferenceSchema, } from "./quotes_tools.js";
function parseBody(result) {
    const text = result.content[0].text;
    return JSON.parse(text);
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
};
function assertNestedQuoteShape(preview) {
    assert.equal(preview.companyId, 806559);
    assert.equal(preview.customerOwnerId, 26540869);
    assert.equal(preview.saleRepId, 153992);
    assert.equal(preview.totalNet, 10);
    assert.equal(preview.totalVat, 2.3);
    assert.equal(preview.total, 12.3);
    assert.equal("totalVAT" in preview, false, "Quotes must use totalVat, not totalVAT");
    assert.ok(Array.isArray(preview.productTrans));
    const line = preview.productTrans[0];
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
    const entry = line.acEntries[0];
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
    const line = payload.productTrans[0];
    assert.equal(line.companyId, 806559);
    const entry = line.acEntries[0];
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
    const preview = body.payloadPreview;
    assertNestedQuoteShape(preview);
    assert.equal(preview.reference, "BQ1234");
    assert.equal("routeToken" in preview, false);
    assert.equal("connectionRef" in preview, false);
    assert.equal("apiKey" in preview, false);
    assert.equal("companyName" in preview, false);
    assert.equal("tranNote" in preview, false);
});
test("brc_batch_quotes confirmWrite=false previews exact BRC batch body and does not PUT", async () => {
    let handlerCalled = false;
    const wrapped = wrapWriteToolHandler("brc_batch_quotes", async () => {
        handlerCalled = true;
        return "posted";
    });
    const flatItem = {
        ...DISPOSABLE_QUOTE_ARGS,
        unitPrice: 7.5,
        reference: "QB0002",
    };
    delete flatItem.companyName;
    const result = await wrapped({
        companyName: "Company C",
        items: [{ opCode: 1, item: flatItem }],
        confirmCounterpartyExplicit: true,
        confirmWrite: false,
        routeToken: "should-not-appear",
        connectionRef: "should-not-appear",
        apiKey: "should-not-appear",
    });
    const body = parseBody(result);
    assert.equal(handlerCalled, false);
    assert.equal(body.status, "confirmation_required");
    assert.equal(body.confirmationRequired, true);
    assert.equal(body.endpoint, "PUT /v1/quotes/batch");
    assert.equal(body.confirmationField, "confirmWrite");
    const preview = body.payloadPreview;
    assert.ok(Array.isArray(preview));
    assert.equal(preview.length, 1);
    assert.equal(preview[0].opCode, 1);
    const quote = preview[0].item;
    assert.equal(quote.companyId, 806559);
    assert.equal(quote.customerOwnerId, 26540869);
    assert.equal(quote.totalNet, 7.5);
    assert.equal(quote.totalVat, 1.72);
    assert.equal(quote.total, 9.22);
    assert.equal("totalVAT" in quote, false);
    const line = quote.productTrans[0];
    assert.equal(line.percentage, 23);
    assert.equal(line.vatRateId, 1596277);
    assert.equal(line.productId, 5023355);
    assert.equal(line.quantity, 1);
    assert.equal(line.unitPrice, 7.5);
    assert.equal(line.vatAmount, 1.72);
    assert.equal(line.amount, 9.22);
    assert.ok(Array.isArray(line.acEntries));
    assert.equal(line.acEntries[0].value, 7.5);
    assert.equal(line.acEntries[0].accountCode, "SA01");
    assert.equal("companyName" in quote, false);
    assert.equal("routeToken" in quote, false);
    assert.equal("connectionRef" in quote, false);
    assert.equal("apiKey" in quote, false);
    assert.equal("routeToken" in preview[0], false);
    const expected = normalizeBatchItems("/v1/quotes", [
        { opCode: 1, item: flatItem },
    ]);
    assert.deepEqual(preview, expected);
});
test("brc_batch_quotes confirmed payloadSent matches preview shape via normalizeBatchItems", async () => {
    const flatItem = {
        ...DISPOSABLE_QUOTE_ARGS,
        unitPrice: 7.5,
        reference: "QB0002",
    };
    delete flatItem.companyName;
    const expected = normalizeBatchItems("/v1/quotes", [
        { opCode: 1, item: flatItem },
    ]);
    const wrapped = wrapWriteToolHandler("brc_batch_quotes", async (args) => {
        const record = args;
        const items = record.items;
        const payloadSent = normalizeBatchItems("/v1/quotes", items);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status: "ok",
                        endpoint: "PUT /v1/quotes/batch",
                        payloadSent,
                    }),
                },
            ],
        };
    });
    const previewBody = parseBody(await wrapped({
        companyName: "Company C",
        items: [{ opCode: 1, item: flatItem }],
        confirmCounterpartyExplicit: true,
        confirmWrite: false,
    }));
    assert.deepEqual(previewBody.payloadPreview, expected);
    const postBody = parseBody(await wrapped({
        companyName: "Company C",
        items: [{ opCode: 1, item: flatItem }],
        confirmCounterpartyExplicit: true,
        confirmWrite: true,
    }));
    assert.equal(postBody.endpoint, "PUT /v1/quotes/batch");
    assert.deepEqual(postBody.payloadSent, previewBody.payloadPreview);
    assert.deepEqual(postBody.payloadSent, expected);
    const sentItem = postBody.payloadSent[0]
        .item;
    assert.equal(sentItem.totalVat, 1.72);
    assert.equal(sentItem.total, 9.22);
});
test("brc_create_quote confirmed path uses same nested payload shape as preview", async () => {
    const expected = buildQuoteCreatePayloadFromToolArgs({ ...DISPOSABLE_QUOTE_ARGS });
    let capturedArgs;
    const wrapped = wrapWriteToolHandler("brc_create_quote", async (args) => {
        capturedArgs = args;
        const payloadSent = buildQuoteCreatePayloadFromToolArgs(args);
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
    const preview = previewBody.payloadPreview;
    const postResult = await wrapped({
        ...DISPOSABLE_QUOTE_ARGS,
        confirmCounterpartyExplicit: true,
        confirmWrite: true,
    });
    const postBody = parseBody(postResult);
    const payloadSent = postBody.payloadSent;
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
    assert.equal(body.endpoint, "POST /v1/quotes/createQuoteWithGeneratingReference");
    const preview = body.payloadPreview;
    assertNestedQuoteShape(preview);
    assert.equal("reference" in preview, false);
});
test("manual quote reference guard still requires a reference when Quotes are Manual", () => {
    const settings = {
        raw: {},
        quotesAutoGenerateReference: false,
    };
    assert.throws(() => enforceReferenceSettingsOrThrow(settings, "quote", {}, "manual"), /manual quote references/i);
    const ok = enforceReferenceSettingsOrThrow(settings, "quote", { reference: "BQ1234" }, "manual");
    assert.deepEqual(ok.warnings, []);
});
test("generated quote reference guard blocks gen-ref when Quotes are Manual", () => {
    const settings = {
        raw: {},
        quotesAutoGenerateReference: false,
    };
    assert.throws(() => enforceReferenceSettingsOrThrow(settings, "quote", {}, "generated"), /manual quote references/i);
});
test("generated quote reference guard allows gen-ref when Quotes are Auto", () => {
    const settings = {
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
    assert.throws(() => assertQuoteManualReferenceLengthOrThrow("BQ12345"), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
    assert.throws(() => assertQuoteManualReferenceLengthOrThrow("QUOTE-TEST-20260813-01"), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
    const seven = quoteManualReferenceSchema.safeParse("BQ12345");
    assert.equal(seven.success, false);
    if (!seven.success) {
        assert.match(seven.error.issues[0].message, /6 characters or fewer/i);
    }
    const staging = quoteManualReferenceSchema.safeParse("QUOTE-TEST-20260813-01");
    assert.equal(staging.success, false);
    assert.throws(() => buildQuotePayload({
        ...DISPOSABLE_QUOTE_ARGS,
        reference: "QUOTE-TEST-20260813-01",
    }), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
});
test("batch Quote long reference is rejected before posting", () => {
    assert.throws(() => normalizeBatchItems("/v1/quotes", [
        {
            opCode: 1,
            item: {
                ...DISPOSABLE_QUOTE_ARGS,
                reference: "QUOTE-TEST-20260813-01",
            },
        },
    ]), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
    assert.throws(() => normalizeBatchItems("/v1/quotes", [
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
    ]), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
});
test("update Quote long reference schema is rejected", () => {
    const result = quoteManualReferenceSchema.safeParse("QUOTE-TEST-20260813-01");
    assert.equal(result.success, false);
    if (!result.success) {
        assert.equal(result.error.issues[0].message, QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
    }
    assert.throws(() => assertQuoteManualReferenceLengthOrThrow("QUOTE-TEST-20260813-01"), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
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
    const line = payload.productTrans[0];
    assert.ok(Array.isArray(line.acEntries));
    assert.deepEqual(line.acEntries, current.productTrans[0].acEntries);
    // Mutation safety: clone, do not rewrite the GET record in place.
    assert.equal(current.reference, "QT0001");
    assert.notEqual(payload.productTrans, current.productTrans);
});
test("brc_update_quote rejects reference longer than 6 characters before PUT body is built", () => {
    assert.throws(() => buildQuoteReferenceUpdatePayload({ id: 1, reference: "QT0001", timeStamp: "ts" }, "TOOLONG"), (error) => error instanceof Error &&
        error.message === QUOTE_MANUAL_REFERENCE_TOO_LONG_MESSAGE);
});
test("buildGenerateSalesInvoiceFromQuotePayload keeps only quoteId and supported dates", () => {
    const payload = buildGenerateSalesInvoiceFromQuotePayload({
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
    });
    assert.deepEqual(payload, {
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
    });
    assert.equal("companyName" in payload, false);
    assert.equal("invoiceDate" in payload, false);
    assert.equal("transactionDate" in payload, false);
    assert.equal("date" in payload, false);
});
test("brc_generate_sales_invoice_from_quote confirmWrite=false previews BRC body and does not POST", async () => {
    let handlerCalled = false;
    const wrapped = wrapWriteToolHandler("brc_generate_sales_invoice_from_quote", async () => {
        handlerCalled = true;
        return "posted";
    });
    const result = await wrapped({
        companyName: "Company C",
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
        confirmWrite: false,
        routeToken: "should-not-appear",
        connectionRef: "should-not-appear",
        apiKey: "should-not-appear",
    });
    const body = parseBody(result);
    assert.equal(handlerCalled, false);
    assert.equal(body.status, "confirmation_required");
    assert.equal(body.confirmationRequired, true);
    assert.equal(body.endpoint, "POST /v1/quotes/generateSaleInvoice");
    const preview = body.payloadPreview;
    assert.deepEqual(preview, {
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
    });
    assert.equal("companyName" in preview, false);
    assert.equal("routeToken" in preview, false);
    assert.equal("connectionRef" in preview, false);
    assert.equal("apiKey" in preview, false);
    assert.equal("invoiceDate" in preview, false);
    assert.equal("transactionDate" in preview, false);
    assert.equal("date" in preview, false);
});
test("brc_generate_sales_invoice_from_quote confirmed payload matches preview", async () => {
    const expected = buildGenerateSalesInvoiceFromQuotePayload({
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
    });
    const wrapped = wrapWriteToolHandler("brc_generate_sales_invoice_from_quote", async (args) => {
        const record = args;
        const payloadSent = buildGenerateSalesInvoiceFromQuotePayload({
            quoteId: Number(record.quoteId),
            entryDate: String(record.entryDate),
            procDate: String(record.procDate),
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status: "ok",
                        endpoint: "POST /v1/quotes/generateSaleInvoice",
                        payloadSent,
                    }),
                },
            ],
        };
    });
    const previewResult = await wrapped({
        companyName: "Company C",
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
        confirmWrite: false,
        routeToken: "secret",
    });
    const previewBody = parseBody(previewResult);
    const postResult = await wrapped({
        companyName: "Company C",
        quoteId: 2892396,
        entryDate: "2026-08-13",
        procDate: "2026-08-13",
        confirmWrite: true,
        routeToken: "secret",
    });
    const postBody = parseBody(postResult);
    assert.deepEqual(previewBody.payloadPreview, expected);
    assert.deepEqual(postBody.payloadSent, expected);
    assert.deepEqual(postBody.payloadSent, previewBody.payloadPreview);
    assert.equal("routeToken" in postBody.payloadSent, false);
    assert.equal("companyName" in postBody.payloadSent, false);
});
const FETCHED_QUOTE = {
    id: 2892396,
    reference: "QT0001",
    customerOwnerName: "Paul Conroy Ltd",
    total: 12.3,
    closedDate: null,
    saleInvoiceId: null,
    timeStamp: "ABC123timestamp=",
    routeToken: "should-not-appear",
    connectionRef: "should-not-appear",
    apiKey: "should-not-appear",
    session: "should-not-appear",
};
test("Quote delete preview uses the already-fetched record without an extra GET", async () => {
    let getCount = 0;
    let deleteCount = 0;
    const wrapped = wrapWriteToolHandler("brc_delete_quote", async (args) => {
        getCount += 1;
        const timestamp = String(FETCHED_QUOTE.timeStamp);
        const payloadPreview = buildQuoteDeletePreview(FETCHED_QUOTE, timestamp);
        const record = args;
        if (record.confirmWrite !== true && record.confirmDelete !== true) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            status: "confirmation_required",
                            confirmationRequired: true,
                            endpoint: "DELETE /v1/quotes/2892396",
                            payloadPreview,
                        }),
                    },
                ],
            };
        }
        deleteCount += 1;
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ deleted: true, timestampUsed: timestamp }),
                },
            ],
        };
    });
    const previewBody = parseBody(await wrapped({
        companyName: "Company C",
        id: 2892396,
        confirmWrite: false,
        routeToken: "should-not-appear",
        connectionRef: "should-not-appear",
        apiKey: "should-not-appear",
    }));
    assert.equal(getCount, 1, "preview must use the single Quote GET already needed for timestamp");
    assert.equal(deleteCount, 0);
    assert.equal(previewBody.status, "confirmation_required");
    const preview = previewBody.payloadPreview;
    assert.equal(preview.id, 2892396);
    assert.equal(preview.reference, "QT0001");
    assert.equal(preview.customer, "Paul Conroy Ltd");
    assert.equal(preview.customerOwnerName, "Paul Conroy Ltd");
    assert.equal(preview.total, 12.3);
    assert.equal(preview.closedDate, null);
    assert.equal(preview.state, "open");
    assert.equal(preview.saleInvoiceId, null);
    assert.equal(preview.timestamp, "ABC123timestamp=");
    assert.equal("routeToken" in preview, false);
    assert.equal("connectionRef" in preview, false);
    assert.equal("apiKey" in preview, false);
    assert.equal("session" in preview, false);
    const postBody = parseBody(await wrapped({
        companyName: "Company C",
        id: 2892396,
        confirmWrite: true,
    }));
    assert.equal(getCount, 2, "confirmed delete still uses one GET of its own for timestamp");
    assert.equal(deleteCount, 1);
    assert.equal(postBody.deleted, true);
});
test("buildQuoteDeletePreview includes reference, customer, total, state, and timestamp", () => {
    const closedPreview = buildQuoteDeletePreview({
        ...FETCHED_QUOTE,
        closedDate: "2026-08-13T00:00:00",
        saleInvoiceId: 1001,
    }, "ABC123timestamp=");
    assert.equal(closedPreview.id, 2892396);
    assert.equal(closedPreview.reference, "QT0001");
    assert.equal(closedPreview.customer, "Paul Conroy Ltd");
    assert.equal(closedPreview.total, 12.3);
    assert.equal(closedPreview.state, "closed");
    assert.equal(closedPreview.closedDate, "2026-08-13T00:00:00");
    assert.equal(closedPreview.saleInvoiceId, 1001);
    assert.equal(closedPreview.timestamp, "ABC123timestamp=");
    assert.equal("routeToken" in closedPreview, false);
    assert.equal("connectionRef" in closedPreview, false);
    assert.equal("apiKey" in closedPreview, false);
    assert.equal("session" in closedPreview, false);
});
test("Quote create success includes endpoint, payloadSent, and status", () => {
    const body = buildQuoteCreateSuccessBody({
        message: "Quote created using structured MCP fields.",
        companyName: "Company C",
        endpoint: "POST /v1/quotes",
        payloadSent: { reference: "BQ1234", companyId: 806559 },
        response: { id: 2892396, reference: "BQ1234" },
    });
    assert.equal(body.endpoint, "POST /v1/quotes");
    assert.deepEqual(body.payloadSent, { reference: "BQ1234", companyId: 806559 });
    assert.equal(body.status, "created");
    assert.deepEqual(body.response, { id: 2892396, reference: "BQ1234" });
    assert.equal(body.createdQuoteId, 2892396);
    assert.equal("routeToken" in body, false);
    assert.equal("connectionRef" in body, false);
    assert.equal("apiKey" in body, false);
});
test("createdQuoteId is surfaced only when BRC returns a Quote id", () => {
    const withId = buildQuoteCreateSuccessBody({
        message: "Quote created.",
        companyName: "Company C",
        endpoint: "POST /v1/quotes",
        payloadSent: { reference: "BQ1234" },
        response: { id: 2892396 },
    });
    assert.equal(withId.createdQuoteId, 2892396);
    const numericId = extractCreatedQuoteId(2892396);
    assert.equal(numericId, 2892396);
    const emptyBody = buildQuoteCreateSuccessBody({
        message: "Quote created.",
        companyName: "Company C",
        endpoint: "POST /v1/quotes/createQuoteWithGeneratingReference",
        payloadSent: { companyId: 806559 },
        response: { message: "created successfully", statusCode: 201 },
    });
    assert.equal("createdQuoteId" in emptyBody, false);
    assert.equal(emptyBody.status, 201);
    assert.equal(emptyBody.endpoint, "POST /v1/quotes/createQuoteWithGeneratingReference");
    assert.equal(extractCreatedQuoteId({}), undefined);
    assert.equal(extractCreatedQuoteId({ companyId: 806559 }), undefined);
    assert.equal(extractCreatedQuoteId({ reference: "BQ1234" }), undefined);
    assert.equal(extractCreatedQuoteId({ statusCode: 201 }), undefined);
    assert.equal(extractCreatedQuoteId(null), undefined);
});
test("post-delete verification wording does not treat an unexpected lookup error as delete failure", () => {
    const unexpected = describeQuotePostDeleteVerification({
        deleteSucceeded: true,
        lookupOutcome: "unexpected_error",
    });
    assert.match(unexpected, /deleted successfully/i);
    assert.match(unexpected, /inconclusive/i);
    assert.match(unexpected, /quote id/i);
    assert.match(unexpected, /not necessarily unique/i);
    assert.equal(/deletion failed|was not deleted|failed to delete/i.test(unexpected), false);
    const success = describeQuotePostDeleteVerification({
        deleteSucceeded: true,
        lookupOutcome: "not_attempted",
    });
    assert.match(success, /deleted successfully/i);
    assert.match(success, /quote list/i);
    assert.equal(/every 500|HTTP 500 means deleted/i.test(success), false);
    const failed = describeQuotePostDeleteVerification({
        deleteSucceeded: false,
        lookupOutcome: "unexpected_error",
    });
    assert.match(failed, /was not deleted/i);
});
