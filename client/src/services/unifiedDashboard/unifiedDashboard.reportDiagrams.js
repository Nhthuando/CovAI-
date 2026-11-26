import { fmtCount, fmtDuration } from "./format.js";
import { UNIFIED_DASHBOARD_CONFIG } from "./unifiedDashboard.config.js";
import {
  nfc,
  normalizeReportLanguage,
  pickText,
} from "./unifiedDashboard.reportI18n.js";

function escapeXml(value) {
  return nfc(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function estimateCharWidthPx(ch, fontSize = 10, isBold = false, isMono = false) {
  if (isMono) {
    return fontSize * (isBold ? 0.65 : 0.61);
  }
  const boldFactor = isBold ? 1.06 : 1.0;
  if ("WM@%".includes(ch)) return fontSize * 1.02 * boldFactor;
  if (/[A-ZĐƠƯĂÂÊÔ]/.test(ch)) return fontSize * 0.78 * boldFactor;
  if (/[mw]/.test(ch)) return fontSize * 0.78 * boldFactor;
  if (/[ilIjtfr1.,:;|!'"`()[\]{}/\\ ]/.test(ch)) return fontSize * 0.36 * boldFactor;
  return fontSize * 0.58 * boldFactor;
}

function truncateSvgTextByPx(text, maxPx, fontSize = 10, isBold = false, isMono = false) {
  const s = nfc(text).trim();
  if (!s) return "";
  const ellipsisW = estimateCharWidthPx("…", fontSize, isBold, isMono);
  let totalW = 0;
  for (const ch of s) {
    totalW += estimateCharWidthPx(ch, fontSize, isBold, isMono);
  }
  if (totalW <= maxPx) return s;

  let acc = 0;
  let cutIdx = 0;
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i += 1) {
    const w = estimateCharWidthPx(chars[i], fontSize, isBold, isMono);
    if (acc + w + ellipsisW > maxPx) {
      break;
    }
    acc += w;
    cutIdx = i + 1;
  }
  return `${chars.slice(0, Math.max(1, cutIdx)).join("")}…`;
}

function num(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveLayerRunState(pillar) {
  if (!pillar) return "NOT_RUN";
  const total = num(pillar.totalTests, 0);
  const passed = num(pillar.passedTests, 0);
  const failed = num(pillar.failedTests, 0);
  if (total <= 0 || (passed === 0 && failed === 0 && num(pillar.skippedTests, 0) === 0)) {
    return "NOT_RUN";
  }
  return failed > 0 ? "HAS_FAILURES" : "ALL_PASSING";
}

/**
 * Extract a normalized, numeric-parity report model directly from UnifiedDashboardVM.
 * Keeps `NOT_RUN` (`totalTests === 0`) and `uncoveredApis` strictly distinct from `0%` failures.
 */
export function buildReportMetricsModel(vm = {}) {
  const pillars = vm?.pillars || {};
  const unit = pillars.unit || {};
  const integration = pillars.integration || {};
  const system = pillars.system || {};

  const unitState = resolveLayerRunState(unit);
  const intState = resolveLayerRunState(integration);
  const sysState = resolveLayerRunState(system);

  const unitTotal = num(unit.totalTests, 0);
  const intTotal = num(integration.totalTests, 0);
  const sysTotal = num(system.totalTests, 0);
  const totalExecuted = num(vm?.execution?.total, unitTotal + intTotal + sysTotal);

  const unitLines = unitState === "NOT_RUN" ? 0 : num(unit.coverageMetrics?.lines ?? vm?.coverage?.codePct, 0);
  const unitBranches = unitState === "NOT_RUN" ? 0 : num(unit.coverageMetrics?.branches ?? vm?.coverage?.branchPct, 0);
  const totalApis = num(integration.coverageMetrics?.totalApis, 0);
  const uncoveredApis = num(integration.coverageMetrics?.uncoveredApis ?? vm?.execution?.uncoveredApis, 0);
  const failedApis = num(integration.coverageMetrics?.failedApis, 0);
  const coveredApis =
    intState === "NOT_RUN"
      ? 0
      : num(
          integration.coverageMetrics?.coveredApis,
          Math.max(0, totalApis - uncoveredApis - failedApis)
        );
  const apiPct =
    intState === "NOT_RUN" || totalApis <= 0
      ? 0
      : num(integration.coverageMetrics?.apiEndpoint ?? vm?.coverage?.apiPct, 0);
  const flowPct = sysState === "NOT_RUN" ? 0 : num(system.coverageMetrics?.flow ?? vm?.coverage?.flowPct, 0);

  const weights = UNIFIED_DASHBOARD_CONFIG.weights;
  const overallCov =
    totalExecuted > 0
      ? num(
          vm?.coverage?.overall,
          Number(
            (unitLines * weights.unit + apiPct * weights.integration + flowPct * weights.system).toFixed(1)
          )
        )
      : 0;

  const layers = {
    unit: {
      id: "unit",
      framework: nfc(unit.framework || "Jest"),
      state: unitState,
      totalTests: unitTotal,
      passedTests: num(unit.passedTests, 0),
      failedTests: num(unit.failedTests, 0),
      skippedTests: num(unit.skippedTests, 0),
      flakyTests: num(unit.flakyTests, 0),
      passRate: unitState === "NOT_RUN" ? null : num(unit.passRate, 0),
      durationMs: num(unit.durationMs, 0),
      avgDurationMs: num(unit.avgDurationMs, 0),
      coverage: {
        lines: unitLines,
        branches: unitBranches,
        functions: unitState === "NOT_RUN" ? 0 : num(unit.coverageMetrics?.functions, 0),
        statements: unitState === "NOT_RUN" ? 0 : num(unit.coverageMetrics?.statements, 0),
      },
      lowCoverageItems: Array.isArray(unit.lowCoverageItems) ? unit.lowCoverageItems : [],
      failedScenarios: Array.isArray(unit.failedScenarios) ? unit.failedScenarios : [],
    },
    integration: {
      id: "integration",
      framework: nfc(integration.framework || "Supertest"),
      state: intState,
      totalTests: intTotal,
      passedTests: num(integration.passedTests, 0),
      failedTests: num(integration.failedTests, 0),
      skippedTests: num(integration.skippedTests, 0),
      flakyTests: num(integration.flakyTests, 0),
      passRate: intState === "NOT_RUN" ? null : num(integration.passRate, 0),
      durationMs: num(integration.durationMs, 0),
      avgDurationMs: num(integration.avgDurationMs, 0),
      coverage: {
        apiEndpoint: apiPct,
        lines: intState === "NOT_RUN" ? 0 : num(integration.coverageMetrics?.lines, 0),
        branches: intState === "NOT_RUN" ? 0 : num(integration.coverageMetrics?.branches, 0),
        functions: intState === "NOT_RUN" ? 0 : num(integration.coverageMetrics?.functions, 0),
        statements: intState === "NOT_RUN" ? 0 : num(integration.coverageMetrics?.statements, 0),
        coveredApis,
        failedApis,
        uncoveredApis,
        totalApis,
      },
      lowCoverageItems: Array.isArray(integration.lowCoverageItems) ? integration.lowCoverageItems : [],
      failedScenarios: Array.isArray(integration.failedScenarios) ? integration.failedScenarios : [],
      failureDistribution: integration.failureDistribution || {
        route: 0,
        middlewareAuth: 0,
        controller: 0,
        database: 0,
      },
    },
    system: {
      id: "system",
      framework: nfc(system.framework || "Playwright"),
      state: sysState,
      totalTests: sysTotal,
      passedTests: num(system.passedTests, 0),
      failedTests: num(system.failedTests, 0),
      skippedTests: num(system.skippedTests, 0),
      flakyTests: num(system.flakyTests, 0),
      passRate: sysState === "NOT_RUN" ? null : num(system.passRate, 0),
      durationMs: num(system.durationMs, 0),
      avgDurationMs: num(system.avgDurationMs, 0),
      coverage: {
        flow: flowPct,
        lines: sysState === "NOT_RUN" ? 0 : num(system.coverageMetrics?.lines, 0),
      },
      lowCoverageItems: Array.isArray(system.lowCoverageItems) ? system.lowCoverageItems : [],
      failedScenarios: Array.isArray(system.failedScenarios) ? system.failedScenarios : [],
      failureDistribution: system.failureDistribution || {
        selectorNotFound: 0,
        networkTimeout: 0,
        assertion: 0,
        flaky: 0,
      },
    },
  };

  const execution = {
    total: totalExecuted,
    passed: num(vm?.execution?.passed, layers.unit.passedTests + layers.integration.passedTests + layers.system.passedTests),
    failed: num(vm?.execution?.failed, layers.unit.failedTests + layers.integration.failedTests + layers.system.failedTests),
    skipped: num(vm?.execution?.skipped, layers.unit.skippedTests + layers.integration.skippedTests + layers.system.skippedTests),
    flaky: num(vm?.execution?.flaky, layers.unit.flakyTests + layers.integration.flakyTests + layers.system.flakyTests),
    uncoveredApis,
    passRate: totalExecuted > 0 ? num(vm?.execution?.passRate, 0) : null,
    durationMs: num(vm?.execution?.durationMs, layers.unit.durationMs + layers.integration.durationMs + layers.system.durationMs),
  };

  const coverage = {
    overall: overallCov,
    codePct: unitLines,
    branchPct: unitBranches,
    apiPct,
    flowPct,
  };

  const healthRawScore = vm?.health?.score;
  const healthValid =
    totalExecuted > 0 &&
    healthRawScore !== null &&
    healthRawScore !== undefined &&
    Number.isFinite(Number(healthRawScore));

  const health = {
    score: healthValid ? Number(healthRawScore) : null,
    grade: healthValid && vm?.health?.grade && vm.health.grade !== "—" ? nfc(vm.health.grade) : null,
    delta: vm?.health?.delta ?? null,
  };

  const trendSeries = Array.isArray(vm?.trend?.series) ? vm.trend.series : [];
  const matrixRows = Array.isArray(vm?.matrix?.rows) ? vm.matrix.rows : [];
  const actionItems = Array.isArray(vm?.actions?.items) ? vm.actions.items : [];
  const historyRuns = Array.isArray(vm?.history?.runs) ? vm.history.runs : [];

  const varianceItems = [
    {
      id: "unit-lines",
      enLabel: "Unit Lines (vs 70%)",
      viLabel: "Dòng Đ.vị (mốc 70%)",
      biLabel: "Unit Lines · Dòng Đ.vị",
      actual: unitState === "NOT_RUN" ? null : unitLines,
      target: UNIFIED_DASHBOARD_CONFIG.qualityGate.coverageThresholds.unitLinesPct,
      delta: unitState === "NOT_RUN" ? null : Number((unitLines - UNIFIED_DASHBOARD_CONFIG.qualityGate.coverageThresholds.unitLinesPct).toFixed(1)),
      state: unitState,
    },
    {
      id: "unit-branches",
      enLabel: "Unit Branches (Gate 75%)",
      viLabel: "Nhánh Đ.vị (cổng 75%)",
      biLabel: "Unit Branches · Nhánh",
      actual: unitState === "NOT_RUN" ? null : unitBranches,
      target: 75,
      delta: unitState === "NOT_RUN" ? null : Number((unitBranches - 75).toFixed(1)),
      state: unitState,
    },
    {
      id: "api-endpoints",
      enLabel: "API Endpoints (Gate 80%)",
      viLabel: "API T.hợp (cổng 80%)",
      biLabel: "API Endpoints · API",
      actual: intState === "NOT_RUN" ? null : apiPct,
      target: 80,
      delta: intState === "NOT_RUN" ? null : Number((apiPct - 80).toFixed(1)),
      state: intState,
    },
    {
      id: "system-pass",
      enLabel: "E2E Pass Rate (Gate 100%)",
      viLabel: "Tỷ lệ đạt E2E (cổng 100%)",
      biLabel: "E2E Pass · Tỷ lệ E2E",
      actual: sysState === "NOT_RUN" ? null : layers.system.passRate,
      target: 100,
      delta: sysState === "NOT_RUN" ? null : Number(((layers.system.passRate ?? 0) - 100).toFixed(1)),
      state: sysState,
    },
  ];

  const weightedContributions = {
    unit: Number((unitLines * weights.unit).toFixed(1)),
    integration: Number((apiPct * weights.integration).toFixed(1)),
    system: Number((flowPct * weights.system).toFixed(1)),
    overall: overallCov,
  };

  const intFail = layers.integration.failureDistribution || {};
  const sysFail = layers.system.failureDistribution || {};
  const failureDistribution = {
    unit: {
      failedTests: layers.unit.failedTests,
    },
    integration: {
      route: num(intFail.route, 0),
      middlewareAuth: num(intFail.middlewareAuth, 0),
      controller: num(intFail.controller, 0),
      database: num(intFail.database, 0),
    },
    system: {
      selectorNotFound: num(sysFail.selectorNotFound, 0),
      networkTimeout: num(sysFail.networkTimeout, 0),
      assertion: num(sysFail.assertion, 0),
      flaky: num(sysFail.flaky, 0),
    },
  };

  const actionPriorityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const actionPillarCounts = { unit: 0, integration: 0, system: 0, other: 0 };
  for (const act of actionItems) {
    const prio = String(act?.priority || "LOW").toUpperCase();
    if (prio === "CRITICAL" || prio === "P0") actionPriorityCounts.CRITICAL += 1;
    else if (prio === "HIGH" || prio === "P1") actionPriorityCounts.HIGH += 1;
    else if (prio === "MEDIUM" || prio === "P2") actionPriorityCounts.MEDIUM += 1;
    else actionPriorityCounts.LOW += 1;

    const pil = String(act?.pillar || "").toLowerCase();
    if (pil === "unit") actionPillarCounts.unit += 1;
    else if (pil === "integration") actionPillarCounts.integration += 1;
    else if (pil === "system") actionPillarCounts.system += 1;
    else actionPillarCounts.other += 1;
  }

  return {
    layers,
    execution,
    coverage,
    health,
    qualityGate: vm?.qualityGate || { status: "UNVERIFIED", label: "UNVERIFIED • NOT RUN", reasons: [], checklist: [] },
    pyramid: vm?.pyramid || { shape: "insufficient", badgeTitle: "No Tests Executed", warning: null, layers: [] },
    ai: vm?.ai || { aiGenerated: 0, aiRepaired: 0, gaps: 0 },
    trendSeries,
    beforeAfter: vm?.trend?.beforeAfter || null,
    matrixRows,
    actionItems,
    historyRuns,
    varianceItems,
    weightedContributions,
    failureDistribution,
    actionPriorityCounts,
    actionPillarCounts,
  };
}

const FONT_SANS = `'Inter', 'Noto Sans', 'Segoe UI', 'DejaVu Sans', Arial, sans-serif`;
const FONT_MONO = `'JetBrains Mono', 'Consolas', 'DejaVu Sans Mono', ui-monospace, monospace`;

const TIER_COLORS = {
  unit: "#0969da",
  integration: "#8250df",
  system: "#0d9488",
};

const SEMANTIC_COLORS = {
  passFill: "#15803d",
  failFill: "#be123c",
  warnFill: "#b45309",
  gateStroke: "#334155",
  baselineStroke: "#475569",
  grid: "#e2e8f0",
  track: "#f1f5f9",
  notRunBg: "#f8fafc",
  notRunStroke: "#94a3b8",
  ink: "#0f172a",
  ink2: "#334155",
  muted: "#64748b",
};

/**
 * Helper: extract Pass/Fail/Total counts from a matrix cell safely.
 */
export function extractMatrixCellCounts(cell) {
  if (!cell) return { passed: 0, failed: 0, total: 0 };
  const totalRaw = Number(cell.total);
  if (Number.isFinite(totalRaw) && totalRaw > 0) {
    const passed = Math.max(0, num(cell.passed, 0));
    const failed = Math.max(0, num(cell.failed, 0));
    return { passed, failed, total: totalRaw };
  }
  const match = String(cell.label || "").match(/(\d+)\s*\/\s*(\d+)/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (Number.isFinite(first) && Number.isFinite(second) && second > 0) {
      const s = String(cell.status || "").toLowerCase();
      if (s === "fail" || s === "failed") {
        return { passed: Math.min(first, second), failed: Math.max(0, second - first), total: second };
      }
      return { passed: Math.min(first, second), failed: 0, total: second };
    }
  }
  const status = String(cell.status || "").toLowerCase();
  if (status === "pass" || status === "passed") return { passed: 1, failed: 0, total: 1 };
  if (status === "fail" || status === "failed") return { passed: 0, failed: 1, total: 1 };
  if (status === "warn" || status === "warning") return { passed: 0, failed: 0, total: 1 };
  return { passed: 0, failed: 0, total: 0 };
}

export function sortMatrixRowsByRisk(matrixRows = []) {
  const priorityScore = (r) => {
    const statuses = [r.unit?.status, r.integration?.status, r.system?.status].map((s) =>
      String(s || "").toLowerCase()
    );
    if (statuses.includes("fail") || statuses.includes("failed")) return 3;
    if (statuses.includes("warn") || statuses.includes("warning")) return 2;
    if (statuses.includes("untested") || statuses.includes("none") || statuses.includes("")) return 1;
    return 0;
  };
  const failCount = (r) =>
    extractMatrixCellCounts(r.unit).failed +
    extractMatrixCellCounts(r.integration).failed +
    extractMatrixCellCounts(r.system).failed;

  return [...matrixRows].sort((a, b) => {
    const pDiff = priorityScore(b) - priorityScore(a);
    if (pDiff !== 0) return pDiff;
    return failCount(b) - failCount(a);
  });
}

/**
 * Page-1 Chart 1: Tier Bar Comparison (Pass, Fail & Coverage across Unit, Integration, System).
 * Native half-width viewBox 460x250.
 */
export function renderTierBarComparisonSvg(model, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const { layers, coverage } = model;

  const width = 460;
  const height = 250;
  const padL = 88;
  const padR = 124;
  const chartW = width - padL - padR; // 248px
  const topY = 40;
  const bottomY = 216;

  const rows = [
    {
      key: "unit",
      label: lang === "vi" ? "Đơn vị" : lang === "en" ? "Unit" : "Unit · Đ.vị",
      color: TIER_COLORS.unit,
      cov: coverage.codePct,
      target: UNIFIED_DASHBOARD_CONFIG.qualityGate.coverageThresholds.unitLinesPct,
      data: layers.unit,
    },
    {
      key: "integration",
      label: lang === "vi" ? "Tích hợp" : lang === "en" ? "Integration" : "Integr. · T.hợp",
      color: TIER_COLORS.integration,
      cov: coverage.apiPct,
      target: 80,
      data: layers.integration,
    },
    {
      key: "system",
      label: lang === "vi" ? "Hệ thống" : lang === "en" ? "System" : "System · E2E",
      color: TIER_COLORS.system,
      cov: coverage.flowPct,
      target: 80,
      data: layers.system,
    },
  ];

  const legendItems = [
    {
      x: 12,
      kind: "triad",
      text: lang === "vi" ? "Độ phủ %" : lang === "en" ? "Coverage %" : "Cov · Phủ",
    },
    {
      x: 108,
      kind: "rect",
      fill: SEMANTIC_COLORS.passFill,
      text: lang === "vi" ? "Đạt %" : lang === "en" ? "Pass %" : "Pass · Đạt",
    },
    {
      x: 198,
      kind: "rect",
      fill: SEMANTIC_COLORS.failFill,
      text: lang === "vi" ? "Trượt %" : lang === "en" ? "Fail %" : "Fail · Trượt",
    },
    {
      x: 294,
      kind: "dash",
      fill: SEMANTIC_COLORS.gateStroke,
      text: lang === "vi" ? "Ngưỡng cổng" : lang === "en" ? "Gate target" : "Gate · Ngưỡng",
    },
  ];

  const legendSvg = legendItems
    .map((it) => {
      let swatch;
      if (it.kind === "triad") {
        swatch = `
          <rect x="${it.x}" y="12" width="3.5" height="9" rx="1" fill="${TIER_COLORS.unit}"/>
          <rect x="${it.x + 4}" y="12" width="3.5" height="9" rx="1" fill="${TIER_COLORS.integration}"/>
          <rect x="${it.x + 8}" y="12" width="3.5" height="9" rx="1" fill="${TIER_COLORS.system}"/>
        `;
      } else if (it.kind === "rect") {
        swatch = `<rect x="${it.x}" y="12" width="9" height="9" rx="2" fill="${it.fill}"/>`;
      } else {
        swatch = `<line x1="${it.x + 4}" y1="10" x2="${it.x + 4}" y2="23" stroke="${it.fill}" stroke-width="1.6" stroke-dasharray="3 2"/>`;
      }
      return `${swatch}<text x="${it.x + (it.kind === "triad" ? 15 : 13)}" y="19.5" font-size="8.8" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(it.text)}</text>`;
    })
    .join("");

  const gridSvg = [0, 25, 50, 75, 100]
    .map((pct, idx, arr) => {
      const gx = padL + (pct / 100) * chartW;
      const anchor = idx === 0 ? "start" : idx === arr.length - 1 ? "end" : "middle";
      return `
        <line x1="${gx.toFixed(1)}" y1="${topY}" x2="${gx.toFixed(1)}" y2="${bottomY}" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
        <text x="${gx.toFixed(1)}" y="${bottomY + 14}" text-anchor="${anchor}" font-size="8.8" font-family="${FONT_MONO}" fill="${SEMANTIC_COLORS.muted}">${pct}%</text>
      `;
    })
    .join("");

  const notRunLabel = lang === "vi" ? "Chưa chạy (0)" : lang === "en" ? "Not Run (0)" : "NOT RUN (0)";
  const covPrefix = lang === "vi" ? "Phủ" : "Cov";
  const pTag = lang === "vi" ? "Đ" : "P";
  const fTag = lang === "vi" ? "T" : "F";
  const testsWord = lang === "vi" ? "bài" : "tests";

  const rowsSvg = rows
    .map((r, idx) => {
      const yBase = 52 + idx * 54;
      const targetX = padL + (r.target / 100) * chartW;
      const isNotRun = r.data.state === "NOT_RUN";
      const tierTxt = truncateSvgTextByPx(r.label, 76, 9.8, true, false);
      const countTxt = isNotRun
        ? `0 ${testsWord}`
        : `${fmtCount(r.data.totalTests)} ${testsWord}`;

      if (isNotRun) {
        return `
          <text x="${padL - 8}" y="${yBase + 13}" text-anchor="end" font-size="9.8" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(tierTxt)}</text>
          <text x="${padL - 8}" y="${yBase + 26}" text-anchor="end" font-size="8.5" font-weight="500" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_MONO}">${escapeXml(countTxt)}</text>
          <rect x="${padL}" y="${yBase + 4}" width="${chartW}" height="24" rx="3" fill="${SEMANTIC_COLORS.notRunBg}" stroke="${SEMANTIC_COLORS.notRunStroke}" stroke-width="1.2" stroke-dasharray="4 3"/>
          <line x1="${targetX.toFixed(1)}" y1="${yBase}" x2="${targetX.toFixed(1)}" y2="${yBase + 32}" stroke="${SEMANTIC_COLORS.gateStroke}" stroke-width="1.5" stroke-dasharray="3 2"/>
          <text x="${padL + chartW / 2}" y="${yBase + 19.5}" text-anchor="middle" font-size="8.8" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_SANS}">${escapeXml(notRunLabel)}</text>
          <text x="${padL + chartW + 8}" y="${yBase + 19.5}" text-anchor="start" font-size="9" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_MONO}">— / ${r.target}%</text>
        `;
      }

      const covPct = Math.max(0, Math.min(100, num(r.cov, 0)));
      const covW = covPct > 0 ? Math.max(2, (covPct / 100) * chartW) : 0;

      const totalT = Math.max(1, r.data.totalTests);
      const passShare = Math.max(0, Math.min(1, r.data.passedTests / totalT));
      const failShare = Math.max(0, Math.min(1 - passShare, r.data.failedTests / totalT));
      const skipShare = Math.max(0, Math.min(1 - passShare - failShare, r.data.skippedTests / totalT));

      let passW = passShare > 0 ? Math.max(2, passShare * chartW) : 0;
      let failW = failShare > 0 ? Math.max(2, failShare * chartW) : 0;
      let skipW = skipShare > 0 ? Math.max(2, skipShare * chartW) : 0;
      const sumBarW = passW + failW + skipW;
      if (sumBarW > chartW) {
        let excess = sumBarW - chartW;
        const segs = [
          { key: "p", w: passW },
          { key: "f", w: failW },
          { key: "s", w: skipW },
        ].sort((a, b) => b.w - a.w);
        for (const seg of segs) {
          if (excess <= 0) break;
          const reducible = Math.max(0, seg.w - 2);
          const take = Math.min(reducible, excess);
          seg.w -= take;
          excess -= take;
        }
        passW = segs.find((s) => s.key === "p").w;
        failW = segs.find((s) => s.key === "f").w;
        skipW = segs.find((s) => s.key === "s").w;
      }
      passW = Math.round(passW * 10) / 10;
      failW = Math.round(failW * 10) / 10;
      skipW = Math.round(skipW * 10) / 10;
      if (passW + failW + skipW > chartW) {
        const over = Math.round((passW + failW + skipW - chartW) * 10) / 10;
        if (passW >= failW && passW >= skipW && passW > over) {
          passW = Math.round((passW - over) * 10) / 10;
        } else if (failW >= skipW && failW > over) {
          failW = Math.round((failW - over) * 10) / 10;
        } else if (skipW > over) {
          skipW = Math.round((skipW - over) * 10) / 10;
        }
      }
      const failX = padL + passW;
      const skipX = failX + failW;
      const passPct = num(r.data.passRate, 0);

      const covReadout = truncateSvgTextByPx(
        `${covPrefix} ${covPct.toFixed(1)}% (${r.target}%)`,
        110,
        9,
        true,
        true
      );
      const passReadout = truncateSvgTextByPx(
        `${passPct.toFixed(1)}% (${fmtCount(r.data.passedTests)}${pTag}/${fmtCount(r.data.failedTests)}${fTag})`,
        110,
        8.8,
        true,
        true
      );

      return `
        <text x="${padL - 8}" y="${yBase + 13}" text-anchor="end" font-size="9.8" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(tierTxt)}</text>
        <text x="${padL - 8}" y="${yBase + 26}" text-anchor="end" font-size="8.5" font-weight="500" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_MONO}">${escapeXml(countTxt)}</text>
        <rect x="${padL}" y="${yBase + 3}" width="${chartW}" height="11" rx="2" fill="${SEMANTIC_COLORS.track}"/>
        ${covW > 0 ? `<rect x="${padL}" y="${yBase + 3}" width="${covW.toFixed(1)}" height="11" rx="2" fill="${r.color}"/>` : ""}
        <rect x="${padL}" y="${yBase + 17}" width="${chartW}" height="10" rx="2" fill="${SEMANTIC_COLORS.track}"/>
        ${passW > 0 ? `<rect x="${padL}" y="${yBase + 17}" width="${passW.toFixed(1)}" height="10" rx="2" fill="${SEMANTIC_COLORS.passFill}"/>` : ""}
        ${failW > 0 ? `<rect x="${failX.toFixed(1)}" y="${yBase + 17}" width="${failW.toFixed(1)}" height="10" fill="${SEMANTIC_COLORS.failFill}"/>` : ""}
        ${skipW > 0 ? `<rect x="${skipX.toFixed(1)}" y="${yBase + 17}" width="${skipW.toFixed(1)}" height="10" fill="${SEMANTIC_COLORS.warnFill}"/>` : ""}
        <line x1="${targetX.toFixed(1)}" y1="${yBase}" x2="${targetX.toFixed(1)}" y2="${yBase + 31}" stroke="${SEMANTIC_COLORS.gateStroke}" stroke-width="1.5" stroke-dasharray="3 2"/>
        <text x="${padL + chartW + 8}" y="${yBase + 12}" text-anchor="start" font-size="9" font-weight="700" fill="${r.color}" font-family="${FONT_MONO}">${escapeXml(covReadout)}</text>
        <text x="${padL + chartW + 8}" y="${yBase + 25.5}" text-anchor="start" font-size="8.8" font-weight="600" fill="${r.data.failedTests > 0 ? SEMANTIC_COLORS.failFill : SEMANTIC_COLORS.passFill}" font-family="${FONT_MONO}">${escapeXml(passReadout)}</text>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-id="tier-bar-comparison" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeXml(pickText("Tier Pass, Fail and Coverage Comparison", "So sánh Đạt, Trượt và Độ phủ 3 Tầng", lang))}" style="display:block;max-width:100%;height:auto;">
    <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
    ${legendSvg}
    <line x1="12" y1="32" x2="${width - 12}" y2="32" stroke="${SEMANTIC_COLORS.track}" stroke-width="1"/>
    ${gridSvg}
    ${rowsSvg}
  </svg>`;
}

/**
 * Page-1 Chart 2: Donut Chart (Passed / Failed / Skipped Outcomes + 3-Tier Distribution Share).
 * Native half-width viewBox 460x250.
 */
export function renderTierOutcomeDonutSvg(model, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const { layers, execution } = model;

  const width = 460;
  const height = 250;
  const cx = 104;
  const cy = 128;
  const outerR = 72;
  const innerR = 44;
  const midR = (outerR + innerR) / 2;

  const passed = Math.max(0, num(execution.passed, 0));
  const failed = Math.max(0, num(execution.failed, 0));
  const skipped = Math.max(0, num(execution.skipped, 0));
  const flaky = Math.max(0, num(execution.flaky, 0));
  const sumOutcomes = passed + failed + skipped;
  const totalExec = Math.max(0, num(execution.total, sumOutcomes));

  const polar = (r, angleDeg) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeDonutSlice = (startAngle, endAngle) => {
    const p1 = polar(outerR, startAngle);
    const p2 = polar(outerR, endAngle);
    const p3 = polar(innerR, endAngle);
    const p4 = polar(innerR, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  };

  const rawSlices = [
    {
      key: "passed",
      count: passed,
      color: SEMANTIC_COLORS.passFill,
      label: lang === "vi" ? "Đạt" : "Pass",
    },
    {
      key: "failed",
      count: failed,
      color: SEMANTIC_COLORS.failFill,
      label: lang === "vi" ? "Trượt" : "Fail",
    },
    {
      key: "skipped",
      count: skipped,
      color: SEMANTIC_COLORS.warnFill,
      label: lang === "vi" ? "Bỏ qua" : "Skip",
    },
  ].filter((s) => s.count > 0);

  let donutSvg;
  if (totalExec === 0 || sumOutcomes === 0 || rawSlices.length === 0) {
    const emptySub = lang === "vi" ? "Chưa chạy" : "Not Run";
    donutSvg = `
      <circle cx="${cx}" cy="${cy}" r="${midR}" fill="none" stroke="${SEMANTIC_COLORS.notRunStroke}" stroke-width="${outerR - innerR}" stroke-dasharray="5 4"/>
      <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="18" font-weight="700" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_MONO}">0</text>
      <text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="9" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_SANS}">${escapeXml(emptySub)}</text>
    `;
  } else {
    const passLabel = lang === "vi" ? "đạt" : "pass";
    let slicesMarkup;
    if (rawSlices.length === 1) {
      const only = rawSlices[0];
      const lblPos = polar(midR, 0);
      slicesMarkup = `
        <circle cx="${cx}" cy="${cy}" r="${midR}" fill="none" stroke="${only.color}" stroke-width="${outerR - innerR}"/>
        <text x="${lblPos.x.toFixed(1)}" y="${(lblPos.y + 3.5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#ffffff" font-family="${FONT_MONO}">100%</text>
      `;
    } else {
      const minSweep = 1.8;
      const sliceMetrics = rawSlices.map((s) => {
        const share = s.count / sumOutcomes;
        return { ...s, share, sweep: Math.max(minSweep, share * 360) };
      });
      const totalSweep = sliceMetrics.reduce((acc, s) => acc + s.sweep, 0);
      if (totalSweep > 360) {
        let excess = totalSweep - 360;
        const bySweep = [...sliceMetrics].sort((a, b) => b.sweep - a.sweep);
        for (const s of bySweep) {
          if (excess <= 0) break;
          const reducible = Math.max(0, s.sweep - minSweep);
          const take = Math.min(reducible, excess);
          s.sweep -= take;
          excess -= take;
        }
      }
      let currentAngle = 0;
      slicesMarkup = sliceMetrics
        .map((s) => {
          const start = currentAngle;
          const end = currentAngle + s.sweep;
          currentAngle = end;
          const path = describeDonutSlice(start, end);
          const midAngle = start + s.sweep / 2;
          const lblPos = polar(midR, midAngle);
          const pctText = s.share >= 0.12 ? `<text x="${lblPos.x.toFixed(1)}" y="${(lblPos.y + 3.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff" font-family="${FONT_MONO}">${Math.round(s.share * 100)}%</text>` : "";
          return `<path d="${path}" fill="${s.color}" stroke="#ffffff" stroke-width="0.9"/>${pctText}`;
        })
        .join("");
    }
    const centerRate = execution.passRate !== null ? `${execution.passRate}% ${passLabel}` : "—";
    donutSvg = `
      ${slicesMarkup}
      <text x="${cx}" y="${cy + 1}" text-anchor="middle" font-size="18" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_MONO}">${escapeXml(fmtCount(totalExec))}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_MONO}">${escapeXml(centerRate)}</text>
    `;
  }

  const panelX = 200;
  const panelW = 246;

  const outcomeSummaryChips = [
    {
      x: panelX,
      color: SEMANTIC_COLORS.passFill,
      txt: `${lang === "vi" ? "Đạt" : "Pass"} ${fmtCount(passed)}`,
    },
    {
      x: panelX + 82,
      color: SEMANTIC_COLORS.failFill,
      txt: `${lang === "vi" ? "Trượt" : "Fail"} ${fmtCount(failed)}`,
    },
    {
      x: panelX + 164,
      color: SEMANTIC_COLORS.warnFill,
      txt: `${lang === "vi" ? "Bỏ qua" : "Skip"} ${fmtCount(skipped)}`,
    },
  ]
    .map(
      (c) => `
      <circle cx="${c.x + 4}" cy="20" r="3.8" fill="${c.color}"/>
      <text x="${c.x + 12}" y="23.5" font-size="9" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_MONO}">${escapeXml(c.txt)}</text>
    `
    )
    .join("");

  const tierListHeader =
    lang === "vi"
      ? "Phân bố khối lượng 3 tầng"
      : lang === "en"
        ? "3-Tier Volume & Outcomes"
        : "3-Tier Share · Tỷ trọng 3 Tầng";

  const tierEntries = [
    {
      label: lang === "vi" ? "Đơn vị" : lang === "en" ? "Unit" : "Unit · Đ.vị",
      color: TIER_COLORS.unit,
      data: layers.unit,
    },
    {
      label: lang === "vi" ? "Tích hợp" : lang === "en" ? "Integration" : "Integr. · T.hợp",
      color: TIER_COLORS.integration,
      data: layers.integration,
    },
    {
      label: lang === "vi" ? "Hệ thống" : lang === "en" ? "System (E2E)" : "System · E2E",
      color: TIER_COLORS.system,
      data: layers.system,
    },
  ];

  const tierRowsSvg = tierEntries
    .map((t, idx) => {
      const y = 70 + idx * 48;
      const isNotRun = t.data.state === "NOT_RUN";
      const sharePct = totalExec > 0 && !isNotRun ? (t.data.totalTests / totalExec) * 100 : 0;
      const barFillW = sharePct > 0 ? Math.max(3, (sharePct / 100) * panelW) : 0;

      const pChar = lang === "vi" ? "Đ" : "P";
      const fChar = lang === "vi" ? "T" : "F";
      const sChar = lang === "vi" ? "B" : "S";
      const rightStat = isNotRun
        ? lang === "vi"
          ? "Chưa chạy (0)"
          : "Not Run (0)"
        : `${sharePct.toFixed(0)}% · ${t.data.passedTests}${pChar}/${t.data.failedTests}${fChar}/${t.data.skippedTests}${sChar}`;

      return `
        <circle cx="${panelX + 4}" cy="${y + 4}" r="4" fill="${isNotRun ? SEMANTIC_COLORS.notRunStroke : t.color}"/>
        <text x="${panelX + 13}" y="${y + 7.5}" font-size="9.5" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(t.label)}</text>
        <text x="${panelX + panelW}" y="${y + 7.5}" text-anchor="end" font-size="8.8" font-weight="600" fill="${isNotRun ? SEMANTIC_COLORS.muted : SEMANTIC_COLORS.ink2}" font-family="${FONT_MONO}">${escapeXml(rightStat)}</text>
        ${
          isNotRun
            ? `<rect x="${panelX}" y="${y + 15}" width="${panelW}" height="8" rx="3" fill="${SEMANTIC_COLORS.notRunBg}" stroke="${SEMANTIC_COLORS.notRunStroke}" stroke-width="1" stroke-dasharray="3 2"/>`
            : `<rect x="${panelX}" y="${y + 15}" width="${panelW}" height="8" rx="3" fill="${SEMANTIC_COLORS.track}"/>
               ${barFillW > 0 ? `<rect x="${panelX}" y="${y + 15}" width="${barFillW.toFixed(1)}" height="8" rx="3" fill="${t.color}"/>` : ""}`
        }
      `;
    })
    .join("");

  const flakyNote =
    flaky > 0
      ? lang === "vi"
        ? ` · ${fmtCount(flaky)} chập chờn`
        : lang === "en"
          ? ` · ${fmtCount(flaky)} flaky`
          : ` · ${fmtCount(flaky)} flaky / chập chờn`
      : "";

  const footnoteText =
    execution.uncoveredApis > 0
      ? lang === "vi"
        ? `API chưa phủ (AST): ${fmtCount(execution.uncoveredApis)} (tách khỏi lỗi test)${flakyNote}`
        : lang === "en"
          ? `Untested AST APIs: ${fmtCount(execution.uncoveredApis)} (tracked separately)${flakyNote}`
          : `Untested APIs / API chưa phủ: ${fmtCount(execution.uncoveredApis)}${flakyNote}`
      : totalExec > 0
        ? lang === "vi"
          ? `Tổng thời lượng chạy: ${fmtDuration(execution.durationMs)}${flakyNote}`
          : `Total runtime: ${fmtDuration(execution.durationMs)}${flakyNote}`
        : lang === "vi"
          ? "Chưa ghi nhận bài kiểm thử thực thi"
          : "No executed tests recorded";

  return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-id="tier-outcome-donut" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeXml(pickText("Execution Outcomes and 3-Tier Distribution", "Kết quả Thực thi và Phân bố 3 Tầng", lang))}" style="display:block;max-width:100%;height:auto;">
    <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
    ${donutSvg}
    ${outcomeSummaryChips}
    <line x1="${panelX}" y1="34" x2="${panelX + panelW}" y2="34" stroke="${SEMANTIC_COLORS.track}" stroke-width="1"/>
    <text x="${panelX}" y="52" font-size="9.2" font-weight="700" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(tierListHeader)}</text>
    ${tierRowsSvg}
    <line x1="12" y1="220" x2="${width - 12}" y2="220" stroke="${SEMANTIC_COLORS.track}" stroke-width="1"/>
    <text x="${width - 14}" y="236" text-anchor="end" font-size="8.8" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_MONO}">${escapeXml(truncateSvgTextByPx(footnoteText, 430, 8.8, true, true))}</text>
  </svg>`;
}

/**
 * Page-1 Chart 3: Coverage & Pass-Rate Line Chart (>= 2 runs) OR Baseline Gate Fallback (< 2 runs).
 * Native half-width viewBox 460x250.
 */
export function renderCoveragePassRateTrendSvg(model, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const { trendSeries, coverage, execution, layers } = model;

  const width = 460;
  const height = 250;

  if (Array.isArray(trendSeries) && trendSeries.length >= 2) {
    const pts = trendSeries.slice(-10);
    const padL = 36;
    const padR = 54;
    const padT = 46;
    const padB = 34;
    const chartW = width - padL - padR; // 370px
    const chartH = height - padT - padB; // 170px

    const toX = (idx) => padL + (pts.length <= 1 ? 0 : (idx / (pts.length - 1)) * chartW);
    const toY = (val) =>
      padT + chartH - (Math.max(0, Math.min(100, num(val, 0))) / 100) * chartH;

    const legendRow1 = [
      { x: 12, color: SEMANTIC_COLORS.ink, kind: "solid-dot", label: lang === "vi" ? "Tổng phủ" : "Overall" },
      { x: 108, color: SEMANTIC_COLORS.passFill, kind: "dash-sq", label: lang === "vi" ? "Tỷ lệ đạt" : "Pass Rate" },
      { x: 218, color: SEMANTIC_COLORS.baselineStroke, kind: "dash", label: lang === "vi" ? "Mốc 80%" : "80% Gate" },
    ];
    const legendRow2 = [
      { x: 12, color: TIER_COLORS.unit, label: lang === "vi" ? "Đơn vị" : "Unit" },
      { x: 108, color: TIER_COLORS.integration, label: lang === "vi" ? "Tích hợp" : "Integration" },
      { x: 218, color: TIER_COLORS.system, label: lang === "vi" ? "Hệ thống" : "System" },
    ];

    const legendSvg = [
      ...legendRow1.map((s) => {
        const swatch =
          s.kind === "solid-dot"
            ? `<line x1="${s.x}" y1="14" x2="${s.x + 14}" y2="14" stroke="${s.color}" stroke-width="2.2"/><circle cx="${s.x + 7}" cy="14" r="2.8" fill="${s.color}"/>`
            : s.kind === "dash-sq"
              ? `<line x1="${s.x}" y1="14" x2="${s.x + 14}" y2="14" stroke="${s.color}" stroke-width="1.8" stroke-dasharray="4 2"/><rect x="${s.x + 4.5}" y="11.5" width="5" height="5" fill="${s.color}"/>`
              : `<line x1="${s.x}" y1="14" x2="${s.x + 14}" y2="14" stroke="${s.color}" stroke-width="1.4" stroke-dasharray="3 2"/>`;
        return `${swatch}<text x="${s.x + 18}" y="17.2" font-size="8.6" font-weight="600" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(s.label)}</text>`;
      }),
      ...legendRow2.map(
        (s) =>
          `<line x1="${s.x}" y1="29" x2="${s.x + 14}" y2="29" stroke="${s.color}" stroke-width="1.5"/><circle cx="${s.x + 7}" cy="29" r="2.2" fill="${s.color}"/><text x="${s.x + 18}" y="32" font-size="8.4" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(s.label)}</text>`
      ),
    ].join("");

    const yTicksSvg = [0, 25, 50, 75, 100]
      .map((v) => {
        const y = toY(v);
        return `
          <line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + chartW}" y2="${y.toFixed(1)}" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
          <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8.6" font-family="${FONT_MONO}" fill="${SEMANTIC_COLORS.muted}">${v}%</text>
        `;
      })
      .join("");

    const gateY = toY(80);

    const buildLine = (getter, color, widthPx, dashed = false, markerType = "circle") => {
      const valid = pts
        .map((p, i) => {
          const raw = getter(p);
          if (raw === null || raw === undefined) return null;
          const val = Number(raw);
          if (!Number.isFinite(val)) return null;
          return { x: toX(i), y: toY(val), val };
        })
        .filter(Boolean);

      if (valid.length === 0) return { svg: "", last: null, points: [] };
      const coords = valid.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      const markers = valid
        .map((pt) =>
          markerType === "square"
            ? `<rect x="${(pt.x - 2.6).toFixed(1)}" y="${(pt.y - 2.6).toFixed(1)}" width="5.2" height="5.2" fill="${color}" stroke="#ffffff" stroke-width="0.9"/>`
            : `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${widthPx >= 2 ? "3" : "2.2"}" fill="${color}" stroke="#ffffff" stroke-width="0.9"/>`
        )
        .join("");
      const poly =
        valid.length >= 2
          ? `<polyline fill="none" stroke="${color}" stroke-width="${widthPx}" ${dashed ? 'stroke-dasharray="5 3"' : ""} stroke-linejoin="round" stroke-linecap="round" points="${coords}"/>`
          : "";
      return { svg: `${poly}${markers}`, last: valid[valid.length - 1], points: valid };
    };

    const unitRes = buildLine((p) => p.unitCoverage ?? p.codePct ?? p.unit ?? 0, TIER_COLORS.unit, 1.3);
    const intRes = buildLine((p) => p.integrationCoverage ?? p.apiPct ?? p.integration ?? 0, TIER_COLORS.integration, 1.3);
    const sysRes = buildLine((p) => p.systemCoverage ?? p.flowPct ?? p.system ?? 0, TIER_COLORS.system, 1.3);
    const passRes = buildLine((p) => p.passRate, SEMANTIC_COLORS.passFill, 1.9, true, "square");
    const ovRes = buildLine((p) => p.overallCoverage ?? p.overall ?? p.coveragePct ?? 0, SEMANTIC_COLORS.ink, 2.3, false, "circle");

    // Place 80% gate label cleanly inside the plot without overlapping Y-axis ticks or polylines
    const allSeriesPoints = [unitRes.points, intRes.points, sysRes.points, passRes.points, ovRes.points];
    const boxIntersectsSeries = (bx1, by1, bx2, by2) => {
      for (const sPts of allSeriesPoints) {
        for (let i = 0; i < sPts.length; i += 1) {
          const p = sPts[i];
          if (p.x >= bx1 - 4 && p.x <= bx2 + 4 && p.y >= by1 - 4 && p.y <= by2 + 4) {
            return true;
          }
          if (i + 1 < sPts.length) {
            const q = sPts[i + 1];
            const segMinX = Math.min(p.x, q.x);
            const segMaxX = Math.max(p.x, q.x);
            if (segMaxX < bx1 || segMinX > bx2) continue;
            for (const tx of [bx1, (bx1 + bx2) / 2, bx2]) {
              if (tx < segMinX || tx > segMaxX) continue;
              const t = q.x === p.x ? 0 : (tx - p.x) / (q.x - p.x);
              const sy = p.y + t * (q.y - p.y);
              if (sy >= by1 - 3 && sy <= by2 + 3) return true;
            }
          }
        }
      }
      return false;
    };
    const gateLabelText = "80%";
    const gateCandidates = [
      { x: padL + 6, baselineY: gateY - 3.5 },
      { x: padL + 6, baselineY: gateY + 9.5 },
      { x: padL + chartW - 26, baselineY: gateY - 3.5 },
      { x: padL + chartW - 26, baselineY: gateY + 9.5 },
      { x: padL + chartW * 0.5 - 10, baselineY: gateY - 3.5 },
      { x: padL + chartW * 0.5 - 10, baselineY: gateY + 9.5 },
    ];
    let chosenGatePos = gateCandidates[0];
    for (const cand of gateCandidates) {
      if (!boxIntersectsSeries(cand.x, cand.baselineY - 8, cand.x + 19, cand.baselineY + 1)) {
        chosenGatePos = cand;
        break;
      }
    }
    const gateLineSvg = `
      <line x1="${padL}" y1="${gateY.toFixed(1)}" x2="${padL + chartW}" y2="${gateY.toFixed(1)}" stroke="${SEMANTIC_COLORS.baselineStroke}" stroke-width="1.3" stroke-dasharray="4 3"/>
      <text x="${chosenGatePos.x.toFixed(1)}" y="${chosenGatePos.baselineY.toFixed(1)}" text-anchor="start" font-size="7.8" font-weight="700" font-family="${FONT_MONO}" fill="${SEMANTIC_COLORS.baselineStroke}">${gateLabelText}</text>
    `;

    // End-of-line direct labels with collision avoidance (>= 13px separation at both 0% and 100%)
    const endLabels = [];
    if (ovRes.last) {
      endLabels.push({
        y: ovRes.last.y,
        color: SEMANTIC_COLORS.ink,
        text: `${ovRes.last.val.toFixed(1)}%`,
      });
    }
    if (passRes.last) {
      endLabels.push({
        y: passRes.last.y,
        color: SEMANTIC_COLORS.passFill,
        text: `${passRes.last.val.toFixed(1)}%`,
      });
    }
    if (endLabels.length === 2) {
      const minY = padT + 6;
      const maxY = padT + chartH - 4;
      const minGap = 13;
      endLabels[0].y = Math.max(minY, Math.min(maxY, endLabels[0].y));
      endLabels[1].y = Math.max(minY, Math.min(maxY, endLabels[1].y));
      endLabels.sort((a, b) => a.y - b.y);
      if (endLabels[1].y - endLabels[0].y < minGap) {
        const mid = (endLabels[0].y + endLabels[1].y) / 2;
        let y0 = mid - minGap / 2;
        let y1 = mid + minGap / 2;
        if (y1 > maxY) {
          y1 = maxY;
          y0 = maxY - minGap;
        }
        if (y0 < minY) {
          y0 = minY;
          y1 = minY + minGap;
        }
        endLabels[0].y = Math.max(minY, y0);
        endLabels[1].y = Math.min(maxY, Math.max(endLabels[0].y + minGap, y1));
      }
    }
    const endLabelsSvg = endLabels
      .map(
        (lbl) =>
          `<text x="${padL + chartW + 6}" y="${(lbl.y + 3).toFixed(1)}" text-anchor="start" font-size="8.8" font-weight="700" fill="${lbl.color}" font-family="${FONT_MONO}">${escapeXml(lbl.text)}</text>`
      )
      .join("");

    const maxTicks = 5;
    const step = Math.max(1, Math.ceil((pts.length - 1) / (maxTicks - 1)));
    const xTicksSvg = pts
      .map((p, i) => {
        const isFirst = i === 0;
        const isLast = i === pts.length - 1;
        if (!isFirst && !isLast && i % step !== 0) return "";
        if (!isLast && pts.length - 1 - i < step * 0.55 && !isFirst) return "";
        const anchor = isFirst ? "start" : isLast ? "end" : "middle";
        const label = truncateSvgTextByPx(p.runLabel || p.label || p.snapshotLabel || `#${i + 1}`, 62, 8.5, false, true);
        return `<text x="${toX(i).toFixed(1)}" y="${height - 14}" text-anchor="${anchor}" font-size="8.5" font-family="${FONT_MONO}" fill="${SEMANTIC_COLORS.muted}">${escapeXml(label)}</text>`;
      })
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-id="coverage-passrate-trend" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeXml(pickText("Coverage and Pass-Rate Trend", "Xu hướng Độ phủ và Tỷ lệ Đạt", lang))}" style="display:block;max-width:100%;height:auto;">
      <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
      ${legendSvg}
      <line x1="12" y1="38" x2="${width - 12}" y2="38" stroke="${SEMANTIC_COLORS.track}" stroke-width="1"/>
      ${yTicksSvg}
      ${gateLineSvg}
      ${unitRes.svg}
      ${intRes.svg}
      ${sysRes.svg}
      ${passRes.svg}
      ${ovRes.svg}
      ${endLabelsSvg}
      ${xTicksSvg}
    </svg>`;
  }

  // Fallback (< 2 historical runs): Honest Single-Run Baseline vs. 80% Gate (NO <polyline>)
  const padL = 94;
  const padR = 72;
  const chartW = width - padL - padR; // 294px
  const topY = 44;
  const bottomY = 214;
  const gateX = padL + 0.8 * chartW;

  const badgeText =
    lang === "vi"
      ? "Chưa đủ lịch sử (< 2 lần chạy) — Mốc chuẩn hiện tại so với ngưỡng 80%"
      : lang === "en"
        ? "Baseline Only (< 2 runs) — Current snapshot vs. 80% gate"
        : "Baseline (< 2 runs) · Mốc chuẩn hiện tại (80% gate)";

  const baselineItems = [
    {
      label: lang === "vi" ? "Độ phủ tổng hợp" : "Overall Cov",
      val: execution.total > 0 ? coverage.overall : null,
      color: SEMANTIC_COLORS.ink,
    },
    {
      label: lang === "vi" ? "Tỷ lệ đạt chung" : "Pass Rate",
      val: execution.passRate,
      color: execution.passRate !== null && execution.passRate >= 80 ? SEMANTIC_COLORS.passFill : SEMANTIC_COLORS.failFill,
    },
    {
      label: lang === "vi" ? "Đơn vị (Dòng)" : "Unit Lines",
      val: layers.unit.state === "NOT_RUN" ? null : coverage.codePct,
      color: TIER_COLORS.unit,
    },
    {
      label: lang === "vi" ? "Tích hợp (API)" : "Integr. API",
      val: layers.integration.state === "NOT_RUN" ? null : coverage.apiPct,
      color: TIER_COLORS.integration,
    },
    {
      label: lang === "vi" ? "Hệ thống (E2E)" : "System Flow",
      val: layers.system.state === "NOT_RUN" ? null : coverage.flowPct,
      color: TIER_COLORS.system,
    },
  ];

  const gridSvg = [0, 25, 50, 75, 100]
    .map((pct, idx, arr) => {
      const gx = padL + (pct / 100) * chartW;
      const anchor = idx === 0 ? "start" : idx === arr.length - 1 ? "end" : "middle";
      return `
        <line x1="${gx.toFixed(1)}" y1="${topY}" x2="${gx.toFixed(1)}" y2="${bottomY}" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
        <text x="${gx.toFixed(1)}" y="${bottomY + 15}" text-anchor="${anchor}" font-size="8.6" font-family="${FONT_MONO}" fill="${SEMANTIC_COLORS.muted}">${pct}%</text>
      `;
    })
    .join("");

  const notRunTxt = lang === "vi" ? "Chưa chạy" : "Not Run";
  const rowsSvg = baselineItems
    .map((item, idx) => {
      const y = 52 + idx * 32;
      const lbl = truncateSvgTextByPx(item.label, 82, 9.2, true, false);
      if (item.val === null) {
        return `
          <text x="${padL - 8}" y="${y + 13}" text-anchor="end" font-size="9.2" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(lbl)}</text>
          <rect x="${padL}" y="${y + 3}" width="${chartW}" height="14" rx="2.5" fill="${SEMANTIC_COLORS.notRunBg}" stroke="${SEMANTIC_COLORS.notRunStroke}" stroke-width="1" stroke-dasharray="4 3"/>
          <text x="${padL + chartW / 2}" y="${y + 13}" text-anchor="middle" font-size="8.2" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_SANS}">${escapeXml(notRunTxt)}</text>
          <text x="${padL + chartW + 8}" y="${y + 13.5}" text-anchor="start" font-size="9" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_MONO}">—</text>
        `;
      }
      const v = Math.max(0, Math.min(100, num(item.val, 0)));
      const w = v > 0 ? Math.max(2, (v / 100) * chartW) : 0;
      return `
        <text x="${padL - 8}" y="${y + 13}" text-anchor="end" font-size="9.2" font-weight="600" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(lbl)}</text>
        <rect x="${padL}" y="${y + 3}" width="${chartW}" height="14" rx="2.5" fill="${SEMANTIC_COLORS.track}"/>
        ${w > 0 ? `<rect x="${padL}" y="${y + 3}" width="${w.toFixed(1)}" height="14" rx="2.5" fill="${item.color}"/>` : ""}
        <text x="${padL + chartW + 8}" y="${y + 13.5}" text-anchor="start" font-size="9" font-weight="700" fill="${item.color}" font-family="${FONT_MONO}">${v.toFixed(1)}%</text>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-id="coverage-passrate-trend" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeXml(pickText("Single-Run Baseline vs 80% Gate", "Mốc chuẩn 1 Lần chạy so với Ngưỡng 80%", lang))}" style="display:block;max-width:100%;height:auto;">
    <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
    <rect x="12" y="10" width="${width - 24}" height="22" rx="4" fill="${SEMANTIC_COLORS.notRunBg}" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
    <text x="20" y="24.5" font-size="8.8" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(truncateSvgTextByPx(badgeText, width - 40, 8.8, true, false))}</text>
    ${gridSvg}
    <line x1="${gateX.toFixed(1)}" y1="${topY}" x2="${gateX.toFixed(1)}" y2="${bottomY}" stroke="${SEMANTIC_COLORS.baselineStroke}" stroke-width="1.4" stroke-dasharray="4 3"/>
    <text x="${gateX.toFixed(1)}" y="${topY - 4}" text-anchor="middle" font-size="8" font-weight="700" fill="${SEMANTIC_COLORS.baselineStroke}" font-family="${FONT_MONO}">80%</text>
    ${rowsSvg}
  </svg>`;
}

/**
 * Page-1 Chart 4: 2D Module × 3-Tier Heatmap (top 6 risk-sorted rows + overflow count,
 * or 3-tier readiness heatmap fallback when matrixRows is empty).
 * Native half-width viewBox 460x250.
 */
export function renderModuleTierHeatmapSvg(model, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const { matrixRows, layers } = model;

  const width = 460;
  const height = 250;

  const cellStyle = (status) => {
    const s = String(status || "").toLowerCase();
    if (s === "pass" || s === "passed") {
      return { bg: "#dcfce7", bd: "#16a34a", bw: "1", fg: "#14532d", short: lang === "vi" ? "ĐẠT" : "PASS", dashed: false };
    }
    if (s === "fail" || s === "failed") {
      return { bg: "#ffe4e6", bd: "#e11d48", bw: "1.4", fg: "#881337", short: lang === "vi" ? "TRƯỢT" : "FAIL", dashed: false };
    }
    if (s === "warn" || s === "warning") {
      return { bg: "#fef3c7", bd: "#d97706", bw: "1.1", fg: "#78350f", short: lang === "vi" ? "C.BÁO" : "WARN", dashed: false };
    }
    return { bg: "#f8fafc", bd: "#cbd5e1", bw: "1", fg: "#64748b", short: "—", dashed: true };
  };

  if (Array.isArray(matrixRows) && matrixRows.length > 0) {
    const sorted = sortMatrixRowsByRisk(matrixRows);
    const maxRows = 6;
    const topRows = sorted.slice(0, maxRows);
    const hiddenCount = Math.max(0, matrixRows.length - topRows.length);

    const colHdr = {
      module: lang === "vi" ? "Mô-đun" : "Module",
      unit: lang === "vi" ? "Đơn vị" : "Unit",
      integration: lang === "vi" ? "Tích hợp" : "Integr.",
      system: lang === "vi" ? "Hệ thống" : "System",
      health: lang === "vi" ? "Tổng" : "Health",
    };

    const uCx = 208;
    const iCx = 276;
    const sCx = 344;
    const hCx = 418;
    const startY = 34;
    const rowH = 30;

    const rowsSvg = topRows
      .map((r, idx) => {
        const y = startY + idx * rowH;
        const rowBg = idx % 2 === 1 ? "#f8fafc" : "#ffffff";
        const modName = truncateSvgTextByPx(r.moduleName || "Module", 150, 9.5, true, false);

        const renderTile = (cx, cell) => {
          const st = cellStyle(cell?.status);
          const counts = extractMatrixCellCounts(cell);
          const rawLabel = nfc(cell?.label || "").trim();
          let innerText = st.short;
          if (!st.dashed) {
            if (counts.total > 0 && /^\d+\s*\/\s*\d+$/.test(rawLabel)) {
              innerText = rawLabel;
            } else if (counts.total > 0 && cell?.total != null) {
              innerText = `${counts.passed}/${counts.total}`;
            } else if (rawLabel && rawLabel.length <= 7 && !/not\s*run/i.test(rawLabel)) {
              innerText = rawLabel;
            }
          }
          innerText = truncateSvgTextByPx(innerText, 52, 8.6, true, true);
          return `
            <rect x="${cx - 29}" y="${y + 4}" width="58" height="22" rx="4" fill="${st.bg}" stroke="${st.bd}" stroke-width="${st.bw}" ${st.dashed ? 'stroke-dasharray="3 2"' : ""}/>
            <text x="${cx}" y="${y + 18.2}" text-anchor="middle" font-size="8.6" font-weight="700" fill="${st.fg}" font-family="${FONT_MONO}">${escapeXml(innerText)}</text>
          `;
        };

        const uC = extractMatrixCellCounts(r.unit);
        const iC = extractMatrixCellCounts(r.integration);
        const sC = extractMatrixCellCounts(r.system);
        const sumTotal = uC.total + iC.total + sC.total;
        const sumPassed = uC.passed + iC.passed + sC.passed;
        const sumFailed = uC.failed + iC.failed + sC.failed;
        const hasFail =
          sumFailed > 0 ||
          [r.unit?.status, r.integration?.status, r.system?.status].some((s) =>
            ["fail", "failed"].includes(String(s || "").toLowerCase())
          );
        const hasWarn = [r.unit?.status, r.integration?.status, r.system?.status].some((s) =>
          ["warn", "warning"].includes(String(s || "").toLowerCase())
        );

        const healthTxt = sumTotal > 0 ? `${sumPassed}/${sumTotal}` : "—";
        const healthColor = hasFail
          ? SEMANTIC_COLORS.failFill
          : hasWarn
            ? SEMANTIC_COLORS.warnFill
            : sumTotal > 0
              ? SEMANTIC_COLORS.passFill
              : SEMANTIC_COLORS.muted;

        return `
          <rect x="6" y="${y}" width="${width - 12}" height="${rowH}" fill="${rowBg}"/>
          <text x="12" y="${y + 18.5}" font-size="9.5" font-weight="600" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}" clip-path="url(#ud-hm-mod-clip)">${escapeXml(modName)}</text>
          ${renderTile(uCx, r.unit)}
          ${renderTile(iCx, r.integration)}
          ${renderTile(sCx, r.system)}
          <text x="${hCx}" y="${y + 18.5}" text-anchor="middle" font-size="9" font-weight="700" fill="${healthColor}" font-family="${FONT_MONO}">${escapeXml(healthTxt)}</text>
        `;
      })
      .join("");

    const footerContent =
      hiddenCount > 0
        ? `<text x="12" y="236" font-size="8.8" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_MONO}">${escapeXml(
            lang === "vi"
              ? `+${hiddenCount} mô-đun khác trong bảng Chi tiết ở trang 2`
              : lang === "en"
                ? `+${hiddenCount} more module(s) listed in Page 2 matrix`
                : `+${hiddenCount} more · +${hiddenCount} mô-đun ở trang 2`
          )}</text>`
        : [
            { x: 12, bg: "#dcfce7", bd: "#16a34a", label: lang === "vi" ? "Đạt" : "Pass" },
            { x: 96, bg: "#fef3c7", bd: "#d97706", label: lang === "vi" ? "Cảnh báo" : "Warn" },
            { x: 196, bg: "#ffe4e6", bd: "#e11d48", label: lang === "vi" ? "Trượt" : "Fail" },
            { x: 280, bg: "#f8fafc", bd: "#cbd5e1", dashed: true, label: lang === "vi" ? "Chưa chạy" : "Not Run" },
          ]
            .map(
              (item) => `
              <rect x="${item.x}" y="227" width="10" height="10" rx="2" fill="${item.bg}" stroke="${item.bd}" stroke-width="1" ${item.dashed ? 'stroke-dasharray="2 1.5"' : ""}/>
              <text x="${item.x + 15}" y="235.5" font-size="8.6" font-weight="600" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_SANS}">${escapeXml(item.label)}</text>
            `
            )
            .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-id="module-tier-heatmap" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeXml(pickText("Module by 3-Tier Test Health Heatmap", "Bản đồ nhiệt Sức khỏe Mô-đun theo 3 Tầng", lang))}" style="display:block;max-width:100%;height:auto;">
      <defs>
        <clipPath id="ud-hm-mod-clip">
          <rect x="12" y="30" width="156" height="${height - 46}"/>
        </clipPath>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
      <rect x="1" y="1" width="${width - 2}" height="29" rx="5" fill="${SEMANTIC_COLORS.track}"/>
      <text x="12" y="19.5" font-size="9.2" font-weight="700" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(colHdr.module)}</text>
      <text x="${uCx}" y="19.5" text-anchor="middle" font-size="9.2" font-weight="700" fill="${TIER_COLORS.unit}" font-family="${FONT_SANS}">${escapeXml(colHdr.unit)}</text>
      <text x="${iCx}" y="19.5" text-anchor="middle" font-size="9.2" font-weight="700" fill="${TIER_COLORS.integration}" font-family="${FONT_SANS}">${escapeXml(colHdr.integration)}</text>
      <text x="${sCx}" y="19.5" text-anchor="middle" font-size="9.2" font-weight="700" fill="${TIER_COLORS.system}" font-family="${FONT_SANS}">${escapeXml(colHdr.system)}</text>
      <text x="${hCx}" y="19.5" text-anchor="middle" font-size="9.2" font-weight="700" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(colHdr.health)}</text>
      ${rowsSvg}
      <line x1="12" y1="218" x2="${width - 12}" y2="218" stroke="${SEMANTIC_COLORS.track}" stroke-width="1"/>
      ${footerContent}
    </svg>`;
  }

  // Empty matrix fallback: 3-tier readiness heatmap strip + clear empty-matrix message
  const stateMeta = (st) => {
    if (st === "ALL_PASSING") {
      return { bg: "#dcfce7", bd: "#16a34a", fg: "#14532d", txt: lang === "vi" ? "ĐẠT" : "ALL PASS", dashed: false };
    }
    if (st === "HAS_FAILURES") {
      return { bg: "#ffe4e6", bd: "#e11d48", fg: "#881337", txt: lang === "vi" ? "CÓ LỖI" : "FAILURES", dashed: false };
    }
    return { bg: "#f8fafc", bd: "#cbd5e1", fg: "#64748b", txt: lang === "vi" ? "CHƯA CHẠY" : "NOT RUN", dashed: true };
  };

  const tiles = [
    {
      x: 16,
      title: lang === "vi" ? "Đơn vị" : "Unit",
      color: TIER_COLORS.unit,
      state: layers.unit.state,
      metric:
        layers.unit.state === "NOT_RUN"
          ? "0 / 0"
          : `${layers.unit.passedTests}/${layers.unit.totalTests} · ${layers.unit.coverage.lines.toFixed(1)}%`,
    },
    {
      x: 162,
      title: lang === "vi" ? "Tích hợp" : "Integration",
      color: TIER_COLORS.integration,
      state: layers.integration.state,
      metric:
        layers.integration.state === "NOT_RUN"
          ? `${layers.integration.coverage.uncoveredApis} ${lang === "vi" ? "API chờ" : "APIs wait"}`
          : `${layers.integration.passedTests}/${layers.integration.totalTests} · ${layers.integration.coverage.apiEndpoint.toFixed(1)}%`,
    },
    {
      x: 308,
      title: lang === "vi" ? "Hệ thống" : "System (E2E)",
      color: TIER_COLORS.system,
      state: layers.system.state,
      metric:
        layers.system.state === "NOT_RUN"
          ? "0 / 0"
          : `${layers.system.passedTests}/${layers.system.totalTests} · ${layers.system.coverage.flow.toFixed(1)}%`,
    },
  ];

  const tilesSvg = tiles
    .map((t) => {
      const m = stateMeta(t.state);
      return `
        <rect x="${t.x}" y="44" width="136" height="84" rx="5" fill="${m.bg}" stroke="${m.bd}" stroke-width="1.2" ${m.dashed ? 'stroke-dasharray="4 3"' : ""}/>
        <rect x="${t.x}" y="44" width="136" height="4" rx="2" fill="${t.color}"/>
        <text x="${t.x + 10}" y="66" font-size="10" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(t.title)}</text>
        <text x="${t.x + 10}" y="87" font-size="9.5" font-weight="700" fill="${m.fg}" font-family="${FONT_MONO}">${escapeXml(m.txt)}</text>
        <text x="${t.x + 10}" y="110" font-size="8.8" font-weight="600" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_MONO}">${escapeXml(truncateSvgTextByPx(t.metric, 116, 8.8, true, true))}</text>
      `;
    })
    .join("");

  const emptyHeadline =
    lang === "vi"
      ? "Chưa có dữ liệu ma trận mô-đun trong snapshot này"
      : lang === "en"
        ? "No module-level matrix rows in this snapshot"
        : "No module matrix rows · Chưa có dữ liệu ma trận mô-đun";
  const emptySub =
    lang === "vi"
      ? "Các ô phía trên hiển thị trạng thái sẵn sàng của 3 tầng kiểm thử."
      : lang === "en"
        ? "Top tiles summarize tier readiness; run linked suites to map modules."
        : "Tiles summarize tier readiness · Chạy kiểm thử để lập bản đồ mô-đun.";

  return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-id="module-tier-heatmap" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeXml(pickText("3-Tier Verification Readiness Heatmap", "Bản đồ Sẵn sàng Xác minh 3 Tầng", lang))}" style="display:block;max-width:100%;height:auto;">
    <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#ffffff" stroke="${SEMANTIC_COLORS.grid}" stroke-width="1"/>
    <text x="16" y="25" font-size="9.8" font-weight="700" fill="${SEMANTIC_COLORS.ink}" font-family="${FONT_SANS}">${escapeXml(pickText("3-Tier Readiness Strip", "Trạng thái Sẵn sàng 3 Tầng", lang))}</text>
    ${tilesSvg}
    <rect x="16" y="148" width="${width - 32}" height="82" rx="5" fill="${SEMANTIC_COLORS.notRunBg}" stroke="${SEMANTIC_COLORS.notRunStroke}" stroke-width="1.1" stroke-dasharray="4 3"/>
    <text x="${width / 2}" y="182" text-anchor="middle" font-size="9.8" font-weight="700" fill="${SEMANTIC_COLORS.ink2}" font-family="${FONT_SANS}">${escapeXml(truncateSvgTextByPx(emptyHeadline, width - 56, 9.8, true, false))}</text>
    <text x="${width / 2}" y="204" text-anchor="middle" font-size="8.8" font-weight="500" fill="${SEMANTIC_COLORS.muted}" font-family="${FONT_SANS}">${escapeXml(truncateSvgTextByPx(emptySub, width - 56, 8.8, false, false))}</text>
  </svg>`;
}
