import {
  MOCK_TRACE_MATRIX_ROWS,
  MOCK_TREND_SERIES,
  MOCK_RECENT_RUNS,
  MOCK_AI_STATS,
  MOCK_INTEGRATION_FAILURE_LAYERS,
  MOCK_SYSTEM_FAILURE_KINDS,
} from "./unifiedDashboard.mock.js";
import {
  computeHealth,
  computeQualityGate,
  computeExecutionTotals,
  computeCoverageIndex,
  computePyramid,
  buildActionItems,
  getPassRate,
} from "./unifiedDashboard.selectors.js";

/**
 * Adapt Raw Unit Test Data into PillarVM
 */
export function adaptUnit(raw) {
  if (!raw || (!raw.summary && (!raw.files || raw.files.length === 0) && !raw.executions)) {
    return {
      id: "unit",
      label: "Unit Test",
      framework: "Jest",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0 },
      lowCoverageItems: [],
      failureDistribution: {},
      source: "unavailable",
      errorMessage: null,
    };
  }

  const { summary, files = [], executions = {}, frameworks = {} } = raw;

  // Detect Framework
  const fwName =
    frameworks?.supported?.unit?.[0] ||
    (executions?.vitest ? "Vitest" : executions?.jest ? "Jest" : "Jest");
  const framework = String(fwName).charAt(0).toUpperCase() + String(fwName).slice(1);

  // Test execution counts
  const runInfo = summary?.testExecution || executions?.jest || executions?.vitest || {};
  const passedTests = Number(runInfo.numPassedTests || runInfo.passedTests || 0);
  const failedTests = Number(runInfo.numFailedTests || runInfo.failedTests || 0);
  const totalTests = Number(runInfo.numTotalTests || runInfo.totalTests || passedTests + failedTests);
  const skippedTests = Number(runInfo.numPendingTests || runInfo.skippedTests || 0);
  const flakyTests = 0;
  const durationMs = Number(runInfo.durationMs || runInfo.duration || 0);
  const passRate = getPassRate(passedTests, failedTests) ?? 0;
  const avgDurationMs = totalTests > 0 ? Math.round(durationMs / totalTests) : 0;

  // Coverage percentages
  const cov = summary?.coverage || {};
  const coverageMetrics = {
    lines: Number((cov.lines ?? 0).toFixed ? cov.lines.toFixed(1) : cov.lines ?? 0),
    branches: Number((cov.branches ?? 0).toFixed ? cov.branches.toFixed(1) : cov.branches ?? 0),
    functions: Number((cov.functions ?? 0).toFixed ? cov.functions.toFixed(1) : cov.functions ?? 0),
    statements: Number((cov.statements ?? 0).toFixed ? cov.statements.toFixed(1) : cov.statements ?? 0),
  };

  // Find lowest branch coverage files
  const validFiles = Array.isArray(files)
    ? files.filter(
        (f) =>
          f.filePath &&
          !f.filePath.includes("node_modules") &&
          !f.filePath.includes(".test.") &&
          !f.filePath.includes(".spec.")
      )
    : [];

  const sortedFiles = [...validFiles].sort((a, b) => (a.branchesPct ?? 0) - (b.branchesPct ?? 0));
  const lowCoverageItems = sortedFiles.slice(0, 5).map((f) => ({
    filePath: f.filePath,
    name: f.filePath.split(/[/\\]/).pop(),
    branchesPct: Number((f.branchesPct ?? 0).toFixed(1)),
    linesPct: Number((f.linesPct ?? 0).toFixed(1)),
    line: 1,
  }));

  return {
    id: "unit",
    label: "Unit Test",
    framework,
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    coverageMetrics,
    lowCoverageItems,
    failureDistribution: {},
    source: summary ? "live" : "demo",
    errorMessage: null,
  };
}

/**
 * Adapt Raw Integration Test Data into PillarVM
 */
export function adaptIntegration(workspaceData, coverageSummary = null) {
  if (!workspaceData?.summary && !coverageSummary?.coverage) {
    return {
      id: "integration",
      label: "Integration Test",
      framework: "Supertest",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      coverageMetrics: { lines: 0, branches: 0, functions: 0, statements: 0, apiEndpoint: 0, uncoveredApis: 0 },
      lowCoverageItems: [],
      failureDistribution: MOCK_INTEGRATION_FAILURE_LAYERS,
      source: "unavailable",
      errorMessage: null,
    };
  }

  const wsSummary = workspaceData?.summary || {};
  const endpoints = Array.isArray(workspaceData?.endpoints) ? workspaceData.endpoints : [];

  // Counts from workspace summary or endpoints
  const totalTests = Number(wsSummary.totalTests || wsSummary.executedApis || endpoints.length);
  const passedTests = Number(wsSummary.passedTests || wsSummary.testedApis || endpoints.filter((e) => e.status === "Covered").length);
  const failedTests = Number(wsSummary.failedTests || endpoints.filter((e) => e.status === "Failed" || e.status === "Script Error").length);
  const skippedTests = Number(wsSummary.skippedTests || 0);
  const flakyTests = 0;
  const durationMs = Number(wsSummary.durationMs || 0);
  const avgDurationMs = Number(wsSummary.avgEndpointLatencyMs || wsSummary.avgRequestLatencyMs || 0);
  const passRate = getPassRate(passedTests, failedTests) ?? 0;

  // API Coverage metrics
  const epMetrics = wsSummary.endpointCoverageMetrics || {};
  const apiEndpointPct = epMetrics.endpointCoveragePct !== undefined
    ? Number(epMetrics.endpointCoveragePct.toFixed ? epMetrics.endpointCoveragePct.toFixed(1) : epMetrics.endpointCoveragePct)
    : (endpoints.length > 0 ? Number(((passedTests / endpoints.length) * 100).toFixed(1)) : 0);

  const codeCov = wsSummary.codeCoverage || coverageSummary?.coverage || {};
  const coverageMetrics = {
    lines: Number((codeCov.line ?? codeCov.lines ?? 0).toFixed ? (codeCov.line ?? codeCov.lines ?? 0).toFixed(1) : (codeCov.line ?? codeCov.lines ?? 0)),
    branches: Number((codeCov.branch ?? codeCov.branches ?? 0).toFixed ? (codeCov.branch ?? codeCov.branches ?? 0).toFixed(1) : (codeCov.branch ?? codeCov.branches ?? 0)),
    functions: Number((codeCov.function ?? codeCov.functions ?? 0).toFixed ? (codeCov.function ?? codeCov.functions ?? 0).toFixed(1) : (codeCov.function ?? codeCov.functions ?? 0)),
    statements: Number((codeCov.statement ?? codeCov.statements ?? 0).toFixed ? (codeCov.statement ?? codeCov.statements ?? 0).toFixed(1) : (codeCov.statement ?? codeCov.statements ?? 0)),
    apiEndpoint: apiEndpointPct,
    uncoveredApis: Number(wsSummary.uncoveredApis || (endpoints.length - passedTests)),
  };

  // Failure distribution: route, middlewareAuth, controller, database
  const qc = wsSummary.qualityClassification || {};
  const failureDistribution = {
    route: qc.invalidTests || MOCK_INTEGRATION_FAILURE_LAYERS.route,
    middlewareAuth: qc.testScriptErrors || MOCK_INTEGRATION_FAILURE_LAYERS.middlewareAuth,
    controller: qc.assertionFailures || (failedTests > 0 ? failedTests : MOCK_INTEGRATION_FAILURE_LAYERS.controller),
    database: qc.infrastructureFailures || MOCK_INTEGRATION_FAILURE_LAYERS.database,
  };

  const lowCoverageItems = endpoints
    .filter((e) => e.status !== "Covered" || (e.mappedCodeCoverage?.line ?? 100) < 60)
    .slice(0, 5)
    .map((e) => ({
      filePath: e.path,
      name: `${e.method} ${e.path}`,
      branchesPct: Number((e.mappedCodeCoverage?.branch ?? 0).toFixed(1)),
      linesPct: Number((e.mappedCodeCoverage?.line ?? 0).toFixed(1)),
      line: 1,
    }));

  return {
    id: "integration",
    label: "Integration Test",
    framework: workspaceData?.snapshot?.framework || "Supertest",
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    coverageMetrics,
    lowCoverageItems,
    failureDistribution,
    source: workspaceData ? "live" : "demo",
    errorMessage: null,
  };
}

/**
 * Adapt Raw System Test (E2E) Data into PillarVM
 */
export function adaptSystem(systemSummary, scenariosList = []) {
  if (!systemSummary && (!scenariosList || scenariosList.length === 0)) {
    return {
      id: "system",
      label: "System Test (E2E)",
      framework: "Playwright",
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      flakyTests: 0,
      passRate: 0,
      durationMs: 0,
      avgDurationMs: 0,
      coverageMetrics: { lines: 0, flow: 0 },
      lowCoverageItems: [],
      failureDistribution: MOCK_SYSTEM_FAILURE_KINDS,
      source: "unavailable",
      errorMessage: null,
    };
  }

  const s = systemSummary || {};
  const totalTests = Number(s.totalTests || s.e2eTests || scenariosList.length || 0);
  const passedTests = Number(s.passedTests || s.passed || 0);
  const failedTests = Number(s.failedTests || s.failed || 0);
  const flakyTests = Number(s.flakyTests || s.flaky || 0);
  const skippedTests = Number(s.skippedTests || 0);
  const durationMs = Number(s.durationMs || 0);
  const passRate = getPassRate(passedTests, failedTests) ?? Number(s.passRatePct || 0);
  const avgDurationMs = totalTests > 0 ? Math.round(durationMs / totalTests) : 0;

  // Flow coverage
  const frontendCounters = s.coverageSummary?.frontend?.counters || {};
  const flowCoveragePct = frontendCounters.lines?.pct !== undefined
    ? Number(frontendCounters.lines.pct.toFixed(1))
    : passRate;

  // Failure categories
  const failureDistribution = { ...MOCK_SYSTEM_FAILURE_KINDS };
  if (Array.isArray(s.scenarios) && s.scenarios.length > 0) {
    let selector = 0, timeout = 0, assertion = 0, flaky = flakyTests;
    for (const sc of s.scenarios) {
      if (sc.status === "failed") {
        const msg = (sc.failureMessages || []).join(" ").toLowerCase();
        if (msg.includes("selector") || msg.includes("locator") || msg.includes("waiting for element")) {
          selector++;
        } else if (msg.includes("timeout") || msg.includes("timed out")) {
          timeout++;
        } else {
          assertion++;
        }
      }
    }
    if (selector + timeout + assertion > 0) {
      failureDistribution.selectorNotFound = selector;
      failureDistribution.networkTimeout = timeout;
      failureDistribution.assertion = assertion;
      failureDistribution.flaky = flaky;
    }
  }

  const runnerRaw = s.runner || "playwright";
  const framework = String(runnerRaw).charAt(0).toUpperCase() + String(runnerRaw).slice(1);

  return {
    id: "system",
    label: "System Test (E2E)",
    framework,
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    flakyTests,
    passRate,
    durationMs,
    avgDurationMs,
    coverageMetrics: {
      lines: flowCoveragePct,
      flow: flowCoveragePct,
    },
    lowCoverageItems: [],
    failureDistribution,
    source: s.hasRun ? "live" : "demo",
    errorMessage: null,
  };
}

/**
 * Adapt All Layers into UnifiedDashboardVM
 */
export function adaptUnifiedDashboard({
  unitRaw = null,
  integrationRaw = null,
  systemRaw = null,
  comparisonRaw = null,
  context = {},
}) {
  const unitPillar = adaptUnit(unitRaw);
  const integrationPillar = adaptIntegration(integrationRaw);
  const systemPillar = adaptSystem(systemRaw);

  const pillars = {
    unit: unitPillar,
    integration: integrationPillar,
    system: systemPillar,
  };

  // Compute aggregated scores
  const health = computeHealth(pillars);
  const qualityGate = computeQualityGate(pillars);
  const execution = computeExecutionTotals(pillars);
  const coverage = computeCoverageIndex(pillars);
  const pyramid = computePyramid(pillars);

  // Baseline Delta from comparisonRaw if available
  let healthDelta = null;
  if (comparisonRaw?.testRunComparison?.coverageArtifactDiff?.deltaLinesPct != null) {
    healthDelta = Number(comparisonRaw.testRunComparison.coverageArtifactDiff.deltaLinesPct);
  } else if (comparisonRaw?.runtimeDiff?.summary?.fixesCount > 0) {
    healthDelta = comparisonRaw.runtimeDiff.summary.fixesCount * 2.5;
  }
  health.delta = healthDelta;

  // Trace matrix rows (demo data enriched)
  const matrix = {
    rows: MOCK_TRACE_MATRIX_ROWS,
    source: "demo",
  };

  // Action items derived from live pillars + matrix
  const actions = {
    items: buildActionItems(pillars, matrix.rows),
    source: "live",
  };

  // Trend series & Before/After comparison
  let trendSeries = MOCK_TREND_SERIES;
  if (comparisonRaw?.runtimeDiff?.comparisonAvailable) {
    // If live comparison is available, use real delta to adjust the latest trend point
    const latest = trendSeries[trendSeries.length - 1];
    trendSeries = [
      ...trendSeries.slice(0, -1),
      {
        ...latest,
        unitCoverage: coverage.codePct ?? latest.unitCoverage,
        integrationCoverage: coverage.apiPct ?? latest.integrationCoverage,
        systemCoverage: coverage.flowPct ?? latest.systemCoverage,
        overallCoverage: coverage.overall ?? latest.overallCoverage,
        passRate: execution.passRate,
      },
    ];
  }

  const beforeAfter = {
    before: {
      unit: 72.0,
      integration: 61.5,
      system: 48.0,
    },
    after: {
      unit: coverage.codePct ?? 83.4,
      integration: coverage.apiPct ?? 72.8,
      system: coverage.flowPct ?? 61.0,
    },
  };

  const trend = {
    series: trendSeries,
    beforeAfter,
    source: comparisonRaw?.comparisonAvailable ? "live" : "demo",
  };

  // Execution History
  const history = {
    runs: MOCK_RECENT_RUNS,
    source: "demo",
  };

  // AI Optimization stats
  const ai = {
    ...MOCK_AI_STATS,
    source: "demo",
  };

  return {
    context: {
      projectId: context.projectId || "",
      projectName: context.projectName || "CovAI Project",
      snapshotId: context.snapshotId || "",
      snapshots: context.snapshots || [],
      updatedAt: Date.now(),
    },
    qualityGate,
    health: { ...health, source: unitPillar.source === "live" ? "live" : "demo" },
    execution: { ...execution, source: unitPillar.source === "live" ? "live" : "demo" },
    coverage: { ...coverage, source: unitPillar.source === "live" ? "live" : "demo" },
    ai,
    pillars,
    pyramid,
    matrix,
    actions,
    trend,
    history,
  };
}
