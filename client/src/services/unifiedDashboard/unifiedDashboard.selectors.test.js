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
import { fmtDuration } from "./format.js";

test("getPassRate returns accurate percentages and handles 0 or null", () => {
  assert.equal(getPassRate(10, 0), 100);
  assert.equal(getPassRate(9, 1), 90);
  assert.equal(getPassRate(0, 5), 0);
  assert.equal(getPassRate(0, 0), null);
  assert.equal(getPassRate(null, null), null);
});

test("computeHealth computes weighted score, failure penalty, and grade across all 3 layers", () => {
  const pillarsWithFailures = {
    unit: { passedTests: 90, failedTests: 10, coverageMetrics: { lines: 80 } }, // 0.5*90 + 0.5*80 = 85
    integration: { passedTests: 100, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } }, // 100
    system: { passedTests: 80, failedTests: 20, coverageMetrics: { flow: 60 } }, // 0.5*80 + 0.5*60 = 70
  };
  // Weighted = 85*0.5 + 100*0.3 + 70*0.2 = 86.5 -> minus capped 15pt failure penalty = 71.5 -> 72 (B)
  const health = computeHealth(pillarsWithFailures);
  assert.equal(health.score, 72);
  assert.equal(health.grade, "B");

  const passingPillars = {
    unit: { passedTests: 100, failedTests: 0, coverageMetrics: { lines: 70 } }, // 85
    integration: { passedTests: 20, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } }, // 100
    system: { passedTests: 5, failedTests: 0, coverageMetrics: { flow: 40 } }, // 70
  };
  const passingHealth = computeHealth(passingPillars);
  assert.equal(passingHealth.score, 87);
  assert.equal(passingHealth.grade, "A");
});

test("computeHealth counts unexecuted layers as 0 in fixed 50/30/20 denominator to prevent inflation", () => {
  // Single-layer Unit-only 100% pass rate & 100% coverage -> 50/100 Grade C
  const unitOnly = {
    unit: { totalTests: 20, passedTests: 20, failedTests: 0, coverageMetrics: { lines: 100 } },
    integration: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { apiEndpoint: 0 } },
    system: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { flow: null } },
  };
  assert.deepEqual(computeHealth(unitOnly), { score: 50, grade: "C", delta: null });

  // Two-layer: Unit 100%/100% + Integration 100%/100% -> 80/100 Grade A
  const pillars = {
    unit: { passedTests: 100, failedTests: 0, coverageMetrics: { lines: 100 } },
    integration: { passedTests: 100, failedTests: 0, coverageMetrics: { apiEndpoint: 100 } },
  };
  const health = computeHealth(pillars);
  assert.equal(health.score, 80);
  assert.equal(health.grade, "A");

  // Executed System E2E without coverage measurement (flow: null) falls back to passRate, not 0
  const sysNoCov = {
    unit: { totalTests: 10, passedTests: 10, failedTests: 0, coverageMetrics: { lines: 100 } },
    integration: { totalTests: 0, passedTests: 0, failedTests: 0, coverageMetrics: { apiEndpoint: 0 } },
    system: { totalTests: 5, passedTests: 5, failedTests: 0, coverageMetrics: { flow: null } },
  };
  assert.deepEqual(computeHealth(sysNoCov), { score: 70, grade: "B", delta: null });
});

test("fmtDuration formats sub-second, seconds, minutes, and >=1h cumulative totals cleanly", () => {
  assert.equal(fmtDuration(null), "—");
  assert.equal(fmtDuration(450), "450ms");
  assert.equal(fmtDuration(2400), "2.4s");
  assert.equal(fmtDuration(195000), "3m 15s");
  assert.equal(fmtDuration(4320000), "1h 12m");
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

test("computeCoverageIndex computes 50/30/20 weighted metrics when tests ran and 0 when unexecuted", () => {
  const zeroExec = computeCoverageIndex({
    unit: { coverageMetrics: { lines: 80.0 } },
    integration: { coverageMetrics: { apiEndpoint: 70.0 } },
    system: { coverageMetrics: { flow: 60.0 } },
  });
  assert.equal(zeroExec.overall, 0);
  assert.equal(zeroExec.codePct, 0);
  assert.equal(zeroExec.apiPct, 0);
  assert.equal(zeroExec.flowPct, 0);

  const pillars = {
    unit: { totalTests: 10, coverageMetrics: { lines: 80.0 } },
    integration: { totalTests: 5, coverageMetrics: { apiEndpoint: 70.0, totalApis: 5 } },
    system: { totalTests: 2, coverageMetrics: { flow: 60.0 } },
  };
  const cov = computeCoverageIndex(pillars);
  assert.equal(cov.codePct, 80.0);
  assert.equal(cov.apiPct, 70.0);
  assert.equal(cov.flowPct, 60.0);
  assert.equal(cov.overall, 73.0);
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
  assert.equal(gate.label, "UNVERIFIED • NOT RUN");
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

  // Branch & snapshot label propagation check
  const contextVm = adaptUnifiedDashboard({
    context: {
      snapshotId: "snap-branch-check",
      branch: "develop",
      snapshots: [{ id: "snap-branch-check", label: "#3 (abc1234) — Active" }],
    },
  });
  assert.equal(contextVm.context.branch, "develop");
  assert.equal(contextVm.context.snapshotLabel, "#3 (abc1234)");

  // Fallback path for Unit-only 100%/100% must yield 50/100 Grade C and default 7 canonical features + NOT_RUN AI evaluation
  const unitOnlyFallbackVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-unit-only-1" },
    unitRaw: {
      summary: {
        testExecution: { numTotalTests: 20, numPassedTests: 20, numFailedTests: 0, numPendingTests: 0, durationMs: 500 },
        coverage: { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
      files: [],
    },
  });
  assert.equal(unitOnlyFallbackVm.health.score, 50);
  assert.equal(unitOnlyFallbackVm.health.grade, "C");
  assert.equal(unitOnlyFallbackVm.featureDurations.length, 7);
  assert.ok(unitOnlyFallbackVm.featureDurations.every((f) => f.runCount === 0 && f.lastStatus === "NOT_RUN"));
  assert.equal(unitOnlyFallbackVm.aiTrustworthiness.hasRun, false);
  assert.equal(unitOnlyFallbackVm.aiTrustworthiness.status, "NOT_RUN");
  assert.equal(unitOnlyFallbackVm.aiTrustworthiness.verdict, "NOT_RUN");
});

test("R1 parity regressions: integration coverage precedence, measured 0% vs unmeasured null, and 2-layer 80/100 Grade A alignment", () => {
  // 1. 2-layer Unit 100%/100% + Integration 100% pass (lines=0 absent, apiEndpoint=100) -> 80/100 Grade A on BOTH computeHealth and adaptUnifiedDashboard fallback
  const twoLayerFallbackVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-2layer-1" },
    unitRaw: {
      summary: {
        testExecution: { numTotalTests: 20, numPassedTests: 20, numFailedTests: 0, durationMs: 400 },
        coverage: { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
      files: [],
    },
    integrationRaw: {
      summary: {
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        totalApis: 10,
        endpointCoverageMetrics: { coveredEndpoints: 10, endpointCoveragePct: 100 },
      },
      endpoints: Array.from({ length: 10 }, (_, i) => ({
        id: `ep-${i}`,
        method: "GET",
        path: `/api/r-${i}`,
        status: "Covered",
      })),
    },
  });
  assert.equal(twoLayerFallbackVm.pillars.integration.codeCoverageMeasured, false);
  assert.equal(twoLayerFallbackVm.pillars.integration.coverageMetrics.apiEndpoint, 100);
  assert.equal(twoLayerFallbackVm.qualityGate.status, "WARNING");
  assert.equal(twoLayerFallbackVm.health.score, 80);
  assert.equal(twoLayerFallbackVm.health.grade, "A");
  assert.deepEqual(
    computeHealth(twoLayerFallbackVm.pillars, null, twoLayerFallbackVm.qualityGate),
    { score: 80, grade: "A", delta: null },
  );

  // Also verify unifiedBackendRaw (without precomputed health) where integration has lines=0 and apiEndpoint=100
  const twoLayerBackendNoHealthVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-2layer-backend" },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 20,
          passedTests: 20,
          failedTests: 0,
          coverageMetrics: { lines: 100, branches: 100, functions: 100, statements: 100 },
        },
        integration: {
          framework: "Supertest",
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          coverageMetrics: { lines: 0, apiEndpoint: 100, coveredApis: 10, totalApis: 10 },
        },
        system: { totalTests: 0, passedTests: 0, failedTests: 0 },
      },
    },
  });
  assert.equal(twoLayerBackendNoHealthVm.pillars.integration.coverageMetrics.lines, 0);
  assert.equal(twoLayerBackendNoHealthVm.pillars.integration.coverageMetrics.apiEndpoint, 100);
  assert.equal(twoLayerBackendNoHealthVm.health.score, 80);
  assert.equal(twoLayerBackendNoHealthVm.health.grade, "A");

  // 2. Integration-only (lines=0 absent, apiEndpoint=100) -> 30/100 Grade D (not 15/100)
  const intOnlyVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-int-only" },
    integrationRaw: {
      summary: {
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        totalApis: 10,
        endpointCoverageMetrics: { coveredEndpoints: 10, endpointCoveragePct: 100 },
      },
      endpoints: [],
    },
  });
  assert.equal(intOnlyVm.health.score, 30);
  assert.equal(intOnlyVm.health.grade, "D");

  // 3. Integration-only with genuinely measured 0% API coverage (0/10 covered, totalApis=10) -> 15/100 Grade D
  const intZeroMeasuredVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-int-zero" },
    integrationRaw: {
      summary: {
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        totalApis: 10,
        endpointCoverageMetrics: { coveredEndpoints: 0, endpointCoveragePct: 0 },
      },
      endpoints: [],
    },
  });
  assert.equal(intZeroMeasuredVm.pillars.integration.coverageMetrics.apiEndpoint, 0);
  assert.equal(intZeroMeasuredVm.health.score, 15);
  assert.equal(intZeroMeasuredVm.health.grade, "D");

  // 4. Unit-only 100% pass with unmeasured coverage (null / coverageSource="none") -> falls back to passRate -> 50/100 Grade C
  const unitUnmeasuredFallbackVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-unit-nocov" },
    unitRaw: {
      summary: {
        testExecution: { numTotalTests: 20, numPassedTests: 20, numFailedTests: 0, durationMs: 250 },
      },
      files: [],
    },
  });
  assert.equal(unitUnmeasuredFallbackVm.pillars.unit.coverageSource, "none");
  assert.equal(unitUnmeasuredFallbackVm.pillars.unit.coverageMetrics.lines, null);
  assert.equal(unitUnmeasuredFallbackVm.health.score, 50);
  assert.equal(unitUnmeasuredFallbackVm.health.grade, "C");

  // Backend raw payload with coverageSource="none" and missing health also falls back cleanly to 50/100 Grade C
  const unitUnmeasuredBackendNoHealthVm = adaptUnifiedDashboard({
    context: { snapshotId: "snap-unit-nocov-backend" },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 20,
          passedTests: 20,
          failedTests: 0,
          coverageSource: "none",
          coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0 },
        },
        integration: { totalTests: 0, passedTests: 0, failedTests: 0 },
        system: { totalTests: 0, passedTests: 0, failedTests: 0 },
      },
    },
  });
  assert.equal(unitUnmeasuredBackendNoHealthVm.health.score, 50);
  assert.equal(unitUnmeasuredBackendNoHealthVm.health.grade, "C");
});

test("fmtDuration rolls over sub-second and sub-minute rounding boundaries cleanly without 60.0s or 60m 0s", () => {
  assert.equal(fmtDuration(0), "0ms");
  assert.equal(fmtDuration(999), "999ms");
  assert.equal(fmtDuration(1000), "1.0s");
  assert.equal(fmtDuration(59949), "59.9s");
  assert.equal(fmtDuration(59950), "1m 0s");
  assert.equal(fmtDuration(59999), "1m 0s");
  assert.equal(fmtDuration(3599499), "59m 59s");
  assert.equal(fmtDuration(3599999), "1h 0m");
  assert.equal(fmtDuration(3600000), "1h 0m");
  assert.equal(fmtDuration(3661000), "1h 1m");
});

