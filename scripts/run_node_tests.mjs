#!/usr/bin/env node
/**
 * Split Node test execution so HTTP-spawning integration files run serially
 * while ordinary unit tests remain parallel. Each test file is executed once.
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");

const EXPECTED_HTTP_INTEGRATION_FILES = [
  "mcp_http.integration.test.js",
  "brc_edu_sync.integration.test.js",
  "brc_edu_upload.integration.test.js",
  "freshdesk_public_image.integration.test.js",
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function isIntegrationTest(filePath) {
  return /(^|\/)[^/]+\.integration\.test\.js$/.test(toPosix(filePath));
}

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRunnerPath(filePath) {
  return toPosix(path.relative(root, filePath));
}

function runNodeTest(files, extraArgs, label) {
  if (files.length === 0) {
    throw new Error(`No ${label} test files found under build/.`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--test", ...extraArgs, ...files.map(toRunnerPath)],
      {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
      },
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} test runner killed by ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });
}

function assertExpectedHttpFilesPresent(integrationFiles) {
  const names = new Set(integrationFiles.map((filePath) => path.basename(filePath)));
  const missing = EXPECTED_HTTP_INTEGRATION_FILES.filter((name) => !names.has(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing expected HTTP integration tests: ${missing.join(", ")}`,
    );
  }
}

const mode = process.argv.includes("--http")
  ? "http"
  : process.argv.includes("--integration")
    ? "integration"
    : process.argv.includes("--unit")
      ? "unit"
      : "all";

const allTestFiles = (await collectTestFiles(buildDir)).sort((left, right) =>
  toPosix(left).localeCompare(toPosix(right)),
);
const integrationFiles = allTestFiles.filter(isIntegrationTest);
const httpIntegrationFiles = integrationFiles.filter((filePath) =>
  EXPECTED_HTTP_INTEGRATION_FILES.includes(path.basename(filePath)),
);
const unitFiles = allTestFiles.filter((filePath) => !isIntegrationTest(filePath));

assertExpectedHttpFilesPresent(integrationFiles);

if (allTestFiles.length !== unitFiles.length + integrationFiles.length) {
  throw new Error("Test file split overlap or drop detected.");
}

const serialFiles =
  mode === "http" ? httpIntegrationFiles : integrationFiles;

if (mode !== "unit") {
  console.log(
    `${mode === "http" ? "HTTP integration" : "Integration"} tests (${serialFiles.length} files, serial):`,
  );
  for (const filePath of serialFiles) {
    console.log(`  ${toRunnerPath(filePath)}`);
  }
}

if (mode === "all" || mode === "unit") {
  console.log(`Unit tests: ${unitFiles.length} files (parallel)`);
}

if (mode === "all" || mode === "unit") {
  const unitCode = await runNodeTest(unitFiles, [], "unit");
  if (unitCode !== 0) {
    process.exit(unitCode);
  }
}

if (mode === "unit") {
  process.exit(0);
}

const integrationCode = await runNodeTest(
  serialFiles,
  ["--test-concurrency=1"],
  mode === "http" ? "HTTP integration" : "integration",
);
process.exit(integrationCode);
