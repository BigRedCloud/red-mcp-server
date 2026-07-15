import { createHmac, timingSafeEqual } from "node:crypto";
export const FRESHDESK_PUBLIC_IMAGE_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const FRESHDESK_PUBLIC_IMAGE_SIGNING_SECRET_ENV = "BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET";
export const FRESHDESK_PUBLIC_IMAGE_SIGNING_SECRET_PREVIOUS_ENV = "BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET_PREVIOUS";
function toBase64Url(value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}
function fromBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    try {
        return Buffer.from(normalized + padding, "base64");
    }
    catch {
        return null;
    }
}
function safeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    return timingSafeEqual(a, b);
}
function readSigningSecrets() {
    const current = process.env[FRESHDESK_PUBLIC_IMAGE_SIGNING_SECRET_ENV]?.trim();
    const previous = process.env[FRESHDESK_PUBLIC_IMAGE_SIGNING_SECRET_PREVIOUS_ENV]?.trim();
    return [current, previous].filter((value) => Boolean(value));
}
export function isFreshdeskPublicImageSigningConfigured() {
    return readSigningSecrets().length > 0;
}
export function resolveFreshdeskImageKey(image) {
    const sha256 = image.sha256?.trim().toLowerCase();
    if (sha256 && /^[a-f0-9]{64}$/.test(sha256)) {
        return sha256;
    }
    return null;
}
function buildPayloadString(payload) {
    return `${payload.articleId}.${payload.imageKey}.${payload.expiresAt}`;
}
function signPayload(payload, secret) {
    return toBase64Url(createHmac("sha256", secret).update(payload, "utf8").digest());
}
export function createFreshdeskPublicImageToken(articleId, imageKey, options = {}) {
    const secrets = readSigningSecrets();
    const secret = secrets[0];
    if (!secret) {
        return null;
    }
    const normalizedArticleId = String(articleId).trim();
    const normalizedImageKey = imageKey.trim().toLowerCase();
    if (!/^\d+$/.test(normalizedArticleId) || !/^[a-f0-9]{64}$/.test(normalizedImageKey)) {
        return null;
    }
    const now = options.now ?? Math.floor(Date.now() / 1000);
    const ttlSeconds = options.ttlSeconds ?? FRESHDESK_PUBLIC_IMAGE_TOKEN_TTL_SECONDS;
    const expiresAt = options.expiresAt ?? now + ttlSeconds;
    const payload = buildPayloadString({
        articleId: normalizedArticleId,
        imageKey: normalizedImageKey,
        expiresAt,
    });
    return `${toBase64Url(payload)}.${signPayload(payload, secret)}`;
}
export function verifyFreshdeskPublicImageToken(token, options = {}) {
    const trimmed = token.trim();
    const separatorIndex = trimmed.lastIndexOf(".");
    if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
        return null;
    }
    const encodedPayload = trimmed.slice(0, separatorIndex);
    const encodedSignature = trimmed.slice(separatorIndex + 1);
    const payloadBuffer = fromBase64Url(encodedPayload);
    if (!payloadBuffer) {
        return null;
    }
    const payload = payloadBuffer.toString("utf8");
    const signatureBuffer = fromBase64Url(encodedSignature);
    if (!signatureBuffer) {
        return null;
    }
    const secrets = readSigningSecrets();
    if (secrets.length === 0) {
        return null;
    }
    const verified = secrets.some((secret) => {
        const expected = fromBase64Url(signPayload(payload, secret));
        return expected !== null && safeEqual(signatureBuffer, expected);
    });
    if (!verified) {
        return null;
    }
    const parts = payload.split(".");
    if (parts.length !== 3) {
        return null;
    }
    const [articleId, imageKey, expiresAtRaw] = parts;
    const expiresAt = Number(expiresAtRaw);
    if (!/^\d+$/.test(articleId) || !/^[a-f0-9]{64}$/.test(imageKey) || !Number.isFinite(expiresAt)) {
        return null;
    }
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (expiresAt < now) {
        return null;
    }
    return { articleId, imageKey, expiresAt };
}
