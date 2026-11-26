import { fmtPct, fmtCount, fmtDuration } from "./format.js";
import { UNIFIED_DASHBOARD_CONFIG } from "./unifiedDashboard.config.js";
import {
  nfc,
  normalizeReportLanguage,
  formatHumanDate,
  pickText,
  translateGateStatus,
  translatePyramidShape,
  translateChecklistItem,
  translateSuspectLayer,
  translateMatrixCellLabel,
  translateHistoryStatus,
  LAYER_GUIDES,
  METHODOLOGY_ITEMS,
  FAILURE_CATEGORY_LABELS,
  ACTION_PRIORITY_LABELS,
  REPORT_COPY,
} from "./unifiedDashboard.reportI18n.js";
import {
  buildReportMetricsModel,
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

function formatLayerStateBadge(state, lang = "bilingual") {
  if (state === "ALL_PASSING") {
    return {
      tone: "pass",
      en: "ALL PASSING",
      vi: nfc("Đạt toàn bộ"),
      text: pickText("ALL PASSING", "Đạt toàn bộ", lang),
    };
  }
  if (state === "HAS_FAILURES") {
    return {
      tone: "fail",
      en: "HAS FAILURES",
      vi: nfc("Có lỗi trượt"),
      text: pickText("HAS FAILURES", "Có lỗi trượt", lang),
    };
  }
  return {
    tone: "neutral",
    en: "NOT RUN",
    vi: nfc("Chưa chạy"),
    text: pickText("NOT RUN", "Chưa chạy", lang),
  };
}

function renderStatusBadgeHtml(status, label) {
  const s = String(status || "").toUpperCase();
  let cls = "badge-neutral";
  if (s === "PASS" || s === "PASSED" || s === "COMPLETED" || s === "ALL_PASSING") {
    cls = "badge-pass";
  } else if (s === "FAIL" || s === "FAILED" || s === "BLOCKED" || s === "HAS_FAILURES") {
    cls = "badge-fail";
  } else if (s === "WARN" || s === "WARNING" || s === "PARTIAL") {
    cls = "badge-warn";
  }
  return `<span class="badge ${cls}">${escapeHtml(label || s || "N/A")}</span>`;
}

function buildExecutiveBullets(vm, model) {
  const ctx = vm?.context || {};
  const project = nfc(ctx.projectName || "Project");
  const { layers, execution, coverage, health, qualityGate, pyramid, actionItems, ai } = model;
  const gateInfo = translateGateStatus(qualityGate.status, qualityGate.label);
  const pyrInfo = translatePyramidShape(pyramid.shape, pyramid.badgeTitle, pyramid.warning);

  const unrunEn = [];
  const unrunVi = [];
  if (layers.unit.state === "NOT_RUN") {
    unrunEn.push("Unit");
    unrunVi.push("Đơn vị");
  }
  if (layers.integration.state === "NOT_RUN") {
    unrunEn.push("Integration");
    unrunVi.push("Tích hợp");
  }
  if (layers.system.state === "NOT_RUN") {
    unrunEn.push("System");
    unrunVi.push("Hệ thống");
  }

  const bullet1 = {
    enTopic: "Release Verdict:",
    enBody:
      execution.total === 0
        ? `${project} is ${gateInfo.en} with 0 executed tests; run suites to establish a Health Score baseline.`
        : `${project} is ${gateInfo.en} with Health Score ${health.score ?? "—"}/100 (Grade ${health.grade ?? "—"}).`,
    viTopic: nfc("Mức độ Sẵn sàng:"),
    viBody:
      execution.total === 0
        ? nfc(`${project} ở trạng thái ${gateInfo.vi} do chưa chạy kiểm thử; cần chạy để lập mốc Điểm Sức khỏe.`)
        : nfc(`${project} ở trạng thái ${gateInfo.vi}, Điểm Sức khỏe ${health.score ?? "—"}/100 (Hạng ${health.grade ?? "—"}).`),
  };

  const bullet2 = {
    enTopic: "3-Tier Execution:",
    enBody:
      execution.total === 0
        ? `Unit (0), Integration (0), and System (0) are NOT RUN.${execution.uncoveredApis > 0 ? ` ${execution.uncoveredApis} AST APIs await integration tests.` : ""}`
        : `${fmtCount(execution.total)} tests ran (${execution.passRate}% pass: ${fmtCount(execution.passed)}P/${fmtCount(execution.failed)}F/${fmtCount(execution.skipped)}S) — ${pyrInfo.enTitle}.${unrunEn.length > 0 ? ` Unrun: ${unrunEn.join(", ")}.` : ""}`,
    viTopic: nfc("Thực thi 3 Tầng:"),
    viBody:
      execution.total === 0
        ? nfc(`Cả 3 tầng đều Chưa chạy (0 bài).${execution.uncoveredApis > 0 ? ` Có ${execution.uncoveredApis} API (AST) chờ kiểm thử tích hợp.` : ""}`)
        : nfc(`Đã chạy ${fmtCount(execution.total)} bài (Đạt ${execution.passRate}%: ${fmtCount(execution.passed)} Đạt/${fmtCount(execution.failed)} Trượt) — ${pyrInfo.viTitle}.${unrunVi.length > 0 ? ` Chưa chạy: ${unrunVi.join(", ")}.` : ""}`),
  };

  const bullet3 = {
    enTopic: "Coverage & Gaps:",
    enBody: `Weighted coverage is ${fmtPct(coverage.overall)} (Unit ${layers.unit.state === "NOT_RUN" ? "Not Run" : fmtPct(coverage.codePct)}, API ${layers.integration.state === "NOT_RUN" ? "Not Run" : fmtPct(coverage.apiPct)}, E2E ${layers.system.state === "NOT_RUN" ? "Not Run" : fmtPct(coverage.flowPct)}), with ${fmtCount(ai.gaps ?? 0)} open gaps and ${fmtCount(execution.uncoveredApis)} untested APIs.`,
    viTopic: nfc("Độ phủ & Khoảng trống:"),
    viBody: nfc(`Độ phủ trọng số đạt ${fmtPct(coverage.overall)} (Đơn vị ${layers.unit.state === "NOT_RUN" ? "Chưa chạy" : fmtPct(coverage.codePct)}, API ${layers.integration.state === "NOT_RUN" ? "Chưa chạy" : fmtPct(coverage.apiPct)}, E2E ${layers.system.state === "NOT_RUN" ? "Chưa chạy" : fmtPct(coverage.flowPct)}), còn ${fmtCount(ai.gaps ?? 0)} khoảng trống và ${fmtCount(execution.uncoveredApis)} API chưa phủ.`),
  };

  const topAction = actionItems[0];
  const topPriority = nfc(topAction?.priority || "INFO").toUpperCase();
  const topTitleEn = nfc(topAction?.title || "Recommended remediation action");
  const topTitleVi = nfc(topAction?.title || "Hành động khắc phục khuyến nghị");
  const topTarget = nfc(topAction?.targetName || "");
  const topTargetSuffix = topTarget ? ` (${topTarget})` : "";

  const bullet4 = {
    enTopic: "Immediate Priority:",
    enBody: topAction
      ? `[${topPriority}] ${topTitleEn}${topTargetSuffix}.`
      : unrunEn.length > 0
        ? `Run missing ${unrunEn.join(" & ")} suite(s) to close unverified blind spots.`
        : "Maintain current suite coverage and monitor branch gates on upcoming commits.",
    viTopic: nfc("Ưu tiên Tiếp theo:"),
    viBody: topAction
      ? nfc(`[${ACTION_PRIORITY_LABELS[topPriority]?.vi || topPriority}] ${topTitleVi}${topTargetSuffix}.`)
      : unrunVi.length > 0
        ? nfc(`Chạy bổ sung tầng ${unrunVi.join(" và ")} để đóng các điểm mù chưa xác minh.`)
        : nfc("Duy trì kỷ luật kiểm thử và theo dõi độ phủ nhánh ở các commit tiếp theo."),
  };

  return [bullet1, bullet2, bullet3, bullet4];
}

function buildChartTakeaways(model) {
  const { layers, execution, coverage, trendSeries, matrixRows } = model;
  const unitTxtEn = layers.unit.state === "NOT_RUN" ? "Unit Not Run" : `Unit ${fmtPct(coverage.codePct)} cov`;
  const intTxtEn = layers.integration.state === "NOT_RUN" ? "Integration Not Run" : `API ${fmtPct(coverage.apiPct)} cov`;
  const sysTxtEn = layers.system.state === "NOT_RUN" ? "System Not Run" : `E2E ${fmtPct(coverage.flowPct)} cov`;

  const unitTxtVi = layers.unit.state === "NOT_RUN" ? "Đơn vị Chưa chạy" : `Đơn vị phủ ${fmtPct(coverage.codePct)}`;
  const intTxtVi = layers.integration.state === "NOT_RUN" ? "Tích hợp Chưa chạy" : `API phủ ${fmtPct(coverage.apiPct)}`;
  const sysTxtVi = layers.system.state === "NOT_RUN" ? "Hệ thống Chưa chạy" : `E2E phủ ${fmtPct(coverage.flowPct)}`;

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
    tierBar: {
      en: `${unitTxtEn}, ${intTxtEn}, ${sysTxtEn} against dashed 70%/80% Quality Gate thresholds.`,
      vi: nfc(`${unitTxtVi}, ${intTxtVi}, ${sysTxtVi} đối chiếu với vạch ngưỡng cổng 70%/80%.`),
    },
    outcomeDonut: {
      en:
        execution.total === 0
          ? `0 executed tests across all 3 tiers; ${fmtCount(execution.uncoveredApis)} untested AST API(s) await coverage.`
          : `${fmtCount(execution.passed)} passed, ${fmtCount(execution.failed)} failed, ${fmtCount(execution.skipped)} skipped (${execution.passRate}% pass); ${fmtCount(execution.uncoveredApis)} untested API(s).`,
      vi:
        execution.total === 0
          ? nfc(`Chưa có bài kiểm thử chạy ở 3 tầng; có ${fmtCount(execution.uncoveredApis)} API (AST) chờ kiểm thử.`)
          : nfc(`${fmtCount(execution.passed)} đạt, ${fmtCount(execution.failed)} trượt, ${fmtCount(execution.skipped)} bỏ qua (${execution.passRate}% đạt); ${fmtCount(execution.uncoveredApis)} API chưa phủ.`),
    },
    trendLine:
      trendSeries.length >= 2
        ? {
            en: `Overall coverage ${trendDelta >= 0 ? "gained" : "shifted"} ${trendDelta >= 0 ? "+" : ""}${trendDelta} pp across ${Math.min(10, trendSeries.length)} runs (latest pass rate: ${lastTrend?.passRate ?? execution.passRate ?? "—"}%).`,
            vi: nfc(`Độ phủ tổng hợp ${trendDelta >= 0 ? "tăng" : "biến động"} ${trendDelta >= 0 ? "+" : ""}${trendDelta} điểm % qua ${Math.min(10, trendSeries.length)} lần chạy (tỷ lệ đạt gần nhất: ${lastTrend?.passRate ?? execution.passRate ?? "—"}%).`),
          }
        : {
            en: `Single snapshot (${trendSeries.length} run); shows current tier baselines vs. 80% gate without projecting a trend line.`,
            vi: nfc(`Chỉ có ${trendSeries.length} mốc chạy; hiển thị mốc chuẩn hiện tại so với ngưỡng 80% thay cho đường xu hướng.`),
          },
    moduleHeatmap:
      matrixRows.length > 0
        ? {
            en: `${failingMods} of ${matrixRows.length} tracked module(s) show cross-tier failures; failed rows are prioritized at top.`,
            vi: nfc(`${failingMods}/${matrixRows.length} mô-đun có lỗi liên tầng; các mô-đun trượt được xếp ưu tiên lên đầu.`),
          }
        : {
            en: "No module traceability rows recorded yet; top tiles show per-tier readiness status.",
            vi: nfc("Chưa có dữ liệu ma trận theo mô-đun; các ô phía trên phản ánh trạng thái sẵn sàng 3 tầng."),
          },
  };
}

function renderBiBlock(enHtml, viHtml, lang, tag = "div", cls = "") {
  const cAttr = cls ? ` class="${cls}"` : "";
  if (lang === "en") {
    return `<${tag}${cAttr} data-lang="en">${enHtml}</${tag}>`;
  }
  if (lang === "vi") {
    return `<${tag}${cAttr} data-lang="vi">${viHtml}</${tag}>`;
  }
  return `<${tag}${cAttr} data-lang="en">${enHtml}</${tag}><${tag}${cAttr} data-lang="vi">${viHtml}</${tag}>`;
}

function renderHeadingPair(enTitle, viTitle, lang, level = "h2") {
  if (lang === "en") return `<${level}>${escapeHtml(enTitle)}</${level}>`;
  if (lang === "vi") return `<${level}>${escapeHtml(viTitle)}</${level}>`;
  return `<${level}><span data-lang="en">${escapeHtml(enTitle)}</span><span data-lang="bilingual-sep" class="bi-sep"> · </span><span data-lang="vi" class="vi-heading-sub">${escapeHtml(viTitle)}</span></${level}>`;
}

/**
 * Generates a standalone, self-contained HTML5 executive report (for `.html` download and print-to-PDF).
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
  } = model;

  const gateInfo = translateGateStatus(qualityGate.status, qualityGate.label);
  const pyrInfo = translatePyramidShape(pyramid.shape, pyramid.badgeTitle, pyramid.warning);
  const bullets = buildExecutiveBullets(vm, model);
  const takeaways = buildChartTakeaways(model);
  const humanDate = formatHumanDate(new Date(), lang);
  const snapshotUpdated = ctx.updatedAt ? formatHumanDate(ctx.updatedAt, lang) : pickText("Not recorded", "Chưa ghi nhận", lang);

  const svgBar = renderTierBarComparisonSvg(model, lang);
  const svgDonut = renderTierOutcomeDonutSvg(model, lang);
  const svgTrend = renderCoveragePassRateTrendSvg(model, lang);
  const svgHeatmap = renderModuleTierHeatmapSvg(model, lang);

  const projectTitle = nfc(ctx.projectName || "Project");
  const docTitle =
    lang === "vi"
      ? `${REPORT_COPY.titlePrefix.vi} — ${projectTitle}`
      : `${REPORT_COPY.titlePrefix.en} — ${projectTitle}`;

  const toolbarHtml = printMode
    ? ""
    : `
      <div class="report-toolbar no-print" role="region" aria-label="Report display controls">
        <div class="toolbar-group">
          <span class="toolbar-label">${lang === "vi" ? "Ngôn ngữ:" : "Language:"}</span>
          ${
            lang === "bilingual"
              ? `
            <button type="button" class="tb-btn is-active" data-set-lang="bilingual">Bilingual (EN / VI)</button>
            <button type="button" class="tb-btn" data-set-lang="en">English (EN)</button>
            <button type="button" class="tb-btn" data-set-lang="vi">Tiếng Việt (VI)</button>
          `
              : `<span class="tb-pill">${lang === "en" ? "English (EN)" : "Tiếng Việt (VI)"}</span>`
          }
        </div>
        <div class="toolbar-group">
          <button type="button" class="tb-btn tb-btn-primary" onclick="window.print()">${escapeHtml(lang === "vi" ? "In / Lưu PDF" : "Print / Save PDF")}</button>
        </div>
      </div>
    `;

  const executiveSummaryHtml = sections.executive
    ? `
      <section class="sec sec-exec" id="sec-executive-summary">
        ${renderHeadingPair(REPORT_COPY.sectionTitles.executiveSummary.en, REPORT_COPY.sectionTitles.executiveSummary.vi, lang)}
        <ul class="exec-list">
          ${bullets
            .map((b) => {
              const enLi = `<strong>${escapeHtml(b.enTopic)}</strong> ${escapeHtml(b.enBody)}`;
              const viLi = `<strong>${escapeHtml(b.viTopic)}</strong> ${escapeHtml(b.viBody)}`;
              return `<li>${renderBiBlock(enLi, viLi, lang, "div", "bi-item")}</li>`;
            })
            .join("")}
        </ul>
      </section>

      <section class="sec sec-kpi" id="sec-kpi-strip" aria-label="${escapeHtml(pickText(REPORT_COPY.sectionTitles.kpiStrip.en, REPORT_COPY.sectionTitles.kpiStrip.vi, lang))}">
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">${escapeHtml(pickText("Health Score", "Điểm Sức khỏe", lang))}</div>
            <div class="kpi-val">${escapeHtml(health.score !== null ? `${health.score}/100` : "—")}</div>
            <div class="kpi-sub">${escapeHtml(pickText(`Grade ${health.grade ?? "Unverified"}`, `Hạng ${health.grade ?? "Chưa xác minh"}`, lang))}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">${escapeHtml(pickText("Executed & Pass Rate", "Thực thi & Tỷ lệ Đạt", lang))}</div>
            <div class="kpi-val">${escapeHtml(execution.total > 0 ? `${fmtCount(execution.total)} (${execution.passRate}%)` : pickText("Not Run", "Chưa chạy", lang))}</div>
            <div class="kpi-sub">${escapeHtml(
              lang === "vi"
                ? `${fmtCount(execution.passed)} Đạt · ${fmtCount(execution.failed)} Trượt · ${fmtCount(execution.skipped)} Bỏ qua`
                : `${fmtCount(execution.passed)}P · ${fmtCount(execution.failed)}F · ${fmtCount(execution.skipped)}S`
            )}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">${escapeHtml(pickText("Weighted Coverage", "Độ phủ Trọng số", lang))}</div>
            <div class="kpi-val">${escapeHtml(execution.total > 0 ? fmtPct(coverage.overall) : "—")}</div>
            <div class="kpi-sub">${escapeHtml(
              lang === "vi"
                ? `Đ.vị ${fmtPct(coverage.codePct)} · API ${fmtPct(coverage.apiPct)} · E2E ${fmtPct(coverage.flowPct)}`
                : `Unit ${fmtPct(coverage.codePct)} · API ${fmtPct(coverage.apiPct)} · E2E ${fmtPct(coverage.flowPct)}`
            )}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">${escapeHtml(pickText("Gaps & Untested APIs", "Khoảng trống & API", lang))}</div>
            <div class="kpi-val">${escapeHtml(`${fmtCount(ai.gaps ?? 0)} / ${fmtCount(execution.uncoveredApis)}`)}</div>
            <div class="kpi-sub">${escapeHtml(
              lang === "vi"
                ? `AI: ${fmtCount(ai.aiGenerated ?? 0)} tạo · ${fmtCount(ai.aiRepaired ?? 0)} sửa`
                : `AI: ${fmtCount(ai.aiGenerated ?? 0)} gen · ${fmtCount(ai.aiRepaired ?? 0)} fix`
            )}</div>
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
  const trendSubVi =
    trendSeries.length >= 2
      ? REPORT_COPY.charts.trendLine.viSubtitle
      : REPORT_COPY.charts.trendLine.viBaselineSubtitle;

  const heatmapSubEn =
    matrixRows.length > 0
      ? REPORT_COPY.charts.moduleHeatmap.enSubtitle
      : REPORT_COPY.charts.moduleHeatmap.enEmptySubtitle;
  const heatmapSubVi =
    matrixRows.length > 0
      ? REPORT_COPY.charts.moduleHeatmap.viSubtitle
      : REPORT_COPY.charts.moduleHeatmap.viEmptySubtitle;

  const page1ChartsHtml = showCharts
    ? `
      <section class="sec sec-charts" id="sec-overview-charts">
        ${renderHeadingPair(REPORT_COPY.sectionTitles.overviewCharts.en, REPORT_COPY.sectionTitles.overviewCharts.vi, lang)}
        <div class="charts-grid-2x2">
          <article class="chart-card">
            <div class="chart-head">
              ${renderHeadingPair(REPORT_COPY.charts.tierBar.enTitle, REPORT_COPY.charts.tierBar.viTitle, lang, "h3")}
              ${renderBiBlock(`<p class="chart-sub">${escapeHtml(REPORT_COPY.charts.tierBar.enSubtitle)}</p>`, `<p class="chart-sub">${escapeHtml(REPORT_COPY.charts.tierBar.viSubtitle)}</p>`, lang)}
            </div>
            <figure class="chart-fig">${svgBar}</figure>
            ${renderBiBlock(`<p class="chart-takeaway">${escapeHtml(takeaways.tierBar.en)}</p>`, `<p class="chart-takeaway">${escapeHtml(takeaways.tierBar.vi)}</p>`, lang)}
          </article>

          <article class="chart-card">
            <div class="chart-head">
              ${renderHeadingPair(REPORT_COPY.charts.outcomeDonut.enTitle, REPORT_COPY.charts.outcomeDonut.viTitle, lang, "h3")}
              ${renderBiBlock(`<p class="chart-sub">${escapeHtml(REPORT_COPY.charts.outcomeDonut.enSubtitle)}</p>`, `<p class="chart-sub">${escapeHtml(REPORT_COPY.charts.outcomeDonut.viSubtitle)}</p>`, lang)}
            </div>
            <figure class="chart-fig">${svgDonut}</figure>
            ${renderBiBlock(`<p class="chart-takeaway">${escapeHtml(takeaways.outcomeDonut.en)}</p>`, `<p class="chart-takeaway">${escapeHtml(takeaways.outcomeDonut.vi)}</p>`, lang)}
          </article>

          <article class="chart-card">
            <div class="chart-head">
              ${renderHeadingPair(REPORT_COPY.charts.trendLine.enTitle, REPORT_COPY.charts.trendLine.viTitle, lang, "h3")}
              ${renderBiBlock(`<p class="chart-sub">${escapeHtml(trendSubEn)}</p>`, `<p class="chart-sub">${escapeHtml(trendSubVi)}</p>`, lang)}
            </div>
            <figure class="chart-fig">${svgTrend}</figure>
            ${renderBiBlock(`<p class="chart-takeaway">${escapeHtml(takeaways.trendLine.en)}</p>`, `<p class="chart-takeaway">${escapeHtml(takeaways.trendLine.vi)}</p>`, lang)}
          </article>

          <article class="chart-card">
            <div class="chart-head">
              ${renderHeadingPair(REPORT_COPY.charts.moduleHeatmap.enTitle, REPORT_COPY.charts.moduleHeatmap.viTitle, lang, "h3")}
              ${renderBiBlock(`<p class="chart-sub">${escapeHtml(heatmapSubEn)}</p>`, `<p class="chart-sub">${escapeHtml(heatmapSubVi)}</p>`, lang)}
            </div>
            <figure class="chart-fig">${svgHeatmap}</figure>
            ${renderBiBlock(`<p class="chart-takeaway">${escapeHtml(takeaways.moduleHeatmap.en)}</p>`, `<p class="chart-takeaway">${escapeHtml(takeaways.moduleHeatmap.vi)}</p>`, lang)}
          </article>
        </div>
      </section>
    `
    : "";

  const keyFindingsHtml = sections.pyramidPillars
    ? `
      <section class="sec" id="sec-key-findings">
        ${renderHeadingPair(REPORT_COPY.sectionTitles.keyFindings.en, REPORT_COPY.sectionTitles.keyFindings.vi, lang)}
        ${renderBiBlock(
          `<p class="finding-lead"><strong>${escapeHtml(pyrInfo.enTitle)}:</strong> ${escapeHtml(pyrInfo.enExplain)}</p>`,
          `<p class="finding-lead"><strong>${escapeHtml(pyrInfo.viTitle)}:</strong> ${escapeHtml(pyrInfo.viExplain)}</p>`,
          lang
        )}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(pickText("Tier", "Tầng", lang))}</th>
                <th>${escapeHtml(pickText("Framework", "Công cụ", lang))}</th>
                <th>${escapeHtml(pickText("Status", "Trạng thái", lang))}</th>
                <th>${escapeHtml(pickText("Executed (P/F/S/Total)", "Thực thi (Đ/T/B/Tổng)", lang))}</th>
                <th>${escapeHtml(pickText("Pass Rate", "Tỷ lệ đạt", lang))}</th>
                <th>${escapeHtml(pickText("Primary Coverage", "Độ phủ Chính", lang))}</th>
                <th>${escapeHtml(pickText("Avg Latency", "Thời gian TB", lang))}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>${escapeHtml(pickText("Unit Tests", "Kiểm thử Đơn vị", lang))}</strong></td>
                <td class="mono">${escapeHtml(layers.unit.framework)}</td>
                <td>${renderStatusBadgeHtml(layers.unit.state, formatLayerStateBadge(layers.unit.state, lang).text)}</td>
                <td class="mono">${escapeHtml(`${layers.unit.passedTests}/${layers.unit.failedTests}/${layers.unit.skippedTests}/${layers.unit.totalTests}`)}</td>
                <td class="mono">${escapeHtml(layers.unit.passRate !== null ? `${layers.unit.passRate}%` : "—")}</td>
                <td class="mono">${escapeHtml(
                  layers.unit.state === "NOT_RUN"
                    ? "—"
                    : lang === "vi"
                      ? `Dòng ${fmtPct(layers.unit.coverage.lines)} · Nhánh ${fmtPct(layers.unit.coverage.branches)} · Hàm ${fmtPct(layers.unit.coverage.functions)} · Lệnh ${fmtPct(layers.unit.coverage.statements)}`
                      : `Lines ${fmtPct(layers.unit.coverage.lines)} · Branch ${fmtPct(layers.unit.coverage.branches)} · Fn ${fmtPct(layers.unit.coverage.functions)} · Stmt ${fmtPct(layers.unit.coverage.statements)}`
                )}</td>
                <td class="mono">${escapeHtml(layers.unit.state === "NOT_RUN" ? "—" : fmtDuration(layers.unit.avgDurationMs))}</td>
              </tr>
              <tr>
                <td><strong>${escapeHtml(pickText("Integration Tests", "Kiểm thử Tích hợp", lang))}</strong></td>
                <td class="mono">${escapeHtml(layers.integration.framework)}</td>
                <td>${renderStatusBadgeHtml(layers.integration.state, formatLayerStateBadge(layers.integration.state, lang).text)}</td>
                <td class="mono">${escapeHtml(`${layers.integration.passedTests}/${layers.integration.failedTests}/${layers.integration.skippedTests}/${layers.integration.totalTests}`)}</td>
                <td class="mono">${escapeHtml(layers.integration.passRate !== null ? `${layers.integration.passRate}%` : "—")}</td>
                <td class="mono">${escapeHtml(
                  layers.integration.state === "NOT_RUN"
                    ? lang === "vi"
                      ? `API — (${layers.integration.coverage.uncoveredApis} chưa phủ)`
                      : `API — (${layers.integration.coverage.uncoveredApis} untested)`
                    : `API ${fmtPct(layers.integration.coverage.apiEndpoint)} (${layers.integration.coverage.coveredApis}/${layers.integration.coverage.totalApis}) · ${lang === "vi" ? "Lệnh" : "Stmt"} ${fmtPct(layers.integration.coverage.statements)}`
                )}</td>
                <td class="mono">${escapeHtml(layers.integration.state === "NOT_RUN" ? "—" : fmtDuration(layers.integration.avgDurationMs))}</td>
              </tr>
              <tr>
                <td><strong>${escapeHtml(pickText("System Tests (E2E)", "Kiểm thử Hệ thống (E2E)", lang))}</strong></td>
                <td class="mono">${escapeHtml(layers.system.framework)}</td>
                <td>${renderStatusBadgeHtml(layers.system.state, formatLayerStateBadge(layers.system.state, lang).text)}</td>
                <td class="mono">${escapeHtml(`${layers.system.passedTests}/${layers.system.failedTests}/${layers.system.skippedTests}/${layers.system.totalTests}`)}</td>
                <td class="mono">${escapeHtml(layers.system.passRate !== null ? `${layers.system.passRate}%` : "—")}</td>
                <td class="mono">${escapeHtml(
                  layers.system.state === "NOT_RUN"
                    ? "—"
                    : lang === "vi"
                      ? `Luồng ${fmtPct(layers.system.coverage.flow)}`
                      : `Flow ${fmtPct(layers.system.coverage.flow)}`
                )}</td>
                <td class="mono">${escapeHtml(layers.system.state === "NOT_RUN" ? "—" : fmtDuration(layers.system.avgDurationMs))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${
          (qualityGate.checklist || []).length > 0
            ? `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>${escapeHtml(pickText("Quality Gate Criterion", "Tiêu chí Cổng Chất lượng", lang))}</th>
                      <th>${escapeHtml(pickText("Measured", "Đo được", lang))}</th>
                      <th>${escapeHtml(pickText("Gate", "Cổng", lang))}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${qualityGate.checklist
                      .map((chk) => {
                        const trChk = translateChecklistItem(chk, lang);
                        return `<tr>
                          <td><strong>${escapeHtml(trChk.label)}</strong></td>
                          <td class="mono">${escapeHtml(trChk.currentValue)}</td>
                          <td class="status-cell ${chk.passed ? "cell-pass" : "cell-fail"}">${renderStatusBadgeHtml(chk.passed ? "PASS" : "FAIL", chk.passed ? pickText("PASSED", "Đạt", lang) : pickText("BLOCKED", "Chưa đạt", lang))}</td>
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
  const unitLowItems = (layers.unit.lowCoverageItems || []).slice(0, 5);
  const intCovSummary = layers.integration.coverage;
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
        ${renderHeadingPair(REPORT_COPY.sectionTitles.criticalGaps.en, REPORT_COPY.sectionTitles.criticalGaps.vi, lang)}
        ${
          sections.traceMatrix && prioritizedMatrixRows.length > 0
            ? `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>${escapeHtml(pickText("Module", "Mô-đun", lang))}</th>
                      <th>${escapeHtml(pickText("Unit", "Đơn vị", lang))}</th>
                      <th>${escapeHtml(pickText("Integration", "Tích hợp", lang))}</th>
                      <th>${escapeHtml(pickText("System", "Hệ thống", lang))}</th>
                      <th>${escapeHtml(pickText("Diagnosis & Suspect Layer", "Chẩn đoán & Tầng nghi ngờ", lang))}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${prioritizedMatrixRows
                      .slice(0, 12)
                      .map(
                        (r) => `<tr>
                          <td><strong>${escapeHtml(r.moduleName || "Module")}</strong></td>
                          <td class="status-cell">${renderStatusBadgeHtml(r.unit?.status, translateMatrixCellLabel(r.unit?.label, r.unit?.status, lang))}</td>
                          <td class="status-cell">${renderStatusBadgeHtml(r.integration?.status, translateMatrixCellLabel(r.integration?.label, r.integration?.status, lang))}</td>
                          <td class="status-cell">${renderStatusBadgeHtml(r.system?.status, translateMatrixCellLabel(r.system?.label, r.system?.status, lang))}</td>
                          <td>${escapeHtml(r.rootCause?.summary || "—")} <span class="mono muted">(${escapeHtml(translateSuspectLayer(r.rootCause?.suspectLayer || "none", lang))})</span></td>
                        </tr>`
                      )
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
                    <thead>
                      <tr>
                        <th>${escapeHtml(pickText("Low-Coverage Hotspot", "Tệp Độ phủ thấp", lang))}</th>
                        <th>${escapeHtml(pickText("Branches", "Nhánh", lang))}</th>
                        <th>${escapeHtml(pickText("Lines", "Dòng", lang))}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${unitLowItems
                        .map(
                          (item) => `<tr>
                            <td class="mono">${escapeHtml(item.filePath || item.name || item.label || item.path || "file")}</td>
                            <td class="mono">${escapeHtml(fmtPct(item.branchesPct ?? item.coverage ?? item.value ?? 0))}</td>
                            <td class="mono">${escapeHtml(fmtPct(item.linesPct ?? 0))}</td>
                          </tr>`
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>`
              : ""
          }
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>${escapeHtml(pickText("AST API Summary", "Tổng hợp API (AST)", lang))}</th>
                  <th>${escapeHtml(pickText("Covered", "Đã phủ", lang))}</th>
                  <th>${escapeHtml(pickText("Failed", "Lỗi", lang))}</th>
                  <th>${escapeHtml(pickText("Uncovered", "Chưa phủ", lang))}</th>
                  <th>${escapeHtml(pickText("Total", "Tổng", lang))}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>${escapeHtml(pickText("Endpoints", "Điểm cuối", lang))}</strong></td>
                  <td class="mono">${escapeHtml(fmtCount(intCovSummary.coveredApis))}</td>
                  <td class="mono">${escapeHtml(fmtCount(intCovSummary.failedApis))}</td>
                  <td class="mono">${escapeHtml(fmtCount(intCovSummary.uncoveredApis))}</td>
                  <td class="mono">${escapeHtml(fmtCount(intCovSummary.totalApis))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="failure-line">
          ${
            execution.total === 0
              ? renderBiBlock(
                  `<strong>Failure Breakdown:</strong> Not Run (0 executed tests).`,
                  `<strong>Phân loại Lỗi:</strong> Chưa chạy kiểm thử (0 bài thực thi).`,
                  lang,
                  "span"
                )
              : nonZeroFailures.length > 0
                ? `<span class="mono"><strong>${escapeHtml(pickText("Failure Breakdown", "Phân loại Lỗi", lang))}:</strong> ${nonZeroFailures
                    .map((f) => {
                      const d = FAILURE_CATEGORY_LABELS[f.key] || { en: f.key, vi: f.key };
                      return `${escapeHtml(pickText(d.en, d.vi, lang))}: ${f.count}`;
                    })
                    .join(" · ")}</span>`
                : renderBiBlock(
                    `<strong>Failure Breakdown:</strong> 0 execution failures recorded.`,
                    `<strong>Phân loại Lỗi:</strong> Ghi nhận 0 lỗi thực thi.`,
                    lang,
                    "span"
                  )
          }
        </div>
      </section>
    `
      : "";

  const actionsHtml = sections.actionCenter
    ? `
      <section class="sec" id="sec-actions">
        ${renderHeadingPair(REPORT_COPY.sectionTitles.actions.en, REPORT_COPY.sectionTitles.actions.vi, lang)}
        ${
          actionItems.length > 0
            ? `<ol class="action-list">
                ${actionItems
                  .slice(0, 8)
                  .map((act) => {
                    const priority = String(act?.priority || "INFO").toUpperCase();
                    const pillarTag = String(act?.pillar || "").toUpperCase();
                    const title = nfc(act?.title || pickText("Remediation Action", "Hành động Khắc phục", lang));
                    const targetName = nfc(act?.targetName || "");
                    const desc = nfc(
                      act?.description ||
                        act?.ctaLabel ||
                        targetName ||
                        pickText("Investigate and resolve layer issue.", "Kiểm tra và xử lý vấn đề ở tầng tương ứng.", lang)
                    );
                    return `<li class="action-item">
                      <div class="action-head">
                        ${renderStatusBadgeHtml(["CRITICAL", "P0"].includes(priority) ? "FAIL" : ["HIGH", "P1", "MEDIUM"].includes(priority) ? "WARN" : "NEUTRAL", lang === "vi" ? (ACTION_PRIORITY_LABELS[priority]?.vi || priority) : priority)}
                        ${pillarTag ? `<span class="mono muted">${escapeHtml(pillarTag)}</span>` : ""}
                        <strong>${escapeHtml(title)}</strong>
                        ${targetName ? `<code class="target-code">${escapeHtml(targetName)}</code>` : ""}
                      </div>
                      <p class="action-desc">${escapeHtml(desc)}</p>
                    </li>`;
                  })
                  .join("")}
              </ol>`
            : renderBiBlock(
                `<p>No critical remediation actions pending; monitor branch coverage and flaky counts on upcoming runs.</p>`,
                `<p>Không có hành động khắc phục khẩn cấp; tiếp tục giám sát độ phủ nhánh và độ ổn định kiểm thử.</p>`,
                lang
              )
        }
      </section>
    `
    : "";

  const historyHtml = sections.trendsHistory
    ? `
      <section class="sec" id="sec-history">
        ${renderHeadingPair(REPORT_COPY.sectionTitles.history.en, REPORT_COPY.sectionTitles.history.vi, lang)}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>${escapeHtml(pickText("Run ID", "Mã chạy", lang))}</th>
                <th>${escapeHtml(pickText("Tier", "Tầng", lang))}</th>
                <th>${escapeHtml(pickText("Status", "Trạng thái", lang))}</th>
                <th>${escapeHtml(pickText("Pass / Fail", "Đạt / Trượt", lang))}</th>
                <th>${escapeHtml(pickText("Coverage", "Độ phủ", lang))}</th>
                <th>${escapeHtml(pickText("Duration", "Thời lượng", lang))}</th>
                <th>${escapeHtml(pickText("Commit", "Commit", lang))}</th>
              </tr>
            </thead>
            <tbody>
              ${
                historyRuns.length > 0
                  ? historyRuns
                      .slice(0, 8)
                      .map(
                        (run) => `<tr>
                          <td class="mono">${escapeHtml(run.shortId || run.id || "—")}</td>
                          <td class="mono">${escapeHtml(String(run.type || "—").toUpperCase())}</td>
                          <td class="status-cell">${renderStatusBadgeHtml(run.status, translateHistoryStatus(run.status, lang))}</td>
                          <td class="mono">${escapeHtml(`${run.passed ?? 0} / ${run.failed ?? 0}`)}</td>
                          <td class="mono">${escapeHtml(fmtPct(run.coveragePct))}</td>
                          <td class="mono">${escapeHtml(fmtDuration(run.durationMs))}</td>
                          <td class="mono">${escapeHtml(run.commitSha || "N/A")}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="7" class="empty-cell">${escapeHtml(pickText("No execution runs recorded for this snapshot.", "Chưa có lịch sử chạy kiểm thử cho snapshot này.", lang))}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `
    : "";

  const followupSectionsHtml = [keyFindingsHtml, criticalGapsHtml, actionsHtml, historyHtml]
    .filter(Boolean)
    .join("");
  const hasFollowup = followupSectionsHtml.trim().length > 0;
  const page1Break = hasPage1Content && hasFollowup;

  const caveatsHtml = hasFollowup
    ? `
      <section class="sec sec-caveats" id="sec-caveats">
        ${renderHeadingPair(REPORT_COPY.sectionTitles.caveats.en, REPORT_COPY.sectionTitles.caveats.vi, lang)}
        <ul class="compact-list">
          ${renderBiBlock(
            `<strong>NOT RUN vs. Failures:</strong> Unexecuted layers (0 tests) and untested AST APIs remain unverified blind spots and do not count as failed tests.`,
            `<strong>Chưa chạy và Lỗi:</strong> Tầng chưa chạy (0 bài) và API chưa phủ là điểm mù chưa xác minh, không tính là bài test trượt.`,
            lang,
            "li"
          )}
          ${renderBiBlock(
            `<strong>Snapshot &amp; Questions:</strong> Metrics reflect snapshot <code>${escapeHtml(ctx.snapshotLabel || ctx.snapshotId || "Active")}</code>. ${trendSeries.length < 2 ? "Establish >= 2 consecutive runs to track trajectory." : "Monitor failing modules and gate gaps before release."}`,
            `<strong>Phạm vi &amp; Câu hỏi mở:</strong> Số liệu phản ánh snapshot <code>${escapeHtml(ctx.snapshotLabel || ctx.snapshotId || "Hiện tại")}</code>. ${trendSeries.length < 2 ? "Cần >= 2 lần chạy liên tiếp để theo dõi xu hướng." : "Theo dõi các mô-đun trượt và khoảng trống trước khi phát hành."}`,
            lang,
            "li"
          )}
        </ul>
      </section>
    `
    : "";

  const languageScript =
    !printMode && lang === "bilingual"
      ? `
    <script>
      (function () {
        var btns = document.querySelectorAll("[data-set-lang]");
        if (!btns.length) return;
        btns.forEach(function (btn) {
          btn.addEventListener("click", function () {
            var next = btn.getAttribute("data-set-lang") || "bilingual";
            document.body.setAttribute("data-report-lang", next);
            btns.forEach(function (b) {
              b.classList.toggle("is-active", b.getAttribute("data-set-lang") === next);
            });
          });
        });
      })();
    </script>
  `
      : "";

  const htmlLangAttr = lang === "vi" ? "vi" : "en";

  return nfc(`<!doctype html>
<html lang="${htmlLangAttr}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(docTitle)}</title>
  <style>
    @page { size: A4; margin: 10mm 11mm; }
    * { box-sizing: border-box; }
    :root {
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
      font-family: "Inter", "Noto Sans", "Segoe UI", "DejaVu Sans", Arial, sans-serif;
      font-size: ${printMode ? "10.2px" : "13.5px"};
      line-height: ${printMode ? "1.34" : "1.45"};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-shell {
      max-width: ${printMode ? "100%" : "980px"};
      min-width: 0;
      margin: ${printMode ? "0" : "20px auto"};
      padding: ${printMode ? "0" : "26px 30px"};
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
      margin-bottom: 14px;
      background: var(--surface-3);
      border: 1px solid var(--border-soft);
      border-radius: 6px;
    }
    .toolbar-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .toolbar-label { font-size: 12px; font-weight: 600; color: var(--muted); margin-right: 4px; }
    .tb-btn {
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--paper);
      color: var(--ink);
      cursor: pointer;
    }
    .tb-btn.is-active { background: var(--accent); color: #ffffff; border-color: var(--accent); }
    .tb-btn-primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    .tb-pill { font-size: 12px; font-weight: 600; color: var(--ink); }
    .page-one.has-followup {
      ${printMode ? "break-after: page; page-break-after: always;" : ""}
    }
    .report-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: ${printMode ? "8px 10px" : "12px"};
      padding-bottom: ${printMode ? "6px" : "12px"};
      margin-bottom: ${printMode ? "7px" : "16px"};
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
      font-size: ${printMode ? "15.5px" : "22px"};
      font-weight: 700;
      line-height: 1.18;
      color: var(--ink);
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .provenance {
      margin-top: ${printMode ? "3px" : "6px"};
      display: flex;
      flex-wrap: wrap;
      gap: ${printMode ? "2px 10px" : "4px 12px"};
      font-size: ${printMode ? "9px" : "11.5px"};
      line-height: ${printMode ? "1.22" : "1.4"};
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
      gap: 3px;
      padding: ${printMode ? "5px 8px" : "8px 12px"};
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      max-width: 100%;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .gate-score {
      font-size: ${printMode ? "13px" : "17px"};
      font-weight: 700;
      font-family: "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace;
      font-variant-numeric: tabular-nums;
      color: var(--ink);
    }
    .sec { margin-bottom: ${printMode ? "8px" : "20px"}; min-width: 0; max-width: 100%; }
    .sec-exec { margin-bottom: ${printMode ? "6px" : "14px"}; break-inside: avoid; page-break-inside: avoid; }
    .sec-kpi { margin-bottom: ${printMode ? "6px" : "16px"}; break-inside: avoid; page-break-inside: avoid; }
    .sec-charts { margin-bottom: ${printMode ? "4px" : "18px"}; }
    h2 {
      margin: 0 0 ${printMode ? "4px" : "10px"} 0;
      padding-left: 8px;
      border-left: 3px solid var(--accent);
      font-size: ${printMode ? "11.2px" : "15px"};
      font-weight: 700;
      color: var(--ink);
      break-after: avoid;
      page-break-after: avoid;
    }
    h3 {
      margin: 0 0 ${printMode ? "1px" : "2px"} 0;
      font-size: ${printMode ? "9.8px" : "13px"};
      font-weight: 700;
      color: var(--ink);
      break-after: avoid;
      page-break-after: avoid;
    }
    .vi-heading-sub { font-weight: 600; color: var(--ink-2); }
    .exec-list {
      margin: 0;
      padding-left: 15px;
    }
    .exec-list li {
      margin-bottom: ${printMode ? "2px" : "6px"};
      font-size: ${printMode ? "9.4px" : "13px"};
      line-height: ${printMode ? "1.24" : "1.45"};
      color: var(--ink-2);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .bi-item + .bi-item { margin-top: 1px; color: var(--muted); font-size: ${printMode ? "8.8px" : "12px"}; }
    .compact-list, .action-list { margin: 0; padding-left: 18px; }
    .compact-list li, .action-list li {
      margin-bottom: 6px;
      color: var(--ink-2);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .action-item { break-inside: avoid; page-break-inside: avoid; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: ${printMode ? "6px" : "10px"};
    }
    @media (max-width: 680px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .kpi-card {
      padding: ${printMode ? "4px 7px" : "10px 12px"};
      background: var(--paper);
      border: 1px solid var(--border);
      border-top: 2px solid var(--accent);
      border-radius: 6px;
      min-width: 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .kpi-label {
      font-size: ${printMode ? "8.4px" : "10.5px"};
      font-weight: 600;
      color: var(--muted);
    }
    .kpi-val {
      margin: ${printMode ? "1px 0" : "2px 0"};
      font-size: ${printMode ? "12.5px" : "18px"};
      font-weight: 700;
      font-family: "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace;
      font-variant-numeric: tabular-nums;
      color: var(--ink);
    }
    .kpi-sub {
      font-size: ${printMode ? "8.2px" : "10.5px"};
      font-family: "JetBrains Mono", Consolas, monospace;
      font-variant-numeric: tabular-nums;
      color: var(--ink-2);
      overflow-wrap: anywhere;
    }
    .charts-grid-2x2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: ${printMode ? "6px" : "12px"};
    }
    @media (max-width: 720px) {
      .charts-grid-2x2 { grid-template-columns: 1fr; }
    }
    .chart-card {
      padding: ${printMode ? "5px 7px" : "11px 12px"};
      background: var(--paper);
      border: 1px solid var(--border-soft);
      border-radius: 6px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: ${printMode ? "3px" : "6px"};
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .chart-head { min-width: 0; }
    .chart-sub {
      margin: 0;
      font-size: ${printMode ? "8px" : "10.8px"};
      color: var(--muted);
      line-height: 1.18;
    }
    .chart-fig { margin: 0; padding: 0; min-width: 0; }
    .chart-takeaway {
      margin: 0;
      font-size: ${printMode ? "8.2px" : "11px"};
      color: var(--ink-2);
      line-height: 1.22;
    }
    .page1-footnote {
      margin-top: ${printMode ? "3px" : "8px"};
      font-size: ${printMode ? "8px" : "11px"};
      line-height: 1.22;
      color: var(--muted);
    }
    .footnote-line + .footnote-line { margin-top: 1px; }
    .finding-lead {
      margin: 0 0 8px 0;
      font-size: ${printMode ? "10px" : "12.5px"};
      color: var(--ink-2);
    }
    .gaps-split {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin-top: 8px;
    }
    .failure-line {
      margin-top: 8px;
      padding: 6px 10px;
      background: var(--surface-2);
      border: 1px solid var(--border-soft);
      border-radius: 4px;
      font-size: ${printMode ? "9.8px" : "12px"};
      color: var(--ink-2);
    }
    .table-wrap { overflow-x: auto; max-width: 100%; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: ${printMode ? "9.8px" : "12px"}; }
    thead { display: table-header-group; }
    th, td {
      border: 1px solid var(--border-soft);
      padding: ${printMode ? "4px 6px" : "6px 8px"};
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th { background: var(--surface-3); color: var(--ink); font-size: ${printMode ? "9.2px" : "10.5px"}; font-weight: 700; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .cell-pass { background: var(--pass-bg); color: var(--pass-fg); font-weight: 700; }
    .cell-fail { background: var(--fail-bg); color: var(--fail-fg); font-weight: 700; }
    .empty-cell { text-align: center; color: var(--muted); }
    .badge {
      display: inline-block;
      padding: 1.5px 6px;
      border-radius: 4px;
      font-size: ${printMode ? "9px" : "10px"};
      font-weight: 700;
      font-family: "JetBrains Mono", Consolas, monospace;
      border: 1px solid var(--border-soft);
    }
    .badge-pass { background: var(--pass-bg); color: var(--pass-fg); border-color: var(--pass-bd); }
    .badge-fail { background: var(--fail-bg); color: var(--fail-fg); border-color: var(--fail-bd); }
    .badge-warn { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-bd); }
    .badge-neutral { background: var(--surface-3); color: var(--muted); }
    .mono { font-family: "JetBrains Mono", Consolas, "DejaVu Sans Mono", monospace; font-variant-numeric: tabular-nums; }
    .muted { color: var(--muted); }
    .target-code {
      font-family: "JetBrains Mono", Consolas, monospace;
      font-size: 10.5px;
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
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .action-desc {
      margin: 0;
      font-size: ${printMode ? "9.8px" : "12px"};
      color: var(--ink-2);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .sec-caveats {
      padding-top: 8px;
      border-top: 1px solid var(--border-soft);
      font-size: ${printMode ? "9.6px" : "12px"};
    }
    .report-footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid var(--border-soft);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 6px 12px;
      font-size: 10px;
      color: var(--muted);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    body[data-report-lang="en"] [data-lang="vi"],
    body[data-report-lang="en"] [data-lang="bilingual-sep"] { display: none; }
    body[data-report-lang="vi"] [data-lang="en"],
    body[data-report-lang="vi"] [data-lang="bilingual-sep"] { display: none; }
    @media print {
      body { background: #ffffff !important; color: #0f172a !important; font-size: 10.8px; }
      .page-shell { margin: 0; padding: 0; border: none; max-width: 100%; }
      .no-print { display: none !important; }
      .page-one.has-followup { break-after: page; page-break-after: always; }
      .kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .charts-grid-2x2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
            <span><strong>${escapeHtml(pickText("Branch", "Nhánh", lang))}:</strong> <span class="mono">${escapeHtml(ctx.branch || "main")}</span></span>
            <span><strong>${escapeHtml(pickText("Snapshot", "Snapshot", lang))}:</strong> <span class="mono">${escapeHtml(ctx.snapshotLabel || ctx.snapshotId || "Active")}</span></span>
            <span><strong>${escapeHtml(pickText("Updated", "Cập nhật", lang))}:</strong> ${escapeHtml(snapshotUpdated)}</span>
            <span><strong>${escapeHtml(pickText("Generated", "Xuất báo cáo", lang))}:</strong> ${escapeHtml(humanDate)}</span>
          </div>
        </div>
        <div class="gate-box">
          <div class="gate-score">${escapeHtml(health.score !== null ? `${health.score}/100 (${health.grade ?? "—"})` : pickText("Unverified", "Chưa xác minh", lang))}</div>
          ${renderStatusBadgeHtml(qualityGate.status, lang === "vi" ? gateInfo.vi : lang === "en" ? gateInfo.en : `${gateInfo.en} · ${gateInfo.vi}`)}
        </div>
      </header>
      ${executiveSummaryHtml}
      ${page1ChartsHtml}
      ${
        hasPage1Content
          ? `<div class="page1-footnote">
        ${renderBiBlock(
          `Note: Layers marked NOT RUN (0 executed tests) are unverified and excluded from executed failure counts.`,
          `Lưu ý: Tầng gắn nhãn Chưa chạy (0 bài kiểm thử) là chưa xác minh và không tính vào số bài trượt.`,
          lang,
          "div",
          "footnote-line"
        )}
      </div>`
          : ""
      }
    </div>
    ${
      hasFollowup
        ? `<div class="followup-pages">
            ${followupSectionsHtml}
            ${caveatsHtml}
          </div>`
        : ""
    }
    <footer class="report-footer">
      <span>${escapeHtml(pickText("CovAI Quality Analytics — Unit, Integration & System Verification", "CovAI Quality Analytics — Kiểm thử Đơn vị, Tích hợp & Hệ thống", lang))}</span>
      <span class="mono">${escapeHtml(ctx.snapshotId ? `Snapshot ${(ctx.snapshotId || "").slice(0, 12)}` : pickText("Snapshot Active", "Snapshot Hiện tại", lang))}</span>
    </footer>
  </main>
  ${languageScript}
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
 * Generates an answer-first, bilingual-capable Markdown report concisely aligned with the 2-page executive structure.
 */
export function generateMarkdownReport(
  vm,
  sectionsOrOptions = DEFAULT_EXPORT_SECTIONS,
  maybeOptions = {}
) {
  const { sections, options } = resolveSectionsAndOptions(sectionsOrOptions, maybeOptions);
  const lang = options.language;
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
  } = model;

  const gateInfo = translateGateStatus(qualityGate.status, qualityGate.label);
  const pyrInfo = translatePyramidShape(pyramid.shape, pyramid.badgeTitle, pyramid.warning);
  const bullets = buildExecutiveBullets(vm, model);
  const humanDate = formatHumanDate(new Date(), lang);
  const snapshotUpdated = ctx.updatedAt ? formatHumanDate(ctx.updatedAt, lang) : pickText("Not recorded", "Chưa ghi nhận", lang);
  const projectTitle = nfc(ctx.projectName || "Project");

  const lines = [
    `# ${pickText(REPORT_COPY.titlePrefix.en, REPORT_COPY.titlePrefix.vi, lang)} — ${projectTitle}`,
    ``,
    `> **${pickText("Branch", "Nhánh", lang)}:** \`${ctx.branch || "main"}\` | **Snapshot:** \`${ctx.snapshotLabel || ctx.snapshotId || "Active"}\``,
    `> **${pickText("Updated", "Cập nhật", lang)}:** ${snapshotUpdated} | **${pickText("Generated", "Xuất báo cáo", lang)}:** ${humanDate}`,
    `> **${pickText("Quality Gate", "Cổng Chất lượng", lang)}:** **${lang === "vi" ? gateInfo.vi : lang === "en" ? gateInfo.en : `${gateInfo.en} / ${gateInfo.vi}`}**`,
    ``,
  ];

  if (sections.executive) {
    lines.push(
      `## ${pickText(REPORT_COPY.sectionTitles.executiveSummary.en, REPORT_COPY.sectionTitles.executiveSummary.vi, lang)}`,
      ``
    );
    for (const b of bullets) {
      if (lang === "en") lines.push(`- **${b.enTopic}** ${b.enBody}`);
      else if (lang === "vi") lines.push(`- **${b.viTopic}** ${b.viBody}`);
      else {
        lines.push(`- **${b.enTopic}** ${b.enBody}`);
        lines.push(`  - *Tiếng Việt:* **${b.viTopic}** ${b.viBody}`);
      }
    }
    lines.push(
      ``,
      `### ${pickText(REPORT_COPY.sectionTitles.kpiStrip.en, REPORT_COPY.sectionTitles.kpiStrip.vi, lang)}`,
      ``,
      `- **${pickText("Health Score", "Điểm Sức khỏe", lang)}:** ${health.score !== null ? `**${health.score}/100** (${pickText(`Grade ${health.grade ?? "—"}`, `Hạng ${health.grade ?? "—"}`, lang)})` : pickText("Unverified (0 executed tests)", "Chưa xác minh (0 bài kiểm thử chạy)", lang)}`,
      `- **${pickText("Executed & Pass Rate", "Thực thi & Tỷ lệ đạt", lang)}:** ${fmtCount(execution.total)} (${execution.passRate !== null ? `${execution.passRate}%` : "—"}) — ${
        lang === "vi"
          ? `Đạt: ${fmtCount(execution.passed)} | Trượt: ${fmtCount(execution.failed)} | Bỏ qua: ${fmtCount(execution.skipped)}`
          : `Passed: ${fmtCount(execution.passed)} | Failed: ${fmtCount(execution.failed)} | Skipped: ${fmtCount(execution.skipped)}`
      }`,
      `- **${pickText("Weighted Coverage", "Độ phủ Trọng số", lang)}:** ${fmtPct(coverage.overall)} (${
        lang === "vi"
          ? `Đơn vị ${fmtPct(coverage.codePct)} · API ${fmtPct(coverage.apiPct)} · E2E ${fmtPct(coverage.flowPct)}`
          : `Unit ${fmtPct(coverage.codePct)} · API ${fmtPct(coverage.apiPct)} · E2E ${fmtPct(coverage.flowPct)}`
      })`,
      `- **${pickText("Open Gaps & Untested APIs", "Khoảng trống & API chưa phủ", lang)}:** ${
        lang === "vi"
          ? `${fmtCount(ai.gaps ?? 0)} khoảng trống | ${fmtCount(execution.uncoveredApis)} API chưa phủ`
          : `${fmtCount(ai.gaps ?? 0)} gaps | ${fmtCount(execution.uncoveredApis)} untested AST APIs`
      }`,
      ``
    );
  }

  if (sections.pyramidPillars) {
    const unitCovCell =
      layers.unit.state === "NOT_RUN"
        ? "—"
        : lang === "vi"
          ? `Dòng ${fmtPct(layers.unit.coverage.lines)}, Nhánh ${fmtPct(layers.unit.coverage.branches)}, Hàm ${fmtPct(layers.unit.coverage.functions)}, Lệnh ${fmtPct(layers.unit.coverage.statements)}`
          : `Lines ${fmtPct(layers.unit.coverage.lines)}, Branches ${fmtPct(layers.unit.coverage.branches)}, Fn ${fmtPct(layers.unit.coverage.functions)}, Stmt ${fmtPct(layers.unit.coverage.statements)}`;
    const intCovCell =
      layers.integration.state === "NOT_RUN"
        ? lang === "vi"
          ? `— (API chưa phủ: ${layers.integration.coverage.uncoveredApis})`
          : `— (Uncovered APIs: ${layers.integration.coverage.uncoveredApis})`
        : `API ${fmtPct(layers.integration.coverage.apiEndpoint)} (${layers.integration.coverage.coveredApis}/${layers.integration.coverage.totalApis})`;
    const sysCovCell =
      layers.system.state === "NOT_RUN"
        ? "—"
        : lang === "vi"
          ? `Luồng ${fmtPct(layers.system.coverage.flow)}`
          : `Flow ${fmtPct(layers.system.coverage.flow)}`;

    lines.push(
      `---`,
      ``,
      `## ${pickText(REPORT_COPY.sectionTitles.keyFindings.en, REPORT_COPY.sectionTitles.keyFindings.vi, lang)}`,
      ``,
      `**${pickText("Pyramid Profile", "Hồ sơ Kim tự tháp", lang)}:** ${lang === "vi" ? pyrInfo.viTitle : lang === "en" ? pyrInfo.enTitle : `${pyrInfo.enTitle} / ${pyrInfo.viTitle}`}`,
      ``,
      `| ${pickText("Layer", "Tầng", lang)} | ${pickText("Framework", "Công cụ", lang)} | ${pickText("Status", "Trạng thái", lang)} | ${pickText("Executed (P/F/S/Total)", "Thực thi (Đ/T/B/Tổng)", lang)} | ${pickText("Pass Rate", "Tỷ lệ đạt", lang)} | ${pickText("Coverage", "Độ phủ", lang)} | ${pickText("Avg Latency", "Thời gian TB", lang)} |`,
      `|---|---|---|---|---|---|---|`,
      `| **${escapeMarkdownCell(pickText("Unit", "Đơn vị", lang))}** | ${escapeMarkdownCell(layers.unit.framework)} | ${escapeMarkdownCell(formatLayerStateBadge(layers.unit.state, lang).text)} | ${layers.unit.passedTests} / ${layers.unit.failedTests} / ${layers.unit.skippedTests} / ${layers.unit.totalTests} | ${layers.unit.passRate !== null ? `${layers.unit.passRate}%` : "—"} | ${escapeMarkdownCell(unitCovCell)} | ${layers.unit.state === "NOT_RUN" ? "—" : escapeMarkdownCell(fmtDuration(layers.unit.avgDurationMs))} |`,
      `| **${escapeMarkdownCell(pickText("Integration", "Tích hợp", lang))}** | ${escapeMarkdownCell(layers.integration.framework)} | ${escapeMarkdownCell(formatLayerStateBadge(layers.integration.state, lang).text)} | ${layers.integration.passedTests} / ${layers.integration.failedTests} / ${layers.integration.skippedTests} / ${layers.integration.totalTests} | ${layers.integration.passRate !== null ? `${layers.integration.passRate}%` : "—"} | ${escapeMarkdownCell(intCovCell)} | ${layers.integration.state === "NOT_RUN" ? "—" : escapeMarkdownCell(fmtDuration(layers.integration.avgDurationMs))} |`,
      `| **${escapeMarkdownCell(pickText("System (E2E)", "Hệ thống (E2E)", lang))}** | ${escapeMarkdownCell(layers.system.framework)} | ${escapeMarkdownCell(formatLayerStateBadge(layers.system.state, lang).text)} | ${layers.system.passedTests} / ${layers.system.failedTests} / ${layers.system.skippedTests} / ${layers.system.totalTests} | ${layers.system.passRate !== null ? `${layers.system.passRate}%` : "—"} | ${escapeMarkdownCell(sysCovCell)} | ${layers.system.state === "NOT_RUN" ? "—" : escapeMarkdownCell(fmtDuration(layers.system.avgDurationMs))} |`,
      ``
    );

    if (trendSeries.length >= 2) {
      lines.push(
        `### ${pickText(REPORT_COPY.charts.trendLine.enTitle, REPORT_COPY.charts.trendLine.viTitle, lang)}`,
        ``,
        `| ${pickText("Run", "Lần chạy", lang)} | ${pickText("Overall", "Tổng hợp", lang)} | ${pickText("Unit", "Đơn vị", lang)} | ${pickText("Integration", "Tích hợp", lang)} | ${pickText("System", "Hệ thống", lang)} | ${pickText("Pass Rate", "Tỷ lệ đạt", lang)} |`,
        `|---|---|---|---|---|---|`,
        ...trendSeries.slice(-6).map(
          (pt, i) =>
            `| ${escapeMarkdownCell(pt.runLabel || pt.label || `#${i + 1}`)} | ${fmtPct(pt.overallCoverage ?? pt.overall ?? pt.coveragePct)} | ${fmtPct(pt.unitCoverage ?? pt.codePct ?? pt.unit)} | ${fmtPct(pt.integrationCoverage ?? pt.apiPct ?? pt.integration)} | ${fmtPct(pt.systemCoverage ?? pt.flowPct ?? pt.system)} | ${pt.passRate != null ? fmtPct(pt.passRate) : "—"} |`
        ),
        ``
      );
    } else {
      lines.push(
        `### ${pickText(REPORT_COPY.sectionTitles.diagram3Variance.en, REPORT_COPY.sectionTitles.diagram3Variance.vi, lang)}`,
        ``,
        `| ${pickText("Metric", "Chỉ tiêu", lang)} | ${pickText("Measured", "Thực tế", lang)} | ${pickText("Target", "Mục tiêu", lang)} | ${pickText("Variance (pp)", "Chênh lệch (pp)", lang)} |`,
        `|---|---|---|---|`,
        ...varianceItems.map(
          (v) =>
            `| ${escapeMarkdownCell(lang === "vi" ? v.viLabel : lang === "en" ? v.enLabel : v.biLabel)} | ${v.state === "NOT_RUN" || v.actual === null ? "—" : `${v.actual.toFixed(1)}%`} | ${v.target}% | ${escapeMarkdownCell(v.state === "NOT_RUN" || v.delta === null ? pickText("Not Run", "Chưa chạy", lang) : `${v.delta > 0 ? "+" : ""}${v.delta.toFixed(1)} pp`)} |`
        ),
        ``
      );
    }

    if ((qualityGate.checklist || []).length > 0) {
      lines.push(
        `### ${pickText("Quality Gate Checklist", "Danh mục Kiểm tra Cổng Chất lượng", lang)}`,
        ...(qualityGate.checklist || []).map((chk) => {
          const trChk = translateChecklistItem(chk, lang);
          return `- [${chk.passed ? "x" : " "}] **${trChk.label}** — \`${trChk.currentValue}\``;
        }),
        ``
      );
    }
  }

  if (sections.traceMatrix || sections.pyramidPillars) {
    const prioritizedMatrix = sortMatrixRowsByRisk(matrixRows);
    const unitLow = (layers.unit.lowCoverageItems || []).slice(0, 5);
    const intCov = layers.integration.coverage;
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
      `## ${pickText(REPORT_COPY.sectionTitles.criticalGaps.en, REPORT_COPY.sectionTitles.criticalGaps.vi, lang)}`,
      ``
    );

    if (sections.traceMatrix && prioritizedMatrix.length > 0) {
      lines.push(
        `### ${pickText(REPORT_COPY.sectionTitles.diagram4Matrix.en, REPORT_COPY.sectionTitles.diagram4Matrix.vi, lang)}`,
        ``,
        `| ${pickText("Module", "Mô-đun", lang)} | ${pickText("Unit", "Đơn vị", lang)} | ${pickText("Integration", "Tích hợp", lang)} | ${pickText("System", "Hệ thống", lang)} | ${pickText("Root Cause & Suspect Layer", "Nguyên nhân & Tầng nghi ngờ", lang)} |`,
        `|---|---|---|---|---|`,
        ...prioritizedMatrix.map(
          (r) =>
            `| **${escapeMarkdownCell(r.moduleName || "Module")}** | ${escapeMarkdownCell(translateMatrixCellLabel(r.unit?.label, r.unit?.status, lang))} | ${escapeMarkdownCell(translateMatrixCellLabel(r.integration?.label, r.integration?.status, lang))} | ${escapeMarkdownCell(translateMatrixCellLabel(r.system?.label, r.system?.status, lang))} | ${escapeMarkdownCell(r.rootCause?.summary || "—")} (${escapeMarkdownCell(translateSuspectLayer(r.rootCause?.suspectLayer || "none", lang))}) |`
        ),
        ``
      );
    }

    lines.push(
      `### ${pickText("Low-Coverage Code Hotspots", "Điểm nóng Mã nguồn Độ phủ Thấp", lang)}`,
      ``,
      `| ${pickText("File / Module", "Tệp / Mô-đun", lang)} | ${pickText("Branch Coverage", "Độ phủ Nhánh", lang)} | ${pickText("Line Coverage", "Độ phủ Dòng", lang)} | ${pickText("Gate Target", "Ngưỡng Cổng", lang)} |`,
      `|---|---|---|---|`,
      ...(unitLow.length > 0
        ? unitLow.map(
            (item) =>
              `| \`${escapeMarkdownCell(item.filePath || item.name || item.label || item.path || "file")}\` | ${fmtPct(item.branchesPct ?? item.coverage ?? item.value ?? 0)} | ${fmtPct(item.linesPct ?? 0)} | 75.0% |`
          )
        : [
            `| *${escapeMarkdownCell(pickText("No low-coverage hotspots recorded", "Chưa ghi nhận tệp độ phủ thấp", lang))}* | — | — | 75.0% |`,
          ]),
      ``,
      `### ${pickText("API Endpoint Coverage Breakdown", "Phân rã Độ phủ Điểm cuối API", lang)}`,
      ``,
      `| ${pickText("Covered APIs", "API đã phủ", lang)} | ${pickText("Failed APIs", "API bị lỗi", lang)} | ${pickText("Uncovered / Untested APIs", "API chưa phủ (Chưa test)", lang)} | ${pickText("Total AST APIs", "Tổng API (AST)", lang)} | ${pickText("API Coverage", "Tỷ lệ phủ API", lang)} |`,
      `|---|---|---|---|---|`,
      `| ${fmtCount(intCov.coveredApis)} | ${fmtCount(intCov.failedApis)} | ${fmtCount(intCov.uncoveredApis)} | ${fmtCount(intCov.totalApis)} | ${layers.integration.state === "NOT_RUN" ? "—" : fmtPct(intCov.apiEndpoint)} |`,
      ``
    );

    if (nonZeroFails.length > 0) {
      lines.push(
        `**${pickText("Failure Distribution", "Phân bố Lỗi", lang)}:** ${nonZeroFails
          .map((f) => {
            const d = FAILURE_CATEGORY_LABELS[f.key] || { en: f.key, vi: f.key };
            return `${pickText(d.en, d.vi, lang)} (${f.count})`;
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
      `## ${pickText(REPORT_COPY.sectionTitles.actions.en, REPORT_COPY.sectionTitles.actions.vi, lang)}`,
      ``,
      ...(actionItems.length > 0
        ? actionItems.slice(0, 8).map((act, idx) => {
            const priority = String(act?.priority || "INFO").toUpperCase();
            const prioLabel = lang === "vi" ? ACTION_PRIORITY_LABELS[priority]?.vi || priority : priority;
            const title = nfc(act?.title || pickText("Remediation Action", "Hành động Khắc phục", lang));
            const pillarTag = String(act?.pillar || "").toUpperCase();
            const pillarSuffix = pillarTag ? ` (${pillarTag})` : "";
            const targetName = nfc(act?.targetName || "");
            const desc = nfc(
              act?.description ||
                act?.ctaLabel ||
                pickText("Investigate and resolve layer issue.", "Kiểm tra và xử lý vấn đề ở tầng tương ứng.", lang)
            );
            const targetLine = targetName
              ? ` — \`${targetName}\``
              : "";
            return `${idx + 1}. **[${prioLabel}] ${title}**${pillarSuffix}${targetLine}: ${desc}`;
          })
        : [`1. ${pickText("No pending remediation actions; continue monitoring test execution.", "Chưa có hành động khắc phục tồn đọng; tiếp tục theo dõi các lần chạy kiểm thử.", lang)}`]),
      ``
    );
  }

  if (sections.trendsHistory) {
    lines.push(
      `---`,
      ``,
      `## ${pickText(REPORT_COPY.sectionTitles.history.en, REPORT_COPY.sectionTitles.history.vi, lang)}`,
      ``,
      `| ${pickText("Run ID", "Mã chạy", lang)} | ${pickText("Suite", "Tầng", lang)} | ${pickText("Status", "Trạng thái", lang)} | ${pickText("Pass / Fail", "Đạt / Trượt", lang)} | ${pickText("Coverage", "Độ phủ", lang)} | ${pickText("Duration", "Thời lượng", lang)} | ${pickText("Commit", "Commit", lang)} |`,
      `|---|---|---|---|---|---|---|`,
      ...(historyRuns.length > 0
        ? historyRuns.slice(0, 8).map(
            (run) =>
              `| \`${escapeMarkdownCell(run.shortId || run.id || "—")}\` | ${escapeMarkdownCell(String(run.type || "—").toUpperCase())} | ${escapeMarkdownCell(translateHistoryStatus(run.status, lang))} | ${run.passed ?? 0} / ${run.failed ?? 0} | ${fmtPct(run.coveragePct)} | ${escapeMarkdownCell(fmtDuration(run.durationMs))} | \`${escapeMarkdownCell(run.commitSha || "N/A")}\` |`
          )
        : [`| *${escapeMarkdownCell(pickText("No runs recorded", "Chưa có lịch sử chạy", lang))}* | — | — | — | — | — | — |`]),
      ``
    );
  }

  lines.push(
    `---`,
    ``,
    `## ${pickText(REPORT_COPY.sectionTitles.caveats.en, REPORT_COPY.sectionTitles.caveats.vi, lang)}`,
    ``,
    `- ${pickText("NOT RUN layers (0 executed tests) and untested AST APIs indicate unverified scope rather than 0% test failures.", "Tầng Chưa chạy (0 bài kiểm thử) và API chưa phủ là phạm vi chưa xác minh, không tính là lỗi thất bại 0%.", lang)}`,
    `- ${pickText("Metrics reflect the selected snapshot state; re-run missing suites before final release sign-off.", "Số liệu phản ánh đúng trạng thái snapshot đã chọn; cần chạy bổ sung các tầng còn thiếu trước khi phát hành.", lang)}`
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
  } = model;

  const prioritizedMatrix = sortMatrixRowsByRisk(matrixRows);
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
        coverage: coverage.flowPct,
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
      unitLowCoverageItems: layers.unit.lowCoverageItems,
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
      { metric: "systemFlows", actual: coverage.flowPct, passRate: layers.system.passRate, target: 80, state: layers.system.state },
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
      unitLowCoverageItems: layers.unit.lowCoverageItems,
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
    `- Coverage Index: Overall ${fmtPct(coverage.overall)} | Unit Lines ${fmtPct(coverage.codePct)} (Branches ${fmtPct(coverage.branchPct)}) | Integration API ${fmtPct(coverage.apiPct)} (Uncovered APIs: ${execution.uncoveredApis ?? 0}) | System Flow ${fmtPct(coverage.flowPct)}`,
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
