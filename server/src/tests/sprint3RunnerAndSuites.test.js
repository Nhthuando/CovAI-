import { test } from "@jest/globals";
import assert from "node:assert/strict";
import { buildVitestCommand } from "../services/vitestRunner.service.js";
import { mapCoverageSuiteResult, storedTestRunSuites } from "../controllers/coverage.controller.js";

test("Windows runner replaces POSIX shims and quotes paths with spaces", () => {
  const bin = String.raw`D:\HuuThuan - Project\NCKH\CovAI\node_modules\vitest\vitest.mjs`;
  for (const command of [
    "./node_modules/.bin/vitest run --config vitest.config.js",
    '"./node_modules/.bin/vitest" run --config vitest.config.js',
    "../node_modules/.bin/vitest run --config vitest.config.js",
    "npx vitest run --config vitest.config.js",
  ]) {
    const actual = buildVitestCommand(bin, command, "win32");
    assert.equal(actual, `node "${bin}" run --config vitest.config.js`);
    assert.ok(!actual.startsWith("./"));
  }
  assert.equal(buildVitestCommand(bin, null, "win32"), `node "${bin}" run`);
  assert.equal(buildVitestCommand(null, "./node_modules/.bin/vitest run", "win32"), "npx --no-install vitest run");
});

test("POSIX custom runner commands are retained", () => {
  const command = "./node_modules/.bin/vitest run --config custom.js";
  assert.equal(buildVitestCommand("node_modules/vitest/vitest.mjs", command, "linux"), command);
});

const jestResults = {
  testResults: [
    {
      name: "tests/qa-pass.test.js",
      status: "passed",
      assertionResults: [
        { title: "first passing assertion", status: "passed" },
        { title: "second passing assertion", status: "passed" },
      ],
    },
    {
      name: "tests/qa-fail.test.js",
      status: "failed",
      assertionResults: [
        { title: "failing assertion", status: "failed" },
        { title: "passing assertion", status: "passed" },
      ],
    },
  ],
};

test("Jest suites expose assertion titles, statuses, counts and failure precedence", () => {
  const [passed, failed] = jestResults.testResults.map(mapCoverageSuiteResult);
  assert.deepEqual(passed, {
    assertions: jestResults.testResults[0].assertionResults,
    passedTests: 2, failedTests: 0, totalTests: 2, status: "passed",
  });
  assert.deepEqual(failed, {
    assertions: jestResults.testResults[1].assertionResults,
    passedTests: 1, failedTests: 1, totalTests: 2, status: "failed",
  });
  assert.equal(mapCoverageSuiteResult({ ...jestResults.testResults[0], status: "pending" }).status, "passed");
  assert.equal(mapCoverageSuiteResult({ ...jestResults.testResults[0], status: "failed" }).status, "failed");
  assert.equal(mapCoverageSuiteResult({ ...jestResults.testResults[0], numFailingTests: 1 }).status, "failed");
  assert.equal(mapCoverageSuiteResult({ status: "passed", assertionResults: [] }).status, "pending");
  assert.equal(mapCoverageSuiteResult(null).totalTests, 0);
});

test("suite and assertion messages strip ANSI escapes", () => {
  const suite = mapCoverageSuiteResult({
    message: "\u001b[31mSuite failed\u001b[0m",
    assertionResults: [{ status: "failed", failureMessages: ["\u001b[31mExpected 2\u001b[0m"] }],
  });
  assert.deepEqual([suite.message, suite.assertions[0].failureMessages], ["Suite failed", ["Expected 2"]]);
});

test("stored scenarios recover suites without JSON and exclude older runs", () => {
  const scenarios = jestResults.testResults.flatMap((suite) => suite.assertionResults.map((a) => ({
    ...a, testFile: suite.name,
  })));
  const suites = storedTestRunSuites([
    { type: "JEST", scenarios },
    { type: "JEST", scenarios: [{ testFile: "tests/obsolete.test.js", title: "old", status: "failed" }] },
  ]);
  assert.deepEqual(suites.map((s) => s.name), jestResults.testResults.map((s) => s.name));
  assert.deepEqual(suites.map(mapCoverageSuiteResult).map((s) => ({
    status: s.status, passed: s.passedTests, failed: s.failedTests, total: s.totalTests,
  })), [
    { status: "passed", passed: 2, failed: 0, total: 2 },
    { status: "failed", passed: 1, failed: 1, total: 2 },
  ]);
});
