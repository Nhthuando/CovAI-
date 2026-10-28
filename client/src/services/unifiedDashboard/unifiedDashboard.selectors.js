import { UNIFIED_DASHBOARD_CONFIG } from "./unifiedDashboard.config.js";

/**
 * Compute pass rate percentage (0 - 100) from passed and failed counts.
 * Returns null if no executed tests.
 */
export function getPassRate(passed = 0, failed = 0) {
  const executed = (Number(passed) || 0) + (Number(failed) || 0);
  if (executed <= 0) return null;
  return Number((((Number(passed) || 0) / executed) * 100).toFixed(1));
}

/**
 * Compute Executive Quality Health Score (0 - 100) and letter grade (A/B/C/D).
 * Gracefully normalizes weights when 1 or 2 pillars lack data.
 */
export function computeHealth(pillars = {}, customWeights = null) {
  const cfgWeights = customWeights || UNIFIED_DASHBOARD_CONFIG.weights;
  const pillarKeys = ["unit", "integration", "system"];

  const layerScores = [];
  let totalAvailableWeight = 0;

  for (const key of pillarKeys) {
    const p = pillars[key];
    if (!p) continue;

    // Check if this pillar has meaningful test execution or coverage
    const hasTests = (p.totalTests || 0) > 0 || (p.passedTests || 0) > 0 || (p.failedTests || 0) > 0;
    const coverage = p.coverageMetrics?.lines ?? p.coverageMetrics?.apiEndpoint ?? p.coverageMetrics?.flow ?? null;

    if (!hasTests && coverage === null) {
      continue;
    }

    const passRate = getPassRate(p.passedTests, p.failedTests) ?? (hasTests ? 0 : 100);
    const cov = coverage !== null ? Number(coverage) : passRate;
    const pillarScore = 0.5 * passRate + 0.5 * cov;

    const weight = cfgWeights[key] || 0.33;
    layerScores.push({ key, score: pillarScore, weight });
    totalAvailableWeight += weight;
  }

  if (layerScores.length === 0 || totalAvailableWeight <= 0) {
    return { score: null, grade: null, delta: null };
  }

  // Normalize weights across available layers
  const finalScore = layerScores.reduce((acc, curr) => {
    const normalizedWeight = curr.weight / totalAvailableWeight;
    return acc + curr.score * normalizedWeight;
  }, 0);

  const roundedScore = Math.round(finalScore);

  let grade = "D";
  if (roundedScore >= UNIFIED_DASHBOARD_CONFIG.grades.A) grade = "A";
  else if (roundedScore >= UNIFIED_DASHBOARD_CONFIG.grades.B) grade = "B";
  else if (roundedScore >= UNIFIED_DASHBOARD_CONFIG.grades.C) grade = "C";

  return {
    score: roundedScore,
    grade,
    delta: null, // Populated by adapter if baseline comparison is present
  };
}

/**
 * Global Quality Gate assessment across Unit, Integration, and System layers.
 */
export function computeQualityGate(pillars = {}) {
  const reasons = [];
  let isFailed = false;
  let isWarning = false;

  const minPassRate = UNIFIED_DASHBOARD_CONFIG.qualityGate.minPassRatePct;
  const thresholds = UNIFIED_DASHBOARD_CONFIG.qualityGate.coverageThresholds;

  const unit = pillars.unit;
  const integration = pillars.integration;
  const system = pillars.system;

  // 1. Pass Rate Checks
  for (const [key, p] of Object.entries({ unit, integration, system })) {
    if (!p) continue;
    const rate = getPassRate(p.passedTests, p.failedTests);
    if (rate !== null && rate < minPassRate) {
      isFailed = true;
      reasons.push(`${p.label || key}: Pass rate (${rate}%) is below minimum threshold (${minPassRate}%).`);
    }
  }

  // 2. Critical System Failure Check
  if (system && (system.failedTests || 0) > 0) {
    // E2E test failures represent user-facing breakage
    isFailed = true;
    reasons.push(`System E2E: ${system.failedTests} user journey test(s) failed.`);
  }

  // 3. Coverage Threshold Checks
  if (unit?.coverageMetrics?.lines != null && unit.coverageMetrics.lines < thresholds.unitLinesPct) {
    isWarning = true;
    reasons.push(`Unit: Code coverage (${unit.coverageMetrics.lines}%) is below recommended ${thresholds.unitLinesPct}%.`);
  }

  if (integration?.coverageMetrics?.apiEndpoint != null && integration.coverageMetrics.apiEndpoint < thresholds.integrationApiPct) {
    isWarning = true;
    reasons.push(`Integration: API endpoint coverage (${integration.coverageMetrics.apiEndpoint}%) is below recommended ${thresholds.integrationApiPct}%.`);
  }

  if (system?.coverageMetrics?.flow != null && system.coverageMetrics.flow < thresholds.systemFlowPct) {
    isWarning = true;
    reasons.push(`System E2E: User flow coverage (${system.coverageMetrics.flow}%) is below recommended ${thresholds.systemFlowPct}%.`);
  }

  // 4. Flaky Tests Check
  const totalFlaky = (unit?.flakyTests || 0) + (integration?.flakyTests || 0) + (system?.flakyTests || 0);
  if (totalFlaky > UNIFIED_DASHBOARD_CONFIG.qualityGate.maxFlakyAllowed) {
    isWarning = true;
    reasons.push(`Stability: Detected ${totalFlaky} flaky test(s) requiring stabilization.`);
  }

  // 5. Uncovered / Missing Layers Check
  const missingLayers = [];
  if (!unit || unit.totalTests === 0) missingLayers.push("Unit");
  if (!integration || integration.totalTests === 0) missingLayers.push("Integration");
  if (!system || system.totalTests === 0) missingLayers.push("System (E2E)");

  if (missingLayers.length > 0) {
    isWarning = true;
    reasons.push(`Missing test suites in: ${missingLayers.join(", ")}.`);
  }

  let status = "PASSED";
  let label = "READY TO RELEASE";

  if (isFailed) {
    status = "FAILED";
    label = "BLOCKED";
  } else if (isWarning) {
    status = "WARNING";
    label = "AT RISK";
  } else {
    reasons.push("All 3 test layers meet quality gates, stability targets, and coverage thresholds.");
  }

  return { status, label, reasons };
}

/**
 * Aggregates execution totals across all 3 pillars.
 */
export function computeExecutionTotals(pillars = {}) {
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let flaky = 0;
  let durationMs = 0;

  for (const key of ["unit", "integration", "system"]) {
    const p = pillars[key];
    if (!p) continue;
    total += Number(p.totalTests) || 0;
    passed += Number(p.passedTests) || 0;
    failed += Number(p.failedTests) || 0;
    skipped += Number(p.skippedTests) || 0;
    flaky += Number(p.flakyTests) || 0;
    durationMs += Number(p.durationMs) || 0;
  }

  const passRate = getPassRate(passed, failed) ?? 0;

  return {
    total,
    passed,
    failed,
    skipped,
    flaky,
    passRate,
    durationMs,
  };
}

/**
 * Aggregates multi-layer coverage metrics.
 */
export function computeCoverageIndex(pillars = {}) {
  const codePct = pillars.unit?.coverageMetrics?.lines ?? null;
  const apiPct = pillars.integration?.coverageMetrics?.apiEndpoint ?? null;
  const flowPct = pillars.system?.coverageMetrics?.flow ?? null;

  const available = [codePct, apiPct, flowPct].filter((v) => v !== null && !Number.isNaN(v));
  const overall = available.length > 0
    ? Number((available.reduce((a, b) => a + Number(b), 0) / available.length).toFixed(1))
    : null;

  return {
    overall,
    codePct: codePct !== null ? Number(codePct) : null,
    apiPct: apiPct !== null ? Number(apiPct) : null,
    flowPct: flowPct !== null ? Number(flowPct) : null,
  };
}

/**
 * Analyzes the testing pyramid shape distribution.
 */
export function computePyramid(pillars = {}) {
  const unitCount = Number(pillars.unit?.totalTests) || 0;
  const intCount = Number(pillars.integration?.totalTests) || 0;
  const sysCount = Number(pillars.system?.totalTests) || 0;
  const total = unitCount + intCount + sysCount;

  const unitDur = Number(pillars.unit?.durationMs) || 0;
  const intDur = Number(pillars.integration?.durationMs) || 0;
  const sysDur = Number(pillars.system?.durationMs) || 0;

  const layers = [
    {
      pillar: "system",
      label: "System (E2E)",
      count: sysCount,
      pctOfTotal: total > 0 ? Number(((sysCount / total) * 100).toFixed(1)) : 0,
      durationMs: sysDur,
    },
    {
      pillar: "integration",
      label: "Integration",
      count: intCount,
      pctOfTotal: total > 0 ? Number(((intCount / total) * 100).toFixed(1)) : 0,
      durationMs: intDur,
    },
    {
      pillar: "unit",
      label: "Unit Tests",
      count: unitCount,
      pctOfTotal: total > 0 ? Number(((unitCount / total) * 100).toFixed(1)) : 0,
      durationMs: unitDur,
    },
  ];

  let shape;
  let warning;

  if (total === 0 || (unitCount === 0 && intCount === 0 && sysCount === 0)) {
    shape = "insufficient";
    warning = "Insufficient test data to evaluate test pyramid distribution.";
  } else if (sysCount > unitCount && sysCount > intCount) {
    shape = "ice-cream-cone";
    warning = "Inverted test pyramid (Ice-Cream Cone anti-pattern): System tests outnumber unit/integration tests, leading to brittle and slow test runs.";
  } else if (intCount < Math.min(unitCount, sysCount) && sysCount > 0) {
    shape = "hourglass";
    warning = "Hourglass anti-pattern: Weak integration test layer between unit and system tests.";
  } else {
    shape = "pyramid";
    warning = null;
  }

  return { shape, warning, layers };
}

/**
 * Cross-layer root cause diagnosis logic.
 */
export function diagnoseRootCause(unitStatus = "none", integrationStatus = "none", systemStatus = "none") {
  const u = String(unitStatus || "").toLowerCase();
  const i = String(integrationStatus || "").toLowerCase();
  const s = String(systemStatus || "").toLowerCase();

  const uFail = u === "fail" || u === "failed";
  const iFail = i === "fail" || i === "failed";
  const sFail = s === "fail" || s === "failed";

  const uPass = u === "pass" || u === "passed";
  const iPass = i === "pass" || i === "passed";
  const sPass = s === "pass" || s === "passed";

  if (uFail && iFail && sFail) {
    return {
      diagnosis: "Failures detected across all 3 layers. Root cause is in core function/service business logic propagating upward.",
      suspectLayer: "unit",
      summary: "Core service logic defect",
    };
  }

  if (uPass && iFail && sFail) {
    return {
      diagnosis: "Unit tests pass but API and UI journeys fail. Root cause is in the API route, middleware, or database query layer.",
      suspectLayer: "integration",
      summary: "API / DB communication layer failure",
    };
  }

  if (uPass && iPass && sFail) {
    return {
      diagnosis: "Unit and API tests pass but E2E fails. Root cause is a frontend UI element error, missing selector, or visual state bug.",
      suspectLayer: "system",
      summary: "UI component / selector issue",
    };
  }

  if (uPass && iFail && sPass) {
    return {
      diagnosis: "API endpoint test failed on an edge branch that current UI journeys do not exercise.",
      suspectLayer: "integration",
      summary: "API contract edge case failure",
    };
  }

  if (uFail && iPass) {
    return {
      diagnosis: "Function-level unit test failed, but API integration test still passed. Possible mock divergence or unexercised logic.",
      suspectLayer: "unit",
      summary: "Isolated unit logic discrepancy",
    };
  }

  if (u === "untested" || i === "untested" || s === "untested") {
    return {
      diagnosis: "Coverage gap: Incomplete test suites for this module.",
      suspectLayer: u === "untested" ? "unit" : i === "untested" ? "integration" : "system",
      summary: "Testing gap / uncovered",
    };
  }

  if (uPass && iPass && sPass) {
    return {
      diagnosis: "All test layers verified and passing consistently.",
      suspectLayer: "none",
      summary: "Stable",
    };
  }

  return {
    diagnosis: "Requires manual investigation across test runner artifacts.",
    suspectLayer: "none",
    summary: "Investigation needed",
  };
}

/**
 * Builds prioritized action items (High -> Medium -> Low).
 */
export function buildActionItems(pillars = {}, traceRows = [], limit = 8) {
  const actions = [];

  // 1. High Priority: Failures in System, Integration, and Unit tests
  if (pillars.system?.failedTests > 0) {
    actions.push({
      id: "act-sys-fail",
      priority: "HIGH",
      pillar: "system",
      title: `Fix ${pillars.system.failedTests} broken E2E user journey test(s)`,
      targetName: "System Test Workspace",
      actionType: "REPAIR_E2E_SCENARIO",
      ctaLabel: "Repair E2E Flow",
      focusParams: { focusScenario: "failed" },
      description: "Critical user flow regressions detected on frontend application.",
    });
  }

  if (pillars.integration?.failedTests > 0) {
    actions.push({
      id: "act-int-fail",
      priority: "HIGH",
      pillar: "integration",
      title: `Resolve ${pillars.integration.failedTests} failing API endpoint integration test(s)`,
      targetName: "Integration Workspace",
      actionType: "FIX_INTEGRATION_TEST",
      ctaLabel: "Fix Endpoint Test",
      focusParams: { focusEndpoint: "failed" },
      description: "Endpoint contract assertions or HTTP 500 runtime errors encountered.",
    });
  }

  if (pillars.unit?.failedTests > 0) {
    actions.push({
      id: "act-unit-fail",
      priority: "HIGH",
      pillar: "unit",
      title: `Fix ${pillars.unit.failedTests} failing unit test case(s)`,
      targetName: "Unit Workspace",
      actionType: "GENERATE_UNIT_TEST",
      ctaLabel: "View Unit Tests",
      focusParams: {},
      description: "Source code unit assertions failed during execution.",
    });
  }

  // Add failures from trace rows
  for (const row of traceRows) {
    if (row.rootCause?.suspectLayer !== "none" && (row.unit.status === "fail" || row.integration.status === "fail" || row.system.status === "fail")) {
      actions.push({
        id: `act-row-${row.id}`,
        priority: "HIGH",
        pillar: row.rootCause.suspectLayer === "system" ? "system" : row.rootCause.suspectLayer === "integration" ? "integration" : "unit",
        title: `Investigate failure in ${row.moduleName}`,
        targetName: row.moduleName,
        actionType: "FIX_INTEGRATION_TEST",
        ctaLabel: "Diagnose",
        focusParams: row.rootCause.suspectLayer === "unit" ? { focusFile: row.unit.path } : row.rootCause.suspectLayer === "integration" ? { focusEndpoint: row.integration.endpoint } : { focusScenario: row.system.scenarioId },
        description: row.rootCause.diagnosis,
      });
    }
  }

  // 2. Medium Priority: Low branch coverage files & uncovered API endpoints
  const lowBranches = pillars.unit?.lowCoverageItems || [];
  for (const item of lowBranches.slice(0, 3)) {
    actions.push({
      id: `act-branch-${item.filePath || item.name}`,
      priority: "MEDIUM",
      pillar: "unit",
      title: `Boost branch coverage for ${item.name || item.filePath}`,
      targetName: item.filePath || item.name,
      actionType: "GENERATE_UNIT_TEST",
      ctaLabel: "Generate Unit Test",
      focusParams: { focusFile: item.filePath },
      description: `Branches coverage is only ${item.branchesPct || 0}% (Lines: ${item.linesPct || 0}%).`,
    });
  }

  // Uncovered API endpoints in integration
  if (pillars.integration?.coverageMetrics?.uncoveredApis > 0) {
    actions.push({
      id: "act-int-uncovered",
      priority: "MEDIUM",
      pillar: "integration",
      title: `Cover ${pillars.integration.coverageMetrics.uncoveredApis} untested API endpoint(s)`,
      targetName: "Uncovered Endpoints",
      actionType: "FIX_INTEGRATION_TEST",
      ctaLabel: "Generate API Tests",
      focusParams: {},
      description: "Endpoints discovered without automated Supertest scenarios.",
    });
  }

  // 3. Low Priority: Missing test suites or stability improvements
  if (pillars.system?.flakyTests > 0) {
    actions.push({
      id: "act-sys-flaky",
      priority: "LOW",
      pillar: "system",
      title: `Stabilize ${pillars.system.flakyTests} flaky E2E scenario(s)`,
      targetName: "Flaky Scenarios",
      actionType: "REPAIR_E2E_SCENARIO",
      ctaLabel: "Inspect Flaky Tests",
      focusParams: {},
      description: "Intermittent timing or selector race conditions detected.",
    });
  }

  // Sort: HIGH first, then MEDIUM, then LOW
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  actions.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return actions.slice(0, limit);
}
