import assert from "node:assert/strict";
import test from "node:test";
import { getConnectionStoreKind, getConnectionStoreTargetName, getDeploymentEnvironmentLabel, } from "./connection_store.js";
test("connection store target name never includes connection string", () => {
    const previous = {
        store: process.env.RED_CONNECT_CONNECTION_STORE,
        db: process.env.RED_CONNECT_COSMOS_DATABASE,
        container: process.env.RED_CONNECT_COSMOS_CONTAINER,
        cs: process.env.RED_CONNECT_COSMOS_CONNECTION_STRING,
    };
    process.env.RED_CONNECT_CONNECTION_STORE = "cosmos";
    process.env.RED_CONNECT_COSMOS_DATABASE = "red-connect-staging";
    process.env.RED_CONNECT_COSMOS_CONTAINER = "connections-staging";
    process.env.RED_CONNECT_COSMOS_CONNECTION_STRING =
        "AccountEndpoint=https://example.documents.azure.com:443/;AccountKey=SECRET;";
    try {
        assert.equal(getConnectionStoreKind(), "cosmos");
        assert.equal(getConnectionStoreTargetName(), "cosmos:red-connect-staging/connections-staging");
        assert.equal(getConnectionStoreTargetName().includes("SECRET"), false);
        assert.equal(getConnectionStoreTargetName().includes("AccountKey"), false);
    }
    finally {
        restoreEnv("RED_CONNECT_CONNECTION_STORE", previous.store);
        restoreEnv("RED_CONNECT_COSMOS_DATABASE", previous.db);
        restoreEnv("RED_CONNECT_COSMOS_CONTAINER", previous.container);
        restoreEnv("RED_CONNECT_COSMOS_CONNECTION_STRING", previous.cs);
    }
});
test("deployment environment label prefers BRC_DEPLOYMENT_ENV", () => {
    const previousEnv = process.env.BRC_DEPLOYMENT_ENV;
    const previousSlot = process.env.WEBSITE_SLOT_NAME;
    process.env.BRC_DEPLOYMENT_ENV = "staging";
    process.env.WEBSITE_SLOT_NAME = "production";
    try {
        assert.equal(getDeploymentEnvironmentLabel(), "staging");
    }
    finally {
        restoreEnv("BRC_DEPLOYMENT_ENV", previousEnv);
        restoreEnv("WEBSITE_SLOT_NAME", previousSlot);
    }
});
function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    }
    else {
        process.env[name] = value;
    }
}
