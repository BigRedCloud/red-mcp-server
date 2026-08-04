import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_DATA_ACCESS_VALIDATION_PATH, COMPANY_FINANCIAL_YEAR_VALIDATION_PATH, evaluateBrcCredentialResponse, resetCompanyCredentialValidator, resetValidationFetch, setValidationFetch, validateCompanyApiKeyCredentialViaBrc, } from "./credential_validation.js";
function mockBrcValidationFetch(outcomes) {
    setValidationFetch(async (input) => {
        const url = String(input);
        const path = url.includes("/v1/customers")
            ? COMPANY_DATA_ACCESS_VALIDATION_PATH
            : COMPANY_FINANCIAL_YEAR_VALIDATION_PATH;
        const outcome = outcomes[path] ?? { status: 401, body: "Unauthorized" };
        return new Response(outcome.body ?? "", { status: outcome.status });
    });
}
test("expired or outdated API key fails validation on customers endpoint", async () => {
    resetCompanyCredentialValidator();
    resetValidationFetch();
    mockBrcValidationFetch({
        [COMPANY_DATA_ACCESS_VALIDATION_PATH]: {
            status: 401,
            body: "Unauthorized",
        },
        [COMPANY_FINANCIAL_YEAR_VALIDATION_PATH]: {
            status: 200,
            body: JSON.stringify({ year: 2026 }),
        },
    });
    const result = await validateCompanyApiKeyCredentialViaBrc("Company A", "expired-key-value");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_or_expired_api_key");
    assert.match(result.message, /could not be validated/i);
});
test("financial year success alone is not enough when customers validation fails", async () => {
    resetValidationFetch();
    mockBrcValidationFetch({
        [COMPANY_DATA_ACCESS_VALIDATION_PATH]: {
            status: 403,
            body: "Forbidden",
        },
        [COMPANY_FINANCIAL_YEAR_VALIDATION_PATH]: {
            status: 200,
            body: JSON.stringify({ year: 2026 }),
        },
    });
    const result = await validateCompanyApiKeyCredentialViaBrc("Company A", "bad-key");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "forbidden");
});
test("valid key passes when customers and financial year both succeed", async () => {
    resetValidationFetch();
    mockBrcValidationFetch({
        [COMPANY_DATA_ACCESS_VALIDATION_PATH]: {
            status: 200,
            body: JSON.stringify({ Items: [], Count: 0 }),
        },
        [COMPANY_FINANCIAL_YEAR_VALIDATION_PATH]: {
            status: 200,
            body: JSON.stringify({ year: 2026 }),
        },
    });
    const result = await validateCompanyApiKeyCredentialViaBrc("Company B", "valid-key");
    assert.equal(result.valid, true);
});
test("evaluateBrcCredentialResponse treats auth body on 200 as invalid", () => {
    const evaluated = evaluateBrcCredentialResponse(200, '{"message":"Unauthorized API key"}');
    assert.equal(evaluated.valid, false);
    if (!evaluated.valid) {
        assert.equal(evaluated.reason, "invalid_or_expired_api_key");
    }
});
