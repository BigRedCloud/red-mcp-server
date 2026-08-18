import assert from "node:assert/strict";
import test from "node:test";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "../edu/brc_edu_upload_store.js";
import { EASY_AUTH_CLIENT_PRINCIPAL_HEADER, } from "../edu/brc_edu_admin_auth.js";
import { getFreePort, startHttpTestServer } from "./http_test_server.js";
const ADMIN_PATH = "/internal/brc-edu/admin";
const LEGACY_UPLOAD_PATH = "/internal/brc-edu/resources/upload";
const WORKBOOK_PATH = `${LEGACY_UPLOAD_PATH}/workbook`;
const WORKBOOK_DOWNLOAD_PATH = `${LEGACY_UPLOAD_PATH}/workbook/download`;
function encodePrincipal(principal) {
    return Buffer.from(JSON.stringify(principal), "utf8").toString("base64");
}
async function startTestServer(t, port, envOverrides = {}) {
    return startHttpTestServer(t, port, {
        BRC_EDU_ADMIN_ENTRA_TENANT_ID: "",
        BRC_EDU_ADMIN_ENTRA_GROUP_ID: "",
        BRC_EDU_ADMIN_ENTRA_APP_ROLE: "",
        BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK: "true",
        ...envOverrides,
    });
}
function withSecret(path, port, secret) {
    const base = `http://127.0.0.1:${port}${path}`;
    if (!secret) {
        return base;
    }
    const separator = path.includes("?") ? "&" : "?";
    return `${base}${separator}${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`;
}
function adminUrl(port, secret, view) {
    const path = view ? `${ADMIN_PATH}?view=${encodeURIComponent(view)}` : ADMIN_PATH;
    return withSecret(path, port, secret);
}
function legacyUploadUrl(port, secret) {
    return withSecret(LEGACY_UPLOAD_PATH, port, secret);
}
function workbookUrl(port, secret) {
    return withSecret(WORKBOOK_PATH, port, secret);
}
function workbookDownloadUrl(port, secret) {
    return withSecret(WORKBOOK_DOWNLOAD_PATH, port, secret);
}
test("GET /internal/brc-edu/admin returns 503 when admin secret is not configured", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "",
    });
    const response = await fetch(adminUrl(port, "any-secret"));
    assert.equal(response.status, 503);
});
test("GET /internal/brc-edu/admin returns 401 for missing or wrong secret", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const missing = await fetch(adminUrl(port));
    const wrong = await fetch(adminUrl(port, "wrong-secret"));
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
});
test("GET /internal/brc-edu/admin defaults to content overview", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const response = await fetch(adminUrl(port, "configured-secret"));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Red content administration/i);
    assert.match(html, /Content overview/i);
    assert.match(html, /Visible content by topic/i);
    assert.match(html, /Freshdesk articles/i);
    assert.match(html, /YouTube videos/i);
    assert.equal(html.includes("Upload Excel"), false);
});
test("GET /internal/brc-edu/admin?view=youtube loads YouTube management", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const response = await fetch(adminUrl(port, "configured-secret", "youtube"));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /YouTube video management/i);
    assert.match(html, /Recorded webinars/i);
});
test("GET /internal/brc-edu/resources/upload redirects to the admin page", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const response = await fetch(legacyUploadUrl(port, "configured-secret"), {
        redirect: "manual",
    });
    assert.equal(response.status, 302);
    const location = response.headers.get("location") ?? "";
    assert.match(location, /\/internal\/brc-edu\/admin/);
    assert.match(location, /secret=configured-secret/);
});
test("removed workbook upload and download routes return 404", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const getWorkbook = await fetch(workbookUrl(port, "configured-secret"));
    const putWorkbook = await fetch(workbookUrl(port, "configured-secret"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: [] }),
    });
    const download = await fetch(workbookDownloadUrl(port, "configured-secret"));
    const postUpload = await fetch(legacyUploadUrl(port, "configured-secret"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        redirect: "manual",
    });
    assert.equal(getWorkbook.status, 404);
    assert.equal(putWorkbook.status, 404);
    assert.equal(download.status, 404);
    assert.equal(postUpload.status, 404);
});
test("Freshdesk and overview APIs require admin authentication", async (t) => {
    const port = await getFreePort();
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "configured-secret",
    });
    const overview = await fetch(`http://127.0.0.1:${port}/internal/brc-edu/content/overview`);
    const articles = await fetch(`http://127.0.0.1:${port}/internal/brc-edu/freshdesk/articles`);
    const visibility = await fetch(`http://127.0.0.1:${port}/internal/brc-edu/freshdesk/articles/1/visibility`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excluded: true }),
    });
    assert.equal(overview.status, 401);
    assert.equal(articles.status, 401);
    assert.equal(visibility.status, 401);
});
test("GET /internal/brc-edu/admin allows approved Entra staff without a secret", async (t) => {
    const port = await getFreePort();
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const groupId = "22222222-2222-2222-2222-222222222222";
    await startTestServer(t, port, {
        BRC_EDU_ADMIN_UPLOAD_SECRET: "",
        BRC_EDU_ADMIN_ENTRA_TENANT_ID: tenantId,
        BRC_EDU_ADMIN_ENTRA_GROUP_ID: groupId,
        BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK: "false",
    });
    const principal = encodePrincipal({
        auth_typ: "aad",
        claims: [
            { typ: "tid", val: tenantId },
            { typ: "groups", val: groupId },
            { typ: "preferred_username", val: "staff@example.com" },
        ],
    });
    const response = await fetch(adminUrl(port), {
        headers: {
            [EASY_AUTH_CLIENT_PRINCIPAL_HEADER]: principal,
        },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Red content administration/i);
    assert.match(html, /Content overview/i);
});
