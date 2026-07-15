import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  analyzeFreshdeskPublicImageCropBounds,
  detectFreshdeskPublicImageCropBounds,
  normalizeFreshdeskPublicImageBuffer,
} from "./freshdesk-public-image-crop.js";

async function createBlackCanvasWithScreenshot(options: {
  canvasWidth: number;
  canvasHeight: number;
  screenshotWidth: number;
  screenshotHeight: number;
  screenshotLeft: number;
  screenshotTop: number;
  screenshotColor: { r: number; g: number; b: number };
  extras?: Array<{
    width: number;
    height: number;
    left: number;
    top: number;
    color: { r: number; g: number; b: number };
  }>;
}): Promise<Buffer> {
  const composites: sharp.OverlayOptions[] = [];

  const screenshot = await sharp({
    create: {
      width: options.screenshotWidth,
      height: options.screenshotHeight,
      channels: 3,
      background: options.screenshotColor,
    },
  })
    .png()
    .toBuffer();

  composites.push({
    input: screenshot,
    left: options.screenshotLeft,
    top: options.screenshotTop,
  });

  for (const extra of options.extras ?? []) {
    const patch = await sharp({
      create: {
        width: extra.width,
        height: extra.height,
        channels: 3,
        background: extra.color,
      },
    })
      .png()
      .toBuffer();

    composites.push({
      input: patch,
      left: extra.left,
      top: extra.top,
    });
  }

  return sharp({
    create: {
      width: options.canvasWidth,
      height: options.canvasHeight,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

test("removes large black canvas around the useful screenshot", async () => {
  const source = await createBlackCanvasWithScreenshot({
    canvasWidth: 900,
    canvasHeight: 700,
    screenshotWidth: 360,
    screenshotHeight: 240,
    screenshotLeft: 24,
    screenshotTop: 18,
    screenshotColor: { r: 232, g: 236, b: 244 },
  });

  const result = await normalizeFreshdeskPublicImageBuffer(source, "image/png");
  const metadata = await sharp(result.buffer).metadata();

  assert.equal(result.cropped, true);
  assert.ok((metadata.width ?? 0) < 900);
  assert.ok((metadata.height ?? 0) < 700);
  assert.ok((metadata.width ?? 0) <= 400);
  assert.ok((metadata.height ?? 0) <= 300);
});

test("ignores isolated small regions such as a distant close button", async () => {
  const source = await createBlackCanvasWithScreenshot({
    canvasWidth: 900,
    canvasHeight: 700,
    screenshotWidth: 360,
    screenshotHeight: 240,
    screenshotLeft: 24,
    screenshotTop: 18,
    screenshotColor: { r: 232, g: 236, b: 244 },
    extras: [
      {
        width: 28,
        height: 28,
        left: 820,
        top: 620,
        color: { r: 255, g: 255, b: 255 },
      },
    ],
  });

  const bounds = await analyzeFreshdeskPublicImageCropBounds(source);
  assert.ok(bounds);
  assert.ok(bounds!.left <= 30);
  assert.ok(bounds!.top <= 30);
  assert.ok(bounds!.width < 500);
  assert.ok(bounds!.height < 400);
});

test("preserves the top-left application screenshot", async () => {
  const source = await createBlackCanvasWithScreenshot({
    canvasWidth: 800,
    canvasHeight: 600,
    screenshotWidth: 300,
    screenshotHeight: 180,
    screenshotLeft: 16,
    screenshotTop: 12,
    screenshotColor: { r: 220, g: 225, b: 235 },
  });

  const bounds = await analyzeFreshdeskPublicImageCropBounds(source);
  assert.ok(bounds);
  assert.ok(bounds!.left <= 20);
  assert.ok(bounds!.top <= 20);

  const result = await normalizeFreshdeskPublicImageBuffer(source, "image/png");
  const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });

  assert.equal(result.cropped, true);
  assert.ok(info.width <= 340);
  assert.ok(info.height <= 220);

  const sampleIndex = (20 * info.width + 20) * info.channels;
  const samplePixel = {
    r: data[sampleIndex],
    g: data[sampleIndex + 1],
    b: data[sampleIndex + 2],
  };
  assert.ok(samplePixel.r > 180);
  assert.ok(samplePixel.g > 180);
  assert.ok(samplePixel.b > 180);
});

test("already-cropped images remain unchanged", async () => {
  const source = await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: { r: 228, g: 232, b: 240 },
    },
  })
    .png()
    .toBuffer();

  const result = await normalizeFreshdeskPublicImageBuffer(source, "image/png");

  assert.equal(result.cropped, false);
  assert.equal(result.buffer.equals(source), true);
});

test("safe fallback returns original bytes when cropping is uncertain", async () => {
  const invalid = Buffer.from("not-a-valid-image");
  const result = await normalizeFreshdeskPublicImageBuffer(invalid, "image/png");

  assert.equal(result.cropped, false);
  assert.equal(result.buffer.equals(invalid), true);
});

test("detectFreshdeskPublicImageCropBounds returns null when content fills the frame", () => {
  const width = 40;
  const height = 30;
  const mask = new Array<boolean>(width * height).fill(true);

  const bounds = detectFreshdeskPublicImageCropBounds(
    width,
    height,
    mask,
    320,
    240,
  );

  assert.equal(bounds, null);
});
