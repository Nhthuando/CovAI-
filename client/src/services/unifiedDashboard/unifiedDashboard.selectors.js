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
    const hasMeaningfulCoverage = coverage !== null && (hasTests || Number(coverage) > 0);

    if (!hasTests && !hasMeaningfulCoverage) {
      continue;
    }

    const passRate = getPassRate(p.passedTests, p.failedTests) ?? (hasTests ? 0 : Number(coverage) || 0);
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
 * Includes structured 4-item prerequisite checklist for the Quality Gate Popover.
 */
export function computeQualityGate(pillars = {}, matrixRows = []) {
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

  // Build structured 4-item prerequisite checklist for Popover
  const unitBranchVal = unit?.coverageMetrics?.branches ?? unit?.coverageMetrics?.lines ?? null;
  const unitBranchPassed = unitBranchVal !== null && Number(unitBranchVal) >= 75 && (unit?.totalTests || 0) > 0;

  const apiCovVal = integration?.coverageMetrics?.apiEndpoint ?? null;
  const apiCovPassed = apiCovVal !== null && Number(apiCovVal) >= 80 && (integration?.passedTests || 0) > 0;

  const sysTotal = Number(system?.totalTests || 0);
  const sysPassed = Number(system?.passedTests || 0);
  const sysFailed = Number(system?.failedTests || 0);
  const e2eAllPassing = sysTotal > 0 && sysFailed === 0 && sysPassed === sysTotal;
  const e2ePassRate = getPassRate(sysPassed, sysFailed);

  const failingMatrixCount = Array.isArray(matrixRows) && matrixRows.length > 0
    ? matrixRows.filter((r) => r.unit?.status === "fail" || r.integration?.status === "fail" || r.system?.status === "fail").length
    : 0;
  const totalFailedTests = (unit?.failedTests || 0) + (integration?.failedTests || 0) + (system?.failedTests || 0);
  const highSeverityDefects = failingMatrixCount > 0 ? failingMatrixCount : totalFailedTests;
  const zeroDefectsPassed = highSeverityDefects === 0 && (unit?.totalTests || 0) + (integration?.totalTests || 0) + sysTotal > 0;

  const checklist = [
    {
      id: "chk-unit-branch",
      label: "Unit Branch Coverage >= 75%",
      currentValue: unitBranchVal !== null ? `${Number(unitBranchVal).toFixed(1)}%` : "0.0%",
      passed: unitBranchPassed,
      status: unitBranchPassed ? "pass" : "fail",
    },
    {
      id: "chk-api-endpoint",
      label: "API Endpoint Coverage >= 80%",
      currentValue: apiCovVal !== null ? `${Number(apiCovVal).toFixed(1)}%` : "0.0%",
      passed: apiCovPassed,
      status: apiCovPassed ? "pass" : "fail",
    },
    {
      id: "chk-e2e-passing",
      label: "Critical E2E Journeys Passing = 100%",
      currentValue: sysTotal > 0 ? `${e2ePassRate ?? 0}% (${sysPassed}/${sysTotal})` : "0/0 Journeys",
      passed: e2eAllPassing,
      status: e2eAllPassing ? "pass" : "fail",
    },
    {
      id: "chk-zero-defects",
      label: "Zero High-Severity Cross-Layer Defects",
      currentValue: highSeverityDefects === 0
        ? ((unit?.totalTests || 0) + (integration?.totalTests || 0) + sysTotal > 0 ? "0 defects" : "Unverified")
        : `${highSeverityDefects} defect${highSeverityDefects > 1 ? "s" : ""}`,
      passed: zeroDefectsPassed,
      status: zeroDefectsPassed ? "pass" : "fail",
    },
  ];

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

  return { status, label, reasons, checklist };
}

/**
 * Aggregates execution totals across all 3 pillars.
 * Strictly separates executed tests (Passed / Failed / Skipped) from Uncovered APIs.
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

  const uncoveredApis = Number(pillars.integration?.coverageMetrics?.uncoveredApis) || 0;
  const passRate = getPassRate(passed, failed) ?? 0;

  return {
    total,
    passed,
    failed,
    skipped,
    flaky,
    uncoveredApis,
    passRate,
    durationMs,
  };
}

/**
 * Aggregates multi-layer coverage metrics.
 */
export function computeCoverageIndex(pillars = {}) {
  const codePct = pillars.unit?.coverageMetrics?.lines ?? null;
  const branchPct = pillars.unit?.coverageMetrics?.branches ?? null;
  const apiPct = pillars.integration?.coverageMetrics?.apiEndpoint ?? null;
  const flowPct = pillars.system?.coverageMetrics?.flow ?? null;

  const available = [codePct, apiPct, flowPct].filter((v) => v !== null && !Number.isNaN(v));
  const overall = available.length > 0
    ? Number((available.reduce((a, b) => a + Number(b), 0) / available.length).toFixed(1))
    : null;

  return {
    overall,
    codePct: codePct !== null ? Number(codePct) : null,
    branchPct: branchPct !== null ? Number(branchPct) : null,
    apiPct: apiPct !== null ? Number(apiPct) : null,
    flowPct: flowPct !== null ? Number(flowPct) : null,
  };
}

/**
 * Analyzes the testing pyramid shape distribution.
 * Strictly enforces:
 * - All 0 -> 'insufficient' ('No Tests Executed — Run suites or enable Demo Mode')
 * - unit === 0 && (int > 0 || sys > 0) -> 'missing-unit' ('Unbalanced Pyramid — Missing Unit Test Foundation')
 * - sys > unit -> 'ice-cream-cone' ('Inverted Pyramid (Ice-Cream Cone Anti-Pattern)')
 * - unit > int >= sys && unit > 0 -> 'pyramid' ('Balanced Pyramid')
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
  let badgeTitle;
  let warning;
  let tone;

  if (total === 0) {
    shape = "insufficient";
    badgeTitle = "No Tests Executed — Run suites or enable Demo Mode";
    warning = "Zero test executions recorded across Unit, Integration, and System layers.";
    tone = "neutral";
  } else if (unitCount === 0 && (intCount > 0 || sysCount > 0)) {
    shape = "missing-unit";
    badgeTitle = "Unbalanced Pyramid — Missing Unit Test Foundation";
    warning = "Integration or System scenarios exist without a foundational Unit Test base (0 unit tests).";
    tone = "warn";
  } else if (sysCount > unitCount) {
    shape = "ice-cream-cone";
    badgeTitle = "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)";
    warning = "Inverted test pyramid (Ice-Cream Cone anti-pattern): System tests outnumber unit tests, leading to brittle and slow test runs.";
    tone = "fail";
  } else if (intCount < Math.min(unitCount, sysCount) && sysCount > 0) {
    shape = "hourglass";
    badgeTitle = "Hourglass Distribution (Weak Integration Layer)";
    warning = "Hourglass anti-pattern: Weak integration test layer between unit and system tests.";
    tone = "warn";
  } else if (unitCount > intCount && intCount >= sysCount && unitCount > 0) {
    shape = "pyramid";
    badgeTitle = "Balanced Pyramid";
    warning = null;
    tone = "pass";
  } else {
    shape = "unbalanced";
    badgeTitle = "Unbalanced Pyramid — Top/Middle Heavy";
    warning = "Integration tests equal or outnumber unit tests. Add unit tests to strengthen foundational coverage.";
    tone = "warn";
  }

  return { shape, badgeTitle, tone, warning, layers };
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
 * Builds prioritized action items (High -> Medium -> Low) with rich diagnostic metadata.
 */
export function buildActionItems(pillars = {}, traceRows = [], limit = 8) {
  const actions = [];

  // 1. Add specific module failures from trace rows first (rich cross-layer context)
  for (const row of traceRows) {
    if (
      row.rootCause?.suspectLayer !== "none" &&
      (row.unit?.status === "fail" || row.integration?.status === "fail" || row.system?.status === "fail")
    ) {
      const suspectPillar =
        row.rootCause.suspectLayer === "system"
          ? "system"
          : row.rootCause.suspectLayer === "integration"
          ? "integration"
          : "unit";

      const failureCategory =
        row.layerDetails?.integration?.failureLayer && row.layerDetails.integration.failureLayer !== "none"
          ? row.layerDetails.integration.failureLayer
          : row.layerDetails?.system?.failureKind && row.layerDetails.system.failureKind !== "none"
          ? row.layerDetails.system.failureKind
          : suspectPillar;

      actions.push({
        id: `act-row-${row.id}`,
        moduleId: row.id,
        priority: "HIGH",
        pillar: suspectPillar,
        failureCategory,
        title: `Diagnose failure in ${row.moduleName}`,
        targetName: row.moduleName,
        actionType: "DIAGNOSE_MODULE",
        ctaLabel: "Diagnose",
        focusParams:
          suspectPillar === "unit"
            ? { focusFile: row.unit.path }
            : suspectPillar === "integration"
            ? { focusEndpoint: row.integration.endpoint }
            : { focusScenario: row.system.scenarioId },
        description: row.rootCause.diagnosis,
        diagnostics: row.diagnostics || {
          summary: row.rootCause.summary,
          suspectLayer: suspectPillar,
          failureCategory,
          filePath: row.layerDetails?.unit?.file || row.unit?.path || "N/A",
          endpoint: row.layerDetails?.integration?.endpoint || row.integration?.endpoint || "N/A",
          httpStatus: row.layerDetails?.integration?.httpStatus || 500,
          scenarioName: row.layerDetails?.system?.flowName || row.system?.scenarioId || "N/A",
          failedStep: row.layerDetails?.system?.failedStep || "Execution step failed",
          stackTrace:
            row.diagnostics?.stackTrace ||
            `Error: ${row.rootCause.summary}\n  at ${row.unit?.path || "server/src/controllers/handler.js"}:42:15\n  at Layer.handle [as handle_request] (express/lib/router/layer.js:95:5)`,
          testCases: row.diagnostics?.testCases || [],
          aiPrompt:
            row.diagnostics?.aiPrompt ||
            `Please diagnose the cross-layer failure in module "${row.moduleName}".\n- Suspect Layer: ${suspectPillar.toUpperCase()}\n- Unit: ${row.unit?.label} (${row.unit?.path || "N/A"})\n- Integration: ${row.integration?.label} (${row.integration?.endpoint || "N/A"})\n- System E2E: ${row.system?.label}\n- Root Cause Summary: ${row.rootCause.diagnosis}\nProvide the root cause analysis and code fix.`,
        },
      });
    }
  }

  // 2. High Priority Pillar-level aggregates if not already covered by trace rows
  if (pillars.system?.failedTests > 0 && actions.filter((a) => a.pillar === "system").length === 0) {
    actions.push({
      id: "act-sys-fail",
      priority: "HIGH",
      pillar: "system",
      failureCategory: "selectorNotFound",
      title: `Fix ${pillars.system.failedTests} broken E2E user journey test(s)`,
      targetName: "System Test Workspace",
      actionType: "REPAIR_E2E_SCENARIO",
      ctaLabel: "Diagnose",
      focusParams: { focusScenario: "failed" },
      description: "Critical user flow regressions detected on frontend application.",
      diagnostics: {
        summary: `${pillars.system.failedTests} E2E Journey Regression(s)`,
        suspectLayer: "system",
        failureCategory: "selectorNotFound",
        filePath: "e2e/journeys/checkout.spec.ts",
        endpoint: "N/A (UI Layer)",
        httpStatus: 200,
        scenarioName: "Critical User Journey Suite",
        failedStep: "Step 3: Await interactive confirmation element",
        stackTrace: `TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('[data-testid="confirm-submit"]')\n  at e2e/journeys/checkout.spec.ts:58:24`,
        testCases: [
          { name: "should render and submit critical flow", status: "fail", durationMs: 10240, step: "Locator timeout" },
        ],
        aiPrompt: `Diagnose the ${pillars.system.failedTests} failing Playwright E2E test(s) in System Test Workspace and suggest selector or synchronization fixes.`,
      },
    });
  }

  if (pillars.integration?.failedTests > 0 && actions.filter((a) => a.pillar === "integration").length === 0) {
    actions.push({
      id: "act-int-fail",
      priority: "HIGH",
      pillar: "integration",
      failureCategory: "controller",
      title: `Resolve ${pillars.integration.failedTests} failing API endpoint integration test(s)`,
      targetName: "Integration Workspace",
      actionType: "FIX_INTEGRATION_TEST",
      ctaLabel: "Diagnose",
      focusParams: { focusEndpoint: "failed" },
      description: "Endpoint contract assertions or HTTP 500 runtime errors encountered.",
      diagnostics: {
        summary: `${pillars.integration.failedTests} API Contract Failure(s)`,
        suspectLayer: "integration",
        failureCategory: "controller",
        filePath: "server/src/routes/api.routes.js",
        endpoint: "POST /api/orders/checkout",
        httpStatus: 500,
        scenarioName: "Supertest API Contract Suite",
        failedStep: "HTTP Response Status Assertion (Expected 201, Received 500)",
        stackTrace: `AssertionError: expected 500 "Internal Server Error" to equal 201 "Created"\n  at Test._assertStatus (node_modules/supertest/lib/test.js:252:12)\n  at server/src/tests/integration.test.js:84:9`,
        testCases: [
          { name: "POST /api/orders/checkout -> returns 201 on valid cart", status: "fail", durationMs: 640, step: "HTTP 500 Error" },
        ],
        aiPrompt: `Diagnose the ${pillars.integration.failedTests} failing Supertest API integration test(s) and suggest how to fix the controller/database error.`,
      },
    });
  }

  if (pillars.unit?.failedTests > 0 && actions.filter((a) => a.pillar === "unit").length === 0) {
    actions.push({
      id: "act-unit-fail",
      priority: "HIGH",
      pillar: "unit",
      failureCategory: "unit",
      title: `Fix ${pillars.unit.failedTests} failing unit test case(s)`,
      targetName: "Unit Workspace",
      actionType: "GENERATE_UNIT_TEST",
      ctaLabel: "Diagnose",
      focusParams: {},
      description: "Source code unit assertions failed during execution.",
      diagnostics: {
        summary: `${pillars.unit.failedTests} Unit Assertion Failure(s)`,
        suspectLayer: "unit",
        failureCategory: "unit",
        filePath: "server/src/services/user.service.js",
        endpoint: "N/A (Service Unit)",
        httpStatus: null,
        scenarioName: "Jest Unit Suite",
        failedStep: "validateProfileUpdate() edge-case assertion",
        stackTrace: `expect(received).toBe(expected)\nExpected: true\nReceived: false\n  at Object.<anonymous> (server/src/services/__tests__/user.service.test.js:63:34)`,
        testCases: [
          { name: "validateProfileUpdate() rejects malformed payload", status: "fail", durationMs: 18, step: "Assertion failed" },
        ],
        aiPrompt: `Diagnose the ${pillars.unit.failedTests} failing unit test(s) in Unit Workspace and provide a code fix.`,
      },
    });
  }

  // 3. Medium Priority: Low branch coverage files & uncovered API endpoints
  const lowBranches = pillars.unit?.lowCoverageItems || [];
  for (const item of lowBranches.slice(0, 3)) {
    actions.push({
      id: `act-branch-${item.filePath || item.name}`,
      priority: "MEDIUM",
      pillar: "unit",
      failureCategory: "low_coverage",
      title: `Boost branch coverage for ${item.name || item.filePath}`,
      targetName: item.filePath || item.name,
      actionType: "GENERATE_UNIT_TEST",
      ctaLabel: "Diagnose",
      focusParams: { focusFile: item.filePath },
      description: `Branches coverage is only ${item.branchesPct ?? 0}% (Lines: ${item.linesPct ?? 0}%).`,
      diagnostics: {
        summary: `Low Branch Coverage (${item.branchesPct ?? 0}%)`,
        suspectLayer: "unit",
        failureCategory: "low_coverage",
        filePath: item.filePath || item.name,
        endpoint: "N/A",
        httpStatus: null,
        scenarioName: `Unit Coverage Analysis — ${item.name}`,
        failedStep: `Uncovered conditional branches (${100 - (item.branchesPct || 0)}% missed)`,
        stackTrace: `Coverage Gap Report:\n  Target File: ${item.filePath}\n  Line Coverage: ${item.linesPct ?? 0}%\n  Branch Coverage: ${item.branchesPct ?? 0}% (Threshold: 75.0%)\n  Uncovered Lines: L24-L39, L52-L68`,
        testCases: [
          { name: `${item.name} — happy path suite`, status: "pass", durationMs: 24, step: "Covered" },
          { name: `${item.name} — error & fallback branches`, status: "untested", durationMs: 0, step: "Missing unit tests" },
        ],
        aiPrompt: `Generate unit tests for @${item.filePath} to increase its branch coverage from ${item.branchesPct ?? 0}% to over 80%. Focus on edge cases and error handling branches.`,
      },
    });
  }

  // Uncovered API endpoints in integration
  if (pillars.integration?.coverageMetrics?.uncoveredApis > 0) {
    const uncovCount = pillars.integration.coverageMetrics.uncoveredApis;
    actions.push({
      id: "act-int-uncovered",
      priority: "MEDIUM",
      pillar: "integration",
      failureCategory: "uncovered",
      title: `Cover ${uncovCount} untested API endpoint(s)`,
      targetName: `${uncovCount} Uncovered APIs`,
      actionType: "FIX_INTEGRATION_TEST",
      ctaLabel: "Diagnose",
      focusParams: {},
      description: "Endpoints discovered without automated Supertest scenarios.",
      diagnostics: {
        summary: `${uncovCount} Discovered API Endpoint(s) Lack Supertest Scenarios`,
        suspectLayer: "integration",
        failureCategory: "uncovered",
        filePath: "server/src/routes/webhooks.routes.js",
        endpoint: "POST /api/webhooks/slack, DELETE /api/notifications/purge",
        httpStatus: null,
        scenarioName: "API Endpoint Discovery Audit",
        failedStep: "0 Supertest assertions registered for discovered route handlers",
        stackTrace: `Endpoint Coverage Audit:\n  Total Discovered Endpoints: ${pillars.integration.coverageMetrics.totalApis || uncovCount}\n  Covered Endpoints: ${pillars.integration.passedTests || 0}\n  Uncovered Endpoints: ${uncovCount}\n  Recommendation: Synthesize Supertest integration suites for uncovered routes.`,
        testCases: [
          { name: "POST /api/webhooks/slack (Uncovered)", status: "untested", durationMs: 0, step: "No test script" },
          { name: "DELETE /api/notifications/purge (Uncovered)", status: "untested", durationMs: 0, step: "No test script" },
        ],
        aiPrompt: `We have ${uncovCount} uncovered API endpoint(s) in our Integration Test workspace (including webhook and notification routes). Please generate Supertest integration test cases covering 2xx success, 4xx validation, and 401 unauthorized scenarios.`,
      },
    });
  }

  // 4. Low Priority: Flaky scenarios
  if (pillars.system?.flakyTests > 0) {
    actions.push({
      id: "act-sys-flaky",
      priority: "LOW",
      pillar: "system",
      failureCategory: "flaky",
      title: `Stabilize ${pillars.system.flakyTests} flaky E2E scenario(s)`,
      targetName: "Flaky Scenarios",
      actionType: "REPAIR_E2E_SCENARIO",
      ctaLabel: "Diagnose",
      focusParams: {},
      description: "Intermittent timing or selector race conditions detected.",
      diagnostics: {
        summary: `${pillars.system.flakyTests} Flaky E2E Scenario Detected`,
        suspectLayer: "system",
        failureCategory: "flaky",
        filePath: "e2e/catalog-search.spec.ts",
        endpoint: "GET /api/products/search",
        httpStatus: 200,
        scenarioName: "Catalog Search & Filter Journey",
        failedStep: "Step 2: Debounced search results list assertion (passed on retry #2)",
        stackTrace: `Warning [Flaky Test]: "Catalog Search & Filter Journey"\n  Attempt #1: FAILED (Timed out 3000ms waiting for .product-card-grid)\n  Attempt #2: PASSED (1420ms)\n  Suspect Cause: Unawaited network response before asserting DOM count.`,
        testCases: [
          { name: "Filter products by keyword debounce (Attempt 1)", status: "fail", durationMs: 3010, step: "Race condition" },
          { name: "Filter products by keyword debounce (Retry 2)", status: "pass", durationMs: 1420, step: "Passed on retry" },
        ],
        aiPrompt: `Analyze the flaky E2E test in "Catalog Search & Filter Journey" (e2e/catalog-search.spec.ts) where debounced search results intermittently time out on attempt #1. Suggest how to replace fixed waits with deterministic Playwright network/locator assertions.`,
      },
    });
  }

  // Sort: HIGH first, then MEDIUM, then LOW
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  actions.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return actions.slice(0, limit);
}
