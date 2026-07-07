import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_CONNECTION_STATUS, EMPTY_RESULT_REASON, buildReadConnectionMetadata, enrichReadResponseBody, isEmptyListResponse, responseSuggestsReconnect, } from "./read_connection_metadata.js";
test("empty sales list returns active connection metadata and shouldReconnect false", () => {
    const body = enrichReadResponseBody({ Items: [], Count: 0, Page: 1, PageSize: 20 }, { companyName: "Company B", connectionRefUsed: true });
    assert.equal(body.connectionStatus, ACTIVE_CONNECTION_STATUS);
    assert.equal(body.shouldReconnect, false);
    assert.equal(body.connectionRefUsed, true);
    assert.equal(body.companyName, "Company B");
    assert.equal(body.emptyResultReason, EMPTY_RESULT_REASON);
    assert.match(String(body.message), /Red connection is active/i);
    assert.match(String(body.message), /Company B/i);
    assert.equal(responseSuggestsReconnect(body), false);
});
test("empty purchases list returns active connection metadata and shouldReconnect false", () => {
    const body = enrichReadResponseBody({ Items: [], Count: 0 }, { companyName: "Company D" });
    assert.equal(body.connectionStatus, ACTIVE_CONNECTION_STATUS);
    assert.equal(body.shouldReconnect, false);
    assert.equal(body.emptyResultReason, EMPTY_RESULT_REASON);
    assert.equal(responseSuggestsReconnect(body), false);
});
test("non-empty sales list returns active connection metadata without empty reason", () => {
    const body = enrichReadResponseBody({
        Items: [{ id: 1, reference: "INV-1" }],
        Count: 1,
    }, { companyName: "Company C", connectionRefUsed: true });
    assert.equal(body.connectionStatus, ACTIVE_CONNECTION_STATUS);
    assert.equal(body.shouldReconnect, false);
    assert.equal(body.connectionRefUsed, true);
    assert.equal(body.companyName, "Company C");
    assert.equal(body.emptyResultReason, undefined);
    assert.equal(body.message, undefined);
    assert.equal(responseSuggestsReconnect(body), false);
});
test("non-empty purchases list returns active connection metadata", () => {
    const metadata = buildReadConnectionMetadata({
        Items: [{ id: 9 }],
        Count: 1,
    }, { companyName: "Company C", connectionRefUsed: false });
    assert.equal(metadata.connectionStatus, ACTIVE_CONNECTION_STATUS);
    assert.equal(metadata.shouldReconnect, false);
    assert.equal(metadata.connectionRefUsed, false);
    assert.equal(metadata.companyName, "Company C");
    assert.equal(metadata.emptyResultReason, undefined);
});
test("successful read metadata never suggests reconnect", () => {
    const cases = [
        enrichReadResponseBody({ Items: [], Count: 0 }, { companyName: "Company A" }),
        enrichReadResponseBody({ Items: [{ id: 1 }], Count: 1 }, { companyName: "Company C" }),
        enrichReadResponseBody({ name: "Acme Ltd" }, { companyName: "Company C" }),
    ];
    for (const body of cases) {
        assert.equal(responseSuggestsReconnect(body), false);
        assert.equal(body.shouldReconnect, false);
        assert.equal(body.connectionStatus, ACTIVE_CONNECTION_STATUS);
    }
});
test("isEmptyListResponse recognises Items/Count zero shape", () => {
    assert.equal(isEmptyListResponse({ Items: [], Count: 0 }), true);
    assert.equal(isEmptyListResponse({ Items: [{ id: 1 }], Count: 1 }), false);
    assert.equal(isEmptyListResponse({ name: "Customer" }), false);
});
