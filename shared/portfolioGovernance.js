/**
 * @file shared/portfolioGovernance.js
 * @description Single Source of Truth for Portfolio Lifecycle States, KPI Scope Rules,
 * RBAC constants, normalized 3-layer coverage/health math, Risk Quadrant classification,
 * ROI baseline metadata, and Export contracts across Client and Server.
 */

export const PROJECT_LIFECYCLE_STATES = Object.freeze([
  "NOT_STARTED",
  "DOING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
]);

export const LIFECYCLE_STATE_SET = new Set(PROJECT_LIFECYCLE_STATES);

export const KPI_INCLUDED_LIFECYCLE_STATES = Object.freeze(["DOING"]);
export const OPEN_WORKSPACE_LIFECYCLE_STATES = Object.freeze(["DOING", "NOT_STARTED"]);
export const ISOLATED_LIFECYCLE_STATES = Object.freeze(["PAUSED", "COMPLETED", "CANCELLED"]);

export const LIFECYCLE_META = Object.freeze({
  DOING: Object.freeze({
    value: "DOING",
    label: "Doing",
    includedInKpis: true,
    showTopbarIsolatedBadge: false,
    description: "Active development & QA execution (Included in Portfolio KPIs)",
  }),
  NOT_STARTED: Object.freeze({
    value: "NOT_STARTED",
    label: "Not Started",
    includedInKpis: false,
    showTopbarIsolatedBadge: false,
    description: "Newly imported backlog (Auto-transitions to Doing on test/AI activity)",
  }),
  PAUSED: Object.freeze({
    value: "PAUSED",
    label: "Paused",
    includedInKpis: false,
    showTopbarIsolatedBadge: true,
    description: "Temporarily on hold (Isolated from Portfolio KPIs)",
  }),
  COMPLETED: Object.freeze({
    value: "COMPLETED",
    label: "Completed",
    includedInKpis: false,
    showTopbarIsolatedBadge: true,
    description: "Delivered & verified (Isolated from Portfolio KPIs)",
  }),
  CANCELLED: Object.freeze({
    value: "CANCELLED",
    label: "Cancelled",
    includedInKpis: false,
    showTopbarIsolatedBadge: true,
    description: "Discarded / Archived (Isolated from Portfolio KPIs)",
  }),
});

export const PORTFOLIO_FILTER_SCOPE_LABELS = Object.freeze({
  open: "Open (Doing & Not Started)",
  DOING: "Doing (KPI Scope)",
  NOT_STARTED: "Not Started",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
  all: "All Projects",
});

export const LIFECYCLE_MANAGE_CAPABILITY = "project.lifecycle.manage";

export function isKpiIncludedLifecycleStatus(status) {
  return status === "DOING";
}

export function isOpenWorkspaceLifecycleStatus(status) {
  return status === "DOING" || status === "NOT_STARTED" || !status;
}

export function isIsolatedLifecycleStatus(status) {
  return status === "PAUSED" || status === "COMPLETED" || status === "CANCELLED";
}

export function canManageProjectLifecycle(role) {
  return role === "OWNER";
}

/**
 * Validate whether a lifecycle status transition is allowed under D3 governance rules.
 */
export function validateLifecycleTransition({ currentStatus, nextStatus, hasActivity = false }) {
  if (!LIFECYCLE_STATE_SET.has(nextStatus)) {
    return {
      allowed: false,
      code: "INVALID_LIFECYCLE_STATUS",
      reason: `Lifecycle status must be one of: ${PROJECT_LIFECYCLE_STATES.join(", ")}.`,
    };
  }

  if (nextStatus === "NOT_STARTED" && hasActivity === true) {
    return {
      allowed: false,
      code: "CANNOT_REVERT_TO_NOT_STARTED",
      reason:
        "Projects with existing test runs or coverage cannot be reverted to Not Started. Use Paused or Completed instead.",
    };
  }

  void currentStatus;
  return { allowed: true, code: null, reason: null };
}

export const PORTFOLIO_LAYER_WEIGHTS = Object.freeze({
  unit: 0.5,
  integration: 0.3,
  system: 0.2,
});

export const PORTFOLIO_GRADE_THRESHOLDS = Object.freeze({
  A: 80,
  B: 65,
  C: 50,
  D: 0,
});

export const PORTFOLIO_QUALITY_GATE = Object.freeze({
  minPassRatePct: 80,
  passedMinHealthScore: 80,
  passedMinPassRatePct: 95,
  maxFailurePenalty: 15,
  failurePenaltyPerTest: 2,
  coverageTargetPct: 80,
  lowBranchThresholdPct: 75,
});

export const PORTFOLIO_RISK_QUADRANT_CUTOFFS = Object.freeze({
  coverageCutoff: 70,
  passRateCutoff: 85,
});

export function roundMetric(val, decimals = 1) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(decimals));
}

export function computePassRatePct(passed = 0, failed = 0) {
  const p = Math.max(0, Number(passed) || 0);
  const f = Math.max(0, Number(failed) || 0);
  const denom = p + f;
  if (denom <= 0) return null;
  return roundMetric((p / denom) * 100, 1);
}

/**
 * Compute weighted average re-normalized over layers that have non-null finite values.
 */
export function computeNormalizedWeightedAverage(
  layerValues = {},
  weights = PORTFOLIO_LAYER_WEIGHTS,
) {
  const keys = Object.keys(weights);
  let weightedSum = 0;
  let activeWeightSum = 0;
  const measuredLayers = [];
  const unmeasuredLayers = [];

  for (const key of keys) {
    const raw = layerValues[key];
    const w = Number(weights[key]) || 0;
    if (
      w > 0 &&
      raw !== null &&
      raw !== undefined &&
      raw !== "" &&
      Number.isFinite(Number(raw))
    ) {
      weightedSum += Number(raw) * w;
      activeWeightSum += w;
      measuredLayers.push(key);
    } else {
      unmeasuredLayers.push(key);
    }
  }

  if (activeWeightSum <= 0) {
    return {
      value: null,
      activeWeightSum: 0,
      measuredLayers,
      unmeasuredLayers,
    };
  }

  return {
    value: roundMetric(weightedSum / activeWeightSum, 1),
    activeWeightSum: Number(activeWeightSum.toFixed(4)),
    measuredLayers,
    unmeasuredLayers,
  };
}

/**
 * Compute re-normalized 3-layer coverage, health score, pass rate, grade, and gate status.
 * Coverage values must be null when unmeasured (never pass passRate as coveragePct).
 */
export function computeProjectHealthAndCoverage({
  unit = {},
  integration = {},
  system = {},
} = {}) {
  const layers = { unit, integration, system };
  const layerPassRates = {};
  const layerScores = {};
  const measuredCovValues = {};

  let totalExecuted = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [key, layer] of Object.entries(layers)) {
    const passed = Math.max(0, Number(layer?.passedTests) || 0);
    const failed = Math.max(0, Number(layer?.failedTests) || 0);
    const total = Math.max(0, Number(layer?.totalTests) || 0);
    const hasTests = total > 0 || passed + failed > 0;

    totalExecuted += total;
    totalPassed += passed;
    totalFailed += failed;

    const passRate = computePassRatePct(passed, failed);
    layerPassRates[key] = passRate;

    const rawCov = layer?.coveragePct;
    const hasMeasuredCov =
      hasTests &&
      rawCov !== null &&
      rawCov !== undefined &&
      rawCov !== "" &&
      Number.isFinite(Number(rawCov));

    measuredCovValues[key] = hasMeasuredCov ? Number(rawCov) : null;

    if (hasTests) {
      if (hasMeasuredCov) {
        layerScores[key] = 0.5 * (passRate ?? 0) + 0.5 * Number(rawCov);
      } else {
        layerScores[key] = passRate ?? 0;
      }
    } else {
      layerScores[key] = null;
    }
  }

  const coverageAgg = computeNormalizedWeightedAverage(measuredCovValues);
  const scoreAgg = computeNormalizedWeightedAverage(layerScores);
  const passRatePct = computePassRatePct(totalPassed, totalFailed);

  if (totalExecuted <= 0 && totalPassed + totalFailed <= 0) {
    return {
      unifiedCoveragePct: null,
      measuredCoverageLayers: coverageAgg.measuredLayers,
      healthScore: null,
      passRatePct: null,
      grade: "—",
      gateStatus: "UNTESTED",
      gateLabel: "UNTESTED",
      layerPassRates,
    };
  }

  const penalty =
    totalFailed > 0
      ? Math.min(
          PORTFOLIO_QUALITY_GATE.maxFailurePenalty,
          totalFailed * PORTFOLIO_QUALITY_GATE.failurePenaltyPerTest,
        )
      : 0;

  const rawHealth = scoreAgg.value !== null ? Math.round(scoreAgg.value) - penalty : 0;
  const healthScore = Math.max(0, Math.min(100, rawHealth));

  let grade = "D";
  if (healthScore >= PORTFOLIO_GRADE_THRESHOLDS.A) grade = "A";
  else if (healthScore >= PORTFOLIO_GRADE_THRESHOLDS.B) grade = "B";
  else if (healthScore >= PORTFOLIO_GRADE_THRESHOLDS.C) grade = "C";

  let gateStatus = "AT_RISK";
  let gateLabel = "AT RISK";
  if (
    totalFailed === 0 &&
    (passRatePct ?? 0) >= PORTFOLIO_QUALITY_GATE.passedMinPassRatePct &&
    healthScore >= PORTFOLIO_QUALITY_GATE.passedMinHealthScore
  ) {
    gateStatus = "PASSED";
    gateLabel = "READY TO RELEASE";
  } else if (
    totalFailed > 0 ||
    (passRatePct ?? 0) < PORTFOLIO_QUALITY_GATE.minPassRatePct
  ) {
    gateStatus = "BLOCKED";
    gateLabel = "BLOCKED";
  }

  return {
    unifiedCoveragePct: coverageAgg.value,
    measuredCoverageLayers: coverageAgg.measuredLayers,
    healthScore,
    passRatePct,
    grade,
    gateStatus,
    gateLabel,
    layerPassRates,
  };
}

/**
 * Compute fixed-weight (50% Unit / 30% Integration / 20% System) project health score,
 * coverage index, pass rate, grade, and gate status for the Project Unified Dashboard
 * and its exported reports. Unexecuted layers contribute 0 (no re-normalization).
 */
export function computeFixedWeightProjectHealth({
  unit = {},
  integration = {},
  system = {},
} = {}) {
  const layers = { unit, integration, system };
  const layerPassRates = {};
  const layerScores = { unit: 0, integration: 0, system: 0 };
  const measuredCovValues = { unit: null, integration: null, system: null };
  const measuredCoverageLayers = [];

  let totalExecuted = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [key, layer] of Object.entries(layers)) {
    const passed = Math.max(0, Number(layer?.passedTests) || 0);
    const failed = Math.max(0, Number(layer?.failedTests) || 0);
    const total = Math.max(0, Number(layer?.totalTests) || 0);
    const hasTests = total > 0 || passed + failed > 0;

    totalExecuted += total;
    totalPassed += passed;
    totalFailed += failed;

    const passRate = computePassRatePct(passed, failed);
    layerPassRates[key] = passRate;

    const rawCov = layer?.coveragePct;
    const hasMeasuredCov =
      hasTests &&
      rawCov !== null &&
      rawCov !== undefined &&
      rawCov !== "" &&
      Number.isFinite(Number(rawCov));

    if (hasMeasuredCov) {
      measuredCovValues[key] = Number(rawCov);
      measuredCoverageLayers.push(key);
    }

    if (hasTests) {
      layerScores[key] = hasMeasuredCov
        ? 0.5 * (passRate ?? 0) + 0.5 * Number(rawCov)
        : (passRate ?? 0);
    } else {
      layerScores[key] = 0;
    }
  }

  const passRatePct = computePassRatePct(totalPassed, totalFailed);

  if (totalExecuted <= 0 && totalPassed + totalFailed <= 0) {
    return {
      unifiedCoveragePct: null,
      measuredCoverageLayers,
      healthScore: null,
      passRatePct: null,
      grade: "—",
      gateStatus: "UNTESTED",
      gateLabel: "UNTESTED",
      layerPassRates,
    };
  }

  const fixedCoverage = roundMetric(
    (measuredCovValues.unit ?? 0) * PORTFOLIO_LAYER_WEIGHTS.unit +
      (measuredCovValues.integration ?? 0) * PORTFOLIO_LAYER_WEIGHTS.integration +
      (measuredCovValues.system ?? 0) * PORTFOLIO_LAYER_WEIGHTS.system,
    1,
  );

  const weightedScore =
    layerScores.unit * PORTFOLIO_LAYER_WEIGHTS.unit +
    layerScores.integration * PORTFOLIO_LAYER_WEIGHTS.integration +
    layerScores.system * PORTFOLIO_LAYER_WEIGHTS.system;

  const penalty =
    totalFailed > 0
      ? Math.min(
          PORTFOLIO_QUALITY_GATE.maxFailurePenalty,
          totalFailed * PORTFOLIO_QUALITY_GATE.failurePenaltyPerTest,
        )
      : 0;

  const rawHealth = Math.round(weightedScore) - penalty;
  const healthScore = Math.max(0, Math.min(100, rawHealth));

  let grade = "D";
  if (healthScore >= PORTFOLIO_GRADE_THRESHOLDS.A) grade = "A";
  else if (healthScore >= PORTFOLIO_GRADE_THRESHOLDS.B) grade = "B";
  else if (healthScore >= PORTFOLIO_GRADE_THRESHOLDS.C) grade = "C";

  let gateStatus = "AT_RISK";
  let gateLabel = "AT RISK";
  if (
    totalFailed === 0 &&
    (passRatePct ?? 0) >= PORTFOLIO_QUALITY_GATE.passedMinPassRatePct &&
    healthScore >= PORTFOLIO_QUALITY_GATE.passedMinHealthScore
  ) {
    gateStatus = "PASSED";
    gateLabel = "READY TO RELEASE";
  } else if (
    totalFailed > 0 ||
    (passRatePct ?? 0) < PORTFOLIO_QUALITY_GATE.minPassRatePct
  ) {
    gateStatus = "BLOCKED";
    gateLabel = "BLOCKED";
  }

  return {
    unifiedCoveragePct: fixedCoverage,
    measuredCoverageLayers,
    healthScore,
    passRatePct,
    grade,
    gateStatus,
    gateLabel,
    layerPassRates,
  };
}

/**
 * Segment projects into Risk Quadrant buckets while keeping UNTESTED projects separate
 * from Critical Risk.
 */
export function classifyRiskQuadrant({ unifiedCoveragePct, passRatePct, gateStatus } = {}) {
  if (
    gateStatus === "UNTESTED" ||
    passRatePct === null ||
    passRatePct === undefined ||
    unifiedCoveragePct === null ||
    unifiedCoveragePct === undefined
  ) {
    return {
      quadrantId: "untested",
      quadrantLabel: "Not Yet Tested",
      isUntested: true,
    };
  }

  const x = Number(unifiedCoveragePct);
  const y = Number(passRatePct);
  const { coverageCutoff, passRateCutoff } = PORTFOLIO_RISK_QUADRANT_CUTOFFS;

  if (x >= coverageCutoff && y >= passRateCutoff) {
    return {
      quadrantId: "healthy-stars",
      quadrantLabel: "Healthy Stars",
      isUntested: false,
    };
  }
  if (x < coverageCutoff && y >= passRateCutoff) {
    return {
      quadrantId: "false-security",
      quadrantLabel: "Blind Spot / False Security",
      isUntested: false,
    };
  }
  if (x >= coverageCutoff && y < passRateCutoff) {
    return {
      quadrantId: "active-regressions",
      quadrantLabel: "Active Regressions",
      isUntested: false,
    };
  }
  return {
    quadrantId: "critical-risk",
    quadrantLabel: "Critical Risk",
    isUntested: false,
  };
}

export const PORTFOLIO_ROI_BASELINE = Object.freeze({
  unitMinutes: 2,
  integrationMinutes: 5,
  systemMinutes: 8,
  aiAuthoringMinutesPerTest: 15,
  isHeuristicEstimate: true,
  label: "Est. (CovAI Baseline)",
  methodologyNote:
    "Estimated against CovAI internal baseline (Unit 2m, API 5m, E2E 8m, AI authoring 15m/test). Not a measured manual timesheet.",
});

/**
 * Safely parse AiTest.metaJson which may arrive as a JSON string or pre-parsed object.
 */
export function safeParseMetaJson(raw, { onWarn = null } = {}) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    if (typeof onWarn === "function") {
      onWarn(err);
    } else {
      console.warn("[portfolioGovernance] Failed to parse metaJson:", err?.message || err);
    }
    return null;
  }
}

export const AUTO_TRANSITION_DOING_JOB_TYPES = Object.freeze([
  "RUN_TESTS",
  "RUN_VITEST_TESTS",
  "VITEST_COVERAGE",
  "SUPERTEST_COVERAGE",
  "PLAYWRIGHT_API_COVERAGE",
  "SYSTEM_TEST_ANALYSIS",
  "SYSTEM_TEST_ASSESSMENT",
  "SYSTEM_TEST_IMPROVEMENT",
  "SYSTEM_TEST_MUTATION",
  "AI_TESTS",
  "AI_SUGGEST",
  "UNIT_TEST_SUGGEST",
  "UNIT_TEST_APPLY",
  "AI_INTEGRATION_RUN",
  "AI_SYSTEM_GENERATE",
  "SYSTEM_COLD_START_GENERATE",
  "CYPRESS_SYSTEM_TEST",
  "CYPRESS_SYSTEM_COVERAGE",
  "PLAYWRIGHT_SYSTEM_TEST",
  "PLAYWRIGHT_SYSTEM_COVERAGE",
  "AI_EVALUATION",
]);

export const PORTFOLIO_EXPORT_FORMATS = Object.freeze(["pdf", "csv", "json"]);
export const PORTFOLIO_EXPORT_SCOPES = Object.freeze(["active", "all", "current_view"]);

export const PORTFOLIO_EXPORT_CANONICAL_SCOPES = Object.freeze([
  "active_kpi",
  "all",
  "filtered",
]);

export const PORTFOLIO_EXPORT_SCOPE_ALIASES = Object.freeze({
  active: "active_kpi",
  active_kpi: "active_kpi",
  all: "all",
  current_view: "filtered",
  filtered: "filtered",
});

export const PORTFOLIO_EXPORT_SCOPE_META = Object.freeze({
  active_kpi: Object.freeze({
    id: "active_kpi",
    alias: "active",
    label: "Active KPI Scope (Doing only)",
    filenameSlug: "active-kpi",
    description: "Includes only Doing projects feeding Portfolio Executive KPIs.",
  }),
  all: Object.freeze({
    id: "all",
    alias: "all",
    label: "All Projects",
    filenameSlug: "all",
    description:
      "Includes all accessible projects, separating Included vs. Isolated KPI scope.",
  }),
  filtered: Object.freeze({
    id: "filtered",
    alias: "current_view",
    label: "Current Filtered View",
    filenameSlug: "filtered",
    description: "Exports the directory subset matching your active Portfolio filters.",
  }),
});

export function normalizePortfolioExportScope(rawScope) {
  if (rawScope === undefined || rawScope === null || String(rawScope).trim() === "") {
    return "active_kpi";
  }
  const key = String(rawScope).trim().toLowerCase();
  return PORTFOLIO_EXPORT_SCOPE_ALIASES[key] || null;
}

export function normalizePortfolioExportFormat(rawFormat) {
  if (rawFormat === undefined || rawFormat === null || String(rawFormat).trim() === "") {
    return "json";
  }
  const key = String(rawFormat).trim().toLowerCase();
  return PORTFOLIO_EXPORT_FORMATS.includes(key) ? key : null;
}
