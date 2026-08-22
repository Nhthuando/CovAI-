import fs from "fs";
import { ServiceError } from "../utils/serviceError.js";

const readReport = (resultPath) => {
  if (!fs.existsSync(resultPath)) {
    throw new ServiceError(`System test report was not created: ${resultPath}`, 422);
  }

  try {
    const content = fs.readFileSync(resultPath, "utf8").trim();
    if (!content) throw new Error("report is empty");
    return JSON.parse(content);
  } catch (error) {
    throw new ServiceError(`System test report is invalid: ${error.message}`, 422);
  }
};

const normalisePlaywright = (report, startedAt, finishedAt) => {
  const tests = [];
  const collectSuite = (suite) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) tests.push(test);
    }
    for (const child of suite.suites || []) collectSuite(child);
  };
  for (const suite of report.suites || []) collectSuite(suite);

  const stats = report.stats || {};
  const totalTests = tests.length || Number(stats.expected ?? stats.total);
  if (!Number.isFinite(totalTests)) {
    throw new ServiceError("Playwright report does not contain test totals", 422);
  }

  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  for (const test of tests) {
    const statuses = (test.results || []).map((result) => result.status);
    if (statuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status))) failedTests += 1;
    else if (statuses.some((status) => status === "passed")) passedTests += 1;
    else skippedTests += 1;
  }

  if (tests.length === 0) {
    failedTests = Number(stats.unexpected || 0);
    skippedTests = Number(stats.skipped || 0);
    passedTests = Math.max(0, totalTests - failedTests - skippedTests);
  }

  return {
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    durationMs: Number(stats.duration) || Math.max(0, finishedAt - startedAt),
    status: failedTests > 0 ? "FAILED" : "PASSED",
    startedAt,
    finishedAt,
  };
};

const normaliseCypress = (report, startedAt, finishedAt) => {
  const stats = report.stats || report;
  const totalTests = Number(stats.tests ?? stats.total);
  if (!Number.isFinite(totalTests)) {
    throw new ServiceError("Cypress report does not contain test totals", 422);
  }
  const failedTests = Number(stats.failures || stats.failed || 0);
  const skippedTests = Number(stats.pending || stats.skipped || 0);
  const passedTests = Number.isFinite(Number(stats.passes ?? stats.passed))
    ? Number(stats.passes ?? stats.passed)
    : Math.max(0, totalTests - failedTests - skippedTests);

  return {
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    durationMs: Number(stats.duration) || Math.max(0, finishedAt - startedAt),
    status: failedTests > 0 ? "FAILED" : "PASSED",
    startedAt,
    finishedAt,
  };
};

export const parseSystemTestResult = ({ runner, resultPath, startedAt, finishedAt }) => {
  if (!["playwright", "cypress"].includes(runner)) {
    throw new ServiceError("Unsupported system test runner", 400);
  }
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const finish = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) {
    throw new ServiceError("System test timestamps are invalid", 422);
  }
  const report = readReport(resultPath);
  return runner === "playwright"
    ? normalisePlaywright(report, start, finish)
    : normaliseCypress(report, start, finish);
};
