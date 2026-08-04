import assert from "node:assert/strict";
import test from "node:test";
import { handleFreshdeskVisibilityUpdate, } from "./freshdesk-admin-http.js";
test("handleFreshdeskVisibilityUpdate rejects non-boolean excluded", async () => {
    const result = await handleFreshdeskVisibilityUpdate({
        articleId: "123",
        body: { excluded: "yes" },
    });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /boolean "excluded"/i);
});
test("handleFreshdeskVisibilityUpdate rejects missing body", async () => {
    const result = await handleFreshdeskVisibilityUpdate({
        articleId: "123",
        body: null,
    });
    assert.equal(result.status, 400);
});
