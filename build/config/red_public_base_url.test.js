import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerFacingScreenshotBaseUrl, getRedPublicBaseUrl, validateCustomerFacingPublicBaseUrl, } from "./red_public_base_url.js";
test("getRedPublicBaseUrl prefers RED_PUBLIC_BASE_URL", () => {
    process.env.RED_PUBLIC_BASE_URL = "https://red.example.com/";
    process.env.BRC_PUBLIC_BASE_URL = "https://other.example.com";
    assert.equal(getRedPublicBaseUrl(), "https://red.example.com");
});
test("validateCustomerFacingPublicBaseUrl rejects localhost in strict mode", () => {
    assert.equal(validateCustomerFacingPublicBaseUrl("http://localhost:3000", { strict: true }), null);
});
test("getCustomerFacingScreenshotBaseUrl allows localhost outside strict mode", () => {
    delete process.env.RED_PUBLIC_BASE_URL;
    delete process.env.BRC_PUBLIC_BASE_URL;
    process.env.PORT = "3000";
    delete process.env.BRC_DEPLOYMENT_ENV;
    delete process.env.NODE_ENV;
    assert.equal(getCustomerFacingScreenshotBaseUrl(), "http://localhost:3000");
});
