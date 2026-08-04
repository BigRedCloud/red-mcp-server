import assert from "node:assert/strict";
import test from "node:test";
import { validateBrcEduAdminUploadSecret } from "./brc_edu_upload_store.js";
const ORIGINAL_ENV = { ...process.env };
function restoreEnv() {
    for (const key of Object.keys(process.env)) {
        if (!(key in ORIGINAL_ENV)) {
            delete process.env[key];
        }
    }
    Object.assign(process.env, ORIGINAL_ENV);
}
test("validateBrcEduAdminUploadSecret returns 503 when admin secret is not configured", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "";
    const result = validateBrcEduAdminUploadSecret("any-secret");
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.status, 503);
    }
});
test("validateBrcEduAdminUploadSecret returns 401 for missing or wrong secret", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "configured-secret";
    const missing = validateBrcEduAdminUploadSecret(undefined);
    const wrong = validateBrcEduAdminUploadSecret("wrong-secret");
    assert.equal(missing.ok, false);
    assert.equal(wrong.ok, false);
    if (!missing.ok) {
        assert.equal(missing.status, 401);
    }
    if (!wrong.ok) {
        assert.equal(wrong.status, 401);
    }
});
test("validateBrcEduAdminUploadSecret accepts the configured secret", () => {
    restoreEnv();
    process.env.BRC_EDU_ADMIN_UPLOAD_SECRET = "configured-secret";
    const result = validateBrcEduAdminUploadSecret("configured-secret");
    assert.equal(result.ok, true);
});
