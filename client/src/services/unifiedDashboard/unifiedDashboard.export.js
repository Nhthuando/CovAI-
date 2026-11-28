import { fmtPct, fmtCount, fmtDuration } from "./format.js";
import { UNIFIED_DASHBOARD_CONFIG } from "./unifiedDashboard.config.js";
import {
  nfc,
  normalizeReportLanguage,
  formatHumanDate,
  translateGateStatus,
  translatePyramidShape,
  translateChecklistItem,
  translateSuspectLayer,
  translateMatrixCellLabel,
  translateHistoryStatus,
  LAYER_GUIDES,
  METHODOLOGY_ITEMS,
  FAILURE_CATEGORY_LABELS,
  REPORT_COPY,
} from "./unifiedDashboard.reportI18n.js";
import {
  buildReportMetricsModel,
  extractMatrixCellCounts,
  sortMatrixRowsByRisk,
  renderTierBarComparisonSvg,
  renderTierOutcomeDonutSvg,
  renderCoveragePassRateTrendSvg,
  renderModuleTierHeatmapSvg,
} from "./unifiedDashboard.reportDiagrams.js";

export const DEFAULT_EXPORT_SECTIONS = {
  executive: true,
  pyramidPillars: true,
  traceMatrix: true,
  actionCenter: true,
  trendsHistory: true,
};

const SECTION_KEYS = Object.keys(DEFAULT_EXPORT_SECTIONS);

function resolveSectionsAndOptions(sectionsOrOptions, maybeOptions) {
  let sections = { ...DEFAULT_EXPORT_SECTIONS };
  let options = {};

  if (sectionsOrOptions && typeof sectionsOrOptions === "object") {
    const hasSectionKey = SECTION_KEYS.some((k) => k in sectionsOrOptions);
    if (hasSectionKey) {
      sections = { ...DEFAULT_EXPORT_SECTIONS, ...sectionsOrOptions };
      if (maybeOptions && typeof maybeOptions === "object") {
        options = { ...maybeOptions };
      }
    } else {
      options = { ...sectionsOrOptions, ...(maybeOptions || {}) };
    }
  } else if (maybeOptions && typeof maybeOptions === "object") {
    options = { ...maybeOptions };
  }

  return {
    sections,
    options: {
      language: normalizeReportLanguage(options.language),
      printMode: Boolean(options.printMode),
    },
  };
}

function escapeHtml(value) {
  return nfc(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMarkdownCell(value) {
  return nfc(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n+/g, " ")
    .trim();
}

function safeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatSuiteDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms)) || ms < 0) {
    return "—";
  }
  const val = Number(ms);
  if (val >= 100 && val < 1000) {
    return `${(val / 1000).toFixed(1)}s`;
  }
  return fmtDuration(val);
}

function formatIntegrationDurationCell(intLayer) {
  if (!intLayer || intLayer.state === "NOT_RUN") return "—";
  const base = formatSuiteDuration(intLayer.durationMs);
  const avgEp = Number(intLayer.avgEndpointLatencyMs ?? 0);
  if (avgEp > 0) {
    return `${base} (avg ${fmtDuration(avgEp)}/ep)`;
  }
  return base;
}

function formatSystemFlowShort(layers, coverage) {
  if (layers.system.state === "NOT_RUN") return "Not Run";
  if (layers.system.coverage?.coverageAvailable && layers.system.coverage.flow !== null) {
    return fmtPct(coverage.flowPct);
  }
  return "Pending";
}

function resolveDisplayRootCause(row) {
  const intCounts = extractMatrixCellCounts(row?.integration);
  const rawSummary = nfc(row?.rootCause?.summary || "");
  const rawLayer = row?.rootCause?.suspectLayer || "none";
  const isZeroApiGap =
    intCounts.total === 0 && rawSummary.toLowerCase().includes("api coverage gap");
  if (isZeroApiGap || rawSummary === "Unit verified (no APIs)") {
    return {
      summary: REPORT_COPY.notices.unitVerifiedNoApis.en,
      suspectLayer: "none",
    };
  }
  return {
    summary: rawSummary || "—",
    suspectLayer: rawLayer,
  };
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([nfc(content)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

function formatLayerStateBadge(state) {
  if (state === "ALL_PASSING") {
    return { tone: "pass", text: "ALL PASSING" };
  }
  if (state === "HAS_FAILURES") {
    return { tone: "fail", text: "HAS FAILURES" };
  }
  return { tone: "neutral", text: "NOT RUN" };
}

function resolveStatusClass(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PASS" || s === "PASSED" || s === "COMPLETED" || s === "ALL_PASSING" || s === "SUCCESS") {
    return "badge-pass";
  }
  if (s === "FAIL" || s === "FAILED" || s === "BLOCKED" || s === "HAS_FAILURES" || s === "ERROR") {
    return "badge-fail";
  }
  if (s === "WARN" || s === "WARNING" || s === "PARTIAL" || s === "INCOMPLETE" || s === "RUNNING" || s === "QUEUED" || s === "PROCESSING") {
    return "badge-warn";
  }
  return "badge-neutral";
}

function formatAiEvalScoreText(aiEval) {
  if (!aiEval?.hasRun || aiEval.status === "NOT_RUN") return "Not Run";
  if (aiEval.scoreHidden) return "Hidden (Partial)";
  if (aiEval.score !== null && aiEval.score !== undefined) {
    return `${Number(aiEval.score).toFixed(1)}/100`;
  }
  return "—";
}

function formatAiEvalVerdictLabel(aiEval) {
  if (!aiEval?.hasRun || aiEval.status === "NOT_RUN") return "NOT RUN";
  const st = String(aiEval.status || "").toUpperCase();
  if (["QUEUED", "RUNNING", "PROCESSING"].includes(st)) return st;
  if (["ERROR", "FAILED", "CANCELLED", "CANCELED"].includes(st)) return st === "CANCELED" ? "CANCELLED" : st;
  return String(aiEval.verdict || "INCOMPLETE").toUpperCase();
}

function renderStatusBadgeHtml(status, label) {
  const s = String(status || "").toUpperCase();
  const cls = resolveStatusClass(s);
  return `<span class="badge ${cls}">${escapeHtml(label || s || "N/A")}</span>`;
}

function renderMatrixPillHtml(status, label) {
  const s = String(status || "").toUpperCase();
  const cls = resolveStatusClass(s);
  return `<span class="matrix-pill ${cls}">${escapeHtml(label || s || "N/A")}</span>`;
}

function buildExecutiveBullets(vm, model) {
  const ctx = vm?.context || {};
  const project = nfc(ctx.projectName || "Project");
  const { layers, execution, coverage, health, qualityGate, pyramid, actionItems, ai } = model;
  const gateInfo = translateGateStatus(qualityGate.status, qualityGate.label);
  const pyrInfo = translatePyramidShape(pyramid.shape, pyramid.badgeTitle, pyramid.warning);

  const unrunEn = [];
  if (layers.unit.state === "NOT_RUN") unrunEn.push("Unit");
  if (layers.integration.state === "NOT_RUN") unrunEn.push("Integration");
  if (layers.system.state === "NOT_RUN") unrunEn.push("System");

  const bullet1 = {
    enTopic: "Release Verdict:",
    enBody:
      execution.total === 0
        ? `${project} is ${gateInfo.en} with 0 executed tests; run suites to establish a Health Score baseline.`
        : `${project} is ${gateInfo.en} with Health Score ${health.score ?? "—"}/100 (Grade ${health.grade ?? "—"}).`,
  };

  const bullet2 = {
    enTopic: "3-Tier Execution:",
    enBody:
      execution.total === 0
        ? `Unit (0), Integration (0), and System (0) are NOT RUN.${execution.uncoveredApis > 0 ? ` ${execution.uncoveredApis} AST APIs await integration tests.` : ""}`
        : `${fmtCount(execution.total)} tests ran (${execution.passRate}% pass: ${fmtCount(execution.passed)}P/${fmtCount(execution.failed)}F/${fmtCount(execution.skipped)}S) — ${pyrInfo.enTitle}.${unrunEn.length > 0 ? ` Unrun: ${unrunEn.join(", ")}.` : ""}`,
  };

  const bullet3 = {
    enTopic: "Coverage & Gaps:",
    enBody: `Weighted coverage is ${fmtPct(coverage.overall)} (Unit ${layers.unit.state === "NOT_RUN" ? "Not Run" : fmtPct(coverage.codePct)}, API ${layers.integration.state === "NOT_RUN" ? "Not Run" : fmtPct(coverage.apiPct)}, E2E ${formatSystemFlowShort(layers, coverage)}), with ${fmtCount(ai.gaps ?? 0)} open gaps and ${fmtCount(execution.uncoveredApis)} untested APIs.`,
  };

  const topAction = actionItems[0];
  const topPriority = nfc(topAction?.priority || "INFO").toUpperCase();
  const topTitleEn = nfc(topAction?.title || "Recommended remediation action");
  const topTarget = nfc(topAction?.targetName || "");
  const topTargetSuffix = topTarget ? ` (${topTarget})` : "";

  const bullet4 = {
    enTopic: "Immediate Priority:",
    enBody: topAction
      ? `[${topPriority}] ${topTitleEn}${topTargetSuffix}.`
      : unrunEn.length > 0
        ? `Run missing ${unrunEn.join(" & ")} suite(s) to close unverified blind spots.`
        : "Maintain current suite coverage and monitor branch gates on upcoming commits.",
  };

  return [bullet1, bullet2, bullet3, bullet4];
}

function buildChartTakeaways(model) {
  const { layers, execution, coverage, trendSeries, matrixRows } = model;
  const unitTxtEn = layers.unit.state === "NOT_RUN" ? "Unit Not Run" : `Unit ${fmtPct(coverage.codePct)} cov`;
  const intTxtEn = layers.integration.state === "NOT_RUN" ? "Integration Not Run" : `API ${fmtPct(coverage.apiPct)} cov`;
  const sysTxtEn =
    layers.system.state === "NOT_RUN"
      ? "System Not Run"
      : layers.system.coverage?.coverageAvailable
      ? `E2E ${fmtPct(coverage.flowPct)} cov`
      : "E2E Pending";

  const failingMods = matrixRows.filter((r) =>
    ["fail", "failed"].includes(String(r.unit?.status || "").toLowerCase()) ||
    ["fail", "failed"].includes(String(r.integration?.status || "").toLowerCase()) ||
    ["fail", "failed"].includes(String(r.system?.status || "").toLowerCase())
  ).length;

  const firstTrend = trendSeries[0];
  const lastTrend = trendSeries[trendSeries.length - 1];
  const trendDelta =
    trendSeries.length >= 2
      ? Number(((lastTrend?.overallCoverage ?? 0) - (firstTrend?.overallCoverage ?? 0)).toFixed(1))
      : null;

  return {
    tierBar: `${unitTxtEn}, ${intTxtEn}, ${sysTxtEn} against dashed 70%/80% Quality Gate thresholds.`,
    outcomeDonut:
      execution.total === 0
        ? `0 executed tests across all 3 tiers; ${fmtCount(execution.uncoveredApis)} untested AST API(s) await coverage.`
        : `${fmtCount(execution.passed)} passed, ${fmtCount(execution.failed)} failed, ${fmtCount(execution.skipped)} skipped (${execution.passRate}% pass); ${fmtCount(execution.uncoveredApis)} untested API(s).`,
    trendLine:
      trendSeries.length >= 2
        ? `Overall coverage ${trendDelta >= 0 ? "gained" : "shifted"} ${trendDelta >= 0 ? "+" : ""}${trendDelta} pp across ${Math.min(10, trendSeries.length)} runs (latest pass rate: ${lastTrend?.passRate ?? execution.passRate ?? "—"}%).`
        : `Single snapshot (${trendSeries.length} run); shows current tier baselines vs. 80% gate without projecting a trend line.`,
    moduleHeatmap:
      matrixRows.length > 0
        ? `${failingMods} of ${matrixRows.length} tracked module(s) show cross-tier failures; failed rows are prioritized at top.`
        : "No module traceability rows recorded yet; top tiles show per-tier readiness status.",
  };
}

/**
 * Generates a standalone, self-contained English-only HTML5 executive report (for `.html` download and print-to-PDF).
 */
export function generateHtmlReport(
  vm,
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const { sections, options } = resolveSectionsAndOptions(sectionsOrOptions, maybeOptions);
  const lang = options.language;
  const printMode = options.printMode;
  const ctx = vm?.context || {};
  const model = buildReportMetricsModel(vm);
  const {
    layers,
    execution,
    coverage,
    health,
    qualityGate,
    pyramid,
    ai,
    trendSeries,
    matrixRows,
    actionItems,
    historyRuns,
    failureDistribution,
    featureDurations,
    aiTrustworthiness,
  } = model;

  const showFeatureDurations = Boolean(
    sections.featureDurations ?? (sections.pyramidPillars || sections.trendsHistory)
  );
  const showAiTrustworthiness = Boolean(
    sections.aiTrustworthiness ??
      (sections.pyramidPillars ||
        sections.traceMatrix ||
        sections.actionCenter ||
        sections.trendsHistory)
  );

  const gateInfo = translateGateStatus(qualityGate.status, qualityGate.label);
  const pyrInfo = translatePyramidShape(pyramid.shape, pyramid.badgeTitle, pyramid.warning);
  const bullets = buildExecutiveBullets(vm, model);
  const takeaways = buildChartTakeaways(model);
  const humanDate = formatHumanDate(new Date());
  const snapshotUpdated = ctx.updatedAt ? formatHumanDate(ctx.updatedAt) : "Not recorded";

  const svgBar = renderTierBarComparisonSvg(model);
  const svgDonut = renderTierOutcomeDonutSvg(model);
  const svgTrend = renderCoveragePassRateTrendSvg(model);
  const svgHeatmap = renderModuleTierHeatmapSvg(model);

  const projectTitle = nfc(ctx.projectName || "Project");
  const docTitle = `${REPORT_COPY.titlePrefix.en} — ${projectTitle}`;

  const toolbarHtml = printMode
    ? ""
    : `
      <div class="report-toolbar no-print" role="region" aria-label="Report display controls">
        <div class="toolbar-group">
          <span class="toolbar-brand">CovAI Quality Analytics</span>
          <span class="toolbar-sep">·</span>
          <span class="toolbar-meta">Interactive HTML Report</span>
        </div>
        <div class="toolbar-group">
          <button type="button" class="tb-btn tb-btn-primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>
    `;

  const executiveSummaryHtml = sections.executive
    ? `
      <section class="sec sec-exec" id="sec-executive-summary">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.executiveSummary.en)}</h2>
        <ul class="exec-list">
          ${bullets
            .map(
              (b) =>
                `<li><strong>${escapeHtml(b.enTopic)}</strong> ${escapeHtml(b.enBody)}</li>`
            )
            .join("")}
        </ul>
      </section>

      <section class="sec sec-kpi" id="sec-kpi-strip" aria-label="${escapeHtml(REPORT_COPY.sectionTitles.kpiStrip.en)}">
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Health Score</div>
            <div class="kpi-val">${escapeHtml(health.score !== null ? `${health.score}/100` : "—")}</div>
            <div class="kpi-sub">${escapeHtml(`Grade ${health.grade ?? "Unverified"}`)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Executed &amp; Pass Rate</div>
            <div class="kpi-val">${escapeHtml(execution.total > 0 ? `${fmtCount(execution.total)} (${execution.passRate}%)` : "Not Run")}</div>
            <div class="kpi-sub">${escapeHtml(`${fmtCount(execution.passed)}P · ${fmtCount(execution.failed)}F · ${fmtCount(execution.skipped)}S`)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Weighted Coverage</div>
            <div class="kpi-val">${escapeHtml(execution.total > 0 ? fmtPct(coverage.overall) : "—")}</div>
            <div class="kpi-sub"><span class="nowrap">${escapeHtml(`Unit ${fmtPct(coverage.codePct)}`)}</span> · <span class="nowrap">${escapeHtml(`API ${fmtPct(coverage.apiPct)}`)}</span> · <span class="nowrap">${escapeHtml(`E2E ${layers.system.state === "NOT_RUN" ? "—" : layers.system.coverage?.coverageAvailable ? fmtPct(coverage.flowPct) : "Pending"}`)}</span></div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Gaps &amp; Untested APIs</div>
            <div class="kpi-val">${escapeHtml(`${fmtCount(ai.gaps ?? 0)} / ${fmtCount(execution.uncoveredApis)}`)}</div>
            <div class="kpi-sub">${escapeHtml(`AI: ${fmtCount(ai.aiGenerated ?? 0)} gen · ${fmtCount(ai.aiRepaired ?? 0)} fix`)}</div>
          </div>
        </div>
      </section>
    `
    : "";

  const showCharts =
    sections.executive || sections.pyramidPillars || sections.traceMatrix || sections.trendsHistory;
  const hasPage1Content = Boolean(sections.executive || showCharts);

  const trendSubEn =
    trendSeries.length >= 2
      ? REPORT_COPY.charts.trendLine.enSubtitle
      : REPORT_COPY.charts.trendLine.enBaselineSubtitle;

  const heatmapSubEn =
    matrixRows.length > 0
      ? REPORT_COPY.charts.moduleHeatmap.enSubtitle
      : REPORT_COPY.charts.moduleHeatmap.enEmptySubtitle;

  const page1ChartsHtml = showCharts
    ? `
      <section class="sec sec-charts" id="sec-overview-charts">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.overviewCharts.en)}</h2>
        <p class="sec-sub">${escapeHtml(REPORT_COPY.sectionTitles.overviewChartsSubtitle.en)}</p>
        <div class="charts-stack">
          <article class="chart-card">
            <div class="chart-head">
              <h3>${escapeHtml(REPORT_COPY.charts.tierBar.enTitle)}</h3>
              <p class="chart-sub">${escapeHtml(REPORT_COPY.charts.tierBar.enSubtitle)}</p>
            </div>
            <figure class="chart-fig">${svgBar}</figure>
            <div class="chart-takeaway-box"><p class="chart-takeaway">${escapeHtml(takeaways.tierBar)}</p></div>
          </article>

          <article class="chart-card">
            <div class="chart-head">
              <h3>${escapeHtml(REPORT_COPY.charts.outcomeDonut.enTitle)}</h3>
              <p class="chart-sub">${escapeHtml(REPORT_COPY.charts.outcomeDonut.enSubtitle)}</p>
            </div>
            <figure class="chart-fig">${svgDonut}</figure>
            <div class="chart-takeaway-box"><p class="chart-takeaway">${escapeHtml(takeaways.outcomeDonut)}</p></div>
          </article>
        </div>
      </section>
    `
    : "";

  const page2ChartsHtml = showCharts
    ? `
      <section class="sec sec-charts" id="sec-overview-charts-2">
        <h2>Trend Trajectory &amp; Module Health</h2>
        <p class="sec-sub">Multi-run coverage trajectory and per-module cross-tier health risk breakdown.</p>
        <div class="charts-stack">
          <article class="chart-card">
            <div class="chart-head">
              <h3>${escapeHtml(REPORT_COPY.charts.trendLine.enTitle)}</h3>
              <p class="chart-sub">${escapeHtml(trendSubEn)}</p>
            </div>
            <figure class="chart-fig">${svgTrend}</figure>
            <div class="chart-takeaway-box"><p class="chart-takeaway">${escapeHtml(takeaways.trendLine)}</p></div>
          </article>

          <article class="chart-card">
            <div class="chart-head">
              <h3>${escapeHtml(REPORT_COPY.charts.moduleHeatmap.enTitle)}</h3>
              <p class="chart-sub">${escapeHtml(heatmapSubEn)}</p>
            </div>
            <figure class="chart-fig">${svgHeatmap}</figure>
            <div class="chart-takeaway-box"><p class="chart-takeaway">${escapeHtml(takeaways.moduleHeatmap)}</p></div>
          </article>
        </div>
      </section>
    `
    : "";

  const keyFindingsHtml = sections.pyramidPillars
    ? `
      <section class="sec" id="sec-key-findings">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.keyFindings.en)}</h2>
        <p class="finding-lead"><strong>${escapeHtml(pyrInfo.enTitle)}:</strong> ${escapeHtml(pyrInfo.enExplain)}</p>
        <div class="table-wrap">
          <table>
            <colgroup>
              <col style="width:15%" />
              <col style="width:12%" />
              <col style="width:16%" />
              <col style="width:14%" />
              <col style="width:9%" />
              <col style="width:24%" />
              <col style="width:10%" />
            </colgroup>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Framework</th>
                <th>Status</th>
                <th>Executed (P / F / S / Total)</th>
                <th>Pass Rate</th>
                <th>Primary Coverage</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="wrap-cell"><strong>Unit Tests</strong></td>
                <td class="mono wrap-cell">${escapeHtml(layers.unit.framework)}</td>
                <td class="status-cell">${renderStatusBadgeHtml(layers.unit.state, formatLayerStateBadge(layers.unit.state).text)}</td>
                <td class="mono wrap-cell">${layers.unit.passedTests}/<wbr>${layers.unit.failedTests}/<wbr>${layers.unit.skippedTests}/<wbr>${layers.unit.totalTests}</td>
                <td class="mono wrap-cell">${escapeHtml(layers.unit.passRate !== null ? `${layers.unit.passRate}%` : "—")}</td>
                <td class="mono wrap-cell">${escapeHtml(
                  layers.unit.state === "NOT_RUN"
                    ? "—"
                    : `Lines ${fmtPct(layers.unit.coverage.lines)} · Branch ${fmtPct(layers.unit.coverage.branches)} · Fn ${fmtPct(layers.unit.coverage.functions)} · Stmt ${fmtPct(layers.unit.coverage.statements)}`
                )}</td>
                <td class="mono wrap-cell">${escapeHtml(layers.unit.state === "NOT_RUN" ? "—" : formatSuiteDuration(layers.unit.durationMs))}</td>
              </tr>
              <tr>
                <td class="wrap-cell"><strong>Integration Tests</strong></td>
                <td class="mono wrap-cell">${escapeHtml(layers.integration.framework)}</td>
                <td class="status-cell">${renderStatusBadgeHtml(layers.integration.state, formatLayerStateBadge(layers.integration.state).text)}</td>
                <td class="mono wrap-cell">${layers.integration.passedTests}/<wbr>${layers.integration.failedTests}/<wbr>${layers.integration.skippedTests}/<wbr>${layers.integration.totalTests}</td>
                <td class="mono wrap-cell">${escapeHtml(layers.integration.passRate !== null ? `${layers.integration.passRate}%` : "—")}</td>
                <td class="mono wrap-cell">${escapeHtml(
                  layers.integration.state === "NOT_RUN"
                    ? `API — (${layers.integration.coverage.uncoveredApis} untested)`
                    : `API ${fmtPct(layers.integration.coverage.apiEndpoint)} (${layers.integration.coverage.coveredApis}/${layers.integration.coverage.totalApis}) · Stmt ${fmtPct(layers.integration.coverage.statements)}`
                )}</td>
                <td class="mono wrap-cell">${escapeHtml(formatIntegrationDurationCell(layers.integration))}</td>
              </tr>
              <tr>
                <td class="wrap-cell"><strong>System Tests (E2E)</strong></td>
                <td class="mono wrap-cell">${escapeHtml(layers.system.framework)}</td>
                <td class="status-cell">${renderStatusBadgeHtml(layers.system.state, formatLayerStateBadge(layers.system.state).text)}</td>
                <td class="mono wrap-cell">${layers.system.passedTests}/<wbr>${layers.system.failedTests}/<wbr>${layers.system.skippedTests}/<wbr>${layers.system.totalTests}</td>
                <td class="mono wrap-cell">${escapeHtml(layers.system.passRate !== null ? `${layers.system.passRate}%` : "—")}</td>
                <td class="mono wrap-cell">${escapeHtml(
                  layers.system.state === "NOT_RUN"
                    ? "—"
                    : layers.system.coverage?.coverageAvailable && layers.system.coverage.flow !== null
                    ? `Flow ${fmtPct(layers.system.coverage.flow)}`
                    : "Flow Pending"
                )}</td>
                <td class="mono wrap-cell">${escapeHtml(layers.system.state === "NOT_RUN" ? "—" : formatSuiteDuration(layers.system.durationMs))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${
          (qualityGate.checklist || []).length > 0
            ? `<div class="table-wrap">
                <table>
                  <colgroup>
                    <col style="width:58%" />
                    <col style="width:24%" />
                    <col style="width:18%" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Quality Gate Criterion</th>
                      <th>Measured</th>
                      <th>Gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${qualityGate.checklist
                      .map((chk) => {
                        const trChk = translateChecklistItem(chk);
                        return `<tr>
                          <td class="wrap-cell"><strong>${escapeHtml(trChk.label)}</strong></td>
                          <td class="mono wrap-cell">${escapeHtml(trChk.currentValue)}</td>
                          <td class="status-cell ${chk.passed ? "cell-pass" : "cell-fail"}">${renderStatusBadgeHtml(chk.passed ? "PASS" : "FAIL", chk.passed ? "PASSED" : "BLOCKED")}</td>
                        </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : ""
        }
      </section>
    `
      : "";

  const prioritizedMatrixRows = sortMatrixRowsByRisk(matrixRows);
  const unitLowItems = layers.unit.lowCoverageHotspots || layers.unit.lowCoverageItems || [];
  const intCovSummary = layers.integration.coverage;
  const hasDiscoveredApis = Number(intCovSummary?.totalApis ?? 0) > 0;
  const nonZeroFailures = [
    { key: "unitFailed", count: safeCount(failureDistribution?.unit?.failedTests) },
    { key: "route", count: safeCount(failureDistribution?.integration?.route) },
    { key: "middlewareAuth", count: safeCount(failureDistribution?.integration?.middlewareAuth) },
    { key: "controller", count: safeCount(failureDistribution?.integration?.controller) },
    { key: "database", count: safeCount(failureDistribution?.integration?.database) },
    { key: "selectorNotFound", count: safeCount(failureDistribution?.system?.selectorNotFound) },
    { key: "networkTimeout", count: safeCount(failureDistribution?.system?.networkTimeout) },
    { key: "assertion", count: safeCount(failureDistribution?.system?.assertion) },
    { key: "flaky", count: safeCount(failureDistribution?.system?.flaky) },
  ].filter((item) => item.count > 0);

  const criticalGapsHtml =
    sections.traceMatrix || sections.pyramidPillars
      ? `
      <section class="sec" id="sec-critical-gaps">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.criticalGaps.en)}</h2>
        ${
          sections.traceMatrix && prioritizedMatrixRows.length > 0
            ? `<div class="table-wrap">
                <table>
                  <colgroup>
                    <col style="width:20%" />
                    <col style="width:17%" />
                    <col style="width:15%" />
                    <col style="width:14%" />
                    <col style="width:34%" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Unit</th>
                      <th>Integration</th>
                      <th>System</th>
                      <th>Diagnosis &amp; Suspect Layer</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${prioritizedMatrixRows
                      .slice(0, 12)
                      .map((r) => {
                        const diag = resolveDisplayRootCause(r);
                        return `<tr>
                          <td class="wrap-cell"><strong>${escapeHtml(r.moduleName || "Module")}</strong></td>
                          <td class="status-cell">${renderMatrixPillHtml(r.unit?.status, translateMatrixCellLabel(r.unit?.label, r.unit?.status))}</td>
                          <td class="status-cell">${renderMatrixPillHtml(r.integration?.status, translateMatrixCellLabel(r.integration?.label, r.integration?.status))}</td>
                          <td class="status-cell">${renderMatrixPillHtml(r.system?.status, translateMatrixCellLabel(r.system?.label, r.system?.status))}</td>
                          <td class="wrap-cell">${escapeHtml(diag.summary)} <span class="mono muted">(${escapeHtml(translateSuspectLayer(diag.suspectLayer))})</span></td>
                        </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : ""
        }
        <div class="gaps-split">
          ${
            unitLowItems.length > 0
              ? `<div class="table-wrap">
                  <table>
                    <colgroup>
                      <col style="width:55%" />
                      <col style="width:15%" />
                      <col style="width:15%" />
                      <col style="width:15%" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Low-Coverage Hotspot</th>
                        <th>Branches</th>
                        <th>Lines</th>
                        <th>Functions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${unitLowItems
                        .map(
                          (item) => `<tr>
                            <td class="mono path-cell">${escapeHtml(item.filePath || item.name || item.label || item.path || "file")}</td>
                            <td class="mono">${escapeHtml(fmtPct(item.branchesPct ?? item.coverage ?? item.value ?? 0))}</td>
                            <td class="mono">${escapeHtml(fmtPct(item.linesPct ?? 0))}</td>
                            <td class="mono">${escapeHtml(item.functionsPct !== null && item.functionsPct !== undefined ? fmtPct(item.functionsPct) : "—")}</td>
                          </tr>`
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>`
              : layers.unit.hasUnitFiles
                ? `<div class="zero-api-note"><strong>Low-Coverage Hotspot:</strong> ${escapeHtml(REPORT_COPY.notices.allFilesCovered.en)}</div>`
                : ""
          }
          ${
            hasDiscoveredApis
              ? `<div class="table-wrap">
                  <table>
                    <colgroup>
                      <col style="width:40%" />
                      <col style="width:15%" />
                      <col style="width:15%" />
                      <col style="width:15%" />
                      <col style="width:15%" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>AST API Summary</th>
                        <th>Covered</th>
                        <th>Failed</th>
                        <th>Uncovered</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Endpoints</strong></td>
                        <td class="mono">${escapeHtml(fmtCount(intCovSummary.coveredApis))}</td>
                        <td class="mono">${escapeHtml(fmtCount(intCovSummary.failedApis))}</td>
                        <td class="mono">${escapeHtml(fmtCount(intCovSummary.uncoveredApis))}</td>
                        <td class="mono">${escapeHtml(fmtCount(intCovSummary.totalApis))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>`
              : `<div class="zero-api-note"><strong>AST API Summary:</strong> ${escapeHtml(REPORT_COPY.notices.zeroApisDiscovered.en)}</div>`
          }
        </div>
        <div class="failure-line">
          ${
            execution.total === 0
              ? `<span><strong>Failure Breakdown:</strong> Not Run (0 executed tests).</span>`
              : nonZeroFailures.length > 0
                ? `<span class="mono"><strong>Failure Breakdown:</strong> ${nonZeroFailures
                    .map((f) => {
                      const d = FAILURE_CATEGORY_LABELS[f.key] || { en: f.key };
                      return `${escapeHtml(d.en)}: ${f.count}`;
                    })
                    .join(" · ")}</span>`
                : `<span><strong>Failure Breakdown:</strong> 0 execution failures recorded.</span>`
          }
        </div>
      </section>
    `
      : "";

  const actionsHtml = sections.actionCenter
    ? `
      <section class="sec" id="sec-actions">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.actions.en)}</h2>
        ${
          actionItems.length > 0
            ? `<ol class="action-list">
                ${actionItems
                  .slice(0, 8)
                  .map((act) => {
                    const priority = String(act?.priority || "INFO").toUpperCase();
                    const pillarTag = String(act?.pillar || "").toUpperCase();
                    const title = nfc(act?.title || "Remediation Action");
                    const targetName = nfc(act?.targetName || "");
                    const desc = nfc(
                      act?.description ||
                        act?.ctaLabel ||
                        targetName ||
                        "Investigate and resolve layer issue."
                    );
                    return `<li class="action-item">
                      <div class="action-head">
                        ${renderStatusBadgeHtml(["CRITICAL", "P0"].includes(priority) ? "FAIL" : ["HIGH", "P1", "MEDIUM"].includes(priority) ? "WARN" : "NEUTRAL", priority)}
                        ${pillarTag ? `<span class="mono muted">${escapeHtml(pillarTag)}</span>` : ""}
                        <strong>${escapeHtml(title)}</strong>
                        ${targetName ? `<code class="target-code">${escapeHtml(targetName)}</code>` : ""}
                      </div>
                      <p class="action-desc">${escapeHtml(desc)}</p>
                    </li>`;
                  })
                  .join("")}
              </ol>`
            : `<p class="empty-note">No critical remediation actions pending; monitor branch coverage and flaky counts on upcoming runs.</p>`
        }
      </section>
    `
    : "";

  const historyHtml = sections.trendsHistory
    ? `
      <section class="sec" id="sec-history">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.history.en)}</h2>
        <div class="table-wrap">
          <table>
            <colgroup>
              <col style="width:15%" />
              <col style="width:14%" />
              <col style="width:15%" />
              <col style="width:13%" />
              <col style="width:12%" />
              <col style="width:12%" />
              <col style="width:19%" />
            </colgroup>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Pass / Fail</th>
                <th>Coverage</th>
                <th>Duration</th>
                <th>Commit</th>
              </tr>
            </thead>
            <tbody>
              ${
                historyRuns.length > 0
                  ? historyRuns
                      .slice(0, 8)
                      .map(
                        (run) => `<tr>
                          <td class="mono wrap-cell">${escapeHtml(run.shortId || run.id || "—")}</td>
                          <td class="mono wrap-cell">${escapeHtml(String(run.type || "—").toUpperCase())}</td>
                          <td class="status-cell">${renderStatusBadgeHtml(run.status, translateHistoryStatus(run.status))}</td>
                          <td class="mono wrap-cell">${escapeHtml(`${run.passed ?? 0} / ${run.failed ?? 0}`)}</td>
                          <td class="mono wrap-cell">${escapeHtml(fmtPct(run.coveragePct))}</td>
                          <td class="mono wrap-cell">${escapeHtml(formatSuiteDuration(run.durationMs))}</td>
                          <td class="mono wrap-cell">${escapeHtml(run.commitSha || "N/A")}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="7" class="empty-cell">No execution runs recorded for this snapshot.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `
    : "";

  const featureDurationsHtml = showFeatureDurations
    ? `
      <section class="sec" id="sec-feature-durations">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.featureDurations.en)}</h2>
        <div class="table-wrap">
          <table>
            <colgroup>
              <col style="width:28%" />
              <col style="width:10%" />
              <col style="width:15%" />
              <col style="width:17%" />
              <col style="width:15%" />
              <col style="width:15%" />
            </colgroup>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Runs</th>
                <th>Latest</th>
                <th>Cumulative Total</th>
                <th>Average</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${(featureDurations || [])
                .map((row) => {
                  const hasRuns = Number(row?.runCount || 0) > 0;
                  const statusLabel = hasRuns ? String(row.lastStatus || "SUCCESS").toUpperCase() : "NOT RUN";
                  return `<tr>
                    <td class="wrap-cell"><strong>${escapeHtml(row.label)}</strong></td>
                    <td class="mono wrap-cell">${hasRuns ? fmtCount(row.runCount) : "0"}</td>
                    <td class="mono wrap-cell">${escapeHtml(hasRuns ? fmtDuration(row.latestDurationMs) : "—")}</td>
                    <td class="mono wrap-cell">${escapeHtml(hasRuns ? fmtDuration(row.totalDurationMs) : "—")}</td>
                    <td class="mono wrap-cell">${escapeHtml(hasRuns ? fmtDuration(row.avgDurationMs) : "—")}</td>
                    <td class="status-cell">${renderStatusBadgeHtml(hasRuns ? row.lastStatus : "NOT_RUN", statusLabel)}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `
    : "";

  const aiTrustworthinessHtml = showAiTrustworthiness
    ? (() => {
        const evalData = aiTrustworthiness || { hasRun: false, status: "NOT_RUN", verdict: "NOT_RUN" };
        const hasRun = Boolean(evalData.hasRun && evalData.status !== "NOT_RUN");
        const verdictLabel = formatAiEvalVerdictLabel(evalData);
        const designAudit = evalData.designAudit || null;
        if (!hasRun) {
          return `
            <section class="sec" id="sec-ai-trustworthiness">
              <h2>${escapeHtml(REPORT_COPY.sectionTitles.aiTrustworthiness.en)}</h2>
              <div class="zero-api-note">
                <strong>Status:</strong> Not Run — No AI trustworthiness evaluation has been executed for this project yet.
                ${
                  designAudit?.status === "READY"
                    ? `Design Audit: ${escapeHtml(designAudit.detected ? `Chatbot Detected (${designAudit.designScore ?? "—"}/100, ${designAudit.findingsCount} findings)` : "No Chatbot Detected")}.`
                    : ""
                }
              </div>
            </section>
          `;
        }

        const spr = evalData.scenarioPassRate;
        const stab = evalData.stability;
        const lat = evalData.latency;
        const criteria = Array.isArray(evalData.criteriaSummary) ? evalData.criteriaSummary : [];
        return `
          <section class="sec" id="sec-ai-trustworthiness">
            <h2>${escapeHtml(REPORT_COPY.sectionTitles.aiTrustworthiness.en)}</h2>
            <p class="finding-lead">
              ${renderStatusBadgeHtml(verdictLabel, verdictLabel)}
              <strong>Trust Score:</strong> <span class="mono">${escapeHtml(formatAiEvalScoreText(evalData))}</span>
              ${evalData.passMark !== null ? ` · <strong>Pass Mark:</strong> <span class="mono">${escapeHtml(`${evalData.passMark}/100`)}</span>` : ""}
              ${evalData.targetName ? ` · <strong>Target:</strong> ${escapeHtml(evalData.targetName)}` : ""}
              ${evalData.profileName ? ` · <strong>Profile:</strong> ${escapeHtml(evalData.profileName)}` : ""}
            </p>
            <div class="table-wrap">
              <table>
                <colgroup>
                  <col style="width:25%" />
                  <col style="width:25%" />
                  <col style="width:25%" />
                  <col style="width:25%" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Trust Score</th>
                    <th>Scenario Pass Rate</th>
                    <th>Response Stability</th>
                    <th>Latency (Avg / P95)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="mono wrap-cell">${escapeHtml(formatAiEvalScoreText(evalData))}</td>
                    <td class="mono wrap-cell">${escapeHtml(
                      spr
                        ? `${spr.rate !== null ? fmtPct(spr.rate) : "—"} (${spr.passed}/${spr.evaluated})`
                        : "—"
                    )}</td>
                    <td class="mono wrap-cell">${escapeHtml(
                      stab?.stabilityRate !== null && stab?.stabilityRate !== undefined
                        ? `${fmtPct(stab.stabilityRate)} (${stab.stableCases}/${stab.eligibleCases})`
                        : "—"
                    )}</td>
                    <td class="mono wrap-cell">${escapeHtml(
                      lat?.avgMs !== null && lat?.avgMs !== undefined
                        ? `${fmtDuration(lat.avgMs)} / ${lat.p95Ms !== null ? fmtDuration(lat.p95Ms) : "—"}`
                        : "—"
                    )}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            ${
              criteria.length > 0
                ? `<div class="table-wrap">
                    <table>
                      <colgroup>
                        <col style="width:52%" />
                        <col style="width:24%" />
                        <col style="width:24%" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Evaluation Criterion</th>
                          <th>Score</th>
                          <th>Checks Scored</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${criteria
                          .map(
                            (c) => `<tr>
                              <td class="wrap-cell"><strong>${escapeHtml(c.label || c.criterionKey)}</strong></td>
                              <td class="mono wrap-cell">${escapeHtml(c.score !== null && c.score !== undefined ? fmtPct(c.score) : "—")}</td>
                              <td class="mono wrap-cell">${escapeHtml(c.applicable > 0 ? `${c.scored}/${c.applicable}` : "Not checked")}</td>
                            </tr>`
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>`
                : ""
            }
          </section>
        `;
      })()
    : "";

  const followupSectionsHtml = [
    keyFindingsHtml,
    featureDurationsHtml,
    aiTrustworthinessHtml,
    criticalGapsHtml,
    actionsHtml,
    historyHtml,
  ]
    .filter(Boolean)
    .join("");
  const hasFollowup = followupSectionsHtml.trim().length > 0;
  const page1Break = hasPage1Content && (showCharts || hasFollowup);
  const page2Break = showCharts && hasFollowup;

  const caveatsHtml = hasFollowup
    ? `
      <section class="sec sec-caveats" id="sec-caveats">
        <h2>${escapeHtml(REPORT_COPY.sectionTitles.caveats.en)}</h2>
        <ul class="compact-list">
          <li><strong>NOT RUN vs. Failures:</strong> Unexecuted layers (0 tests) and untested AST APIs remain unverified blind spots and do not count as failed tests.</li>
          <li><strong>Snapshot &amp; Questions:</strong> Metrics reflect snapshot <code>${escapeHtml(ctx.snapshotLabel || ctx.snapshotId || "Active")}</code>. ${trendSeries.length < 2 ? "Establish >= 2 consecutive runs to track trajectory." : "Monitor failing modules and gate gaps before release."}</li>
        </ul>
      </section>
    `
    : "";

  const pageOneCompactCss = `
      .page-one .report-header { gap: 6px 10px; padding-bottom: 6px; margin-bottom: 7px; }
      .page-one h1 { font-size: 14.5pt; line-height: 1.2; }
      .page-one .provenance { margin-top: 3px; gap: 2px 10px; font-size: 8pt; line-height: 1.28; }
      .page-one .gate-box { padding: 5px 9px; gap: 3px; }
      .page-one .gate-score { font-size: 12.5pt; }
      .page-one .gate-box .badge { font-size: 7.5pt; padding: 2px 6px; }
      .page-one .sec-exec { margin-bottom: 6px; }
      .page-one .sec-kpi { margin-bottom: 7px; }
      .page-one .sec-charts { margin-bottom: 4px; }
      .page-one h2 { margin: 0 0 4px 0; font-size: 11pt; line-height: 1.25; }
      .page-one .sec-sub { margin: -1px 0 5px 0; font-size: 8.2pt; line-height: 1.24; }
      .page-one .exec-list { padding-left: 16px; }
      .page-one .exec-list li { margin-bottom: 2.5px; font-size: 8.8pt; line-height: 1.32; }
      .page-one .kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
      .page-one .kpi-card { padding: 6px 8px; }
      .page-one .kpi-label { font-size: 7.2pt; }
      .page-one .kpi-val { margin: 1.5px 0; font-size: 12.8pt; }
      .page-one .kpi-sub { font-size: 7.6pt; }
      .page-one .charts-stack { grid-template-columns: 1fr; gap: 10px; }
      .page-one .chart-card { padding: 8px 10px 7px; gap: 4px; }
      .page-one .chart-head { min-height: 26px; }
      .page-one .chart-fig svg { max-height: 278px; }
      .page-one h3 { margin: 0 0 1.5px 0; font-size: 9.8pt; line-height: 1.22; }
      .page-one .chart-sub { font-size: 8pt; line-height: 1.24; }
      .page-one .chart-takeaway-box { padding-top: 4px; }
      .page-one .chart-takeaway { font-size: 8.2pt; line-height: 1.28; }
      .page-one .page1-footnote { margin-top: 5px; font-size: 7.8pt; line-height: 1.24; }
      .charts-page-two .sec-charts { margin-bottom: 0; }
      .charts-page-two .charts-stack { grid-template-columns: 1fr; gap: 14px; }
      .charts-page-two .chart-card { padding: 10px 12px 9px; gap: 6px; }
      .charts-page-two .chart-fig svg { max-height: 365px; }
  `;

  return nfc(`<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(docTitle)}</title>
  <style>
    @page { size: A4; margin: 9mm 10mm; }
    * { box-sizing: border-box; }
    :root {
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --bg: #f8fafc;
      --paper: #ffffff;
      --surface-2: #f8fafc;
      --surface-3: #f1f5f9;
      --ink: #0f172a;
      --ink-2: #334155;
      --muted: #64748b;
      --border: #d0d7de;
      --border-soft: #e2e8f0;
      --accent: #0969da;
      --pass-bg: #dcfce7;
      --pass-fg: #14532d;
      --pass-bd: #86efac;
      --fail-bg: #ffe4e6;
      --fail-fg: #881337;
      --fail-bd: #fda4af;
      --warn-bg: #fef3c7;
      --warn-fg: #78350f;
      --warn-bd: #fcd34d;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: var(--font-sans);
      font-size: 10.5pt;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-shell {
      max-width: ${printMode ? "100%" : "1020px"};
      min-width: 0;
      margin: ${printMode ? "0" : "24px auto"};
      padding: ${printMode ? "0" : "26px 32px"};
      background: var(--paper);
      border: ${printMode ? "none" : "1px solid var(--border)"};
      border-radius: ${printMode ? "0" : "8px"};
      overflow-wrap: break-word;
    }
    .report-toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      margin-bottom: 16px;
      background: var(--surface-3);
      border: 1px solid var(--border-soft);
      border-radius: 6px;
    }
    .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .toolbar-brand { font-size: 9.5pt; font-weight: 700; color: var(--ink); }
    .toolbar-sep { color: var(--muted); }
    .toolbar-meta { font-size: 9pt; font-weight: 500; color: var(--muted); }
    .tb-btn {
      padding: 6px 12px;
      font-family: var(--font-sans);
      font-size: 9pt;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--paper);
      color: var(--ink);
      cursor: pointer;
    }
    .tb-btn-primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .page-one.has-followup, .charts-page-two.has-followup {
      ${printMode ? "break-after: page; page-break-after: always;" : "margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-soft);"}
    }
    .report-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: ${printMode ? "8px 12px" : "14px"};
      padding-bottom: ${printMode ? "8px" : "12px"};
      margin-bottom: ${printMode ? "10px" : "16px"};
      border-bottom: 2px solid var(--ink);
      min-width: 0;
      max-width: 100%;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .report-header > div { min-width: 0; max-width: 100%; }
    .report-header > div:first-child { flex: 1 1 320px; }
    h1 {
      margin: 0;
      font-family: var(--font-sans);
      font-size: 17.5pt;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.22;
      color: var(--ink);
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .provenance {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      font-size: 9pt;
      line-height: 1.35;
      color: var(--muted);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .provenance > span, .provenance .mono {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .gate-box {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      flex-shrink: 0;
      gap: 5px;
      padding: 8px 12px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      max-width: 100%;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .gate-score {
      font-size: 14pt;
      font-weight: 700;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--ink);
      white-space: nowrap;
    }
    .sec { margin-bottom: ${printMode ? "14px" : "22px"}; min-width: 0; max-width: 100%; }
    .sec-exec { margin-bottom: 14px; }
    .sec-kpi { margin-bottom: 16px; }
    .sec-charts { margin-bottom: 16px; }
    h2 {
      margin: 0 0 10px 0;
      padding-left: 9px;
      border-left: 3px solid var(--accent);
      font-family: var(--font-sans);
      font-size: 12.5pt;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.28;
      color: var(--ink);
      overflow-wrap: normal;
      word-break: normal;
      break-after: avoid;
      page-break-after: avoid;
    }
    .sec-sub {
      margin: -4px 0 10px 0;
      padding-left: 12px;
      font-size: 9pt;
      color: var(--muted);
      line-height: 1.35;
    }
    h3 {
      margin: 0 0 3px 0;
      font-family: var(--font-sans);
      font-size: 10pt;
      font-weight: 700;
      line-height: 1.28;
      color: var(--ink);
      overflow-wrap: normal;
      word-break: normal;
      break-after: avoid;
      page-break-after: avoid;
    }
    .exec-list {
      margin: 0;
      padding-left: 18px;
    }
    .exec-list li {
      margin-bottom: 5px;
      font-size: 10pt;
      line-height: 1.48;
      color: var(--ink-2);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: break-word;
    }
    .compact-list, .action-list { margin: 0; padding-left: 18px; }
    .compact-list li, .action-list li {
      margin-bottom: 6px;
      font-size: 9.5pt;
      line-height: 1.45;
      color: var(--ink-2);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: break-word;
    }
    .action-item { break-inside: avoid; page-break-inside: avoid; }
    .empty-note { margin: 0; font-size: 9.5pt; color: var(--muted); }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    @media (max-width: 680px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .kpi-card {
      padding: 10px 12px;
      background: var(--paper);
      border: 1px solid var(--border);
      border-top: 2.5px solid var(--accent);
      border-radius: 6px;
      min-width: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .kpi-card:nth-child(2) { border-top-color: #15803d; }
    .kpi-card:nth-child(3) { border-top-color: #8250df; }
    .kpi-card:nth-child(4) { border-top-color: #b45309; }
    .kpi-label {
      font-size: 7.8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .kpi-val {
      margin: 3px 0 2px;
      font-size: 15.5pt;
      font-weight: 700;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--ink);
    }
    .kpi-sub {
      font-size: 8.5pt;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      color: var(--ink-2);
      overflow-wrap: break-word;
    }
    .charts-stack {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .chart-card {
      padding: 12px 14px 10px;
      background: var(--paper);
      border: 1px solid var(--border);
      border-radius: 6px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .chart-head {
      min-width: 0;
      min-height: 30px;
    }
    .chart-sub {
      margin: 0;
      font-size: 8.6pt;
      color: var(--muted);
      line-height: 1.3;
    }
    .chart-fig {
      margin: 0;
      padding: 0;
      min-width: 0;
      background: #ffffff;
    }
    .chart-fig svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 360px;
      margin: 0 auto;
    }
    .chart-takeaway-box {
      margin-top: auto;
      padding-top: 6px;
      border-top: 1px solid var(--border-soft);
    }
    .chart-takeaway {
      margin: 0;
      font-size: 8.8pt;
      color: var(--ink-2);
      line-height: 1.36;
    }
    .page1-footnote {
      margin-top: 8px;
      font-size: 8.5pt;
      line-height: 1.35;
      color: var(--muted);
    }
    .finding-lead {
      margin: 0 0 8px 0;
      font-size: 9.5pt;
      line-height: 1.42;
      color: var(--ink-2);
    }
    .gaps-split {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin-top: 8px;
    }
    .failure-line, .zero-api-note {
      margin-top: 8px;
      padding: 7px 10px;
      background: var(--surface-2);
      border: 1px solid var(--border-soft);
      border-radius: 4px;
      font-size: 9pt;
      line-height: 1.42;
      color: var(--ink-2);
    }
    .table-wrap { overflow-x: ${printMode ? "visible" : "auto"}; max-width: 100%; margin-top: 8px; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-family: var(--font-sans);
      font-size: 9pt;
    }
    thead { display: table-header-group; }
    th, td {
      border: 1px solid var(--border-soft);
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: normal;
      word-break: normal;
      font-family: var(--font-sans);
      font-size: 9pt;
      line-height: 1.38;
    }
    th {
      background: var(--surface-3);
      color: var(--ink-2);
      font-size: 7.8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      line-height: 1.3;
    }
    td.wrap-cell { overflow-wrap: break-word; }
    td.path-cell { overflow-wrap: anywhere; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .cell-pass { background: var(--pass-bg); color: var(--pass-fg); font-weight: 700; }
    .cell-fail { background: var(--fail-bg); color: var(--fail-fg); font-weight: 700; }
    .empty-cell { text-align: center; color: var(--muted); }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-family: var(--font-sans);
      font-size: 7.8pt;
      font-weight: 700;
      letter-spacing: 0.03em;
      line-height: 1.25;
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
      border: 1px solid var(--border-soft);
    }
    .matrix-pill {
      display: inline-block;
      max-width: 100%;
      padding: 3px 7px;
      border-radius: 4px;
      font-family: var(--font-sans);
      font-size: 8.2pt;
      font-weight: 600;
      line-height: 1.3;
      white-space: normal;
      overflow-wrap: break-word;
      word-break: normal;
      border: 1px solid var(--border-soft);
    }
    .badge-pass { background: var(--pass-bg); color: var(--pass-fg); border-color: var(--pass-bd); }
    .badge-fail { background: var(--fail-bg); color: var(--fail-fg); border-color: var(--fail-bd); }
    .badge-warn { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-bd); }
    .badge-neutral { background: var(--surface-3); color: var(--muted); }
    .mono {
      font-family: var(--font-mono);
      font-size: 8.5pt;
      font-variant-numeric: tabular-nums;
    }
    .nowrap { white-space: nowrap; }
    .muted { color: var(--muted); }
    .target-code {
      font-family: var(--font-mono);
      font-size: 8.4pt;
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--surface-3);
      border: 1px solid var(--border-soft);
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .action-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 2px;
      min-width: 0;
      max-width: 100%;
      overflow-wrap: break-word;
    }
    .action-desc {
      margin: 0;
      font-size: 9.2pt;
      line-height: 1.42;
      color: var(--ink-2);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .sec-caveats {
      padding-top: 8px;
      border-top: 1px solid var(--border-soft);
      font-size: 9pt;
    }
    .report-footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid var(--border-soft);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 6px 12px;
      font-size: 8.5pt;
      color: var(--muted);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: break-word;
    }
    ${printMode ? pageOneCompactCss : ""}
    @media print {
      body { background: #ffffff !important; color: #0f172a !important; font-family: var(--font-sans); font-size: 9.5pt; }
      .page-shell { margin: 0; padding: 0; border: none; max-width: 100%; }
      .no-print { display: none !important; }
      .page-one.has-followup, .charts-page-two.has-followup { margin-bottom: 0; padding-bottom: 0; border-bottom: none; break-after: page; page-break-after: always; }
      .kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .charts-stack { grid-template-columns: 1fr; }
      .table-wrap { overflow: visible; }
      th, td { padding: 5px 7px; font-size: 8.4pt; }
      th { font-size: 7.4pt; }
      .mono { font-size: 8pt; }
      .badge { font-size: 7.4pt; padding: 2px 6px; }
      .matrix-pill { font-size: 7.8pt; padding: 2.5px 6px; }
      ${pageOneCompactCss}
    }
  </style>
</head>
<body data-report-lang="${lang}">
  <main class="page-shell">
    ${toolbarHtml}
    <div class="page-one${page1Break ? " has-followup" : ""}">
      <header class="report-header">
        <div>
          <h1>${escapeHtml(docTitle)}</h1>
          <div class="provenance">
            <span><strong>Branch:</strong> <span class="mono">${escapeHtml(ctx.branch || "main")}</span></span>
            <span><strong>Snapshot:</strong> <span class="mono">${escapeHtml(ctx.snapshotLabel || ctx.snapshotId || "Active")}</span></span>
            <span><strong>Updated:</strong> ${escapeHtml(snapshotUpdated)}</span>
            <span><strong>Generated:</strong> ${escapeHtml(humanDate)}</span>
          </div>
        </div>
        <div class="gate-box">
          <div class="gate-score">${escapeHtml(health.score !== null ? `${health.score}/100 (${health.grade ?? "—"})` : "Unverified")}</div>
          ${renderStatusBadgeHtml(qualityGate.status, gateInfo.en)}
        </div>
      </header>
      ${executiveSummaryHtml}
      ${page1ChartsHtml}
      ${
        hasPage1Content
          ? `<div class="page1-footnote">
        Note: Layers marked NOT RUN (0 executed tests) are unverified and excluded from executed failure counts.
      </div>`
          : ""
      }
    </div>
    ${
      showCharts
        ? `<div class="charts-page-two${page2Break ? " has-followup" : ""}">
            ${page2ChartsHtml}
          </div>`
        : ""
    }
    ${
      hasFollowup
        ? `<div class="followup-pages">
            ${followupSectionsHtml}
            ${caveatsHtml}
          </div>`
        : ""
    }
    <footer class="report-footer">
      <span>CovAI Quality Analytics — Unit, Integration &amp; System Verification</span>
      <span class="mono">${escapeHtml(ctx.snapshotId ? `Snapshot ${(ctx.snapshotId || "").slice(0, 12)}` : "Snapshot Active")}</span>
    </footer>
  </main>
</body>
</html>`);
}

/**
 * Pure helper generating print-ready A4 HTML for PDF export and verification.
 */
export function generatePdfHtmlReport(
  vm,
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const { sections, options } = resolveSectionsAndOptions(sectionsOrOptions, maybeOptions);
  return generateHtmlReport(vm, sections, { ...options, printMode: true });
}

/**
 * Generates an answer-first English-only Markdown report aligned with the 2-page executive structure.
 */
export function generateMarkdownReport(
  vm,
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const { sections } = resolveSectionsAndOptions(sectionsOrOptions, maybeOptions);
  const ctx = vm?.context || {};
  const model = buildReportMetricsModel(vm);
  const {
    layers,
    execution,
    coverage,
    health,
    qualityGate,
    pyramid,
    ai,
    trendSeries,
    matrixRows,
    actionItems,
    historyRuns,
    varianceItems,
    failureDistribution,
    featureDurations,
    aiTrustworthiness,
  } = model;

  const showFeatureDurations = Boolean(
    sections.featureDurations ?? (sections.pyramidPillars || sections.trendsHistory)
  );
  const showAiTrustworthiness = Boolean(
    sections.aiTrustworthiness ??
      (sections.pyramidPillars ||
        sections.traceMatrix ||
        sections.actionCenter ||
        sections.trendsHistory)
  );

  const gateInfo = translateGateStatus(qualityGate.status, qualityGate.label);
  const pyrInfo = translatePyramidShape(pyramid.shape, pyramid.badgeTitle, pyramid.warning);
  const bullets = buildExecutiveBullets(vm, model);
  const humanDate = formatHumanDate(new Date());
  const snapshotUpdated = ctx.updatedAt ? formatHumanDate(ctx.updatedAt) : "Not recorded";
  const projectTitle = nfc(ctx.projectName || "Project");

  const lines = [
    `# ${REPORT_COPY.titlePrefix.en} — ${projectTitle}`,
    ``,
    `> **Branch:** \`${ctx.branch || "main"}\` | **Snapshot:** \`${ctx.snapshotLabel || ctx.snapshotId || "Active"}\``,
    `> **Updated:** ${snapshotUpdated} | **Generated:** ${humanDate}`,
    `> **Quality Gate:** **${gateInfo.en}**`,
    ``,
  ];

  if (sections.executive) {
    lines.push(
      `## ${REPORT_COPY.sectionTitles.executiveSummary.en}`,
      ``
    );
    for (const b of bullets) {
      lines.push(`- **${b.enTopic}** ${b.enBody}`);
    }
    lines.push(
      ``,
      `### ${REPORT_COPY.sectionTitles.kpiStrip.en}`,
      ``,
      `- **Health Score:** ${health.score !== null ? `**${health.score}/100** (Grade ${health.grade ?? "—"})` : "Unverified (0 executed tests)"}`,
      `- **Executed & Pass Rate:** ${fmtCount(execution.total)} (${execution.passRate !== null ? `${execution.passRate}%` : "—"}) — Passed: ${fmtCount(execution.passed)} | Failed: ${fmtCount(execution.failed)} | Skipped: ${fmtCount(execution.skipped)}`,
      `- **Weighted Coverage:** ${fmtPct(coverage.overall)} (Unit ${fmtPct(coverage.codePct)} · API ${fmtPct(coverage.apiPct)} · E2E ${formatSystemFlowShort(layers, coverage)})`,
      `- **Open Gaps & Untested APIs:** ${fmtCount(ai.gaps ?? 0)} gaps | ${fmtCount(execution.uncoveredApis)} untested AST APIs`,
      ``
    );
  }

  if (sections.pyramidPillars) {
    const unitCovCell =
      layers.unit.state === "NOT_RUN"
        ? "—"
        : `Lines ${fmtPct(layers.unit.coverage.lines)}, Branches ${fmtPct(layers.unit.coverage.branches)}, Fn ${fmtPct(layers.unit.coverage.functions)}, Stmt ${fmtPct(layers.unit.coverage.statements)}`;
    const intCovCell =
      layers.integration.state === "NOT_RUN"
        ? `— (Uncovered APIs: ${layers.integration.coverage.uncoveredApis})`
        : `API ${fmtPct(layers.integration.coverage.apiEndpoint)} (${layers.integration.coverage.coveredApis}/${layers.integration.coverage.totalApis})`;
    const sysCovCell =
      layers.system.state === "NOT_RUN"
        ? "—"
        : layers.system.coverage?.coverageAvailable && layers.system.coverage.flow !== null
        ? `Flow ${fmtPct(layers.system.coverage.flow)}`
        : "Flow Pending";

    lines.push(
      `---`,
      ``,
      `## ${REPORT_COPY.sectionTitles.keyFindings.en}`,
      ``,
      `**Pyramid Profile:** ${pyrInfo.enTitle}`,
      ``,
      `| Layer | Framework | Status | Executed (P/F/S/Total) | Pass Rate | Coverage | Duration |`,
      `|---|---|---|---|---|---|---|`,
      `| **Unit** | ${escapeMarkdownCell(layers.unit.framework)} | ${escapeMarkdownCell(formatLayerStateBadge(layers.unit.state).text)} | ${layers.unit.passedTests} / ${layers.unit.failedTests} / ${layers.unit.skippedTests} / ${layers.unit.totalTests} | ${layers.unit.passRate !== null ? `${layers.unit.passRate}%` : "—"} | ${escapeMarkdownCell(unitCovCell)} | ${layers.unit.state === "NOT_RUN" ? "—" : escapeMarkdownCell(formatSuiteDuration(layers.unit.durationMs))} |`,
      `| **Integration** | ${escapeMarkdownCell(layers.integration.framework)} | ${escapeMarkdownCell(formatLayerStateBadge(layers.integration.state).text)} | ${layers.integration.passedTests} / ${layers.integration.failedTests} / ${layers.integration.skippedTests} / ${layers.integration.totalTests} | ${layers.integration.passRate !== null ? `${layers.integration.passRate}%` : "—"} | ${escapeMarkdownCell(intCovCell)} | ${escapeMarkdownCell(formatIntegrationDurationCell(layers.integration))} |`,
      `| **System (E2E)** | ${escapeMarkdownCell(layers.system.framework)} | ${escapeMarkdownCell(formatLayerStateBadge(layers.system.state).text)} | ${layers.system.passedTests} / ${layers.system.failedTests} / ${layers.system.skippedTests} / ${layers.system.totalTests} | ${layers.system.passRate !== null ? `${layers.system.passRate}%` : "—"} | ${escapeMarkdownCell(sysCovCell)} | ${layers.system.state === "NOT_RUN" ? "—" : escapeMarkdownCell(formatSuiteDuration(layers.system.durationMs))} |`,
      ``
    );

    if (trendSeries.length >= 2) {
      lines.push(
        `### ${REPORT_COPY.charts.trendLine.enTitle}`,
        ``,
        `| Run | Overall | Unit | Integration | System | Pass Rate |`,
        `|---|---|---|---|---|---|`,
        ...trendSeries.slice(-6).map(
          (pt, i) =>
            `| ${escapeMarkdownCell(pt.runLabel || pt.label || `#${i + 1}`)} | ${fmtPct(pt.overallCoverage ?? pt.overall ?? pt.coveragePct)} | ${fmtPct(pt.unitCoverage ?? pt.codePct ?? pt.unit)} | ${fmtPct(pt.integrationCoverage ?? pt.apiPct ?? pt.integration)} | ${fmtPct(pt.systemCoverage ?? pt.flowPct ?? pt.system)} | ${pt.passRate != null ? fmtPct(pt.passRate) : "—"} |`
        ),
        ``
      );
    } else {
      lines.push(
        `### ${REPORT_COPY.sectionTitles.diagram3Variance.en}`,
        ``,
        `| Metric | Measured | Target | Variance (pp) |`,
        `|---|---|---|---|`,
        ...varianceItems.map(
          (v) =>
            `| ${escapeMarkdownCell(v.enLabel)} | ${v.state === "NOT_RUN" || v.actual === null ? "—" : `${v.actual.toFixed(1)}%`} | ${v.target}% | ${escapeMarkdownCell(v.state === "NOT_RUN" || v.delta === null ? "Not Run" : `${v.delta > 0 ? "+" : ""}${v.delta.toFixed(1)} pp`)} |`
        ),
        ``
      );
    }

    if ((qualityGate.checklist || []).length > 0) {
      lines.push(
        `### Quality Gate Checklist`,
        ...(qualityGate.checklist || []).map((chk) => {
          const trChk = translateChecklistItem(chk);
          return `- [${chk.passed ? "x" : " "}] **${trChk.label}** — \`${trChk.currentValue}\``;
        }),
        ``
      );
    }
  }

  if (sections.traceMatrix || sections.pyramidPillars) {
    const prioritizedMatrix = sortMatrixRowsByRisk(matrixRows);
    const unitLow = layers.unit.lowCoverageHotspots || layers.unit.lowCoverageItems || [];
    const intCov = layers.integration.coverage;
    const hasDiscoveredApis = Number(intCov?.totalApis ?? 0) > 0;
    const nonZeroFails = [
      { key: "unitFailed", count: safeCount(failureDistribution?.unit?.failedTests) },
      { key: "route", count: safeCount(failureDistribution?.integration?.route) },
      { key: "middlewareAuth", count: safeCount(failureDistribution?.integration?.middlewareAuth) },
      { key: "controller", count: safeCount(failureDistribution?.integration?.controller) },
      { key: "database", count: safeCount(failureDistribution?.integration?.database) },
      { key: "selectorNotFound", count: safeCount(failureDistribution?.system?.selectorNotFound) },
      { key: "networkTimeout", count: safeCount(failureDistribution?.system?.networkTimeout) },
      { key: "assertion", count: safeCount(failureDistribution?.system?.assertion) },
      { key: "flaky", count: safeCount(failureDistribution?.system?.flaky) },
    ].filter((f) => f.count > 0);

    lines.push(
      `---`,
      ``,
      `## ${REPORT_COPY.sectionTitles.criticalGaps.en}`,
      ``
    );

    if (sections.traceMatrix && prioritizedMatrix.length > 0) {
      lines.push(
        `### ${REPORT_COPY.sectionTitles.diagram4Matrix.en}`,
        ``,
        `| Module | Unit | Integration | System | Root Cause & Suspect Layer |`,
        `|---|---|---|---|---|`,
        ...prioritizedMatrix.map((r) => {
          const diag = resolveDisplayRootCause(r);
          return `| **${escapeMarkdownCell(r.moduleName || "Module")}** | ${escapeMarkdownCell(translateMatrixCellLabel(r.unit?.label, r.unit?.status))} | ${escapeMarkdownCell(translateMatrixCellLabel(r.integration?.label, r.integration?.status))} | ${escapeMarkdownCell(translateMatrixCellLabel(r.system?.label, r.system?.status))} | ${escapeMarkdownCell(diag.summary)} (${escapeMarkdownCell(translateSuspectLayer(diag.suspectLayer))}) |`;
        }),
        ``
      );
    }

    lines.push(
      `### Low-Coverage Code Hotspots`,
      ``,
      `| File / Module | Branch Coverage | Line Coverage | Function Coverage | Gate Target |`,
      `|---|---|---|---|---|`,
      ...(unitLow.length > 0
        ? unitLow.map(
            (item) =>
              `| \`${escapeMarkdownCell(item.filePath || item.name || item.label || item.path || "file")}\` | ${fmtPct(item.branchesPct ?? item.coverage ?? item.value ?? 0)} | ${fmtPct(item.linesPct ?? 0)} | ${item.functionsPct !== null && item.functionsPct !== undefined ? fmtPct(item.functionsPct) : "—"} | 75.0% |`
          )
        : [
            `| *${escapeMarkdownCell(layers.unit.hasUnitFiles ? REPORT_COPY.notices.allFilesCovered.en : "No low-coverage hotspots recorded")}* | — | — | — | 75.0% |`,
          ]),
      ``,
      `### API Endpoint Coverage Breakdown`,
      ``,
      ...(hasDiscoveredApis
        ? [
            `| Covered APIs | Failed APIs | Uncovered / Untested APIs | Total AST APIs | API Coverage |`,
            `|---|---|---|---|---|`,
            `| ${fmtCount(intCov.coveredApis)} | ${fmtCount(intCov.failedApis)} | ${fmtCount(intCov.uncoveredApis)} | ${fmtCount(intCov.totalApis)} | ${layers.integration.state === "NOT_RUN" ? "—" : fmtPct(intCov.apiEndpoint)} |`,
          ]
        : [`> ${REPORT_COPY.notices.zeroApisDiscovered.en}`]),
      ``
    );

    if (nonZeroFails.length > 0) {
      lines.push(
        `**Failure Distribution:** ${nonZeroFails
          .map((f) => {
            const d = FAILURE_CATEGORY_LABELS[f.key] || { en: f.key };
            return `${d.en} (${f.count})`;
          })
          .join(" · ")}`,
        ``
      );
    }
  }

  if (sections.actionCenter) {
    lines.push(
      `---`,
      ``,
      `## ${REPORT_COPY.sectionTitles.actions.en}`,
      ``,
      ...(actionItems.length > 0
        ? actionItems.slice(0, 8).map((act, idx) => {
            const priority = String(act?.priority || "INFO").toUpperCase();
            const title = nfc(act?.title || "Remediation Action");
            const pillarTag = String(act?.pillar || "").toUpperCase();
            const pillarSuffix = pillarTag ? ` (${pillarTag})` : "";
            const targetName = nfc(act?.targetName || "");
            const desc = nfc(
              act?.description ||
                act?.ctaLabel ||
                "Investigate and resolve layer issue."
            );
            const targetLine = targetName ? ` — \`${targetName}\`` : "";
            return `${idx + 1}. **[${priority}] ${title}**${pillarSuffix}${targetLine}: ${desc}`;
          })
        : [`1. No pending remediation actions; continue monitoring test execution.`]),
      ``
    );
  }

  if (showFeatureDurations) {
    lines.push(
      `---`,
      ``,
      `## ${REPORT_COPY.sectionTitles.featureDurations.en}`,
      ``,
      `| Feature | Runs | Latest | Cumulative Total | Average | Status |`,
      `|---|---|---|---|---|---|`,
      ...(featureDurations || []).map((row) => {
        const hasRuns = Number(row?.runCount || 0) > 0;
        const statusLabel = hasRuns ? String(row.lastStatus || "SUCCESS").toUpperCase() : "NOT RUN";
        return `| **${escapeMarkdownCell(row.label)}** | ${hasRuns ? fmtCount(row.runCount) : "0"} | ${escapeMarkdownCell(hasRuns ? fmtDuration(row.latestDurationMs) : "—")} | ${escapeMarkdownCell(hasRuns ? fmtDuration(row.totalDurationMs) : "—")} | ${escapeMarkdownCell(hasRuns ? fmtDuration(row.avgDurationMs) : "—")} | ${escapeMarkdownCell(statusLabel)} |`;
      }),
      ``
    );
  }

  if (showAiTrustworthiness) {
    const evalData = aiTrustworthiness || { hasRun: false, status: "NOT_RUN", verdict: "NOT_RUN" };
    const hasRun = Boolean(evalData.hasRun && evalData.status !== "NOT_RUN");
    lines.push(
      `---`,
      ``,
      `## ${REPORT_COPY.sectionTitles.aiTrustworthiness.en}`,
      ``
    );
    if (!hasRun) {
      lines.push(
        `> **Status:** Not Run — No AI trustworthiness evaluation has been executed for this project yet.`,
        ``
      );
      if (evalData.designAudit?.status === "READY") {
        lines.push(
          `- **Design Audit:** ${evalData.designAudit.detected ? `Chatbot Detected (${evalData.designAudit.designScore ?? "—"}/100, ${evalData.designAudit.findingsCount} findings)` : "No Chatbot Detected"}`,
          ``
        );
      }
    } else {
      const spr = evalData.scenarioPassRate;
      const stab = evalData.stability;
      const lat = evalData.latency;
      lines.push(
        `- **Verdict:** **${formatAiEvalVerdictLabel(evalData)}** (${evalData.status})`,
        `- **Trust Score:** ${formatAiEvalScoreText(evalData)}${evalData.passMark !== null ? ` (Pass Mark: ${evalData.passMark}/100)` : ""}`,
        `- **Scenario Pass Rate:** ${spr ? `${spr.rate !== null ? fmtPct(spr.rate) : "—"} (${spr.passed}/${spr.evaluated} evaluated)` : "—"}`,
        `- **Response Stability:** ${stab?.stabilityRate !== null && stab?.stabilityRate !== undefined ? `${fmtPct(stab.stabilityRate)} (${stab.stableCases}/${stab.eligibleCases})` : "—"}`,
        `- **Response Latency:** ${lat?.avgMs !== null && lat?.avgMs !== undefined ? `Avg ${fmtDuration(lat.avgMs)}${lat.p95Ms !== null ? ` · P95 ${fmtDuration(lat.p95Ms)}` : ""}` : "—"}`,
        ``
      );
      if (Array.isArray(evalData.criteriaSummary) && evalData.criteriaSummary.length > 0) {
        lines.push(
          `| Evaluation Criterion | Score | Checks Scored |`,
          `|---|---|---|`,
          ...evalData.criteriaSummary.map(
            (c) =>
              `| **${escapeMarkdownCell(c.label || c.criterionKey)}** | ${c.score !== null && c.score !== undefined ? fmtPct(c.score) : "—"} | ${c.applicable > 0 ? `${c.scored}/${c.applicable}` : "Not checked"} |`
          ),
          ``
        );
      }
    }
  }

  if (sections.trendsHistory) {
    lines.push(
      `---`,
      ``,
      `## ${REPORT_COPY.sectionTitles.history.en}`,
      ``,
      `| Run ID | Suite | Status | Pass / Fail | Coverage | Duration | Commit |`,
      `|---|---|---|---|---|---|---|`,
      ...(historyRuns.length > 0
        ? historyRuns.slice(0, 8).map(
            (run) =>
              `| \`${escapeMarkdownCell(run.shortId || run.id || "—")}\` | ${escapeMarkdownCell(String(run.type || "—").toUpperCase())} | ${escapeMarkdownCell(translateHistoryStatus(run.status))} | ${run.passed ?? 0} / ${run.failed ?? 0} | ${fmtPct(run.coveragePct)} | ${escapeMarkdownCell(formatSuiteDuration(run.durationMs))} | \`${escapeMarkdownCell(run.commitSha || "N/A")}\` |`
          )
        : [`| *No runs recorded* | — | — | — | — | — | — |`]),
      ``
    );
  }

  lines.push(
    `---`,
    ``,
    `## ${REPORT_COPY.sectionTitles.caveats.en}`,
    ``,
    `- NOT RUN layers (0 executed tests) and untested AST APIs indicate unverified scope rather than 0% test failures.`,
    `- Metrics reflect the selected snapshot state; re-run missing suites before final release sign-off.`
  );

  return nfc(lines.join("\n"));
}

/**
 * Builds structured schemaVersion "2.0" JSON report payload with full Page-1 diagram parity.
 */
export function buildFilteredJsonPayload(
  vm,
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const { sections, options } = resolveSectionsAndOptions(sectionsOrOptions, maybeOptions);
  const lang = options.language;
  const model = buildReportMetricsModel(vm);
  const bullets = buildExecutiveBullets(vm, model);
  const {
    layers,
    execution,
    coverage,
    health,
    qualityGate,
    pyramid,
    varianceItems,
    weightedContributions,
    trendSeries,
    matrixRows,
    failureDistribution,
    actionPriorityCounts,
    actionPillarCounts,
    featureDurations,
    aiTrustworthiness,
  } = model;

  const showFeatureDurations = Boolean(
    sections.featureDurations ?? (sections.pyramidPillars || sections.trendsHistory)
  );
  const showAiTrustworthiness = Boolean(
    sections.aiTrustworthiness ??
      (sections.pyramidPillars ||
        sections.traceMatrix ||
        sections.actionCenter ||
        sections.trendsHistory)
  );

  const prioritizedMatrix = sortMatrixRowsByRisk(matrixRows).map((r) => {
    const diag = resolveDisplayRootCause(r);
    if (
      diag.suspectLayer !== (r.rootCause?.suspectLayer || "none") ||
      diag.summary !== (r.rootCause?.summary || "—")
    ) {
      return {
        ...r,
        rootCause: {
          ...(r.rootCause || {}),
          suspectLayer: diag.suspectLayer,
          summary: diag.summary,
        },
      };
    }
    return r;
  });
  const unitLowCoverageHotspots =
    layers.unit.lowCoverageHotspots || layers.unit.lowCoverageItems || [];
  const totalExec = Math.max(0, execution.total);

  const payload = {
    reportMeta: {
      schemaVersion: "2.0",
      generator: "CovAI Unified Quality Analytics",
      language: lang,
      exportedAt: new Date().toISOString(),
      projectName: nfc(vm?.context?.projectName || "Project"),
      branch: nfc(vm?.context?.branch || "main"),
      snapshotId: vm?.context?.snapshotId || null,
      snapshotLabel: vm?.context?.snapshotLabel ? nfc(vm.context.snapshotLabel) : null,
      qualityGateStatus: qualityGate?.status || "UNVERIFIED",
    },
    context: vm?.context,
  };

  if (sections.executive) {
    payload.executiveSummary = {
      verdict: translateGateStatus(qualityGate.status, qualityGate.label),
      bullets,
    };
    payload.qualityGate = vm?.qualityGate;
    payload.health = health;
    payload.execution = execution;
    payload.coverage = coverage;
    payload.ai = vm?.ai;
  }

  if (sections.pyramidPillars) {
    payload.pyramid = vm?.pyramid;
    payload.pillars = vm?.pillars;
    payload.layerDefinitions = {
      unit: {
        ...LAYER_GUIDES.unit,
        state: layers.unit.state,
        framework: layers.unit.framework,
        metrics: {
          totalTests: layers.unit.totalTests,
          passedTests: layers.unit.passedTests,
          failedTests: layers.unit.failedTests,
          skippedTests: layers.unit.skippedTests,
          passRate: layers.unit.passRate,
          durationMs: layers.unit.durationMs,
          avgDurationMs: layers.unit.avgDurationMs,
          avgTestDurationMs: layers.unit.avgTestDurationMs,
          coverage: layers.unit.coverage,
        },
      },
      integration: {
        ...LAYER_GUIDES.integration,
        state: layers.integration.state,
        framework: layers.integration.framework,
        metrics: {
          totalTests: layers.integration.totalTests,
          passedTests: layers.integration.passedTests,
          failedTests: layers.integration.failedTests,
          skippedTests: layers.integration.skippedTests,
          passRate: layers.integration.passRate,
          durationMs: layers.integration.durationMs,
          avgDurationMs: layers.integration.avgDurationMs,
          avgEndpointLatencyMs: layers.integration.avgEndpointLatencyMs,
          coverage: layers.integration.coverage,
        },
      },
      system: {
        ...LAYER_GUIDES.system,
        state: layers.system.state,
        framework: layers.system.framework,
        metrics: {
          totalTests: layers.system.totalTests,
          passedTests: layers.system.passedTests,
          failedTests: layers.system.failedTests,
          skippedTests: layers.system.skippedTests,
          flakyTests: layers.system.flakyTests,
          passRate: layers.system.passRate,
          durationMs: layers.system.durationMs,
          avgDurationMs: layers.system.avgDurationMs,
          avgTestDurationMs: layers.system.avgTestDurationMs,
          coverage: layers.system.coverage,
        },
      },
    };
    payload.coverageSummary = {
      weights: UNIFIED_DASHBOARD_CONFIG.weights,
      weightedContributions,
      overall: coverage.overall,
      varianceVsGate: varianceItems,
    };
  }

  payload.coverageDiagrams = {
    tierBarComparison: [
      {
        tier: "unit",
        state: layers.unit.state,
        totalTests: layers.unit.totalTests,
        passedTests: layers.unit.passedTests,
        failedTests: layers.unit.failedTests,
        skippedTests: layers.unit.skippedTests,
        passRate: layers.unit.passRate,
        durationMs: layers.unit.durationMs,
        coverage: coverage.codePct,
        target: UNIFIED_DASHBOARD_CONFIG.qualityGate.coverageThresholds.unitLinesPct,
      },
      {
        tier: "integration",
        state: layers.integration.state,
        totalTests: layers.integration.totalTests,
        passedTests: layers.integration.passedTests,
        failedTests: layers.integration.failedTests,
        skippedTests: layers.integration.skippedTests,
        passRate: layers.integration.passRate,
        durationMs: layers.integration.durationMs,
        avgEndpointLatencyMs: layers.integration.avgEndpointLatencyMs,
        coverage: coverage.apiPct,
        target: 80,
      },
      {
        tier: "system",
        state: layers.system.state,
        totalTests: layers.system.totalTests,
        passedTests: layers.system.passedTests,
        failedTests: layers.system.failedTests,
        skippedTests: layers.system.skippedTests,
        passRate: layers.system.passRate,
        durationMs: layers.system.durationMs,
        coverageAvailable: layers.system.coverage.coverageAvailable,
        coverage: layers.system.coverage.coverageAvailable ? coverage.flowPct : null,
        target: 80,
      },
    ],
    tierOutcomeDonut: {
      total: execution.total,
      passed: execution.passed,
      failed: execution.failed,
      skipped: execution.skipped,
      flaky: execution.flaky,
      passRate: execution.passRate,
      uncoveredApis: execution.uncoveredApis,
      tiers: [
        {
          tier: "unit",
          state: layers.unit.state,
          total: layers.unit.totalTests,
          passed: layers.unit.passedTests,
          failed: layers.unit.failedTests,
          skipped: layers.unit.skippedTests,
          sharePct: totalExec > 0 ? Number(((layers.unit.totalTests / totalExec) * 100).toFixed(1)) : 0,
        },
        {
          tier: "integration",
          state: layers.integration.state,
          total: layers.integration.totalTests,
          passed: layers.integration.passedTests,
          failed: layers.integration.failedTests,
          skipped: layers.integration.skippedTests,
          uncoveredApis: layers.integration.coverage.uncoveredApis,
          sharePct: totalExec > 0 ? Number(((layers.integration.totalTests / totalExec) * 100).toFixed(1)) : 0,
        },
        {
          tier: "system",
          state: layers.system.state,
          total: layers.system.totalTests,
          passed: layers.system.passedTests,
          failed: layers.system.failedTests,
          skipped: layers.system.skippedTests,
          flaky: layers.system.flakyTests,
          sharePct: totalExec > 0 ? Number(((layers.system.totalTests / totalExec) * 100).toFixed(1)) : 0,
        },
      ],
    },
    coveragePassRateTrend: {
      mode: trendSeries.length >= 2 ? "trend" : "baseline",
      seriesCount: trendSeries.length,
      series: trendSeries,
      variance: varianceItems,
      weightedContributions,
    },
    moduleTierHeatmap: {
      mode: prioritizedMatrix.length > 0 ? "heatmap" : "readiness",
      totalRows: prioritizedMatrix.length,
      page1RowsShown: Math.min(6, prioritizedMatrix.length),
      rows: prioritizedMatrix,
      unitLowCoverageItems: unitLowCoverageHotspots,
      apiBreakdown: {
        coveredApis: layers.integration.coverage.coveredApis,
        failedApis: layers.integration.coverage.failedApis,
        uncoveredApis: layers.integration.coverage.uncoveredApis,
        totalApis: layers.integration.coverage.totalApis,
      },
    },
    // Backward-compatible keys preserved for downstream consumers
    coverageVsTargets: [
      { metric: "unitLines", actual: coverage.codePct, passRate: layers.unit.passRate, target: 70, state: layers.unit.state },
      { metric: "unitBranches", actual: coverage.branchPct, passRate: null, target: 75, state: layers.unit.state },
      { metric: "apiEndpoints", actual: coverage.apiPct, passRate: layers.integration.passRate, target: 80, state: layers.integration.state },
      { metric: "systemFlows", actual: layers.system.coverage.coverageAvailable ? coverage.flowPct : null, coverageAvailable: layers.system.coverage.coverageAvailable, passRate: layers.system.passRate, target: 80, state: layers.system.state },
    ],
    pyramidAndOutcomes: {
      shape: pyramid.shape,
      layers: [
        { pillar: "unit", state: layers.unit.state, total: layers.unit.totalTests, passed: layers.unit.passedTests, failed: layers.unit.failedTests, skipped: layers.unit.skippedTests },
        { pillar: "integration", state: layers.integration.state, total: layers.integration.totalTests, passed: layers.integration.passedTests, failed: layers.integration.failedTests, skipped: layers.integration.skippedTests, uncoveredApis: layers.integration.coverage.uncoveredApis },
        { pillar: "system", state: layers.system.state, total: layers.system.totalTests, passed: layers.system.passedTests, failed: layers.system.failedTests, skipped: layers.system.skippedTests, flaky: layers.system.flakyTests },
      ],
    },
    trendOrVariance: {
      mode: trendSeries.length >= 2 ? "trend" : "variance",
      seriesCount: trendSeries.length,
      series: trendSeries,
      variance: varianceItems,
      weightedContributions,
    },
    moduleOrHotspotGaps: {
      mode: matrixRows.length > 0 ? "matrix" : "hotspots",
      matrixRowCount: matrixRows.length,
      unitLowCoverageItems: unitLowCoverageHotspots,
      apiBreakdown: {
        coveredApis: layers.integration.coverage.coveredApis,
        failedApis: layers.integration.coverage.failedApis,
        uncoveredApis: layers.integration.coverage.uncoveredApis,
        totalApis: layers.integration.coverage.totalApis,
      },
    },
    failureDistributionAndActions: {
      totalExecutedTests: execution.total,
      failureDistribution,
      actionPriorityCounts,
      actionPillarCounts,
    },
  };

  if (sections.traceMatrix) {
    payload.matrix = vm?.matrix;
  }
  if (sections.actionCenter) {
    payload.actions = vm?.actions;
  }
  if (sections.trendsHistory) {
    payload.trend = vm?.trend;
    payload.history = vm?.history;
  }
  if (showFeatureDurations) {
    payload.featureDurations = featureDurations;
  }
  if (showAiTrustworthiness) {
    payload.aiTrustworthiness = aiTrustworthiness;
  }

  payload.methodologyAndCaveats = METHODOLOGY_ITEMS;

  return payload;
}

/**
 * Generates A4 print-ready HTML via hidden iframe, awaits font/layout settle, and opens Print/Save PDF.
 */
export function exportUnifiedDashboardPdf(
  vm,
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const html = generatePdfHtmlReport(vm, sectionsOrOptions, maybeOptions);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc || !win) {
    document.body.removeChild(iframe);
    throw new Error("Could not initialize PDF print frame.");
  }

  doc.open();
  doc.write(html);
  doc.close();

  let cleaned = false;
  let cleanupTimer = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanupTimer !== null) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    win?.removeEventListener?.("afterprint", cleanup);
    if (typeof window !== "undefined") {
      window.removeEventListener?.("afterprint", cleanup);
    }
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  win.addEventListener?.("afterprint", cleanup);
  if (typeof window !== "undefined") {
    window.addEventListener?.("afterprint", cleanup);
  }
  cleanupTimer = setTimeout(cleanup, 60000);
  cleanupTimer?.unref?.();

  const triggerPrint = () => {
    try {
      win.focus?.();
      win.print?.();
    } catch (err) {
      cleanup();
      throw err;
    }
  };

  const waitFonts = doc.fonts?.ready
    ? Promise.race([doc.fonts.ready, new Promise((resolve) => setTimeout(resolve, 350))])
    : Promise.resolve();

  waitFonts.then(() => {
    const raf = win.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    raf(() => raf(triggerPrint));
  });

  return true;
}

/**
 * Builds a structured AI analysis prompt containing full Unified Dashboard metrics & gaps
 * so the CovAI Chatbot can immediately diagnose quality health and propose next steps.
 */
export function buildDashboardAiAnalysisPrompt(vm) {
  const {
    context = {},
    qualityGate = {},
    health = {},
    execution = {},
    coverage = {},
    pillars = {},
    pyramid = {},
    matrix = {},
    actions = {},
  } = vm || {};

  const failingModules = (matrix.rows || [])
    .filter(
      (r) =>
        r.unit?.status === "fail" ||
        r.integration?.status === "fail" ||
        r.system?.status === "fail"
    )
    .slice(0, 5)
    .map(
      (r) =>
        `- ${r.moduleName}: Unit=${r.unit?.label || "N/A"}, Integration=${r.integration?.label || "N/A"}, System=${r.system?.label || "N/A"} | Suspect=${r.rootCause?.suspectLayer || "unknown"} (${r.rootCause?.summary || "no summary"})`
    );

  const lowCovFiles = (pillars.unit?.lowCoverageItems || [])
    .slice(0, 5)
    .map((item) => `- ${item.label || item.path || item.name}: ${item.value ?? item.coverage ?? item.branchesPct ?? "—"}`);

  const topActions = (actions.items || [])
    .slice(0, 5)
    .map(
      (a) =>
        `- [${a?.priority || "INFO"}] (${a?.pillar || "general"}) ${a?.title || "Action"} -> ${a?.targetName || "N/A"}: ${a?.description || a?.ctaLabel || "Investigate issue"}`
    );

  return [
    `Analyze the Unified Quality Dashboard for project "${context.projectName || "Project"}" (branch: ${context.branch || "main"}, snapshot: ${context.snapshotLabel || context.snapshotId || "active"}).`,
    ``,
    `Current Metrics:`,
    `- Quality Gate: ${qualityGate.label || qualityGate.status || "PENDING"}`,
    `- Health Score: ${health.score ?? "—"}/100 (Grade ${health.grade ?? "—"})`,
    `- Test Execution: ${execution.total ?? 0} total (${execution.passRate ?? 0}% pass rate: ${execution.passed ?? 0} passed, ${execution.failed ?? 0} failed, ${execution.skipped ?? 0} skipped)`,
    `- Coverage Index: Overall ${fmtPct(coverage.overall)} | Unit Lines ${fmtPct(coverage.codePct)} (Branches ${fmtPct(coverage.branchPct)}) | Integration API ${fmtPct(coverage.apiPct)} (Uncovered APIs: ${execution.uncoveredApis ?? 0}) | System Flow ${pillars.system?.totalTests > 0 && pillars.system?.coverageAvailable === false ? "Pending" : fmtPct(coverage.flowPct)}`,
    `- Testing Pyramid: ${pyramid.badgeTitle || pyramid.shape || "N/A"}${pyramid.warning ? ` (${pyramid.warning})` : ""}`,
    ``,
    failingModules.length > 0 ? `Failing Modules:\n${failingModules.join("\n")}` : `Failing Modules: None recorded.`,
    lowCovFiles.length > 0 ? `\nLow Coverage Targets:\n${lowCovFiles.join("\n")}` : "",
    topActions.length > 0 ? `\nPrioritized Actions:\n${topActions.join("\n")}` : "",
    ``,
    `Please provide a concise engineering assessment: (1) key bottlenecks blocking the quality gate, (2) root-cause patterns across Unit/Integration/System layers, and (3) top 3 concrete actions I should take next.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Export full or partial dashboard as HTML, Markdown, or JSON file.
 */
export function exportUnifiedDashboardReport(
  vm,
  format = "markdown",
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const { sections, options } = resolveSectionsAndOptions(sectionsOrOptions, maybeOptions);
  const snapshotSlug = (vm?.context?.snapshotId || "snapshot").slice(0, 8);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fmt = String(format || "markdown").toLowerCase();

  if (fmt === "json") {
    const filename = `covai-quality-report-${snapshotSlug}-${timestamp}.json`;
    const jsonStr = JSON.stringify(buildFilteredJsonPayload(vm, sections, options), null, 2);
    downloadBlob(jsonStr, filename, "application/json;charset=utf-8");
    return filename;
  }

  if (fmt === "html") {
    const filename = `covai-quality-report-${snapshotSlug}-${timestamp}.html`;
    const htmlStr = generateHtmlReport(vm, sections, { ...options, printMode: false });
    downloadBlob(htmlStr, filename, "text/html;charset=utf-8");
    return filename;
  }

  const filename = `covai-quality-report-${snapshotSlug}-${timestamp}.md`;
  const markdownStr = generateMarkdownReport(vm, sections, options);
  downloadBlob(markdownStr, filename, "text/markdown;charset=utf-8");
  return filename;
}

export default exportUnifiedDashboardReport;
