import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { parseSystemTestResult } from "../services/systemTestResultParser.service.js";

const paths = [];
const report = (name, value) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-system-report-"));
  paths.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
afterEach(() => paths.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("parseSystemTestResult", () => {
  const startedAt = new Date("2026-08-22T00:00:00Z");
  const finishedAt = new Date("2026-08-22T00:00:02Z");

  it("normalizes nested Playwright results", () => {
    const resultPath = report("playwright.json", {
      stats: { duration: 1200 },
      suites: [{ specs: [{ tests: [
        { results: [{ status: "passed" }] },
        { results: [{ status: "failed" }] },
        { results: [{ status: "skipped" }] },
      ] }] }],
    });
    expect(parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt }))
      .toMatchObject({ totalTests: 3, passedTests: 1, failedTests: 1, skippedTests: 1, durationMs: 1200, status: "FAILED" });
  });

  it("normalizes Cypress Mocha JSON", () => {
    const resultPath = report("cypress.json", { stats: { tests: 4, passes: 3, failures: 1, pending: 0, duration: 800 } });
    expect(parseSystemTestResult({ runner: "cypress", resultPath, startedAt, finishedAt }))
      .toMatchObject({ totalTests: 4, passedTests: 3, failedTests: 1, skippedTests: 0, durationMs: 800, status: "FAILED" });
  });

  it("identifies flaky Playwright tests that pass after retry", () => {
    const resultPath = report("playwright-flaky.json", {
      stats: { duration: 2500 },
      suites: [
        {
          title: "login.spec.js",
          file: "tests/e2e/login.spec.js",
          specs: [
            {
              title: "login with credentials",
              tests: [
                {
                  status: "flaky",
                  results: [
                    { status: "failed", duration: 1000, error: { message: "timeout waiting for selector" } },
                    { status: "passed", duration: 800 },
                  ],
                },
              ],
            },
            {
              title: "login with invalid email",
              tests: [
                {
                  status: "expected",
                  results: [{ status: "passed", duration: 700 }],
                },
              ],
            },
          ],
        },
      ],
    });
    const parsed = parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt });
    expect(parsed).toMatchObject({
      totalTests: 2,
      passedTests: 1,
      failedTests: 0,
      flakyTests: 1,
      skippedTests: 0,
      status: "PASSED",
    });
    expect(parsed.scenarios).toHaveLength(2);
    expect(parsed.scenarios[0]).toMatchObject({
      title: "login with credentials",
      status: "flaky",
      suiteName: "login.spec.js",
      failureMessages: ["timeout waiting for selector"],
    });
    expect(parsed.scenarios[1]).toMatchObject({
      title: "login with invalid email",
      status: "passed",
    });
  });

  it("rejects runner errors instead of inventing test cases", () => {
    const resultPath = report("playwright-errors.json", {
      stats: { duration: 92, expected: 0, unexpected: 0 },
      suites: [],
      errors: [
        { message: "Error: Cannot find package '@playwright/test'" },
        { message: "Error: No tests found" },
      ],
    });
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt })).toThrow("Playwright execution failed");
  });

  it("counts expected failures as passing and skipped cases as skipped", () => {
    const resultPath = report("expected.json", { suites: [{ specs: [{ tests: [
      { status: "expected", expectedStatus: "failed", results: [{ status: "failed" }] },
      { status: "skipped", results: [{ status: "skipped" }] },
    ] }] }] });
    const parsed = parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt });
    expect(parsed).toMatchObject({ totalTests: 2, passedTests: 1, failedTests: 0, skippedTests: 1 });
    expect(parsed.scenarios.map((scenario) => scenario.status)).toEqual(["passed", "skipped"]);
  });

  it("rejects empty execution", () => {
    const resultPath = report("empty.json", { suites: [], stats: { expected: 0 } });
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath, startedAt, finishedAt })).toThrow("did not execute any tests");
  });

  it("rejects a missing report", () => {
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath: "missing.json", startedAt, finishedAt }))
      .toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});
