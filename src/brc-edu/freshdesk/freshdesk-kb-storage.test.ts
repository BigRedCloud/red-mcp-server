import assert from "node:assert/strict";
import test from "node:test";

import {
  getFreshdeskKbImageContainerName,
  getFreshdeskKbStorageConnectionString,
} from "./freshdesk-kb-storage.js";

test("getFreshdeskKbStorageConnectionString prefers BRC_EDU_KB_STORAGE_CONNECTION", () => {
  const previousKb = process.env.BRC_EDU_KB_STORAGE_CONNECTION;
  const previousStorage = process.env.BRC_EDU_STORAGE_CONNECTION_STRING;
  const previousStorageAlt = process.env.BRC_EDU_STORAGE_CONNECTION;

  process.env.BRC_EDU_KB_STORAGE_CONNECTION = "kb-connection";
  process.env.BRC_EDU_STORAGE_CONNECTION_STRING = "resource-connection";
  delete process.env.BRC_EDU_STORAGE_CONNECTION;

  assert.equal(getFreshdeskKbStorageConnectionString(), "kb-connection");

  process.env.BRC_EDU_KB_STORAGE_CONNECTION = previousKb;
  process.env.BRC_EDU_STORAGE_CONNECTION_STRING = previousStorage;
  process.env.BRC_EDU_STORAGE_CONNECTION = previousStorageAlt;
});

test("getFreshdeskKbStorageConnectionString falls back to BRC Edu storage connection", () => {
  const previousKb = process.env.BRC_EDU_KB_STORAGE_CONNECTION;
  const previousStorage = process.env.BRC_EDU_STORAGE_CONNECTION_STRING;
  const previousStorageAlt = process.env.BRC_EDU_STORAGE_CONNECTION;

  delete process.env.BRC_EDU_KB_STORAGE_CONNECTION;
  process.env.BRC_EDU_STORAGE_CONNECTION_STRING = "resource-connection";
  delete process.env.BRC_EDU_STORAGE_CONNECTION;

  assert.equal(getFreshdeskKbStorageConnectionString(), "resource-connection");

  if (previousKb) {
    process.env.BRC_EDU_KB_STORAGE_CONNECTION = previousKb;
  }
  process.env.BRC_EDU_STORAGE_CONNECTION_STRING = previousStorage;
  process.env.BRC_EDU_STORAGE_CONNECTION = previousStorageAlt;
});

test("getFreshdeskKbImageContainerName defaults to brc-edu-images", () => {
  const previous = process.env.BRC_EDU_KB_IMAGE_CONTAINER;
  delete process.env.BRC_EDU_KB_IMAGE_CONTAINER;
  assert.equal(getFreshdeskKbImageContainerName(), "brc-edu-images");
  if (previous) {
    process.env.BRC_EDU_KB_IMAGE_CONTAINER = previous;
  }
});
