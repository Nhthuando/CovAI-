import test from "node:test";
import assert from "node:assert/strict";
import { adaptUnifiedDashboard } from "./unifiedDashboard.adapter.js";
import {
  DEFAULT_EXPORT_SECTIONS,
  generateMarkdownReport,
  buildFilteredJsonPayload,
  generateHtmlReport,
  generatePdfHtmlReport,
  exportUnifiedDashboardReport,
  exportUnifiedDashboardPdf,
  buildDashboardAiAnalysisPrompt,
} from "./unifiedDashboard.export.js";
import {
  buildReportMetricsModel,
  renderTierBarComparisonSvg,
  renderTierOutcomeDonutSvg,
  renderCoveragePassRateTrendSvg,
  renderModuleTierHeatmapSvg,
} from "./unifiedDashboard.reportDiagrams.js";
import {
  normalizeReportLanguage,
  formatHumanDate,
  pickText,
  translateChecklistItem,
  translateSuspectLayer,
  translateMatrixCellLabel,
  translateHistoryStatus,
} from "./unifiedDashboard.reportI18n.js";

function makePopulatedVm({ withTrend = true, withMatrix = true, extraMatrixRows = 0 } = {}) {
  const baseRows = [
    {
      id: "mod-auth",
      moduleName: "Authentication & Session",
      unit: { status: "pass", label: "18/18", passed: 18, failed: 0, total: 18 },
      integration: { status: "fail", label: "3/4", passed: 3, failed: 1, total: 4 },
      system: { status: "pass", label: "2/2", passed: 2, failed: 0, total: 2 },
      rootCause: { suspectLayer: "integration", summary: "Auth middleware rejects refresh token" },
    },
    {
      id: "mod-checkout",
      moduleName: "Checkout & Payment",
      unit: { status: "fail", label: "22/24", passed: 22, failed: 2, total: 24 },
      integration: { status: "pass", label: "6/6", passed: 6, failed: 0, total: 6 },
      system: { status: "pass", label: "3/3", passed: 3, failed: 0, total: 3 },
      rootCause: { suspectLayer: "unit", summary: "Rounding branch edge case in tax calculation" },
    },
  ];

  const extraRows = Array.from({ length: extraMatrixRows }, (_, i) => ({
    id: `mod-extra-${i + 1}`,
    moduleName: `Catalog Module #${i + 1}`,
    unit: { status: "pass", label: "4/4", passed: 4, failed: 0, total: 4 },
    integration: { status: i === 0 ? "warn" : "pass", label: i === 0 ? "1/2" : "2/2", passed: i === 0 ? 1 : 2, failed: 0, total: 2 },
    system: { status: "pass", label: "1/1", passed: 1, failed: 0, total: 1 },
    rootCause: { suspectLayer: i === 0 ? "integration" : "none", summary: i === 0 ? "Latency threshold warning" : "All checks green" },
  }));

  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-1",
      projectName: "CovAI Commerce",
      branch: "develop",
      snapshotId: "snap-1234567890",
      snapshotLabel: "v2.4.0-rc1",
      updatedAt: "2026-11-26T10:15:00.000Z",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 42,
          passedTests: 40,
          failedTests: 2,
          skippedTests: 0,
          durationMs: 1850,
          avgDurationMs: 44,
          coverageMetrics: { lines: 84.5, branches: 78.2, functions: 88.0, statements: 85.1 },
          lowCoverageItems: [
            { filePath: "src/services/payment.service.js", name: "payment.service.js", branchesPct: 62.5, linesPct: 75.0 },
            { filePath: "src/services/auth.service.js", name: "auth.service.js", branchesPct: 71.0, linesPct: 82.0 },
          ],
        },
        integration: {
          framework: "Supertest",
          totalTests: 12,
          passedTests: 10,
          failedTests: 2,
          skippedTests: 0,
          durationMs: 3200,
          avgDurationMs: 267,
          coverageMetrics: {
            lines: 81.0,
            branches: 74.0,
            functions: 82.0,
            statements: 81.5,
            apiEndpoint: 83.3,
            coveredApis: 10,
            failedApis: 1,
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
          skippedTests: 0,
          flakyTests: 0,
          durationMs: 9400,
          avgDurationMs: 1880,
          coverageMetrics: { lines: 92.0, flow: 90.0 },
          failureDistribution: { selectorNotFound: 0, networkTimeout: 0, assertion: 0, flaky: 0 },
        },
      },
      ai: { aiGenerated: 8, aiRepaired: 3, gaps: 4 },
      matrix: withMatrix ? { rows: [...extraRows, ...baseRows] } : { rows: [] },
      trend: withTrend
        ? {
            series: [
              { runLabel: "Run #10", overallCoverage: 74.2, unitCoverage: 78.0, integrationCoverage: 70.0, systemCoverage: 71.0, passRate: 88.0 },
              { runLabel: "Run #11", overallCoverage: 80.1, unitCoverage: 82.0, integrationCoverage: 78.0, systemCoverage: 78.5, passRate: 91.5 },
              { runLabel: "Run #12", overallCoverage: 85.2, unitCoverage: 84.5, integrationCoverage: 83.3, systemCoverage: 90.0, passRate: 93.2 },
            ],
          }
        : { series: [{ runLabel: "Run #12", overallCoverage: 85.2, unitCoverage: 84.5, integrationCoverage: 83.3, systemCoverage: 90.0, passRate: 93.2 }] },
      history: {
        runs: [
          { id: "run-101", shortId: "run-101", type: "unit", status: "fail", passed: 40, failed: 2, coveragePct: 84.5, durationMs: 1850, commitSha: "abc1234" },
          { id: "run-102", shortId: "run-102", type: "integration", status: "fail", passed: 10, failed: 2, coveragePct: 83.3, durationMs: 3200, commitSha: "abc1234" },
        ],
      },
    },
  });
}

function makePartialVm() {
  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-2",
      projectName: "CovAI Partial",
      branch: "feature/api",
      snapshotId: "snap-partial1",
      snapshotLabel: "partial-check",
    },
    unitRaw: {
      summary: {
        testExecution: { numTotalTests: 20, numPassedTests: 20, numFailedTests: 0, numPendingTests: 0, durationMs: 900 },
        coverage: { lines: 76.4, branches: 68.0, functions: 80.0, statements: 77.0 },
      },
      files: [
        { filePath: "src/core/calc.js", branchesPct: 58.0, linesPct: 72.0 },
      ],
    },
    integrationRaw: {
      endpoints: [
        { id: "ep-1", method: "GET", path: "/api/orders", status: "Uncovered" },
        { id: "ep-2", method: "POST", path: "/api/orders", status: "Uncovered" },
        { id: "ep-3", method: "GET", path: "/api/users", status: "Uncovered" },
      ],
    },
    systemRaw: null,
  });
}

function makeUnrunVm() {
  return adaptUnifiedDashboard({
    context: {
      projectId: "proj-3",
      projectName: "CovAI Fresh",
      branch: "main",
      snapshotId: "snap-unrun00",
      snapshotLabel: "initial",
    },
  });
}

const EXPECTED_PAGE1_DIAGRAM_IDS = [
  "tier-bar-comparison",
  "tier-outcome-donut",
  "coverage-passrate-trend",
  "module-tier-heatmap",
];

function countSvgs(html) {
  return (html.match(/<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || []).length;
}

function getSvgByDiagramId(html, diagramId) {
  const escaped = diagramId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<svg\\b[^>]*data-diagram-id="${escaped}"[\\s\\S]*?<\\/svg>`));
  return match ? match[0] : "";
}

test("populated snapshot exports Page-1 Executive layout with 4 charts, exact parity, and strictly English-only output", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });

  for (const lang of ["en", "vi", "bilingual"]) {
    const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });
    const pdfHtml = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });
    const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });
    const json = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });

    // 1. NFC normalization & zero NaN/undefined leaks
    assert.equal(html, html.normalize("NFC"));
    assert.equal(pdfHtml, pdfHtml.normalize("NFC"));
    assert.equal(md, md.normalize("NFC"));
    assert.ok(!html.includes("NaN"));
    assert.ok(!pdfHtml.includes("NaN"));
    assert.ok(!md.includes("NaN"));
    assert.ok(!html.includes("undefined"));
    assert.ok(!pdfHtml.includes("undefined"));
    assert.ok(!md.includes("undefined"));

    // 2. Plain matching title (<title> === <h1>), no methodology clutter on Page 1
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const h1Match = html.match(/<h1>([^<]+)<\/h1>/);
    assert.ok(titleMatch && h1Match);
    assert.equal(titleMatch[1], h1Match[1]);
    assert.ok(!html.includes('id="sec-layer-guide"'));
    assert.ok(!html.includes('id="sec-methodology"'));

    // 3. Page-1 ordering: Executive Summary -> KPI Strip -> 2x2 Charts Grid
    const execIdx = html.indexOf('id="sec-executive-summary"');
    const kpiIdx = html.indexOf('id="sec-kpi-strip"');
    const chartsIdx = html.indexOf('id="sec-overview-charts"');
    const followupIdx = html.indexOf('class="followup-pages"');
    assert.ok(execIdx > 0 && kpiIdx > execIdx && chartsIdx > kpiIdx && followupIdx > chartsIdx);

    // 4. Exactly 4 half-width-native Page-1 SVGs in HTML and PDF-HTML, zero CDNs, zero gradients
    assert.equal(countSvgs(html), 4);
    assert.equal(countSvgs(pdfHtml), 4);
    for (const id of EXPECTED_PAGE1_DIAGRAM_IDS) {
      const svg = getSvgByDiagramId(html, id);
      const pdfSvg = getSvgByDiagramId(pdfHtml, id);
      assert.ok(svg, `Missing HTML SVG diagram: ${id}`);
      assert.ok(pdfSvg, `Missing PDF SVG diagram: ${id}`);
      assert.ok(svg.includes('viewBox="0 0 460 250"'), `${id} must use half-width-native 460x250 viewBox`);
      const svgPos = html.indexOf(`data-diagram-id="${id}"`);
      assert.ok(svgPos > chartsIdx && svgPos < followupIdx, `${id} must reside on Page 1`);
    }
    assert.ok(!/<script[^>]+src=/i.test(html));
    assert.ok(!/<link[^>]+href="http/i.test(html));
    assert.ok(!/linear-gradient|radial-gradient/i.test(html));
    assert.ok(!/linear-gradient|radial-gradient/i.test(pdfHtml));

    // 5. Print mode strips interactive toolbar, preserves A4 & page-break boundary, and never includes language switcher
    assert.ok(!pdfHtml.includes('class="report-toolbar'));
    assert.ok(pdfHtml.includes("@page { size: A4;"));
    assert.ok(pdfHtml.includes('class="page-one has-followup"'));
    assert.ok(pdfHtml.includes("break-after: page"));
    assert.ok(!html.includes("data-set-lang"));
    assert.ok(!html.includes("Bilingual"));
    assert.ok(!html.includes("Tiếng Việt"));

    // 6. Chart-level requirements
    const barSvg = getSvgByDiagramId(html, "tier-bar-comparison");
    assert.ok(barSvg.includes("#0969da") && barSvg.includes("#8250df") && barSvg.includes("#0d9488"));
    assert.ok(barSvg.includes("#334155"), "Bar chart must use dark-neutral dashed gate line");
    assert.ok(!barSvg.includes("#d97706"), "Bar chart must not use amber target lines");
    assert.ok(barSvg.includes("84.5%") && barSvg.includes("83.3%") && barSvg.includes("90.0%"));

    const donutSvg = getSvgByDiagramId(html, "tier-outcome-donut");
    assert.ok(donutSvg.includes("<path"));
    assert.ok(donutSvg.includes("59") && donutSvg.includes("93.2%"));
    assert.ok(donutSvg.includes("2"));

    const trendSvg = getSvgByDiagramId(html, "coverage-passrate-trend");
    assert.ok(trendSvg.includes("<polyline"), "3-run trend (>= 2) must render polyline trajectory");
    assert.ok(trendSvg.includes("93.2%"), "Trend chart must include passRate readout");
    assert.ok(trendSvg.includes("85.2%"), "Trend chart must include overall coverage readout");
    assert.ok(!trendSvg.includes("#d97706"), "Trend chart must use dark-neutral 80% gate line");

    const heatmapSvg = getSvgByDiagramId(html, "module-tier-heatmap");
    assert.ok(heatmapSvg.includes("Authentication &amp; Session"));
    assert.ok(heatmapSvg.includes("Checkout &amp; Payment"));
    assert.ok(heatmapSvg.includes("18/18") && heatmapSvg.includes("3/4"));

    // 7. Numeric parity across HTML, Markdown, and JSON
    assert.ok(html.includes(String(vm.execution.total)));
    assert.ok(html.includes("84.5%"));
    assert.ok(html.includes("83.3%"));
    assert.ok(html.includes("90.0%"));
    assert.ok(md.includes("84.5%"));
    assert.ok(md.includes("83.3%"));
    assert.ok(md.includes("90.0%"));
    assert.ok(md.includes("payment.service.js"));

    assert.equal(json.reportMeta.schemaVersion, "2.0");
    assert.equal(json.reportMeta.language, "en");
    assert.equal(json.execution.total, vm.execution.total);
    assert.equal(json.execution.passed, vm.execution.passed);
    assert.equal(json.execution.failed, vm.execution.failed);
    assert.equal(json.execution.uncoveredApis, 2);
    assert.equal(json.coverage.codePct, 84.5);
    assert.equal(json.coverage.apiPct, 83.3);
    assert.equal(json.coverage.flowPct, 90.0);
    assert.equal(json.coverageDiagrams.tierBarComparison.length, 3);
    assert.equal(json.coverageDiagrams.tierOutcomeDonut.total, 59);
    assert.equal(json.coverageDiagrams.coveragePassRateTrend.mode, "trend");
    assert.equal(json.coverageDiagrams.moduleTierHeatmap.mode, "heatmap");
  }
});

test("heatmap caps Page-1 rows to top 6 risk-sorted modules and displays +N more indicator when > 6 rows", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true, extraMatrixRows: 6 }); // total = 8 rows
  const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, { language: "en" });
  const json = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS, { language: "en" });

  const heatmapSvg = getSvgByDiagramId(html, "module-tier-heatmap");
  // Risk-sorted: failing modules must appear on Page 1
  assert.ok(heatmapSvg.includes("Authentication &amp; Session"));
  assert.ok(heatmapSvg.includes("Checkout &amp; Payment"));
  assert.ok(heatmapSvg.includes("+2 more module(s)"));
  assert.equal(json.coverageDiagrams.moduleTierHeatmap.totalRows, 8);
  assert.equal(json.coverageDiagrams.moduleTierHeatmap.page1RowsShown, 6);
  // Failing rows must be sorted first in JSON too
  assert.equal(json.coverageDiagrams.moduleTierHeatmap.rows[0].integration.status === "fail" || json.coverageDiagrams.moduleTierHeatmap.rows[0].unit.status === "fail", true);
});

test("6+ trend runs render multi-run polyline trajectory with passRate and 80% dark-neutral gate", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });
  vm.trend.series = [
    { runLabel: "Run #7", overallCoverage: 62.0, unitCoverage: 68.0, integrationCoverage: 55.0, systemCoverage: 58.0, passRate: 80.0 },
    { runLabel: "Run #8", overallCoverage: 66.5, unitCoverage: 71.0, integrationCoverage: 61.0, systemCoverage: 63.5, passRate: 84.0 },
    { runLabel: "Run #9", overallCoverage: 70.2, unitCoverage: 74.0, integrationCoverage: 66.0, systemCoverage: 67.0, passRate: 86.0 },
    { runLabel: "Run #10", overallCoverage: 74.2, unitCoverage: 78.0, integrationCoverage: 70.0, systemCoverage: 71.0, passRate: 88.0 },
    { runLabel: "Run #11", overallCoverage: 80.1, unitCoverage: 82.0, integrationCoverage: 78.0, systemCoverage: 78.5, passRate: 91.5 },
    { runLabel: "Run #12", overallCoverage: 85.2, unitCoverage: 84.5, integrationCoverage: 83.3, systemCoverage: 90.0, passRate: 93.2 },
  ];
  const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, { language: "en" });
  const trendSvg = getSvgByDiagramId(html, "coverage-passrate-trend");
  assert.ok(trendSvg.includes("<polyline"));
  assert.ok(trendSvg.includes("85.2%"));
  assert.ok(trendSvg.includes("93.2%"));
});

test("single-point trend (< 2 runs) renders clean baseline fallback without polyline, and empty matrix renders readiness heatmap", () => {
  const vm = makePopulatedVm({ withTrend: false, withMatrix: false });
  const html = generateHtmlReport(vm);
  const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS);
  const json = buildFilteredJsonPayload(vm);

  assert.equal(countSvgs(html), 4);
  const trendSvg = getSvgByDiagramId(html, "coverage-passrate-trend");
  assert.ok(!trendSvg.includes("<polyline"), "Single-run fallback must NOT render a fake polyline");
  assert.ok(trendSvg.includes("Baseline Only (&lt; 2 runs)") || trendSvg.includes("Baseline Only (< 2 runs)"));

  const heatmapSvg = getSvgByDiagramId(html, "module-tier-heatmap");
  assert.ok(heatmapSvg.includes("3-Tier Readiness Strip"));
  assert.ok(heatmapSvg.includes("No module-level matrix rows"));

  assert.equal(json.coverageDiagrams.coveragePassRateTrend.mode, "baseline");
  assert.equal(json.coverageDiagrams.moduleTierHeatmap.mode, "readiness");

  assert.ok(md.includes("Low-Coverage Code Hotspots"));
  assert.ok(md.includes("src/services/payment.service.js"));
  assert.ok(md.includes("API Endpoint Coverage Breakdown"));
  assert.ok(md.includes("| 10 | 1 | 2 | 12 | 83.3% |"));
});

test("partial snapshot clearly marks unrun layers as NOT_RUN, handles 100% single-slice donut, and isolates uncoveredApis", () => {
  const vm = makePartialVm();
  const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS);
  const json = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS);

  assert.equal(countSvgs(html), 4);
  assert.equal(json.execution.total, 20);
  assert.equal(json.execution.failed, 0);
  assert.equal(json.execution.uncoveredApis, 3);
  assert.equal(json.layerDefinitions.unit.state, "ALL_PASSING");
  assert.equal(json.layerDefinitions.integration.state, "NOT_RUN");
  assert.equal(json.layerDefinitions.system.state, "NOT_RUN");

  const barSvg = getSvgByDiagramId(html, "tier-bar-comparison");
  assert.ok(barSvg.includes("Not Run (0)"));
  const donutSvg = getSvgByDiagramId(html, "tier-outcome-donut");
  assert.ok(donutSvg.includes("100%"), "Single 100%-passing slice must render complete ring with 100% label");
  assert.ok(donutSvg.includes("Untested AST APIs: 3"));
  assert.ok(md.includes("NOT RUN"));
  assert.ok(!md.includes("Chưa chạy"));
  assert.ok(!html.includes("NaN"));
});

test("completely unrun snapshot renders UNVERIFIED/NOT_RUN cleanly with 4 SVG charts and zero NaN", () => {
  const vm = makeUnrunVm();
  const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  const pdfHtml = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS);
  const json = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS);

  assert.equal(countSvgs(html), 4);
  assert.equal(countSvgs(pdfHtml), 4);
  assert.equal(json.execution.total, 0);
  assert.equal(json.health.score, null);
  assert.equal(json.coverageDiagrams.coveragePassRateTrend.mode, "baseline");

  const donutSvg = getSvgByDiagramId(html, "tier-outcome-donut");
  assert.ok(donutSvg.includes('stroke-dasharray="5 4"'), "0-test donut must render dashed neutral ring");
  assert.ok(html.includes("UNVERIFIED"));
  assert.ok(pdfHtml.includes("Unverified"));
  assert.ok(!pdfHtml.includes("Chưa xác minh"));
  assert.ok(md.includes("NOT RUN"));
  assert.ok(!html.includes("NaN"));
  assert.ok(!pdfHtml.includes("NaN"));
  assert.ok(!md.includes("NaN"));
});

test("backward-compatible 2-argument section filtering works for ExportReportModal callers", () => {
  const vm = makePopulatedVm();
  const partialSections = {
    executive: true,
    pyramidPillars: false,
    traceMatrix: false,
    actionCenter: false,
    trendsHistory: false,
  };

  const pdfHtml = generatePdfHtmlReport(vm, partialSections);
  const md = generateMarkdownReport(vm, partialSections);
  const json = buildFilteredJsonPayload(vm, partialSections);

  assert.ok(pdfHtml.includes('id="sec-executive-summary"'));
  assert.ok(!pdfHtml.includes('class="charts-page-two has-followup"'), "No trailing page break when follow-up sections are all disabled");
  assert.ok(!pdfHtml.includes('id="sec-key-findings"'));
  assert.ok(md.includes("Executive Summary"));
  assert.ok(!md.includes("Critical Gaps & Failures"));
  assert.ok(json.executiveSummary);
  assert.equal(json.matrix, undefined);
  assert.equal(json.actions, undefined);
});

test("exportUnifiedDashboardReport, exportUnifiedDashboardPdf, and buildDashboardAiAnalysisPrompt execute cleanly", async () => {
  const vm = makePopulatedVm();
  const prompt = buildDashboardAiAnalysisPrompt(vm);
  assert.ok(prompt.includes("CovAI Commerce"));
  assert.ok(prompt.includes("Authentication & Session"));

  const downloads = [];
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  try {
    let printed = false;
    let afterPrintHandler = null;
    const fakeBodyChildren = [];
    const fakeIframeWin = {
      document: {
        open() {},
        write(str) {
          this.writtenHtml = str;
        },
        close() {},
        fonts: { ready: Promise.resolve() },
      },
      requestAnimationFrame(cb) {
        cb();
      },
      focus() {},
      print() {
        printed = true;
        afterPrintHandler?.();
      },
      addEventListener(ev, fn) {
        if (ev === "afterprint") afterPrintHandler = fn;
      },
      removeEventListener() {},
    };

    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.document = {
      body: {
        appendChild(el) {
          fakeBodyChildren.push(el);
        },
        removeChild(el) {
          const idx = fakeBodyChildren.indexOf(el);
          if (idx >= 0) fakeBodyChildren.splice(idx, 1);
        },
      },
      createElement(tag) {
        if (tag === "iframe") {
          return {
            style: {},
            setAttribute() {},
            contentWindow: fakeIframeWin,
            get parentNode() {
              return fakeBodyChildren.includes(this) ? globalThis.document.body : null;
            },
          };
        }
        return {
          style: {},
          click() {
            downloads.push({ href: this.href, download: this.download });
          },
        };
      },
    };
    URL.createObjectURL = (blob) => `blob://mock/${blob.type}`;
    URL.revokeObjectURL = () => {};

    const htmlFile = exportUnifiedDashboardReport(vm, "html", DEFAULT_EXPORT_SECTIONS, { language: "bilingual" });
    const mdFile = exportUnifiedDashboardReport(vm, "markdown", DEFAULT_EXPORT_SECTIONS, { language: "vi" });
    const jsonFile = exportUnifiedDashboardReport(vm, "json", DEFAULT_EXPORT_SECTIONS, { language: "en" });

    assert.ok(htmlFile.endsWith(".html"));
    assert.ok(mdFile.endsWith(".md"));
    assert.ok(jsonFile.endsWith(".json"));
    assert.equal(downloads.length, 3);

    const pdfStarted = exportUnifiedDashboardPdf(vm, DEFAULT_EXPORT_SECTIONS, { language: "vi" });
    assert.equal(pdfStarted, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(printed, true);
    assert.ok(fakeIframeWin.document.writtenHtml.includes("Unit Tests"));
    assert.ok(!fakeIframeWin.document.writtenHtml.includes("Kiểm thử Đơn vị"));
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("hardening: long unspaced strings, wide SVG glyphs, and missing action fields never leak undefined or overflow", () => {
  const vm = makePopulatedVm({ withTrend: false, withMatrix: true });
  vm.context.projectName = "CovAI_Long_Unspaced_Enterprise_Monorepo_Microservices_Dashboard_Identifier_v2026_Production";
  vm.context.branch = "feature/unspaced_very_long_branch_name_regression_verification_identifier_without_spaces_2026";
  vm.pyramid = {
    ...vm.pyramid,
    badgeTitle: "W".repeat(44),
  };
  vm.matrix = {
    rows: [
      {
        id: "mod-wide-w",
        moduleName: "W".repeat(30),
        unit: { status: "pass", label: "10/10" },
        integration: { status: "warn", label: "2/4" },
        system: { status: "fail", label: "1/2" },
        rootCause: { suspectLayer: "system", summary: "Wide W module stress test" },
      },
      {
        id: "mod-wide-m",
        moduleName: "M".repeat(30),
        unit: { status: "warn", label: "5/6" },
        integration: { status: "pass", label: "4/4" },
        system: { status: "pass", label: "2/2" },
        rootCause: { suspectLayer: "unit", summary: "Wide M module stress test" },
      },
    ],
  };
  vm.actions = {
    items: [{ title: "Run unit tests" }],
  };

  for (const lang of ["bilingual", "en", "vi"]) {
    const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });
    const pdfHtml = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });
    const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });
    const json = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS, { language: lang });

    assert.ok(!html.includes("undefined"), `HTML (${lang}) must not contain literal undefined`);
    assert.ok(!pdfHtml.includes("undefined"), `PDF HTML (${lang}) must not contain literal undefined`);
    assert.ok(!md.includes("undefined"), `Markdown (${lang}) must not contain literal undefined`);
    assert.ok(!JSON.stringify(json.executiveSummary).includes("undefined"));
    assert.ok(!html.includes("NaN"));
    assert.ok(!md.includes("NaN"));

    assert.ok(html.includes("overflow-wrap: anywhere"));
    assert.ok(html.includes("min-width: 0"));
    assert.equal(countSvgs(html), 4);

    // Heatmap clips & truncates wide 30-char W/M module names before Unit column
    const heatmapSvg = getSvgByDiagramId(html, "module-tier-heatmap");
    assert.ok(heatmapSvg.includes('id="ud-hm-mod-clip"'));
    assert.ok(!heatmapSvg.includes("W".repeat(25)), "Heatmap must truncate wide 30-char W module names");
    assert.ok(!heatmapSvg.includes("M".repeat(25)), "Heatmap must truncate wide 30-char M module names");
  }
});

test("markdown escaping: pipe characters inside table cells do not split columns", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });
  vm.pillars.unit.framework = "Jest|Vitest";
  vm.matrix.rows[0].moduleName = "Auth | Session | OAuth";
  vm.matrix.rows[0].rootCause.summary = "Header | Token | Refresh mismatch";
  vm.history.runs[0].shortId = "run|101";
  vm.history.runs[0].commitSha = "abc|def";

  const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS, { language: "en" });
  const lines = md.split("\n");

  const checkTableRows = (headerStartsWith, expectedPipes) => {
    const headerIdx = lines.findIndex((l) => l.startsWith(headerStartsWith));
    assert.ok(headerIdx >= 0, `Missing table header: ${headerStartsWith}`);
    for (let i = headerIdx; i < lines.length && lines[i].startsWith("|"); i += 1) {
      const unescapedPipes = lines[i].replace(/\\\|/g, "XX").split("|").length - 1;
      assert.equal(unescapedPipes, expectedPipes, `Row broke columns: ${lines[i]}`);
    }
  };

  checkTableRows("| Layer |", 8);
  checkTableRows("| Run |", 7);
  checkTableRows("| Module |", 6);
  checkTableRows("| Run ID |", 8);
});

test("English-only purity: zero Vietnamese text, bilingual duplication, or language-switcher UI even with legacy options", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });
  const viPattern = /(Đơn vị|Tích hợp|Hệ thống|Đạt|Trượt|Bỏ qua|Chưa chạy|Mô-đun|Ngưỡng|Tổng phủ|Tóm tắt|Khoảng trống|Phương pháp|Tiếng Việt|Bilingual|In \/ Lưu PDF)/i;

  for (const lang of [undefined, "en", "vi", "bilingual"]) {
    const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, lang ? { language: lang } : {});
    const pdfHtml = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS, lang ? { language: lang } : {});
    const md = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS, lang ? { language: lang } : {});
    const jsonStr = JSON.stringify(buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS, lang ? { language: lang } : {}));

    for (const [label, out] of [
      ["html", html],
      ["pdfHtml", pdfHtml],
      ["md", md],
      ["json", jsonStr],
    ]) {
      assert.ok(!viPattern.test(out), `${label} (${lang}) leaked Vietnamese or bilingual token`);
    }

    assert.ok(html.includes("Executive Summary"));
    assert.ok(html.includes("3-Tier Statistical Overview"));
    assert.ok(html.includes("Print / Save PDF"));
    assert.ok(!html.includes("data-set-lang"));
    assert.ok(!html.includes("data-lang="));
    assert.ok(!html.includes("Language:"));
  }

  const unrunHtml = generateHtmlReport(makeUnrunVm(), DEFAULT_EXPORT_SECTIONS, { language: "vi" });
  assert.ok(unrunHtml.includes("NOT RUN"));
  assert.ok(unrunHtml.includes("Unverified"));
  assert.ok(!viPattern.test(unrunHtml));
});

test("regression: trend 80% gate label avoids Y-axis 75% tick and 0%/100% end labels stay >= 13px apart", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: false });
  vm.trend.series = [
    { runLabel: "R1", overallCoverage: 10, unitCoverage: 10, integrationCoverage: 10, systemCoverage: 10, passRate: 20 },
    { runLabel: "R2", overallCoverage: 0, unitCoverage: 0, integrationCoverage: 0, systemCoverage: 0, passRate: 0 },
  ];
  const zeroTrendSvg = renderCoveragePassRateTrendSvg(buildReportMetricsModel(vm), "en");

  // Gate label must NOT sit in left Y-axis tick column (x = 30) alongside 75%
  assert.ok(!/<text x="30"[^>]*>80<\/text>/.test(zeroTrendSvg), "80 gate label must not share Y-axis tick column with 75%");
  const gateTextMatch = zeroTrendSvg.match(/<text x="([0-9.]+)" y="([0-9.]+)"[^>]*>80%<\/text>/);
  assert.ok(gateTextMatch, "Trend SVG must render 80% gate label inside plot");
  assert.ok(Number(gateTextMatch[1]) >= 36, "80% gate label must be inside plot area (x >= padL)");

  // Both 0.0% end labels at x=412 must have >= 13px vertical separation
  const zeroEndMatches = [...zeroTrendSvg.matchAll(/<text x="412" y="([0-9.]+)"[^>]*>0\.0%<\/text>/g)].map((m) =>
    Number(m[1])
  );
  assert.equal(zeroEndMatches.length, 2);
  assert.ok(Math.abs(zeroEndMatches[1] - zeroEndMatches[0]) >= 13, `0.0% end labels collided: ${zeroEndMatches}`);

  // Top boundary (100% / 100%) must also maintain >= 13px separation
  vm.trend.series = [
    { runLabel: "R1", overallCoverage: 80, unitCoverage: 80, integrationCoverage: 80, systemCoverage: 80, passRate: 80 },
    { runLabel: "R2", overallCoverage: 100, unitCoverage: 100, integrationCoverage: 100, systemCoverage: 100, passRate: 100 },
  ];
  const topTrendSvg = renderCoveragePassRateTrendSvg(buildReportMetricsModel(vm), "en");
  const topEndMatches = [...topTrendSvg.matchAll(/<text x="412" y="([0-9.]+)"[^>]*>100\.0%<\/text>/g)].map((m) =>
    Number(m[1])
  );
  assert.equal(topEndMatches.length, 2);
  assert.ok(Math.abs(topEndMatches[1] - topEndMatches[0]) >= 13, `100.0% end labels collided: ${topEndMatches}`);
});

test("regression: donut and bar charts do not double-count flakyTests into skipped", () => {
  const vm = adaptUnifiedDashboard({
    context: { projectId: "p-flaky", projectName: "FlakyProj", branch: "main", snapshotId: "s-flaky" },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 10,
          passedTests: 10,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 400,
          coverageMetrics: { lines: 90, branches: 85, functions: 90, statements: 90 },
        },
        integration: {
          framework: "Supertest",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          coverageMetrics: { totalApis: 0, uncoveredApis: 0 },
        },
        system: {
          framework: "Playwright",
          totalTests: 5,
          passedTests: 5,
          failedTests: 0,
          skippedTests: 0,
          flakyTests: 2,
          durationMs: 1200,
          coverageMetrics: { lines: 85, flow: 85 },
        },
      },
    },
  });

  const model = buildReportMetricsModel(vm);
  const donutEn = renderTierOutcomeDonutSvg(model);
  const barEn = renderTierBarComparisonSvg(model);

  assert.ok(donutEn.includes("Skip 0"), "Donut must show Skip 0 when skippedTests is 0 and flakyTests is 2");
  assert.ok(!donutEn.includes("Skip 2"), "Donut must not add flakyTests into Skip");
  assert.ok(!donutEn.includes("<path"), "100% passing suite with flakyTests must remain a full 100% ring");
  assert.ok(donutEn.includes("2 flaky"), "Donut footnote must display non-additive flaky annotation");
  assert.ok(!barEn.includes("#b45309"), "Bar chart must not render amber skip segment for flakyTests when skippedTests === 0");
});

test("regression: bar chart clamps stacked pass/fail/skip segments inside track (<= 336) and formats large counts", () => {
  const vm = adaptUnifiedDashboard({
    context: { projectId: "p-bar", projectName: "BarClamp", branch: "main", snapshotId: "s-bar" },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Jest",
          totalTests: 1000,
          passedTests: 998,
          failedTests: 1,
          skippedTests: 1,
          durationMs: 1000,
          coverageMetrics: { lines: 99.5, branches: 95, functions: 99, statements: 99.5 },
        },
        integration: {
          framework: "Supertest",
          totalTests: 12000,
          passedTests: 11990,
          failedTests: 10,
          skippedTests: 0,
          durationMs: 2000,
          coverageMetrics: { apiEndpoint: 90, coveredApis: 9, failedApis: 1, uncoveredApis: 0, totalApis: 10 },
        },
        system: {
          framework: "Playwright",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          coverageMetrics: { lines: 0, flow: 0 },
        },
      },
    },
  });

  const barSvg = renderTierBarComparisonSvg(buildReportMetricsModel(vm), "en");
  // Check every rect starting in track (x >= 88 && width < 400) ends at <= 336 (padL 88 + chartW 248)
  const rectMatches = [...barSvg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)"/g)];
  for (const m of rectMatches) {
    const x = Number(m[1]);
    const w = Number(m[3]);
    if (x >= 88 && w < 400) {
      assert.ok(x + w <= 336.05, `Bar rect overflowed track: x=${x}, width=${w}, end=${x + w}`);
    }
  }
  assert.ok(barSvg.includes("11,990P/10F") || barSvg.includes("11.990P/10F"), "Bar passReadout must format counts via fmtCount");
});

test("regression: English Markdown date formatting, onlyActions omits empty Page-1 break, and footnote renders cleanly", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });
  vm.context.updatedAt = new Date().toISOString();
  vm.actions = {
    items: [{ priority: "high", pillar: "unit", title: "Fix branch gap", targetName: "calc.js" }],
  };

  const mdRecent = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS);
  assert.ok(!/\bago\b/i.test(mdRecent), `Markdown leaked relative time: ${mdRecent.slice(0, 300)}`);
  assert.ok(!mdRecent.includes("Never") && !mdRecent.includes("Unknown date"));
  assert.ok(mdRecent.includes("Updated:"));

  const vmNoUpdated = makeUnrunVm();
  vmNoUpdated.context.updatedAt = null;
  const mdNull = generateMarkdownReport(vmNoUpdated, DEFAULT_EXPORT_SECTIONS);
  assert.ok(mdNull.includes("Not recorded"));
  assert.ok(!mdNull.includes("Never") && !/\bago\b/i.test(mdNull));

  const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  assert.ok(html.includes(">HIGH<"), "Actions must uppercase priority badge");

  // onlyActions filter must NOT emit empty .page-one.has-followup or .page1-footnote
  const onlyActionsSections = {
    executive: false,
    pyramidPillars: false,
    traceMatrix: false,
    actionCenter: true,
    trendsHistory: false,
  };
  const onlyActionsPdf = generatePdfHtmlReport(vm, onlyActionsSections);
  assert.ok(!onlyActionsPdf.includes('class="page-one has-followup"'), "onlyActions must not force a blank Page 1 break");
  assert.ok(!onlyActionsPdf.includes('class="page1-footnote"'), "onlyActions must not emit Page-1 footnote when Page-1 content is absent");
  assert.ok(onlyActionsPdf.includes('id="sec-actions"'));

  const pdfDoc = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  assert.ok(pdfDoc.includes('<div class="page1-footnote">'));
  assert.ok(pdfDoc.includes("Note: Layers marked NOT RUN"));
});

test("R1 & R2: HTML and Print/PDF reports lift 13pt constraint, use sans/mono typography, and prevent mid-word wrapping in tables and badges", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });
  const html = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  const pdfHtml = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);

  for (const doc of [html, pdfHtml]) {
    assert.ok(!doc.includes("Times New Roman"), "Times New Roman must be replaced with clean sans/mono pairing");
    assert.ok(!doc.includes("font-size: 13pt;"), "Fixed 13pt base font-size constraint must be lifted");
    assert.ok(doc.includes("--font-sans:"), "CSS must define clean sans-serif font stack");
    assert.ok(doc.includes("--font-mono:"), "CSS must define monospace font stack");
    assert.ok(doc.includes("font-variant-numeric: tabular-nums"), "Numeric cells must preserve tabular-nums");
    assert.ok(doc.includes("table-layout: fixed"), "Tables must use deterministic column sizing");
    assert.ok(doc.includes("<colgroup>"), "Tables must specify explicit colgroup column proportions");
    assert.match(doc, /th,\s*td\s*\{[^}]*overflow-wrap:\s*normal;\s*word-break:\s*normal;/, "Table headers and cells must not break mid-word by default");
    assert.match(doc, /\.badge\s*\{[^}]*white-space:\s*nowrap;/, "Status badges must not wrap mid-word");
    assert.match(doc, /\.matrix-pill\s*\{[^}]*overflow-wrap:\s*break-word;\s*word-break:\s*normal;/, "Matrix pills must wrap at word boundaries and break unspaced oversized tokens instead of overflowing");
  }

  // Print flow & A4 max-2-charts-per-page stack rules
  assert.ok(pdfHtml.includes(".table-wrap { overflow-x: visible;"));
  assert.match(pdfHtml, /\.charts-stack\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.ok(!pdfHtml.includes("charts-grid-2x2"), "Report must not cram 4 charts into a 2x2 grid");
  assert.match(pdfHtml, /\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  const mediaPrintBlock = pdfHtml.match(/@media print\s*\{([\s\S]*?)\n\s*\}\s*\n\s*<\/style>/);
  assert.ok(mediaPrintBlock, "Print/PDF must include @media print CSS block");
  assert.match(mediaPrintBlock[1], /\.charts-stack\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.match(mediaPrintBlock[1], /\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.ok(pdfHtml.includes("break-after: page;"));

  // All 4 SVG diagrams use clean sans/mono fonts without 13pt override and retain 460x250 viewBox
  for (const id of EXPECTED_PAGE1_DIAGRAM_IDS) {
    const svg = getSvgByDiagramId(html, id);
    assert.ok(!svg.includes("Times New Roman"), `${id} SVG must not use Times New Roman`);
    assert.ok(!svg.includes('font-size="13pt"'), `${id} SVG must lift 13pt constraint`);
    assert.ok(svg.includes('viewBox="0 0 460 250"'), `${id} SVG must keep 460x250 viewBox`);
  }
});

test("R2: reproduces & verifies fixes for Screenshot 1-3 bugs (Core Module 0/1, separated pass vs coverage, zero-API diagnosis & hidden 0-row API table) in English", () => {
  const screenshotVm = adaptUnifiedDashboard({
    context: {
      projectId: "proj-consent",
      projectName: "Cookie Consent Manager",
      branch: "main",
      snapshotId: "snap-consent-1",
      snapshotLabel: "#1 (abc1234)",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Vitest",
          totalTests: 225,
          passedTests: 223,
          failedTests: 2,
          skippedTests: 0,
          durationMs: 1450,
          coverageMetrics: { lines: 98.9, branches: 96.2, functions: 95.0, statements: 98.8 },
          lowCoverageItems: [
            { filePath: "src/core/lawDeterminer.ts", branchesPct: 100, linesPct: 98.7, functionsPct: 100 },
            { filePath: "src/presets/index.ts", branchesPct: 100, linesPct: 99.4, functionsPct: 100 },
            { filePath: "src/core/cdnDetection.ts", branchesPct: 100, linesPct: 100, functionsPct: 100 },
            { filePath: "src/core/complianceReport.ts", branchesPct: 100, linesPct: 100, functionsPct: 100 },
          ],
          coverageFiles: [
            { filePath: "src/core/lawDeterminer.ts", branchesPct: 100, linesPct: 98.7, functionsPct: 100 },
            { filePath: "src/presets/index.ts", branchesPct: 100, linesPct: 99.4, functionsPct: 100 },
            { filePath: "src/core/cdnDetection.ts", branchesPct: 100, linesPct: 100, functionsPct: 100 },
            { filePath: "src/core/complianceReport.ts", branchesPct: 100, linesPct: 100, functionsPct: 100 },
          ],
        },
        integration: {
          framework: "Supertest",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          coverageMetrics: { totalApis: 0, coveredApis: 0, failedApis: 0, uncoveredApis: 0, apiEndpoint: 0 },
        },
        system: {
          framework: "Playwright",
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          coverageMetrics: { lines: 0, flow: 0 },
        },
      },
      matrix: {
        rows: [
          {
            id: "mod-consent",
            moduleName: "Consent Module",
            unit: { status: "fail", label: "44/45 passed (100%)", passed: 44, failed: 1, total: 45 },
            integration: { status: "untested", label: "0/0 APIs", passed: 0, failed: 0, total: 0 },
            system: { status: "untested", label: "0/0 Journeys", passed: 0, failed: 0, total: 0 },
            rootCause: { suspectLayer: "unit", summary: "Unit test assertion failure" },
          },
          {
            id: "mod-law",
            moduleName: "Law Module",
            unit: { status: "pass", label: "54/54 passed (98.7%)", passed: 54, failed: 0, total: 54 },
            integration: { status: "untested", label: "0/0 APIs", passed: 0, failed: 0, total: 0 },
            system: { status: "untested", label: "0/0 Journeys", passed: 0, failed: 0, total: 0 },
            rootCause: { suspectLayer: "integration", summary: "API coverage gap" },
          },
          {
            id: "mod-core",
            moduleName: "Core Module",
            unit: { status: "pass", label: "99.4% lines · 100% branch", passed: 0, failed: 0, total: 1 },
            integration: { status: "untested", label: "0/0 APIs", passed: 0, failed: 0, total: 0 },
            system: { status: "untested", label: "0/0 Journeys", passed: 0, failed: 0, total: 0 },
            rootCause: { suspectLayer: "integration", summary: "API coverage gap" },
          },
        ],
      },
    },
  });

  const enHtml = generateHtmlReport(screenshotVm, DEFAULT_EXPORT_SECTIONS);
  const enPdf = generatePdfHtmlReport(screenshotVm, DEFAULT_EXPORT_SECTIONS);
  const enMd = generateMarkdownReport(screenshotVm, DEFAULT_EXPORT_SECTIONS);
  const json = buildFilteredJsonPayload(screenshotVm, DEFAULT_EXPORT_SECTIONS);

  // 1. Screenshot 1 fix: Heatmap for Core Module must NOT emit 0/1; must show 99.4%
  const heatmap = getSvgByDiagramId(enHtml, "module-tier-heatmap");
  assert.ok(!heatmap.includes(">0/1<"), "Core Module Heatmap must never display 0/1");
  assert.ok(heatmap.includes(">99.4%<"), "Core Module Heatmap tile & Health column must display 99.4%");

  // 2. Screenshot 2 fix: Separated pass rate vs line coverage in English
  assert.ok(!enHtml.includes("44/45 passed (100%)"));
  assert.ok(!enHtml.includes("54/54 passed (98.7%)"));
  assert.ok(enHtml.includes("44/45 passed (97.8%) · 100% lines"), "Consent Module must separate pass rate from 100% lines");
  assert.ok(enHtml.includes("54/54 passed (100%) · 98.7% lines"), "Law Module must separate 100% pass rate from 98.7% lines");
  assert.ok(enHtml.includes("99.4% lines · 100% branch"));
  assert.ok(enMd.includes("44/45 passed (97.8%) · 100% lines"));

  // 3. Screenshot 2 fix: 0/0 APIs must NEVER diagnose "API coverage gap"
  for (const out of [enHtml, enPdf, enMd]) {
    assert.ok(!out.includes("API coverage gap"), "0/0 API modules must never receive 'API coverage gap' diagnosis");
  }
  assert.ok(!JSON.stringify(json.coverageDiagrams.moduleTierHeatmap.rows).includes("API coverage gap"));

  // 4. Screenshot 3 fix: totalApis === 0 hides 0-row AST API Summary table and shows explicit note
  assert.ok(!enHtml.includes("<td><strong>Endpoints</strong></td>"), "0-row AST API table must be hidden in HTML");
  assert.ok(!enMd.includes("| Total AST APIs |"), "0-row AST API table must be hidden in Markdown");
  assert.ok(enHtml.includes("No AST API endpoints were discovered"));
  assert.ok(enMd.includes("No AST API endpoints were discovered"));

  // 5. Screenshot 3 fix: 100%-covered files (cdnDetection.ts, complianceReport.ts) excluded from Low-Coverage table
  assert.ok(enHtml.includes("src/core/lawDeterminer.ts"));
  assert.ok(enHtml.includes("src/presets/index.ts"));
  assert.ok(!enHtml.includes("src/core/cdnDetection.ts"), "100%-covered file must be excluded");
  assert.ok(!enHtml.includes("src/core/complianceReport.ts"), "100%-covered file must be excluded");
  assert.ok(!enMd.includes("src/core/cdnDetection.ts"));
  assert.equal(json.coverageDiagrams.moduleTierHeatmap.unitLowCoverageItems.length, 2);
});

test("R3: Low-Coverage Hotspot table includes Functions column, removes 4-5 row cap, excludes 100% all-3-metric files, and preserves Top-4 on-screen UI", () => {
  const rawFiles = [
    { filePath: "src/a.ts", branchesPct: 40.0, linesPct: 55.0, funcsPct: 50.0 },
    { filePath: "src/b.ts", branchesPct: 60.0, linesPct: 70.0, funcsPct: 75.0 },
    { filePath: "src/c.ts", branchesPct: 70.0, linesPct: 80.0, funcsPct: 85.0 },
    { filePath: "src/d.ts", branchesPct: 78.0, linesPct: 88.0, funcsPct: 90.0 },
    { filePath: "src/e.ts", branchesPct: 85.0, linesPct: 92.0, funcsPct: 95.0 },
    { filePath: "src/f.ts", branchesPct: 100.0, linesPct: 98.5, funcsPct: 100.0 },
    { filePath: "src/g-func-only.ts", branchesPct: 100.0, linesPct: 100.0, funcsPct: 80.0 },
    { filePath: "src/h-perfect.ts", branchesPct: 100.0, linesPct: 100.0, funcsPct: 100.0 },
    { filePath: "src/i-perfect.ts", branchesPct: 100.0, linesPct: 100.0, funcsPct: 100.0 },
  ];

  const vm = adaptUnifiedDashboard({
    context: {
      projectId: "proj-r3",
      projectName: "Full Coverage Export",
      branch: "main",
      snapshotId: "snap-r3-1",
    },
    unitRaw: {
      summary: {
        testExecution: { numTotalTests: 50, numPassedTests: 50, numFailedTests: 0, numPendingTests: 0, durationMs: 500 },
        coverage: { lines: 89.0, branches: 81.0, functions: 87.0, statements: 90.0 },
      },
      files: rawFiles,
    },
  });

  // On-screen UI contract: lowCoverageItems remains capped at 4
  assert.equal(vm.pillars.unit.lowCoverageItems.length, 4);
  // Report contract: coverageFiles carries all 9 files with functionsPct
  assert.equal(vm.pillars.unit.coverageFiles.length, 9);
  assert.equal(vm.pillars.unit.coverageFiles[0].functionsPct, 50.0);

  const enHtml = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  const enPdf = generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  const enMd = generateMarkdownReport(vm, DEFAULT_EXPORT_SECTIONS);
  const json = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS);

  // Functions column headers present across HTML, Print/PDF, and Markdown
  assert.ok(enHtml.includes("<th>Functions</th>"));
  assert.ok(enPdf.includes("<th>Functions</th>"));
  assert.ok(enMd.includes("| Function Coverage |"));

  // All 7 files with < 100% on Branches, Lines, OR Functions are listed (no 4-5 cap!)
  for (const expectedPath of [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/d.ts",
    "src/e.ts",
    "src/f.ts",
    "src/g-func-only.ts",
  ]) {
    assert.ok(enHtml.includes(expectedPath), `HTML missing <100% file: ${expectedPath}`);
    assert.ok(enPdf.includes(expectedPath), `PDF missing <100% file: ${expectedPath}`);
    assert.ok(enMd.includes(expectedPath), `Markdown missing <100% file: ${expectedPath}`);
  }
  assert.ok(enHtml.includes("80.0%"), "HTML must include Functions coverage 80.0% for g-func-only.ts");

  // 100% on all 3 metrics must be excluded everywhere
  for (const excludedPath of ["src/h-perfect.ts", "src/i-perfect.ts"]) {
    assert.ok(!enHtml.includes(excludedPath), `HTML must exclude 100%-covered file: ${excludedPath}`);
    assert.ok(!enPdf.includes(excludedPath), `PDF must exclude 100%-covered file: ${excludedPath}`);
    assert.ok(!enMd.includes(excludedPath), `Markdown must exclude 100%-covered file: ${excludedPath}`);
  }

  // JSON includes all 7 filtered files with functionsPct
  const jsonItems = json.coverageDiagrams.moduleTierHeatmap.unitLowCoverageItems;
  assert.equal(jsonItems.length, 7);
  assert.equal(jsonItems.find((x) => x.filePath === "src/g-func-only.ts")?.functionsPct, 80.0);

  // Legacy partial mocks without functionsPct render "—" (never "0.0%") and exclude 100%/100% files
  const partialVm = makePartialVm();
  partialVm.pillars.unit.coverageFiles = [
    { filePath: "src/legacy-low.js", branchesPct: 90, linesPct: 100, functionsPct: null },
    { filePath: "src/legacy-full.js", branchesPct: 100, linesPct: 100, functionsPct: null },
  ];
  const partialHtml = generateHtmlReport(partialVm, DEFAULT_EXPORT_SECTIONS);
  assert.ok(partialHtml.includes("src/legacy-low.js"));
  assert.ok(!partialHtml.includes("src/legacy-full.js"));
  assert.ok(partialHtml.includes(">—<"), "Missing functionsPct must render '—', never '0.0%'");

  // All 100%-covered unit files render graceful explicit notice
  const allPerfectVm = makePartialVm();
  allPerfectVm.pillars.unit.coverageFiles = [
    { filePath: "src/perfect.js", branchesPct: 100, linesPct: 100, functionsPct: 100 },
  ];
  const allPerfectHtml = generateHtmlReport(allPerfectVm, DEFAULT_EXPORT_SECTIONS);
  const allPerfectMd = generateMarkdownReport(allPerfectVm, DEFAULT_EXPORT_SECTIONS);
  assert.ok(allPerfectHtml.includes("100.0% coverage across Branches, Lines, and Functions"));
  assert.ok(allPerfectMd.includes("100.0% coverage across Branches, Lines, and Functions"));
});

test("report language is strictly English-only across helpers, SVGs, HTML, PDF, Markdown, and JSON", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });
  const defaultHtml = generateHtmlReport(vm);
  const defaultPdfHtml = generatePdfHtmlReport(vm);
  const defaultMd = generateMarkdownReport(vm);
  const defaultJson = buildFilteredJsonPayload(vm);

  assert.equal(normalizeReportLanguage(), "en");
  assert.equal(normalizeReportLanguage("vi"), "en");
  assert.equal(normalizeReportLanguage("bilingual"), "en");
  assert.equal(defaultJson.reportMeta.language, "en");
  assert.ok(defaultHtml.includes('data-report-lang="en"'));
  assert.ok(defaultPdfHtml.includes('data-report-lang="en"'));
  assert.ok(defaultHtml.includes("Executive Summary"));
  assert.ok(defaultPdfHtml.includes("Executive Summary"));
  assert.ok(!defaultHtml.includes("Tóm tắt Điều hành"));
  assert.ok(!defaultPdfHtml.includes("Tóm tắt Điều hành"));
  assert.ok(!defaultMd.includes("Tóm tắt Điều hành"));

  // Direct i18n helper calls remain strictly English-only regardless of extra arguments
  const defaultDate = formatHumanDate(new Date("2026-11-27T00:00:00Z"));
  assert.ok(!defaultDate.includes("(") && !defaultDate.includes("27/11/2026"), `formatHumanDate() must be English-only: ${defaultDate}`);
  assert.equal(pickText("Unit Tests", "Kiểm thử Đơn vị"), "Unit Tests");
  assert.equal(pickText("Unit Tests", "Kiểm thử Đơn vị", "bilingual"), "Unit Tests");
  assert.equal(pickText("Unit Tests", "Kiểm thử Đơn vị", "vi"), "Unit Tests");
  assert.deepEqual(translateChecklistItem({ id: "chk-api-endpoint", currentValue: "60%" }), {
    label: "API Endpoint Coverage >= 80%",
    currentValue: "60%",
  });
  assert.equal(translateSuspectLayer("integration", "vi"), "integration");
  assert.equal(translateMatrixCellLabel("10/12 passed (83.3%)", "fail"), "10/12 passed (83.3%) · 83.3% lines");
  assert.equal(translateMatrixCellLabel("0/0 (Not run)", "untested"), "0/0 (Not run)");
  assert.equal(translateHistoryStatus("PASS", "vi"), "PASS");

  // Direct SVG renderer calls remain English-only
  const model = buildReportMetricsModel(vm);
  const partialModel = buildReportMetricsModel(makePartialVm());
  const defaultBarSvg = renderTierBarComparisonSvg(partialModel);
  const defaultDonutSvg = renderTierOutcomeDonutSvg(partialModel);
  const defaultTrendSvg = renderCoveragePassRateTrendSvg(model);
  const defaultTrendBaselineSvg = renderCoveragePassRateTrendSvg(partialModel);
  const defaultHeatmapSvg = renderModuleTierHeatmapSvg(model);
  const defaultHeatmapEmptySvg = renderModuleTierHeatmapSvg(partialModel);

  for (const [name, svg] of [
    ["tierBar", defaultBarSvg],
    ["outcomeDonut", defaultDonutSvg],
    ["trend", defaultTrendSvg],
    ["trendBaseline", defaultTrendBaselineSvg],
    ["heatmap", defaultHeatmapSvg],
    ["heatmapEmpty", defaultHeatmapEmptySvg],
  ]) {
    assert.ok(!/(Đơn vị|Tích hợp|Hệ thống|Đạt|Trượt|Bỏ qua|Chưa chạy|Mô-đun|Ngưỡng|Tổng phủ)/i.test(svg), `${name} SVG leaked Vietnamese: ${svg}`);
  }
  assert.ok(defaultBarSvg.includes("Coverage %") && defaultBarSvg.includes("Not Run (0)"));
  assert.ok(defaultDonutSvg.includes("Execution Mix") && defaultDonutSvg.includes("3-Tier Volume &amp; Outcomes"));
  assert.ok(defaultTrendSvg.includes("Overall") && defaultTrendSvg.includes("Pass Rate"));
  assert.ok(defaultHeatmapSvg.includes("Module") && defaultHeatmapSvg.includes("Health"));

  const biJson = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS, { language: "bilingual" });
  const viJson = buildFilteredJsonPayload(vm, DEFAULT_EXPORT_SECTIONS, { language: "vi" });
  assert.equal(biJson.reportMeta.language, "en");
  assert.equal(viJson.reportMeta.language, "en");
});

test("R3: Each chart page renders at most 2 large full-width SVGs (2 on Page 1, 2 on Page 2) for HTML and Print/PDF", () => {
  const vm = makePopulatedVm({ withTrend: true, withMatrix: true });

  for (const [modeName, doc] of [
    ["html", generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS)],
    ["pdf", generatePdfHtmlReport(vm, DEFAULT_EXPORT_SECTIONS)],
  ]) {
    const pageOneStart = doc.indexOf('<div class="page-one');
    const pageTwoStart = doc.indexOf('<div class="charts-page-two');
    const followupStart = doc.indexOf('<div class="followup-pages">');
    assert.ok(
      pageOneStart > 0 && pageTwoStart > pageOneStart && followupStart > pageTwoStart,
      `${modeName} missing .page-one / .charts-page-two / .followup-pages boundaries`,
    );
    const pageOneSlice = doc.slice(pageOneStart, pageTwoStart);
    const pageTwoSlice = doc.slice(pageTwoStart, followupStart);

    assert.ok(pageOneSlice.includes('id="sec-overview-charts"'), `${modeName} missing overview charts section in .page-one`);
    assert.ok(pageOneSlice.includes('class="charts-stack"'), `${modeName} missing single-column charts stack in .page-one`);
    assert.ok(pageTwoSlice.includes('id="sec-overview-charts-2"'), `${modeName} missing second charts section in .charts-page-two`);
    assert.ok(pageTwoSlice.includes('class="charts-stack"'), `${modeName} missing single-column charts stack in .charts-page-two`);
    assert.ok(!doc.includes('class="charts-grid-2x2"'), `${modeName} must not use cramped 2x2 grid`);
    assert.ok(pageOneSlice.includes('class="sec-sub"'), `${modeName} missing overviewChartsSubtitle`);
    assert.ok(pageOneSlice.includes('class="chart-takeaway-box"'), `${modeName} missing aligned chart takeaway divider box`);

    // Strictly at most 2 charts per page container
    assert.equal(countSvgs(pageOneSlice), 2, `${modeName} Page 1 must render exactly 2 charts`);
    assert.equal(countSvgs(pageTwoSlice), 2, `${modeName} Page 2 must render exactly 2 charts`);
    assert.ok(getSvgByDiagramId(pageOneSlice, "tier-bar-comparison"), `${modeName} missing tier-bar-comparison on Page 1`);
    assert.ok(getSvgByDiagramId(pageOneSlice, "tier-outcome-donut"), `${modeName} missing tier-outcome-donut on Page 1`);
    assert.ok(getSvgByDiagramId(pageTwoSlice, "coverage-passrate-trend"), `${modeName} missing coverage-passrate-trend on Page 2`);
    assert.ok(getSvgByDiagramId(pageTwoSlice, "module-tier-heatmap"), `${modeName} missing module-tier-heatmap on Page 2`);

    for (const id of EXPECTED_PAGE1_DIAGRAM_IDS) {
      const svg = getSvgByDiagramId(doc, id);
      assert.ok(svg, `${modeName} missing ${id}`);
      assert.ok(svg.includes('viewBox="0 0 460 250"'), `${id} must retain 460x250 viewBox`);
      assert.ok(svg.includes('stroke="none"'), `${id} outer background rect must avoid double border inside .chart-card`);
    }

    // Verify single-column charts-stack & 4-col KPI rules remain intact in CSS
    assert.match(doc, /\.charts-stack\s*\{[^}]*grid-template-columns:\s*1fr;/);
    assert.match(doc, /\.kpi-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
    assert.ok(!/linear-gradient|radial-gradient/i.test(doc), `${modeName} must contain zero gradients`);
  }

  // Interactive HTML must separate chart pages cleanly (non-zero gap + subtle divider)
  const htmlDoc = generateHtmlReport(vm, DEFAULT_EXPORT_SECTIONS);
  assert.match(htmlDoc, /\.page-one\.has-followup,\s*\.charts-page-two\.has-followup\s*\{[^}]*margin-bottom:\s*18px;[^}]*padding-bottom:\s*14px;[^}]*border-bottom:\s*1px solid var\(--border-soft\);/);

  // Trend SVG 80% gate label avoids series crossing 80% near Run #1 and keeps white halo
  const crossVm = makePopulatedVm({ withTrend: true, withMatrix: false });
  crossVm.trend.series = [
    { runLabel: "Run #1", overallCoverage: 45, unitCoverage: 78, integrationCoverage: 0, systemCoverage: 0, passRate: 80 },
    { runLabel: "Run #2", overallCoverage: 50, unitCoverage: 100, integrationCoverage: 0, systemCoverage: 0, passRate: 88.5 },
  ];
  const crossTrendSvg = renderCoveragePassRateTrendSvg(buildReportMetricsModel(crossVm));
  const crossGateMatch = crossTrendSvg.match(/<text x="([0-9.]+)" y="([0-9.]+)"[^>]*paint-order="stroke"[^>]*>80%<\/text>/);
  assert.ok(crossGateMatch, "Trend SVG 80% gate label must include white stroke halo for legibility");
  assert.ok(Number(crossGateMatch[1]) > 100, `80% gate label must avoid Run #1 crossing at x=${crossGateMatch[1]}`);

  // Regression: Executed (P/F/S/Total) uses <wbr> slash boundaries + wrap-cell, and Quality Gate / History cells guard against unspaced overflow
  assert.ok(htmlDoc.includes("40/<wbr>2/<wbr>0/<wbr>42"), "Executed column must allow clean wrapping at / boundaries for large counts");
  assert.ok(htmlDoc.includes('<td class="mono wrap-cell">run-101</td>'));
  assert.ok(htmlDoc.includes('<td class="mono wrap-cell">UNIT</td>'));
});

test("R2 Parity: fifa-wc2026-stadium-ai live Unit metrics (97.6% lines, 99.4% branches, 98.1% fn, 0.2s) pass Branch Gate across all 4 formats", () => {
  const fifaVm = adaptUnifiedDashboard({
    context: {
      projectId: "proj-fifa",
      projectName: "fifa-wc2026-stadium-ai",
      branch: "main",
      snapshotId: "snap-4b775ba",
      snapshotLabel: "#1 (4b775ba)",
    },
    unifiedBackendRaw: {
      pillars: {
        unit: {
          framework: "Vitest",
          totalTests: 108,
          passedTests: 106,
          failedTests: 2,
          skippedTests: 0,
          durationMs: 200,
          coverageMetrics: { lines: 97.6, branches: 99.4, functions: 98.1, statements: 97.6 },
        },
        integration: { framework: "Express", totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0, coverage: { apiEndpoint: 0, totalApis: 0, coveredApis: 0, uncoveredApis: 0 } },
        system: { framework: "Playwright", totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 },
      },
      matrix: { rows: [] },
      trend: { series: [] },
    },
  });

  const html = generateHtmlReport(fifaVm, DEFAULT_EXPORT_SECTIONS);
  const pdf = generatePdfHtmlReport(fifaVm, DEFAULT_EXPORT_SECTIONS);
  const md = generateMarkdownReport(fifaVm, DEFAULT_EXPORT_SECTIONS);
  const json = buildFilteredJsonPayload(fifaVm, DEFAULT_EXPORT_SECTIONS);

  for (const doc of [html, pdf, md]) {
    assert.ok(doc.includes("97.6%"), "Must report exact 97.6% lines");
    assert.ok(doc.includes("99.4%"), "Must report exact 99.4% branches (not 72.9%)");
    assert.ok(doc.includes("98.1%"), "Must report exact 98.1% functions (not 99.3%)");
    assert.ok(doc.includes("0.2s"), "Must report 0.2s suite duration (not 1ms)");
  }
  assert.ok(html.includes("Lines 97.6% · Branch 99.4% · Fn 98.1% · Stmt 97.6%"));
  assert.ok(pdf.includes("Lines 97.6% · Branch 99.4% · Fn 98.1% · Stmt 97.6%"));
  const branchGate = json.qualityGate.checklist.find((c) => /branch/i.test(c.label));
  assert.ok(branchGate && branchGate.passed === true, "Unit Branch Coverage >= 75% must be PASSED at 99.4%");
  assert.equal(json.layerDefinitions.unit.metrics.coverage.branches, 99.4);
  assert.equal(json.layerDefinitions.unit.metrics.coverage.functions, 98.1);
});
