import assert from "node:assert/strict";
import test, { after } from "node:test";
process.env.RED_CONNECT_CONNECTION_STORE = "memory";
import { resetCompanyCredentialValidator, resetValidationFetch, setCompanyCredentialValidator, setValidationFetch, } from "./credential_validation.js";
import { validateAndPersistConnectedCompanies } from "./connection_persistence.js";
import { claimConnectionCodeForSession, getConnectionStore, } from "./connection_store.js";
import { CompanyNotConnectedError, buildCompanyCredentialInvalidResponse, buildCompanyNotConnectedResponse, } from "./company_connection_errors.js";
import { brcFetch, jsonResponse, listConnectedCompanyNames, runWithSessionKeyStore, setApiKeyForCompany, } from "../shared.js";
import { hydrateSessionKeyStoreFromConnectionStore } from "./connection_persistence.js";
function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function mockBrcValidationFetchForKeys(validKeys, invalidKeys) {
    setValidationFetch(async (_input, init) => {
        const authHeader = String(init?.headers?.Authorization ?? "");
        const isInvalid = Array.from(invalidKeys).some((key) => authHeader.includes(Buffer.from(`${key}:`, "utf8").toString("base64")));
        const isValid = Array.from(validKeys).some((key) => authHeader.includes(Buffer.from(`${key}:`, "utf8").toString("base64")));
        if (isInvalid || !isValid) {
            return new Response("Unauthorized", { status: 401 });
        }
        return new Response(JSON.stringify({ Items: [], Count: 0 }), {
            status: 200,
        });
    });
}
function mockValidator(outcomes) {
    setCompanyCredentialValidator(async (companyName, apiKey) => {
        void apiKey;
        const outcome = outcomes[companyName.trim()];
        if (outcome === "valid") {
            return { valid: true };
        }
        return {
            valid: false,
            reason: "invalid_or_expired_api_key",
            message: `${companyName.trim()} was not connected because the credential could not be validated.`,
        };
    });
}
test("all valid company credentials are connected", async () => {
    resetCompanyCredentialValidator();
    mockValidator({
        "Company A": "valid",
        "Company B": "valid",
    });
    const connectionId = uniqueId("connection");
    const outcome = await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [
            { companyName: "Company A", apiKey: "key-a" },
            { companyName: "Company B", apiKey: "key-b" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    assert.deepEqual(outcome.connectedCompanies.sort(), ["Company A", "Company B"]);
    assert.deepEqual(outcome.failedCompanies, []);
    const store = getConnectionStore();
    const stored = await store.listConnectedCompanies(connectionId);
    assert.equal(stored.length, 2);
});
test("one invalid API key among multiple companies excludes only that company", async () => {
    resetCompanyCredentialValidator();
    resetValidationFetch();
    mockBrcValidationFetchForKeys(new Set(["key-b", "key-c", "key-d"]), new Set(["bad-key"]));
    const connectionId = uniqueId("connection");
    const outcome = await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [
            { companyName: "Company A", apiKey: "bad-key" },
            { companyName: "Company B", apiKey: "key-b" },
            { companyName: "Company C", apiKey: "key-c" },
            { companyName: "Company D", apiKey: "key-d" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    assert.deepEqual(outcome.connectedCompanies.sort(), [
        "Company B",
        "Company C",
        "Company D",
    ]);
    assert.equal(outcome.failedCompanies.length, 1);
    assert.equal(outcome.failedCompanies[0]?.companyName, "Company A");
    assert.equal(outcome.failedCompanies[0]?.connected, false);
    assert.equal(outcome.failedCompanies[0]?.reason, "invalid_or_expired_api_key");
    assert.match(outcome.failedCompanies[0]?.message ?? "", /could not be validated/i);
});
test("claim returns connected and failed companies separately", async () => {
    resetCompanyCredentialValidator();
    mockValidator({
        "Company A": "invalid_or_expired_api_key",
        "Company B": "valid",
    });
    const store = getConnectionStore();
    const code = uniqueId("code");
    const connectionId = uniqueId("connection");
    const sessionId = uniqueId("session");
    await store.createPendingConnection({
        code,
        connectionId,
        expiresAt: Date.now() + 60_000,
    });
    await store.completePendingConnection(code);
    await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [
            { companyName: "Company A", apiKey: "bad-key" },
            { companyName: "Company B", apiKey: "good-key" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    const result = await claimConnectionCodeForSession(code, sessionId);
    assert.deepEqual(result.connectedCompanies, ["Company B"]);
    assert.equal(result.failedCompanies.length, 1);
    assert.equal(result.failedCompanies[0]?.companyName, "Company A");
});
test("list contexts only includes validated connected companies", async () => {
    resetCompanyCredentialValidator();
    mockValidator({
        "Company A": "invalid_or_expired_api_key",
        "Company B": "valid",
    });
    const connectionId = uniqueId("connection");
    const keyStore = new Map();
    await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [
            { companyName: "Company A", apiKey: "bad-key" },
            { companyName: "Company B", apiKey: "good-key" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    await runWithSessionKeyStore(keyStore, async () => {
        await hydrateSessionKeyStoreFromConnectionStore(connectionId, keyStore);
        const names = listConnectedCompanyNames();
        assert.deepEqual(names, ["Company B"]);
        assert.equal(names.includes("Company A"), false);
    });
});
test("asking for an invalid company returns company_not_connected, not expired connection", async () => {
    resetCompanyCredentialValidator();
    mockValidator({
        "Company A": "invalid_or_expired_api_key",
        "Company B": "valid",
    });
    const connectionId = uniqueId("connection");
    const keyStore = new Map();
    await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [
            { companyName: "Company A", apiKey: "bad-key" },
            { companyName: "Company B", apiKey: "good-key" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    await runWithSessionKeyStore(keyStore, async () => {
        await hydrateSessionKeyStoreFromConnectionStore(connectionId, keyStore);
        const body = (await brcFetch("Company A", "/v1/customers?page=1&pageSize=1"));
        assert.equal(body.connectionStatus, "active");
        assert.equal(body.shouldReconnect, false);
        assert.equal(body.companyConnected, false);
        assert.equal(body.errorType, "company_not_connected");
        assert.match(String(body.message), /Company A is not connected/i);
        assert.equal(String(body.message).includes("expired"), false);
    });
});
test("company not connected response never includes API keys", async () => {
    const payload = buildCompanyNotConnectedResponse("Company A", {
        otherCompaniesConnected: true,
    });
    const serialised = JSON.stringify(payload);
    assert.equal(serialised.includes("apiKey"), false);
    assert.equal(serialised.includes("secret"), false);
    assert.equal(serialised.includes("token"), false);
});
test("validation partition responses never include API keys", async () => {
    resetCompanyCredentialValidator();
    mockValidator({
        "Company A": "invalid_or_expired_api_key",
        "Company B": "valid",
    });
    const outcome = await validateAndPersistConnectedCompanies({
        connectionId: uniqueId("connection"),
        companies: [
            { companyName: "Company A", apiKey: "super-secret-key-value" },
            { companyName: "Company B", apiKey: "another-secret-key" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    const serialised = JSON.stringify(outcome);
    assert.equal(serialised.includes("super-secret-key-value"), false);
    assert.equal(serialised.includes("another-secret-key"), false);
});
test("CompanyNotConnectedError is thrown when other companies are connected", async () => {
    resetCompanyCredentialValidator();
    mockValidator({ "Company B": "valid" });
    const connectionId = uniqueId("connection");
    const keyStore = new Map();
    await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [{ companyName: "Company B", apiKey: "good-key" }],
        expiresAt: Date.now() + 60_000,
    });
    await runWithSessionKeyStore(keyStore, async () => {
        await hydrateSessionKeyStoreFromConnectionStore(connectionId, keyStore);
        const { getCredentialForCompany } = await import("../shared.js");
        assert.throws(() => getCredentialForCompany("Company A"), (error) => error instanceof CompanyNotConnectedError);
    });
});
test("confirm json response includes connectedCompanies and failedCompanies without secrets", async () => {
    resetCompanyCredentialValidator();
    mockValidator({
        "Company A": "invalid_or_expired_api_key",
        "Company B": "valid",
    });
    const store = getConnectionStore();
    const code = uniqueId("code");
    const connectionId = uniqueId("connection");
    await store.createPendingConnection({
        code,
        connectionId,
        expiresAt: Date.now() + 60_000,
    });
    await store.completePendingConnection(code);
    await validateAndPersistConnectedCompanies({
        connectionId,
        companies: [
            { companyName: "Company A", apiKey: "bad-key" },
            { companyName: "Company B", apiKey: "good-key" },
        ],
        expiresAt: Date.now() + 60_000,
    });
    const result = await claimConnectionCodeForSession(code, uniqueId("session"));
    const payload = jsonResponse({
        connectedCompanies: result.connectedCompanies,
        failedCompanies: result.failedCompanies,
        connectionRef: result.connectionRef,
    });
    const text = payload.content[0]?.text ?? "";
    const body = JSON.parse(text);
    assert.deepEqual(body.connectedCompanies, ["Company B"]);
    assert.equal(body.failedCompanies[0]?.companyName, "Company A");
    assert.equal(text.includes("bad-key"), false);
    assert.match(body.connectionRef, /^redconn_/);
});
test("later 401 for one company returns company_credential_invalid and removes it", async () => {
    const originalFetch = globalThis.fetch;
    const badKey = "bad-runtime-key";
    const goodKey = "good-runtime-key";
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        const auth = String(init?.headers?.Authorization ?? "");
        if (auth.includes(Buffer.from(`${badKey}:`, "utf8").toString("base64"))) {
            return new Response("Unauthorized", { status: 401 });
        }
        if (url.includes("/v1/customers")) {
            return new Response(JSON.stringify({ Items: [{ id: 1 }], Count: 1 }), {
                status: 200,
            });
        }
        return new Response("{}", { status: 200 });
    };
    try {
        const keyStore = new Map();
        await runWithSessionKeyStore(keyStore, async () => {
            setApiKeyForCompany({
                companyName: "Company A",
                apiKey: badKey,
                expiresAt: Date.now() + 60_000,
            });
            setApiKeyForCompany({
                companyName: "Company B",
                apiKey: goodKey,
                expiresAt: Date.now() + 60_000,
            });
            const failed = (await brcFetch("Company A", "/v1/customers?page=1&pageSize=1"));
            assert.equal(failed.errorType, "company_credential_invalid");
            assert.equal(failed.shouldReconnect, false);
            assert.equal(failed.companyConnected, false);
            assert.match(String(failed.message), /invalid or expired/i);
            assert.match(String(failed.assistantInstruction), /Do not say the full Red connection expired/i);
            assert.equal(listConnectedCompanyNames().includes("Company A"), false);
            const success = (await brcFetch("Company B", "/v1/customers?page=1&pageSize=1"));
            assert.equal(success.errorType, undefined);
            assert.equal(Array.isArray(success.Items) || success.Items !== undefined, true);
        });
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test("company credential invalid response never includes API keys", () => {
    const payload = buildCompanyCredentialInvalidResponse("Company A", {
        otherCompaniesConnected: true,
    });
    const serialised = JSON.stringify(payload);
    assert.equal(serialised.includes("apiKey"), false);
    assert.equal(serialised.includes("secret"), false);
    assert.equal(payload.errorType, "company_credential_invalid");
});
after(() => {
    resetCompanyCredentialValidator();
    resetValidationFetch();
});
