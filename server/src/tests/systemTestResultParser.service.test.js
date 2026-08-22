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

  it("rejects a missing report", () => {
    expect(() => parseSystemTestResult({ runner: "playwright", resultPath: "missing.json", startedAt, finishedAt }))
      .toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});
