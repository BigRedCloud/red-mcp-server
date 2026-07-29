import assert from "node:assert/strict";
import test from "node:test";
import { authorizeBrcEduAdminRequest, BRC_EDU_ADMIN_DEFAULT_PROTECTED_PATH, BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE, buildEasyAuthLoginRedirectUrl, buildOpenEduAdminToolPayload, EASY_AUTH_CLIENT_PRINCIPAL_HEADER, EASY_AUTH_CLIENT_PRINCIPAL_NAME_HEADER, evaluateEntraStaffAccess, getBrcEduAdminProtectedPath, getBrcEduAdminPublicUrl, parseEasyAuthClientPrincipal, } from "./brc_edu_admin_auth.js";
import { BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY } from "./brc_edu_upload_store.js";
import { renderBrcEduUploadPage } from "./brc_edu_upload_page.js";
const ORIGINAL_ENV = { ...process.env };
function restoreEnv() {
    for (const key of Object.keys(process.env)) {
        if (!(key in ORIGINAL_ENV)) {
            delete process.env[key];
        }
    }
    Object.assign(process.env, ORIGINAL_ENV);
}
function encodePrincipal(principal) {
    return Buffer.from(JSON.stringify(principal), "utf8").toString("base64");
}
function staffPrincipal(options) {
    const claims = [
        {
            typ: "http://schemas.microsoft.com/identity/claims/tenantid",
            val: options.tenantId,
        },
        {
            typ: "preferred_username",
            val: options.email ?? "staff@bigredbook.com",
        },
        {
            typ: "oid",
            val: "11111111-2222-3333-4444-555555555555",
        },
    ];
    if (options.groupId) {
        claims.push({
            typ: "groups",
            val: options.groupId,
        });
    }
    if (options.role) {
        claims.push({
            typ: "roles",
            val: options.role,
        });
    }
    return { auth_typ: "aad", claims };
}
test("getBrcEduAdminProtectedPath defaults and accepts override", () => {
    restoreEnv();
    delete process.env.BRC_EDU_ADMIN_PROTECTED_PATH;
    assert.equal(getBrcEduAdminProtectedPath(), BRC_EDU_ADMIN_DEFAULT_PROTECTED_PATH);
    process.env.BRC_EDU_ADMIN_PROTECTED_PATH = "internal/custom-admin";
    assert.equal(getBrcEduAdminProtectedPath(), "/internal/custom-admin");
});
test("getBrcEduAdminPublicUrl prefers BRC_EDU_ADMIN_PUBLIC_URL", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_PUBLIC_URL =
        "https://red.example.com/internal/brc-edu/admin/";
    process.env.RED_PUBLIC_BASE_URL = "https://other.example.com";
    assert.equal(getBrcEduAdminPublicUrl(), "https://red.example.com/internal/brc-edu/admin");
});
test("getBrcEduAdminPublicUrl derives from Red public base URL", () => {
    restoreEnv();
    delete process.env.BRC_EDU_ADMIN_PUBLIC_URL;
    process.env.RED_PUBLIC_BASE_URL = "https://red.example.com/";
    delete process.env.BRC_EDU_ADMIN_PROTECTED_PATH;
    assert.equal(getBrcEduAdminPublicUrl(), "https://red.example.com/internal/brc-edu/admin");
});
test("buildOpenEduAdminToolPayload returns protected URL without secrets", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_PUBLIC_URL =
        "https://red.example.com/internal/brc-edu/admin";
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "must-never-appear";
    const payload = buildOpenEduAdminToolPayload();
    const serialized = JSON.stringify(payload);
    assert.equal(payload.adminUrl, process.env.BRC_EDU_ADMIN_PUBLIC_URL);
    assert.equal(payload.protectedPath, BRC_EDU_ADMIN_DEFAULT_PROTECTED_PATH);
    assert.equal(serialized.includes("must-never-appear"), false);
    assert.equal(serialized.includes(BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY), false);
    assert.equal(serialized.includes("?"), false);
});
test("parseEasyAuthClientPrincipal decodes base64 principal", () => {
    const principal = staffPrincipal({
        tenantId: "tenant-a",
        groupId: "group-a",
    });
    const parsed = parseEasyAuthClientPrincipal(encodePrincipal(principal));
    assert.ok(parsed);
    assert.equal(parsed?.auth_typ, "aad");
});
test("evaluateEntraStaffAccess allows configured group members", () => {
    const principal = staffPrincipal({
        tenantId: "tenant-a",
        groupId: "group-edu-admins",
    });
    const result = evaluateEntraStaffAccess(principal, {
        tenantId: "tenant-a",
        groupId: "group-edu-admins",
        appRole: null,
    });
    assert.equal(result.allowed, true);
});
test("evaluateEntraStaffAccess allows configured app role", () => {
    const principal = staffPrincipal({
        tenantId: "tenant-a",
        role: "BrcEdu.Admin",
    });
    const result = evaluateEntraStaffAccess(principal, {
        tenantId: "tenant-a",
        groupId: null,
        appRole: "BrcEdu.Admin",
    });
    assert.equal(result.allowed, true);
});
test("evaluateEntraStaffAccess denies users outside the approved group", () => {
    const principal = staffPrincipal({
        tenantId: "tenant-a",
        groupId: "other-group",
    });
    const result = evaluateEntraStaffAccess(principal, {
        tenantId: "tenant-a",
        groupId: "group-edu-admins",
        appRole: null,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "not_authorised");
});
test("unauthenticated access redirects to Microsoft sign-in when Entra is configured", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_ENTRA_TENANT_ID = "tenant-a";
    process.env.BRC_EDU_ADMIN_ENTRA_GROUP_ID = "group-edu-admins";
    delete process.env.BRC_EDU_ADMIN_UPLOAD_SECRET;
    const result = authorizeBrcEduAdminRequest({
        headers: {},
        returnPath: "/internal/brc-edu/admin",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.status, 401);
        assert.ok(result.redirectToLogin);
        assert.match(result.redirectToLogin, /^\/\.auth\/login\/aad\?/);
        assert.match(result.redirectToLogin, /post_login_redirect_uri=%2Finternal%2Fbrc-edu%2Fadmin/);
    }
});
test("approved staff can access the admin page via Easy Auth principal", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_ENTRA_TENANT_ID = "tenant-a";
    process.env.BRC_EDU_ADMIN_ENTRA_GROUP_ID = "group-edu-admins";
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "emergency-secret";
    const principal = staffPrincipal({
        tenantId: "tenant-a",
        groupId: "group-edu-admins",
        email: "lauren@bigredbook.com",
    });
    const result = authorizeBrcEduAdminRequest({
        headers: {
            [EASY_AUTH_CLIENT_PRINCIPAL_HEADER]: encodePrincipal(principal),
            [EASY_AUTH_CLIENT_PRINCIPAL_NAME_HEADER]: "lauren@bigredbook.com",
        },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.method, "entra");
        assert.equal(result.identity, "lauren@bigredbook.com");
    }
});
test("authenticated users outside the approved group are denied", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_ENTRA_TENANT_ID = "tenant-a";
    process.env.BRC_EDU_ADMIN_ENTRA_GROUP_ID = "group-edu-admins";
    const principal = staffPrincipal({
        tenantId: "tenant-a",
        groupId: "some-other-group",
        email: "external@example.com",
    });
    const result = authorizeBrcEduAdminRequest({
        headers: {
            [EASY_AUTH_CLIENT_PRINCIPAL_HEADER]: encodePrincipal(principal),
            [EASY_AUTH_CLIENT_PRINCIPAL_NAME_HEADER]: "external@example.com",
        },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.status, 403);
        assert.equal(result.error, BRC_EDU_ADMIN_STAFF_DENIED_MESSAGE);
    }
});
test("emergency secret fallback still allows access without Entra principal", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_ENTRA_TENANT_ID = "tenant-a";
    process.env.BRC_EDU_ADMIN_ENTRA_GROUP_ID = "group-edu-admins";
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "emergency-secret";
    process.env.BRC_EDU_ADMIN_ALLOW_SECRET_FALLBACK = "true";
    const result = authorizeBrcEduAdminRequest({
        headers: {},
        providedSecret: "emergency-secret",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.method, "secret");
    }
});
test("admin secret is never embedded in session-authenticated admin page URLs", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "must-never-appear-in-html";
    const html = renderBrcEduUploadPage({ mode: "session" });
    assert.equal(html.includes("must-never-appear-in-html"), false);
    assert.equal(html.includes(`${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=`), false);
    assert.match(html, /Red content administration/);
    assert.match(html, /Content overview/);
});
test("existing admin page still works after secret authentication", () => {
    const secret = "configured-secret";
    const html = renderBrcEduUploadPage(secret, "youtube");
    assert.match(html, /Red content administration/);
    assert.match(html, /id="youtube-sync-btn"/);
    assert.match(html, /YouTube video management/);
    assert.match(html, new RegExp(`${BRC_EDU_ADMIN_UPLOAD_SECRET_QUERY}=${encodeURIComponent(secret)}`));
});
test("buildEasyAuthLoginRedirectUrl encodes the return path", () => {
    assert.equal(buildEasyAuthLoginRedirectUrl("/internal/brc-edu/admin"), "/.auth/login/aad?post_login_redirect_uri=%2Finternal%2Fbrc-edu%2Fadmin");
});
