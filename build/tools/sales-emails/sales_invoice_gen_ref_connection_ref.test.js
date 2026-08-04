import assert from "node:assert/strict";
import test, { after, before } from "node:test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
process.env.RED_CONNECT_HTTP_MODE = "true";
import { wrapHttpSessionAwareToolHandler } from "../../auth/mcp_http_session.js";
import { issueConnectionRef } from "../../auth/connection_ref.js";
import { getConnectionStore } from "../../auth/connection_store.js";
import { getActiveConnectionRef, listConnectedCompanyNames, } from "../../shared.js";
import { wrapWriteToolHandler } from "../../guards/write_confirmation.js";
import { buildSalesVatCategoryContext, setSalesVatCategoryContextLoaderForTests, } from "../../guards/sales_vat_category.js";
import { createSalesInvoiceWithGeneratingReference } from "./sales_entry_inv_tools.js";
const COMPANY = "Company C GenRef Conn";
const VAT_CATEGORIES = {
    items: [{ id: 1, name: "Sales" }],
};
const VAT_RATES = {
    items: [{ id: 10, percentage: 23, vatCategoryId: 1 }],
};
function validTwoLinePayload() {
    const line = (overrides) => ({
        amount: 123,
        amountNet: 100,
        percentage: 23,
        productId: 5023355,
        productCode: "A",
        quantity: 1,
        unitPrice: 100,
        vat: 23,
        vatRateId: 10,
        vatAnalysisTypeId: 1,
        useTaxInclusiveUnitPrice: false,
        tranNotes: ["Line"],
        acEntries: [
            {
                accountCode: "S01",
                analysisCategoryId: 10,
                description: "Line",
                value: 100,
            },
        ],
        ...overrides,
    });
    return {
        customerId: 100,
        acCode: "CUST01",
        entryDate: "2026-07-01",
        procDate: "2026-07-01",
        saleRepId: 2,
        saleRepCode: "REP",
        bookTranTypeId: 6,
        totalNet: 200,
        totalVAT: 46,
        total: 246,
        unpaid: 246,
        useTaxInclusiveUnitPrice: false,
        vatTypeId: 1,
        productTrans: [
            line({ productCode: "A" }),
            line({
                productCode: "B",
                productId: 5023356,
                amountNet: 100,
                amount: 123,
                vat: 23,
            }),
        ],
    };
}
function parseText(result) {
    const text = result.content[0].text;
    return JSON.parse(text);
}
function assertNoMissingConnectionRefMessage(body) {
    const blob = JSON.stringify(body);
    assert.equal(blob.includes("Vibe did not pass connectionRef"), false, `unexpected missing-connectionRef wording in ${blob}`);
}
function composeProductionOrder(toolName, handler) {
    const writeWrapped = wrapWriteToolHandler(toolName, handler);
    return wrapHttpSessionAwareToolHandler(writeWrapped, { toolName });
}
function composeBrokenOrder(toolName, handler) {
    const httpAware = wrapHttpSessionAwareToolHandler(handler, { toolName });
    return wrapWriteToolHandler(toolName, httpAware);
}
let storedConnectionRef = "";
before(async () => {
    const store = getConnectionStore();
    const connectionId = `conn-gen-ref-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await store.saveConnectedCompanies(connectionId, [
        {
            companyName: COMPANY,
            apiKey: "test-api-key-company-c-gen-ref",
            expiresAt: Date.now() + 60 * 60 * 1000,
            credentialValidatedAt: Date.now(),
        },
    ]);
    const issued = await issueConnectionRef(connectionId);
    storedConnectionRef = issued.connectionRef;
    setSalesVatCategoryContextLoaderForTests(async () => buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES));
});
after(() => {
    setSalesVatCategoryContextLoaderForTests();
});
test("brc_create_sales_invoice_gen_ref schema registration includes connectionRef", async () => {
    const { registerAllTools } = await import("../../register_all_tools.js");
    const tools = new Map();
    registerAllTools({
        tool(name, _description, schema) {
            if (schema && typeof schema === "object") {
                tools.set(name, schema);
            }
        },
        resource() { },
        registerResource() { },
        prompt() { },
        registerPrompt() { },
    });
    const schema = tools.get("brc_create_sales_invoice_gen_ref");
    assert.ok(schema);
    assert.ok(schema.connectionRef, "expected connectionRef on MCP-facing schema");
});
test("supplied connectionRef is active during preview write-preflight and retained in payloadPreview", async () => {
    let refDuringVatPreflight;
    let companiesDuringVatPreflight = [];
    let handlerCalled = false;
    setSalesVatCategoryContextLoaderForTests(async () => {
        refDuringVatPreflight = getActiveConnectionRef();
        companiesDuringVatPreflight = listConnectedCompanyNames();
        return buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES);
    });
    try {
        const composed = composeProductionOrder("brc_create_sales_invoice_gen_ref", async () => {
            handlerCalled = true;
            return {
                content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
            };
        });
        const result = await composed({
            companyName: COMPANY,
            connectionRef: storedConnectionRef,
            payload: validTwoLinePayload(),
        }, { sessionId: `vibe-session-preview-${Date.now()}` });
        const body = parseText(result);
        assert.ok(body.status === "confirmation_required" ||
            body.status === "counterparty_confirmation_required", `unexpected status ${String(body.status)}`);
        assert.equal(body.payloadPreview
            ?.connectionRef, storedConnectionRef, "preview payload must retain the supplied connectionRef");
        assert.equal(handlerCalled, false, "post handler must not run on preview");
        assert.equal(refDuringVatPreflight, storedConnectionRef);
        assert.ok(companiesDuringVatPreflight.includes(COMPANY), `expected ${COMPANY} loaded during VAT preflight, got ${JSON.stringify(companiesDuringVatPreflight)}`);
        assertNoMissingConnectionRefMessage(body);
    }
    finally {
        setSalesVatCategoryContextLoaderForTests(async () => buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES));
    }
});
test("supplied connectionRef reaches confirmed-post handler args and active scope", async () => {
    let activeRefDuringHandler;
    let argsRefDuringHandler;
    let refDuringVatPreflight;
    setSalesVatCategoryContextLoaderForTests(async () => {
        refDuringVatPreflight = getActiveConnectionRef();
        return buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES);
    });
    try {
        const composed = composeProductionOrder("brc_create_sales_invoice_gen_ref", async (args) => {
            argsRefDuringHandler =
                typeof args.connectionRef === "string" ? args.connectionRef : undefined;
            activeRefDuringHandler = getActiveConnectionRef();
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            posted: true,
                            activeConnectionRef: getActiveConnectionRef(),
                            argsConnectionRef: argsRefDuringHandler,
                        }),
                    },
                ],
            };
        });
        const result = await composed({
            companyName: COMPANY,
            connectionRef: storedConnectionRef,
            payload: validTwoLinePayload(),
            confirmWrite: true,
            confirmCounterpartyExplicit: true,
        }, { sessionId: `vibe-session-post-${Date.now()}` });
        const body = parseText(result);
        assert.equal(body.posted, true);
        assert.equal(argsRefDuringHandler, storedConnectionRef);
        assert.equal(activeRefDuringHandler, storedConnectionRef);
        assert.equal(refDuringVatPreflight, storedConnectionRef);
        assert.equal(body.activeConnectionRef, storedConnectionRef);
        assert.equal(body.argsConnectionRef, storedConnectionRef);
        assertNoMissingConnectionRefMessage(body);
    }
    finally {
        setSalesVatCategoryContextLoaderForTests(async () => buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES));
    }
});
test("validation failures keep connectionRef active and do not claim it was missing", async () => {
    let refDuringVatPreflight;
    setSalesVatCategoryContextLoaderForTests(async () => {
        refDuringVatPreflight = getActiveConnectionRef();
        return buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES);
    });
    try {
        const composed = composeProductionOrder("brc_create_sales_invoice_gen_ref", async () => {
            throw new Error("post handler must not run on validation failure");
        });
        const payload = validTwoLinePayload();
        payload.productTrans[1].acEntries = [];
        const result = await composed({
            companyName: COMPANY,
            connectionRef: storedConnectionRef,
            payload,
        }, { sessionId: `vibe-session-validation-${Date.now()}` });
        const body = parseText(result);
        assert.equal(body.valid, false);
        assert.equal(refDuringVatPreflight, storedConnectionRef);
        assertNoMissingConnectionRefMessage(body);
    }
    finally {
        setSalesVatCategoryContextLoaderForTests(async () => buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES));
    }
});
test("createSalesInvoiceWithGeneratingReference forwards connectionRef into active scope", async () => {
    let seen;
    const result = await createSalesInvoiceWithGeneratingReference({
        companyName: COMPANY,
        payload: validTwoLinePayload(),
        connectionRef: storedConnectionRef,
    }, {
        brcJsonRequest: async () => {
            seen = getActiveConnectionRef();
            return { id: 1 };
        },
        resolveCustomerVatType: async () => 1,
        loadAndEnforceTransactionSettings: async () => {
            assert.equal(getActiveConnectionRef(), storedConnectionRef);
            return {
                raw: {},
                cashReceiptVatMode: "not_enabled",
                grossPriceSalesInvoicingEnabled: false,
            };
        },
        loadAndEnforceReferenceSettings: async () => ({
            settings: { raw: {}, salesAutoGenerateReference: true },
            warnings: [],
        }),
        enforceSalesVatCategoryOrThrow: async () => {
            assert.equal(getActiveConnectionRef(), storedConnectionRef);
        },
    });
    assert.equal(seen, storedConnectionRef);
    assertNoMissingConnectionRefMessage(parseText(result));
});
test("broken wrapper order drops connectionRef during write preflight", async () => {
    let preflightError;
    let refDuringBrokenPreflight;
    setSalesVatCategoryContextLoaderForTests(async () => {
        refDuringBrokenPreflight = getActiveConnectionRef();
        // Force the same credential lookup write tools perform in HTTP mode.
        if (!getActiveConnectionRef()) {
            throw new Error([
                `No company connection is currently stored for "${COMPANY}".`,
                "",
                "Vibe did not pass connectionRef on this tool call.",
            ].join("\n"));
        }
        return buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES);
    });
    try {
        const broken = composeBrokenOrder("brc_create_sales_invoice_gen_ref", async () => ({ content: [{ type: "text", text: "{}" }] }));
        try {
            await broken({
                companyName: COMPANY,
                connectionRef: storedConnectionRef,
                payload: validTwoLinePayload(),
            });
        }
        catch (error) {
            preflightError = error instanceof Error ? error.message : String(error);
        }
        assert.equal(refDuringBrokenPreflight, undefined);
        assert.ok(preflightError);
        assert.match(preflightError, /Vibe did not pass connectionRef/i);
    }
    finally {
        setSalesVatCategoryContextLoaderForTests(async () => buildSalesVatCategoryContext(VAT_CATEGORIES, VAT_RATES));
    }
});
