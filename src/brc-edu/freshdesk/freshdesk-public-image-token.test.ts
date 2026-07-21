import assert from "node:assert/strict";
import test from "node:test";

import {
  createFreshdeskPublicImageToken,
  FRESHDESK_PUBLIC_IMAGE_TOKEN_TTL_SECONDS,
  verifyFreshdeskPublicImageToken,
} from "./freshdesk-public-image-token.js";

const ARTICLE_ID = "1001";
const IMAGE_KEY = "a".repeat(64);
const SECRET = "test-signing-secret";

test("createFreshdeskPublicImageToken returns URL-safe opaque token", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;

  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: 1_700_000_000,
    expiresAt: 1_700_086_400,
  });

  assert.ok(token);
  assert.match(token!, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(token!.includes("freshdesk/"), false);
  assert.equal(token!.includes("blob.core.windows.net"), false);
});

test("verifyFreshdeskPublicImageToken accepts valid token", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;

  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: 1_700_000_000,
    expiresAt: 1_700_086_400,
  });

  const payload = verifyFreshdeskPublicImageToken(token!, {
    now: 1_700_000_000,
  });

  assert.deepEqual(payload, {
    articleId: ARTICLE_ID,
    imageKey: IMAGE_KEY,
    expiresAt: 1_700_086_400,
  });
});

test("verifyFreshdeskPublicImageToken rejects tampered token", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;

  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: 1_700_000_000,
    expiresAt: 1_700_086_400,
  });

  const tampered = `${token!.slice(0, -1)}x`;
  assert.equal(verifyFreshdeskPublicImageToken(tampered, { now: 1_700_000_000 }), null);
});

test("verifyFreshdeskPublicImageToken rejects expired token", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = SECRET;

  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: 1_700_000_000,
    expiresAt: 1_700_000_000 + FRESHDESK_PUBLIC_IMAGE_TOKEN_TTL_SECONDS,
  });

  assert.equal(
    verifyFreshdeskPublicImageToken(token!, {
      now: 1_700_000_000 + FRESHDESK_PUBLIC_IMAGE_TOKEN_TTL_SECONDS + 1,
    }),
    null,
  );
});

test("verifyFreshdeskPublicImageToken supports key rotation with previous secret", () => {
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "old-secret";
  const token = createFreshdeskPublicImageToken(ARTICLE_ID, IMAGE_KEY, {
    now: 1_700_000_000,
    expiresAt: 1_700_086_400,
  });

  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET = "new-secret";
  process.env.BRC_EDU_PUBLIC_IMAGE_SIGNING_SECRET_PREVIOUS = "old-secret";

  assert.ok(verifyFreshdeskPublicImageToken(token!, { now: 1_700_000_000 }));
});
