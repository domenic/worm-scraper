"use strict";
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../package.json");

const cliPath = path.resolve(__dirname, "../lib/worm-scraper.js");
const projectPath = path.resolve(__dirname, "..");

test("--help describes the commands and typed options", () => {
  const result = runCLI("--help");

  assertSuccessful(result);
  assert.match(result.stdout, /Commands:/u);
  assert.match(result.stdout, /-j, --jobs\s+Number of concurrent read\/write conversion jobs/u);
  assert.match(result.stdout, /\[number\]/u);
});

test("--version reports the package version", () => {
  const result = runCLI("--version");

  assertSuccessful(result);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("unknown options are rejected", () => {
  const result = runCLI("not-a-command", "--unknown");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: unknown/u);
});

test("a positive integer is accepted for --jobs", () => {
  const result = runCLI("--jobs=3", "--help");

  assertSuccessful(result);
});

for (const invalidJobs of ["abc", "1.5", "0", "-1"]) {
  test(`--jobs rejects ${invalidJobs}`, () => {
    const result = runCLI(`--jobs=${invalidJobs}`, "not-a-command");

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--jobs must be a positive integer/u);
  });
}

function runCLI(...args) {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectPath,
    encoding: "utf8",
    timeout: 10_000
  });
}

function assertSuccessful(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
}
