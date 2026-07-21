import assert from "node:assert/strict";
import test from "node:test";

import { extractFreshdeskImages } from "./image-extractor.js";

test("extractFreshdeskImages extracts valid HTTPS img src values", () => {
  const html = `
    <p>Intro</p>
    <img src="https://cdn.freshdesk.com/helpdesk/attachments/a.png" />
    <img src="https://s3.amazonaws.com/freshdesk-assets/b.jpg" />
  `;

  const images = extractFreshdeskImages(html);

  assert.equal(images.length, 2);
  assert.equal(
    images[0]?.sourceUrl,
    "https://cdn.freshdesk.com/helpdesk/attachments/a.png",
  );
  assert.equal(
    images[1]?.sourceUrl,
    "https://s3.amazonaws.com/freshdesk-assets/b.jpg",
  );
});

test("extractFreshdeskImages preserves alt text", () => {
  const html = `
    <img src="https://cdn.freshdesk.com/a.png" alt="  Setup diagram  " />
    <img src="https://cdn.freshdesk.com/b.png" />
  `;

  const images = extractFreshdeskImages(html);

  assert.equal(images.length, 2);
  assert.equal(images[0]?.altText, "Setup diagram");
  assert.equal(images[1]?.altText, null);
});

test("extractFreshdeskImages removes duplicate image URLs", () => {
  const sharedUrl = "https://cdn.freshdesk.com/shared.png";
  const html = `
    <img src="${sharedUrl}" alt="first" />
    <img src="${sharedUrl}" alt="second" />
  `;

  const images = extractFreshdeskImages(html);

  assert.equal(images.length, 1);
  assert.equal(images[0]?.sourceUrl, sharedUrl);
  assert.equal(images[0]?.altText, "second");
});

test("extractFreshdeskImages ignores missing src", () => {
  const html = `
    <img alt="no source" />
    <img src="" alt="empty source" />
    <img src="   " alt="whitespace source" />
  `;

  const images = extractFreshdeskImages(html);

  assert.deepEqual(images, []);
});

test("extractFreshdeskImages ignores malformed URLs", () => {
  const html = `
    <img src="not-a-valid-url" alt="bad" />
    <img src="://missing-scheme" alt="worse" />
  `;

  const images = extractFreshdeskImages(html);

  assert.deepEqual(images, []);
});

test("extractFreshdeskImages ignores non-HTTPS URLs", () => {
  const html = `
    <img src="http://cdn.freshdesk.com/insecure.png" alt="http" />
    <img src="ftp://cdn.freshdesk.com/file.png" alt="ftp" />
    <img src="//cdn.freshdesk.com/protocol-relative.png" alt="relative" />
  `;

  const images = extractFreshdeskImages(html);

  assert.deepEqual(images, []);
});
