import test from "node:test";
import assert from "node:assert/strict";
import {
  getPassRate,
  computeHealth,
  computeQualityGate,
  computeExecutionTotals,
  computeCoverageIndex,
  computePyramid,
  diagnoseRootCause,
  buildActionItems,
} from "./unifiedDashboard.selectors.js";

test("getPassRate returns accurate percentages and handles 0 or null", () => {
  assert.equal(getPassRate(10, 0), 100);
  assert.equal(getPassRate(9, 1), 90);
  assert.equal(getPassRate(0, 5), 0);
  assert.equal(getPassRate(0, 0), null);
  assert.equal(getPassRate(null, null), null);
});

test("computeHealth computes weighted score and grade across all 3 layers", () => {
  const pillars = {
    unit: { passedTests: 90, failedTests: 10, coverageMetrics: { lines: 80 } }, // 0.5*90 + 0.5*80 = 85
    integration: { passedTests: 100, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } }, // 100
    system: { passedTests: 80, failedTests: 20, coverageMetrics: { flow: 60 } }, // 0.5*80 + 0.5*60 = 70
  };
  // weights: 0.5 * 85 + 0.3 * 100 + 0.2 * 70 = 42.5 + 30 + 14 = 86.5 -> round = 87
  const health = computeHealth(pillars);
  assert.equal(health.score, 87);
  assert.equal(health.grade, "B");
});

test("computeHealth re-normalizes weights when a layer has no data", () => {
  const pillars = {
    unit: { passedTests: 100, failedTests: 0, coverageMetrics: { lines: 100 } }, // 100
    integration: { passedTests: 100, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } }, // 100
    // system has no data
  };
  // unit (0.50) + integration (0.30) -> normalized: unit = 0.5/0.8, integration = 0.3/0.8 -> score 100
  const health = computeHealth(pillars);
  assert.equal(health.score, 100);
  assert.equal(health.grade, "A");
});

test("computeHealth returns null when no pillars have data", () => {
  assert.deepEqual(computeHealth({}), { score: null, grade: null, delta: null });
});

test("computeQualityGate returns PASSED when all criteria are met", () => {
  const pillars = {
    unit: { totalTests: 100, passedTests: 100, failedTests: 0, coverageMetrics: { lines: 85 } },
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: 80 } },
  };
  const gate = computeQualityGate(pillars);
  assert.equal(gate.status, "PASSED");
  assert.equal(gate.label, "READY TO RELEASE");
  assert.ok(gate.reasons.length > 0);
});

test("computeQualityGate returns FAILED if pass rate < 80% or system journey fails", () => {
  const pillarsWithLowPass = {
    unit: { totalTests: 100, passedTests: 70, failedTests: 30, coverageMetrics: { lines: 85 } }, // 70% < 80%
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: 80 } },
  };
  const gate1 = computeQualityGate(pillarsWithLowPass);
  assert.equal(gate1.status, "FAILED");
  assert.equal(gate1.label, "BLOCKED");

  const pillarsWithSystemFail = {
    unit: { totalTests: 100, passedTests: 100, failedTests: 0, coverageMetrics: { lines: 85 } },
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 4, failedTests: 1, coverageMetrics: { flow: 80 } },
  };
  const gate2 = computeQualityGate(pillarsWithSystemFail);
  assert.equal(gate2.status, "FAILED");
  assert.ok(gate2.reasons.some((r) => r.includes("user journey test(s) failed")));
});

test("computeQualityGate returns WARNING if coverage is below threshold or flaky tests exist", () => {
  const pillars = {
    unit: { totalTests: 100, passedTests: 100, failedTests: 0, coverageMetrics: { lines: 65 } }, // < 70%
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: 80 }, flakyTests: 1 },
  };
  const gate = computeQualityGate(pillars);
  assert.equal(gate.status, "WARNING");
  assert.equal(gate.label, "AT RISK");
  assert.ok(gate.reasons.some((r) => r.includes("flaky")));
  assert.ok(gate.reasons.some((r) => r.includes("Code coverage (65%)")));
});

test("computeExecutionTotals correctly aggregates counts and pass rate", () => {
  const pillars = {
    unit: { totalTests: 100, passedTests: 95, failedTests: 5, skippedTests: 2, flakyTests: 0, durationMs: 4000 },
    integration: { totalTests: 25, passedTests: 24, failedTests: 1, skippedTests: 0, flakyTests: 0, durationMs: 12000 },
    system: { totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 1, flakyTests: 1, durationMs: 45000 },
  };
  const totals = computeExecutionTotals(pillars);
  assert.equal(totals.total, 135);
  assert.equal(totals.passed, 129);
  assert.equal(totals.failed, 6);
  assert.equal(totals.skipped, 3);
  assert.equal(totals.flaky, 1);
  assert.equal(totals.durationMs, 61000);
  assert.equal(totals.passRate, 95.6);
});

test("computeCoverageIndex averages available metrics", () => {
  const pillars = {
    unit: { coverageMetrics: { lines: 80.0 } },
    integration: { coverageMetrics: { apiEndpoint: 70.0 } },
    system: { coverageMetrics: { flow: 60.0 } },
  };
  const cov = computeCoverageIndex(pillars);
  assert.equal(cov.codePct, 80.0);
  assert.equal(cov.apiPct, 70.0);
  assert.equal(cov.flowPct, 60.0);
  assert.equal(cov.overall, 70.0);
});

test("computePyramid identifies pyramid, ice-cream-cone, and hourglass patterns", () => {
  // Balanced: 100 Unit >= 20 Int >= 5 Sys
  const p1 = computePyramid({
    unit: { totalTests: 100 },
    integration: { totalTests: 20 },
    system: { totalTests: 5 },
  });
  assert.equal(p1.shape, "pyramid");
  assert.equal(p1.warning, null);

  // Inverted: 50 Sys > 10 Unit
  const p2 = computePyramid({
    unit: { totalTests: 10 },
    integration: { totalTests: 15 },
    system: { totalTests: 50 },
  });
  assert.equal(p2.shape, "ice-cream-cone");
  assert.ok(p2.warning.includes("Ice-Cream Cone"));

  // Hourglass: 100 Unit, 2 Int, 20 Sys
  const p3 = computePyramid({
    unit: { totalTests: 100 },
    integration: { totalTests: 2 },
    system: { totalTests: 20 },
  });
  assert.equal(p3.shape, "hourglass");
  assert.ok(p3.warning.includes("Hourglass"));

  // Insufficient: all 0
  const p4 = computePyramid({});
  assert.equal(p4.shape, "insufficient");
});

test("diagnoseRootCause matches cross-layer diagnosis truth table", () => {
  assert.equal(diagnoseRootCause("pass", "fail", "fail").suspectLayer, "integration");
  assert.equal(diagnoseRootCause("pass", "pass", "fail").suspectLayer, "system");
  assert.equal(diagnoseRootCause("fail", "fail", "fail").suspectLayer, "unit");
  assert.equal(diagnoseRootCause("pass", "fail", "pass").suspectLayer, "integration");
  assert.equal(diagnoseRootCause("pass", "pass", "pass").suspectLayer, "none");
  assert.equal(diagnoseRootCause("untested", "pass", "pass").suspectLayer, "unit");
});

test("buildActionItems orders actions by High, Medium, Low priority", () => {
  const pillars = {
    unit: { failedTests: 1, lowCoverageItems: [{ filePath: "service.js", branchesPct: 40 }] },
    integration: { failedTests: 2, coverageMetrics: { uncoveredApis: 3 } },
    system: { failedTests: 1, flakyTests: 2 },
  };
  const items = buildActionItems(pillars, [], 5);
  assert.ok(items.length > 0);
  assert.equal(items[0].priority, "HIGH");
  // Check ordering
  const priorities = items.map((i) => i.priority);
  assert.ok(priorities.indexOf("HIGH") <= priorities.indexOf("MEDIUM"));
});
