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
import { adaptUnifiedDashboard } from "./unifiedDashboard.adapter.js";

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
  const health = computeHealth(pillars);
  assert.equal(health.score, 87);
  assert.equal(health.grade, "B");
});

test("computeHealth re-normalizes weights when a layer has no data", () => {
  const pillars = {
    unit: { passedTests: 100, failedTests: 0, coverageMetrics: { lines: 100 } },
    integration: { passedTests: 100, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } },
  };
  const health = computeHealth(pillars);
  assert.equal(health.score, 100);
  assert.equal(health.grade, "A");
});

test("computeHealth returns null when no pillars have data", () => {
  assert.deepEqual(computeHealth({}), { score: null, grade: null, delta: null });
});

test("computeQualityGate returns PASSED with 4 passing checklist items when all criteria are met", () => {
  const pillars = {
    unit: {
      totalTests: 100,
      passedTests: 100,
      failedTests: 0,
      coverageMetrics: { lines: 85, branches: 80 },
    },
    integration: {
      totalTests: 20,
      passedTests: 20,
      failedTests: 0,
      coverageMetrics: { apiEndpoint: 90 },
    },
    system: {
      totalTests: 5,
      passedTests: 5,
      failedTests: 0,
      coverageMetrics: { flow: 80 },
    },
  };
  const gate = computeQualityGate(pillars, []);
  assert.equal(gate.status, "PASSED");
  assert.equal(gate.label, "READY TO RELEASE");
  assert.equal(gate.checklist.length, 4);
  assert.ok(gate.checklist.every((item) => item.passed === true));
});

test("computeQualityGate returns FAILED if pass rate < 80% or system journey fails", () => {
  const pillarsWithLowPass = {
    unit: { totalTests: 100, passedTests: 70, failedTests: 30, coverageMetrics: { lines: 85, branches: 80 } },
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: 80 } },
  };
  const gate1 = computeQualityGate(pillarsWithLowPass);
  assert.equal(gate1.status, "FAILED");
  assert.equal(gate1.label, "BLOCKED");

  const pillarsWithSystemFail = {
    unit: { totalTests: 100, passedTests: 100, failedTests: 0, coverageMetrics: { lines: 85, branches: 80 } },
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 4, failedTests: 1, coverageMetrics: { flow: 80 } },
  };
  const gate2 = computeQualityGate(pillarsWithSystemFail);
  assert.equal(gate2.status, "FAILED");
  assert.ok(gate2.reasons.some((r) => r.includes("user journey test(s) failed")));
});

test("computeQualityGate returns WARNING if coverage is below threshold or flaky tests exist", () => {
  const pillars = {
    unit: { totalTests: 100, passedTests: 100, failedTests: 0, coverageMetrics: { lines: 65, branches: 65 } },
    integration: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 90 } },
    system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: 80 }, flakyTests: 1 },
  };
  const gate = computeQualityGate(pillars);
  assert.equal(gate.status, "WARNING");
  assert.equal(gate.label, "AT RISK");
  assert.ok(gate.reasons.some((r) => r.includes("flaky")));
  assert.ok(gate.reasons.some((r) => r.includes("Code coverage (65%)")));
  assert.equal(gate.checklist[0].passed, false);
});

test("computeExecutionTotals separates uncoveredApis from failed tests", () => {
  const pillars = {
    unit: { totalTests: 100, passedTests: 95, failedTests: 5, skippedTests: 2, flakyTests: 0, durationMs: 4000 },
    integration: {
      totalTests: 25,
      passedTests: 24,
      failedTests: 1,
      skippedTests: 0,
      flakyTests: 0,
      durationMs: 12000,
      coverageMetrics: { uncoveredApis: 9 },
    },
    system: { totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 1, flakyTests: 1, durationMs: 45000 },
  };
  const totals = computeExecutionTotals(pillars);
  assert.equal(totals.total, 135);
  assert.equal(totals.passed, 129);
  assert.equal(totals.failed, 6);
  assert.equal(totals.uncoveredApis, 9);
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

test("computePyramid identifies pyramid, missing-unit, ice-cream-cone, hourglass, and insufficient patterns", () => {
  // 1. Balanced Pyramid: unitTests > integrationTests >= systemTests and unitTests > 0
  const p1 = computePyramid({
    unit: { totalTests: 100 },
    integration: { totalTests: 20 },
    system: { totalTests: 5 },
  });
  assert.equal(p1.shape, "pyramid");
  assert.equal(p1.badgeTitle, "Balanced Pyramid");
  assert.equal(p1.warning, null);

  // 2. Missing Unit Foundation: unitTests === 0 while integrationTests > 0
  const pMissingUnit = computePyramid({
    unit: { totalTests: 0 },
    integration: { totalTests: 9 },
    system: { totalTests: 0 },
  });
  assert.equal(pMissingUnit.shape, "missing-unit");
  assert.equal(
    pMissingUnit.badgeTitle,
    "Unbalanced Pyramid — Missing Unit Test Foundation"
  );
  assert.ok(pMissingUnit.warning.includes("0 unit tests"));

  // 3. Inverted: systemTests > unitTests
  const p2 = computePyramid({
    unit: { totalTests: 10 },
    integration: { totalTests: 15 },
    system: { totalTests: 50 },
  });
  assert.equal(p2.shape, "ice-cream-cone");
  assert.equal(
    p2.badgeTitle,
    "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)"
  );

  // 4. Hourglass: 100 Unit, 2 Int, 20 Sys
  const p3 = computePyramid({
    unit: { totalTests: 100 },
    integration: { totalTests: 2 },
    system: { totalTests: 20 },
  });
  assert.equal(p3.shape, "hourglass");
  assert.ok(p3.warning.includes("Hourglass"));

  // 5. Insufficient: all 0
  const p4 = computePyramid({});
  assert.equal(p4.shape, "insufficient");
  assert.equal(
    p4.badgeTitle,
    "No Tests Executed — Run suites to establish baseline"
  );
});

test("computeQualityGate returns UNVERIFIED when zero tests have been executed across all pillars", () => {
  const gate = computeQualityGate({});
  assert.equal(gate.status, "UNVERIFIED");
  assert.equal(gate.label, "UNVERIFIED");
  assert.equal(gate.checklist.length, 4);
});

test("diagnoseRootCause matches cross-layer diagnosis truth table", () => {
  assert.equal(diagnoseRootCause("pass", "fail", "fail").suspectLayer, "integration");
  assert.equal(diagnoseRootCause("pass", "pass", "fail").suspectLayer, "system");
  assert.equal(diagnoseRootCause("fail", "fail", "fail").suspectLayer, "unit");
  assert.equal(diagnoseRootCause("pass", "fail", "pass").suspectLayer, "integration");
  assert.equal(diagnoseRootCause("pass", "pass", "pass").suspectLayer, "none");
  assert.equal(diagnoseRootCause("untested", "pass", "pass").suspectLayer, "unit");
});

test("buildActionItems orders actions by CRITICAL, HIGH, MEDIUM, LOW priority using real data", () => {
  const pillars = {
    unit: { failedTests: 1, lowCoverageItems: [{ filePath: "service.js", branchesPct: 40 }] },
    integration: { failedTests: 2, coverageMetrics: { uncoveredApis: 3 } },
    system: { failedTests: 1, flakyTests: 2 },
  };
  const items = buildActionItems(pillars, [], 5);
  assert.ok(items.length > 0);
  assert.equal(items[0].priority, "CRITICAL");
  const priorities = items.map((i) => i.priority);
  assert.ok(priorities.indexOf("CRITICAL") <= priorities.indexOf("HIGH"));
  assert.ok(priorities.indexOf("HIGH") <= priorities.indexOf("MEDIUM"));
});

test("adaptUnifiedDashboard ensures 0 split-brain contradictions and 100% mathematical consistency on real payloads", () => {
  // Real state with 9 uncovered endpoints and 0 executed tests
  const liveVm = adaptUnifiedDashboard({
    context: { snapshotId: "cmvs3749" },
    integrationRaw: {
      endpoints: Array.from({ length: 9 }, (_, i) => ({
        id: `ep-${i}`,
        method: "GET",
        path: `/api/v1/resource-${i}`,
        status: "Uncovered",
      })),
    },
  });

  // Uncovered APIs must NEVER be added to executed total or failed
  assert.equal(liveVm.execution.total, 0);
  assert.equal(liveVm.execution.failed, 0);
  assert.equal(liveVm.execution.uncoveredApis, 9);
  assert.equal(liveVm.pillars.integration.passedTests, 0);
  assert.equal(liveVm.pillars.integration.coverageMetrics.uncoveredApis, 9);
  assert.equal(liveVm.qualityGate.status, "UNVERIFIED");
  // All failure layer breakdown counts must be 0 when failedTests === 0
  assert.ok(
    Object.values(liveVm.pillars.integration.failureDistribution).every(
      (count) => count === 0
    )
  );
  assert.ok(
    Object.values(liveVm.pillars.system.failureDistribution).every(
      (count) => count === 0
    )
  );

  // Real unified backend payload must be 100% mathematically coherent across all 5 Zones
  const fullVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-real-1" },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 42,
          passedTests: 40,
          failedTests: 2,
          skippedTests: 0,
          durationMs: 1850,
          coverageMetrics: { lines: 84.5, branches: 78.2, functions: 88.0, statements: 85.1 },
          lowCoverageItems: [
            { filePath: "src/auth.service.js", branchesPct: 62.5, linesPct: 75.0 },
          ],
        },
        integration: {
          framework: "Supertest",
          totalTests: 12,
          passedTests: 10,
          failedTests: 2,
          skippedTests: 0,
          durationMs: 3200,
          avgDurationMs: 145,
          coverageMetrics: {
            lines: 81.0,
            branches: 74.0,
            functions: 82.0,
            statements: 81.5,
            apiEndpoint: 83.3,
            uncoveredApis: 2,
            totalApis: 12,
          },
          failureDistribution: { route: 0, middlewareAuth: 1, controller: 1, database: 0 },
        },
        system: {
          framework: "Playwright",
          totalTests: 5,
          passedTests: 5,
          failedTests: 0,
          flakyTests: 0,
          durationMs: 9400,
          coverageMetrics: { lines: 100, flow: 100 },
          failureDistribution: { selectorNotFound: 0, networkTimeout: 0, assertion: 0, flaky: 0 },
        },
      },
      ai: { aiGenerated: 8, aiRepaired: 3, gaps: 3 },
    },
  });

  const sumTotal =
    fullVm.pillars.unit.totalTests +
    fullVm.pillars.integration.totalTests +
    fullVm.pillars.system.totalTests;
  const sumPassed =
    fullVm.pillars.unit.passedTests +
    fullVm.pillars.integration.passedTests +
    fullVm.pillars.system.passedTests;
  const sumFailed =
    fullVm.pillars.unit.failedTests +
    fullVm.pillars.integration.failedTests +
    fullVm.pillars.system.failedTests;

  assert.equal(fullVm.execution.total, sumTotal);
  assert.equal(fullVm.execution.passed, sumPassed);
  assert.equal(fullVm.execution.failed, sumFailed);
  assert.equal(fullVm.ai.aiGenerated, 8);
  assert.equal(fullVm.ai.aiRepaired, 3);

  const intBreakdownSum = Object.values(
    fullVm.pillars.integration.failureDistribution
  ).reduce((acc, count) => acc + count, 0);
  assert.equal(intBreakdownSum, fullVm.pillars.integration.failedTests);
});

