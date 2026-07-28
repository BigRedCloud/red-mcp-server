import assert from "node:assert/strict";
import test from "node:test";

import {
  getFreshdeskKbImageContainerName,
  getFreshdeskKbStorageConnectionString,
} from "./freshdesk-kb-storage.js";

test("getFreshdeskKbStorageConnectionString prefers BRC_EDU_KB_STORAGE_CONNECTION", () => {
  const previousKb = process.env.BRC_EDU_KB_STORAGE_CONNECTION;
  const previousUpload = process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING;

  process.env.BRC_EDU_KB_STORAGE_CONNECTION = "kb-connection";
  process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING = "upload-connection";

  assert.equal(getFreshdeskKbStorageConnectionString(), "kb-connection");

  process.env.BRC_EDU_KB_STORAGE_CONNECTION = previousKb;
  process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING = previousUpload;
});

test("getFreshdeskKbStorageConnectionString falls back to upload storage connection", () => {
  const previousKb = process.env.BRC_EDU_KB_STORAGE_CONNECTION;
  const previousUpload = process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING;

  delete process.env.BRC_EDU_KB_STORAGE_CONNECTION;
  process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING = "upload-connection";

  assert.equal(getFreshdeskKbStorageConnectionString(), "upload-connection");

  if (previousKb) {
    process.env.BRC_EDU_KB_STORAGE_CONNECTION = previousKb;
  }
  process.env.BRC_EDU_UPLOAD_STORAGE_CONNECTION_STRING = previousUpload;
});

test("getFreshdeskKbImageContainerName defaults to brc-edu-images", () => {
  const previous = process.env.BRC_EDU_KB_IMAGE_CONTAINER;
  delete process.env.BRC_EDU_KB_IMAGE_CONTAINER;
  assert.equal(getFreshdeskKbImageContainerName(), "brc-edu-images");
  if (previous) {
    process.env.BRC_EDU_KB_IMAGE_CONTAINER = previous;
  }
});
