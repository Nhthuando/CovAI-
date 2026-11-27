/**
 * English-only formatting, NFC normalization, and Testing Layer copy
 * for CovAI Unified Quality & Coverage Reports.
 */

export const VALID_REPORT_LANGUAGES = ["en"];

/**
 * Normalize any text value to Unicode NFC.
 */
export function nfc(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFC");
}

/**
 * Normalize report language selector — strictly English-only ("en").
 */
export function normalizeReportLanguage() {
  return "en";
}

/**
 * Format a timestamp into human-readable English copy (no raw ISO dates in visible prose).
 */
export function formatHumanDate(dateInput = new Date()) {
  const d =
    dateInput instanceof Date
      ? dateInput
      : new Date(dateInput || Date.now());
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d;

  const enStr = validDate.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return nfc(enStr);
}

/**
 * Resolve report text (strictly English-only).
 */
export function pickText(enText) {
  return nfc(enText);
}

export function translateGateStatus(status, label) {
  const s = String(status || "").toUpperCase();
  if (s === "PASSED") {
    return {
      en: "READY TO RELEASE",
      tone: "pass",
    };
  }
  if (s === "FAILED") {
    return {
      en: "BLOCKED",
      tone: "fail",
    };
  }
  if (s === "WARNING") {
    return {
      en: "AT RISK",
      tone: "warn",
    };
  }
  return {
    en: nfc(label || "UNVERIFIED • NOT RUN"),
    tone: "neutral",
  };
}

export function translatePyramidShape(shape, badgeTitle, warning) {
  const map = {
    pyramid: {
      enTitle: "Balanced Testing Pyramid",
      enExplain:
        "Unit tests form a wide, fast base; Integration tests validate API contracts in the middle; System (E2E) tests stay focused at the top.",
    },
    "missing-unit": {
      enTitle: "Unbalanced Pyramid — Missing Unit Test Foundation",
      enExplain:
        "Integration or System tests ran without any Unit test base. Defects are caught late, slowly, and without function-level isolation.",
    },
    "ice-cream-cone": {
      enTitle: "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)",
      enExplain:
        "System (E2E) tests outnumber Unit tests, making the suite slow, brittle to UI changes, and expensive to diagnose.",
    },
    hourglass: {
      enTitle: "Hourglass Distribution (Weak Integration Layer)",
      enExplain:
        "Unit and System tests exist, but Integration coverage between them is thin, leaving API, auth middleware, and database contracts exposed.",
    },
    "unit-only": {
      enTitle: "Unit-Only Foundation (Missing Integration & E2E)",
      enExplain:
        "Only isolated Unit tests ran. Service wiring, HTTP routes, database queries, and end-to-end user journeys remain unverified.",
    },
    partial: {
      enTitle: "Partial Pyramid (Missing System E2E Layer)",
      enExplain:
        "Unit and Integration suites ran, but no System (E2E) journeys ran to verify real browser/UI flows end-to-end.",
    },
    unbalanced: {
      enTitle: "Unbalanced Pyramid — Top/Middle Heavy",
      enExplain:
        "Integration tests equal or outnumber Unit tests. Expanding Unit tests speeds up feedback and lowers maintenance overhead.",
    },
    insufficient: {
      enTitle: "No Tests Executed — Run Suites to Establish Baseline",
      enExplain:
        "Zero automated tests have executed on this snapshot across Unit, Integration, and System layers. Unrun metrics do not indicate 0% test failure.",
    },
  };

  const entry = map[shape] || {
    enTitle: badgeTitle || "Testing Pyramid Assessment",
    enExplain: warning || "Distribution across Unit, Integration, and System layers.",
  };

  return {
    enTitle: nfc(entry.enTitle),
    enExplain: nfc(entry.enExplain),
  };
}

export const STANDARD_PYRAMID_BADGE_TITLES = new Set([
  "Balanced Pyramid",
  "Balanced Testing Pyramid",
  "Unbalanced Pyramid — Missing Unit Test Foundation",
  "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)",
  "Hourglass Distribution (Weak Integration Layer)",
  "Unit-Only Foundation (Missing Integration & E2E)",
  "Partial Pyramid (Missing E2E Tests)",
  "Partial Pyramid (Missing System E2E Layer)",
  "Unbalanced Pyramid — Top/Middle Heavy",
  "No Tests Executed — Run suites to establish baseline",
  "No Tests Executed — Run Suites to Establish Baseline",
  "No Tests Executed",
  "Pyramid Assessment",
]);

export function translateChecklistItem(chk = {}) {
  const id = String(chk?.id || "");
  const rawLabel = nfc(chk?.label || "");
  const rawVal = nfc(chk?.currentValue ?? "—");

  const labelById = {
    "chk-unit-branch": "Unit Branch Coverage >= 75%",
    "chk-api-endpoint": "API Endpoint Coverage >= 80%",
    "chk-e2e-passing": "Critical E2E Journeys Passing = 100%",
    "chk-zero-defects": "Zero High-Severity Cross-Layer Defects",
  };

  const label = labelById[id] || rawLabel;

  return {
    label: nfc(label),
    currentValue: rawVal,
  };
}

export function translateSuspectLayer(layer) {
  const raw = String(layer || "none").trim();
  return nfc(raw || "none");
}

export function translateMatrixCellLabel(label, status) {
  const raw = nfc(label || "").trim();
  let normalized = raw;
  const legacyMatch = raw.match(/^(\d+)\s*\/\s*(\d+)\s+passed\s*\(([0-9.]+)%\)$/i);
  if (legacyMatch) {
    const passed = Number(legacyMatch[1]);
    const total = Number(legacyMatch[2]);
    const cov = legacyMatch[3];
    const passRate = total > 0 ? Number(((passed / total) * 100).toFixed(1)) : 0;
    normalized = `${passed}/${total} passed (${passRate}%) · ${cov}% lines`;
  }
  return nfc(normalized) || String(status || "N/A").toUpperCase();
}

export function translateHistoryStatus(status) {
  const s = String(status || "").toUpperCase();
  return nfc(s || "N/A");
}

export const LAYER_GUIDES = {
  unit: {
    id: "unit",
    weightPct: 50,
    en: {
      name: "Unit Tests",
      roleTag: "Foundation Layer • 50% Weight",
      whatItVerifies:
        "Validates individual functions, pure business logic, edge cases, and conditional branches in isolation with dependencies mocked or stubbed.",
      scopeAndSpeed:
        "Fastest feedback loop (milliseconds per test); pinpoints the exact file and branch where logic regresses.",
      metricsMeaning:
        "Line Coverage measures executed code lines (target >= 70%); Branch Coverage measures tested if/else/ternary decision paths (Quality Gate >= 75%).",
      gapInterpretation:
        "Low Unit coverage or failing Unit tests mean core business rules can fail silently or propagate defects upward into Integration and E2E suites.",
      notRunGuidance:
        "When totalTests = 0 (NOT_RUN), code logic correctness is unverified for this snapshot even if static file inventory lists uncovered files.",
    },
  },
  integration: {
    id: "integration",
    weightPct: 30,
    en: {
      name: "Integration Tests",
      roleTag: "Contract Layer • 30% Weight",
      whatItVerifies:
        "Verifies how modules work together across HTTP routes, authentication middleware, request validation, controllers, and database queries.",
      scopeAndSpeed:
        "Moderate speed (tens to hundreds of ms per test); catches contract mismatches, auth bypasses, and SQL/ORM errors that mocked Unit tests miss.",
      metricsMeaning:
        "API Endpoint Coverage = Covered AST Endpoints / Total Discovered Endpoints (Quality Gate >= 80%). Untested AST endpoints are tracked separately as Uncovered APIs—never counted as test failures.",
      gapInterpretation:
        "If Unit tests pass while Integration fails, the defect usually lies in route wiring, auth/RBAC middleware, payload serialization, or database constraints.",
      notRunGuidance:
        "When totalTests = 0 (NOT_RUN), AST-discovered endpoints remain in Uncovered APIs (unverified), while executed failure counts remain 0.",
    },
  },
  system: {
    id: "system",
    weightPct: 20,
    en: {
      name: "System Tests (E2E)",
      roleTag: "User Journey Layer • 20% Weight",
      whatItVerifies:
        "Exercises complete end-to-end user journeys through the rendered frontend UI, network calls, backend APIs, and persistence layer.",
      scopeAndSpeed:
        "Slowest and most realistic layer (seconds per journey); validates critical flows, UI rendering, navigation, and real environment stability.",
      metricsMeaning:
        "User Flow Coverage measures verified end-to-end journey/UI coverage (warning < 50%, target 80%), while the Quality Gate requires 100% of executed E2E journeys passing with 0 flaky tests.",
      gapInterpretation:
        "If Unit and Integration pass while System E2E fails, the root cause typically involves UI selectors, client state synchronization, timeouts, or environment wiring.",
      notRunGuidance:
        "When totalTests = 0 (NOT_RUN), end-to-end user experience and browser integration remain unverified for this release candidate.",
    },
  },
};

export const CROSS_LAYER_DIAGNOSIS_GUIDE = [
  {
    patternEn: "Unit PASS · Integration PASS · System PASS",
    meaningEn: "Full-stack confidence: business logic, API contracts, and user journeys align.",
  },
  {
    patternEn: "Unit FAIL · Integration/System FAIL",
    meaningEn: "Bottom-up logic defect: fix the Unit layer first before debugging higher layers.",
  },
  {
    patternEn: "Unit PASS · Integration FAIL",
    meaningEn: "Boundary/contract defect in routing, auth middleware, controller mapping, or database.",
  },
  {
    patternEn: "Unit PASS · Integration PASS · System FAIL",
    meaningEn: "Frontend/E2E issue: broken UI selector, client state bug, CORS, or network timeout.",
  },
  {
    patternEn: "Any Layer NOT_RUN (0 tests)",
    meaningEn: "Unverified blind spot: contributes 0 to the 50/30/20 weighted index until executed.",
  },
];

export const METHODOLOGY_ITEMS = [
  {
    enTitle: "Pass Rate Denominator",
    enBody: "Pass Rate = Passed / (Passed + Failed). Skipped tests are reported separately and do not inflate or penalize pass rate.",
  },
  {
    enTitle: "50 / 30 / 20 Weighted Coverage & Health Model",
    enBody: "Overall Coverage = 50% Unit Lines + 30% Integration API Endpoints + 20% System Flows. Health Score blends 50% pass rate and 50% coverage per layer using the same 50/30/20 weights, minus up to 15 pts for failing tests.",
  },
  {
    enTitle: "NOT_RUN vs. 0% Execution Failure & Uncovered APIs",
    enBody: "A layer with 0 executed tests is marked NOT_RUN (unverified), contributing 0 to the weighted index without inflating executed failures. AST-discovered endpoints lacking integration tests are counted under Uncovered APIs, never as failed tests.",
  },
  {
    enTitle: "Snapshot & Print Caveat",
    enBody: "All metrics reflect the selected CovAI snapshot state at export time. Partial or unrun suites require running the missing layers to unlock full Quality Gate verification.",
  },
];

export const FAILURE_CATEGORY_LABELS = {
  unitFailed: { en: "Unit Failures" },
  route: { en: "Route Wiring" },
  middlewareAuth: { en: "Auth Middleware" },
  controller: { en: "Controller Logic" },
  database: { en: "Database / ORM" },
  selectorNotFound: { en: "E2E Selector" },
  networkTimeout: { en: "Network Timeout" },
  assertion: { en: "E2E Assertion" },
  flaky: { en: "Flaky Tests" },
};

export const ACTION_PRIORITY_LABELS = {
  CRITICAL: { en: "CRITICAL" },
  HIGH: { en: "HIGH" },
  MEDIUM: { en: "MEDIUM" },
  LOW: { en: "LOW" },
};

export const REPORT_COPY = {
  brand: {
    en: "CovAI Quality Analytics",
  },
  titlePrefix: {
    en: "Testing Quality & Coverage Report",
  },
  metaLabels: {
    branch: { en: "Branch" },
    snapshot: { en: "Snapshot" },
    generated: { en: "Generated" },
    qualityGate: { en: "Quality Gate" },
    healthScore: { en: "Health Score" },
    grade: { en: "Grade" },
    scale: { en: "Scale 0–100" },
    notRun: { en: "Not Run" },
    unverified: { en: "Unverified" },
  },
  sectionTitles: {
    executiveSummary: {
      en: "Executive Summary",
    },
    kpiStrip: {
      en: "Headline Quality Indicators",
    },
    overviewCharts: {
      en: "3-Tier Statistical Overview",
    },
    overviewChartsSubtitle: {
      en: "Unit, Integration, and System metrics across coverage, outcomes, trajectory, and module risk.",
    },
    keyFindings: {
      en: "Key Findings & 3-Tier Metrics",
    },
    criticalGaps: {
      en: "Critical Gaps & Failures",
    },
    layerGuide: {
      en: "Understanding Unit, Integration, and System (E2E) Testing",
    },
    diagram1: {
      en: "Multi-Layer Coverage & Pass Rate vs. Quality Targets",
    },
    diagramUnitDimensions: {
      en: "Unit & Integration 4-Metric Code Coverage Breakdown",
    },
    diagram2: {
      en: "Testing Pyramid Balance & Execution Outcome Distribution",
    },
    diagramDurationVolume: {
      en: "Per-Layer Execution Volume & Duration Latency",
    },
    diagramFailureActions: {
      en: "Failure Root-Cause Distribution & Action Priority Backlog",
    },
    diagram3Trend: {
      en: "Coverage & Pass-Rate Trend",
    },
    diagram3Variance: {
      en: "Gate Baseline & 50/30/20 Weighting",
    },
    diagramApiHotspots: {
      en: "Low-Coverage File Hotspots & AST API Endpoint Coverage",
    },
    diagram4Matrix: {
      en: "Module × 3-Tier Test Health Matrix",
    },
    diagram4Hotspots: {
      en: "3-Tier Verification Readiness Matrix",
    },
    actions: {
      en: "Prioritized Next Steps",
    },
    history: {
      en: "Recent Execution Runs",
    },
    caveats: {
      en: "Caveats & Open Questions",
    },
    methodology: {
      en: "Methodology, Metric Definitions & Caveats",
    },
  },
  charts: {
    tierBar: {
      enTitle: "Tier Pass, Fail & Coverage vs. Gate",
      enSubtitle: "0%–100% scale · Tier coverage (top) & pass/fail share (bottom) vs. dashed gate",
    },
    outcomeDonut: {
      enTitle: "Execution Outcomes & Tier Share",
      enSubtitle: "Pass / Fail / Skip distribution of executed tests and 3-tier volume share",
    },
    trendLine: {
      enTitle: "Coverage & Pass-Rate Trend",
      enSubtitle: "Coverage % and Pass Rate % across recent runs vs. 80% gate baseline",
      enBaselineSubtitle: "Single-run snapshot baseline (< 2 recorded runs) vs. 80% gate",
    },
    moduleHeatmap: {
      enTitle: "Module × 3-Tier Health Heatmap",
      enSubtitle: "Module pass ratio and health state across Unit, Integration, and System",
      enEmptySubtitle: "3-tier readiness summary (no module matrix rows in this snapshot)",
    },
  },
  notices: {
    zeroApisDiscovered: {
      en: "No AST API endpoints were discovered in this snapshot (0/0 APIs).",
    },
    allFilesCovered: {
      en: "All tracked unit source files achieved 100.0% coverage across Branches, Lines, and Functions.",
    },
    unitVerifiedNoApis: {
      en: "Unit verified (no APIs)",
    },
  },
};
