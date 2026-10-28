/**
 * Unified Quality & Testing Dashboard Configuration
 * Centralized weights, quality gate thresholds, and layout limits
 */

export const UNIFIED_DASHBOARD_CONFIG = {
  // Executive Health Score Weights (must sum to 1.0)
  weights: {
    unit: 0.50,
    integration: 0.30,
    system: 0.20,
  },

  // Health Score Grade Thresholds
  grades: {
    A: 90,
    B: 75,
    C: 60,
    D: 0,
  },

  // Global Quality Gate Thresholds
  qualityGate: {
    minPassRatePct: 80, // Pass rate below 80% marks gate as BLOCKED
    coverageThresholds: {
      unitLinesPct: 70,       // Below 70% triggers warning
      integrationApiPct: 60,  // Below 60% triggers warning
      systemFlowPct: 50,      // Below 50% triggers warning
    },
    maxFlakyAllowed: 0,       // Flaky tests trigger warning
  },

  // Low Coverage Highlights
  lowCoverage: {
    maxItems: 5,
    branchThreshold: 60, // Highlight files with branch coverage below 60%
  },

  // Smart Action Center
  actionCenter: {
    initialVisibleCount: 8,
  },

  // History Runs Table
  history: {
    pageSize: 10,
  },
};

export default UNIFIED_DASHBOARD_CONFIG;
