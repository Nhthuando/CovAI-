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
  if (report.errors?.length) {
    throw new ServiceError(`Playwright execution failed: ${report.errors.map((error) => error.message || String(error)).join("; ")}`, 422);
  }
  const tests = [];
  const scenarios = [];

  const collectSuite = (suite, parentFile = "") => {
    const currentFile = suite.file || parentFile;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        tests.push(test);

        const results = test.results || [];
        const statuses = results.map((r) => r.status);
        const isFlaky =
          test.status === "flaky" ||
          (statuses.length > 1 &&
            statuses.includes("passed") &&
            statuses.some((s) => ["failed", "timedOut", "interrupted"].includes(s)));
        const isFailed =
          !isFlaky &&
          test.status !== "expected" && test.status !== "skipped" &&
          (statuses.some((s) => ["failed", "timedOut", "interrupted"].includes(s)) ||
            test.status === "unexpected");
        const isPassed = test.status !== "skipped" && !isFlaky && !isFailed && (statuses.includes("passed") || test.status === "expected");

        let statusStr = "passed";
        if (isFlaky) statusStr = "flaky";
        else if (isFailed) statusStr = "failed";
        else if (!isPassed) statusStr = "skipped";

        const totalDuration = results.reduce((acc, r) => acc + (r.duration || 0), 0);
        const failureMessages = [];
        for (const r of results) {
          if (r.error?.message) failureMessages.push(r.error.message);
          for (const e of r.errors || []) {
            if (e.message && !failureMessages.includes(e.message)) failureMessages.push(e.message);
          }
        }

        scenarios.push({
          title: spec.title || "Unnamed Test",
          suiteName: suite.title || null,
          status: statusStr,
          durationMs: totalDuration || null,
          failureMessages,
          testFile: currentFile || spec.file || null,
          screenshotSource: (results.at(-1)?.attachments?.find(attachment => attachment.name === "evidence" && attachment.contentType === "image/png" && attachment.path) || results.at(-1)?.attachments?.find(attachment => attachment.contentType === "image/png" && attachment.path))?.path || null,
        });
      }
    }
    for (const child of suite.suites || []) collectSuite(child, currentFile);
  };
  for (const suite of report.suites || []) collectSuite(suite);

  const runnerErrors = Array.isArray(report.errors) ? report.errors : [];
  if (runnerErrors.length > 0) {
    for (const err of runnerErrors) {
      const errMsg = err.message || err.stack || (typeof err === "string" ? err : JSON.stringify(err));
      scenarios.push({
        title: "Playwright Runner Error",
        suiteName: "Execution Failure",
        status: "failed",
        durationMs: null,
        failureMessages: [errMsg],
        testFile: err.location?.file || null,
      });
    }
  }

  const stats = report.stats || {};
  let totalTests = tests.length || Number(stats.total ?? (Number(stats.expected || 0) + Number(stats.unexpected || 0) + Number(stats.flaky || 0) + Number(stats.skipped || 0)));
  if (!Number.isFinite(totalTests)) {
    throw new ServiceError("Playwright report does not contain test totals", 422);
  }

  let passedTests = 0;
  let failedTests = 0;
  let flakyTests = 0;
  let skippedTests = 0;

  for (const test of tests) {
    const statuses = (test.results || []).map((result) => result.status);
    const isFlaky =
      test.status === "flaky" ||
      (statuses.length > 1 &&
        statuses.includes("passed") &&
        statuses.some((s) => ["failed", "timedOut", "interrupted"].includes(s)));

    if (test.status === "skipped") {
      skippedTests += 1;
    } else if (isFlaky) {
      flakyTests += 1;
    } else if (test.status === "expected") {
      passedTests += 1;
    } else if (
      statuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status)) ||
      test.status === "unexpected"
    ) {
      failedTests += 1;
    } else if (statuses.some((status) => status === "passed") || test.status === "expected") {
      passedTests += 1;
    } else {
      skippedTests += 1;
    }
  }

  if (tests.length === 0) {
    flakyTests = Number(stats.flaky || 0);
    failedTests = Number(stats.unexpected || 0);
    skippedTests = Number(stats.skipped || 0);
    passedTests = Math.max(0, totalTests - failedTests - flakyTests - skippedTests);
  }
  if (totalTests === 0) {
    throw new ServiceError("Playwright did not execute any tests", 422);
  }

  if (runnerErrors.length > 0) {
    failedTests += runnerErrors.length;
    totalTests = Math.max(totalTests, passedTests + failedTests + flakyTests + skippedTests);
  }

  return {
    totalTests,
    passedTests,
    failedTests,
    flakyTests,
    skippedTests,
    durationMs: Number(stats.duration) || Math.max(0, finishedAt - startedAt),
    status: (failedTests > 0 || runnerErrors.length > 0) ? "FAILED" : "PASSED",
    startedAt,
    finishedAt,
    scenarios,
  };
};

const normaliseCypress = (report, startedAt, finishedAt) => {
  const stats = report.stats || report;
  const totalTests = Number(stats.tests ?? stats.total ?? 0);
  if (!Number.isFinite(totalTests)) {
    throw new ServiceError("Cypress report does not contain test totals", 422);
  }
  const failedTests = Number(stats.failures || stats.failed || 0);
  const skippedTests = Number(stats.pending || stats.skipped || 0);
  const flakyTests = Number(stats.flaky || 0);
  const passedTests = Number.isFinite(Number(stats.passes ?? stats.passed))
    ? Number(stats.passes ?? stats.passed)
    : Math.max(0, totalTests - failedTests - flakyTests - skippedTests);

  const scenarios = [];
  if (Array.isArray(report.runs)) {
    for (const run of report.runs) {
      const testFile = run.spec?.relative || run.spec?.name || null;
      for (const t of run.tests || []) {
        const title = Array.isArray(t.title) ? t.title.join(" > ") : t.title || "Unnamed Test";
        let status = "passed";
        if (t.state === "failed") status = "failed";
        else if (t.state === "pending" || t.state === "skipped") status = "skipped";
        else if (t.flaky || (t.attempts && t.attempts.length > 1 && t.state === "passed")) status = "flaky";

        scenarios.push({
          title,
          suiteName: Array.isArray(t.title) && t.title.length > 1 ? t.title[0] : null,
          status,
          durationMs: t.duration || 0,
          failureMessages: t.displayError ? [t.displayError] : [],
          testFile,
        });
      }
    }
  }

  return {
    totalTests,
    passedTests,
    failedTests,
    flakyTests,
    skippedTests,
    durationMs: Number(stats.duration) || Math.max(0, finishedAt - startedAt),
    status: failedTests > 0 ? "FAILED" : "PASSED",
    startedAt,
    finishedAt,
    scenarios,
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
