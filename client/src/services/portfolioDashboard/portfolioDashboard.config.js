import {
  PORTFOLIO_LAYER_WEIGHTS,
  PORTFOLIO_GRADE_THRESHOLDS,
  PORTFOLIO_QUALITY_GATE,
  PORTFOLIO_RISK_QUADRANT_CUTOFFS,
  PORTFOLIO_FILTER_SCOPE_LABELS,
} from "../../../../shared/portfolioGovernance.js";

/**
 * Multi-Project Quality Portfolio Dashboard Configuration
 * Scoped configuration aligned with shared/portfolioGovernance.js SSOT.
 */
export const PORTFOLIO_CONFIG = {
  // Standardized layer weights matching Single-Project Unified Quality Overview (50/30/20)
  weights: {
    unit: PORTFOLIO_LAYER_WEIGHTS.unit,
    integration: PORTFOLIO_LAYER_WEIGHTS.integration,
    system: PORTFOLIO_LAYER_WEIGHTS.system,
  },

  // Health Score Grade Thresholds
  grades: {
    A: PORTFOLIO_GRADE_THRESHOLDS.A,
    B: PORTFOLIO_GRADE_THRESHOLDS.B,
    C: PORTFOLIO_GRADE_THRESHOLDS.C,
    D: PORTFOLIO_GRADE_THRESHOLDS.D,
  },

  // Portfolio Quality Gate Thresholds
  qualityGate: {
    minPassRatePct: PORTFOLIO_QUALITY_GATE.minPassRatePct,
    coverageThresholds: {
      unitLinesPct: PORTFOLIO_QUALITY_GATE.lowBranchThresholdPct,
      integrationApiPct: PORTFOLIO_QUALITY_GATE.coverageTargetPct,
      systemFlowPct: 60,
    },
    passedRequirements: {
      minHealthScore: PORTFOLIO_QUALITY_GATE.passedMinHealthScore,
      minPassRate: PORTFOLIO_QUALITY_GATE.passedMinPassRatePct,
      maxCriticalFailures: 0,
    },
  },

  // Risk Quadrant Boundaries (Coverage vs. Pass Rate)
  riskQuadrants: {
    coverageCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.coverageCutoff,
    passRateCutoff: PORTFOLIO_RISK_QUADRANT_CUTOFFS.passRateCutoff,
    definitions: {
      healthyStars: {
        id: "healthy-stars",
        label: "Healthy Stars",
        description: "High Coverage & High Pass Rate (Ready for automated release)",
        color: "var(--ud-pass)",
      },
      falseSecurity: {
        id: "false-security",
        label: "Blind Spot / False Security",
        description: "High Pass Rate but Low Coverage (Risk of undetected regressions)",
        color: "var(--ud-warn)",
      },
      activeRegressions: {
        id: "active-regressions",
        label: "Active Regressions",
        description: "High Coverage but Low Pass Rate (Active defects under investigation)",
        color: "#fb8500",
      },
      criticalRisk: {
        id: "critical-risk",
        label: "Critical Risk",
        description: "Low Coverage & Low Pass Rate (Immediate engineering intervention needed)",
        color: "var(--ud-fail)",
      },
      untested: {
        id: "untested",
        label: "Not Yet Tested",
        description: "No test suites executed yet (Excluded from Critical Risk quadrant)",
        color: "var(--ps-neutral)",
      },
    },
  },

  // Lifecycle Filter Labels
  lifecycleFilterLabels: PORTFOLIO_FILTER_SCOPE_LABELS,

  // Sort Options
  sortOptions: [
    { value: "health-desc", label: "Health Score (High → Low)" },
    { value: "health-asc", label: "Health Score (Low → High)" },
    { value: "coverage-desc", label: "Unified Coverage (High → Low)" },
    { value: "gaps-desc", label: "Most Uncovered Gaps" },
    { value: "recent", label: "Recently Updated" },
    { value: "name-asc", label: "Name (A → Z)" },
  ],

  // Status Filter Options
  statusFilterOptions: [
    { value: "all", label: "All Projects" },
    { value: "pinned", label: "★ Pinned" },
    { value: "PASSED", label: "Passed" },
    { value: "AT_RISK", label: "At Risk" },
    { value: "BLOCKED", label: "Blocked" },
    { value: "UNTESTED", label: "Untested" },
  ],

  // Layer Deficit Filter Options
  layerDeficitOptions: [
    { value: "all", label: "All Layers Balanced" },
    { value: "deficit-unit", label: "Missing Unit Tests (<20%)" },
    { value: "deficit-integration", label: "Missing Integration/API Tests (<20%)" },
    { value: "deficit-system", label: "Missing System E2E Tests (<20%)" },
  ],
};

export { PORTFOLIO_FILTER_SCOPE_LABELS };
export default PORTFOLIO_CONFIG;
