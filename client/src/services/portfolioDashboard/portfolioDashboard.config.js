/**
 * Multi-Project Quality Portfolio Dashboard Configuration
 * Scoped configuration for account-level aggregates, quality gates, risk quadrants,
 * and multi-dimensional filter/sort parameters.
 */

export const PORTFOLIO_CONFIG = {
  // Default layer weights for composite health calculation
  weights: {
    unit: 0.35,
    integration: 0.35,
    system: 0.30,
  },

  // Health Score Grade Thresholds
  grades: {
    A: 85,
    B: 75,
    C: 60,
    D: 0,
  },

  // Portfolio Quality Gate Thresholds
  qualityGate: {
    minPassRatePct: 80, // Pass rate below 80% marks gate as BLOCKED
    coverageThresholds: {
      unitLinesPct: 75,
      integrationApiPct: 80,
      systemFlowPct: 60,
    },
    passedRequirements: {
      minHealthScore: 80,
      minPassRate: 95,
      maxCriticalFailures: 0,
    },
  },

  // Risk Quadrant Boundaries (Coverage vs. Pass Rate)
  riskQuadrants: {
    coverageCutoff: 70, // X-axis threshold (0-100%)
    passRateCutoff: 85, // Y-axis threshold (0-100%)
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
    },
  },

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

export default PORTFOLIO_CONFIG;

