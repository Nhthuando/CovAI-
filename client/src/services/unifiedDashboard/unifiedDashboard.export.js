import { fmtPct, fmtCount, fmtDuration, fmtRelativeTime } from "./format.js";

export const DEFAULT_EXPORT_SECTIONS = {
  executive: true,
  pyramidPillars: true,
  traceMatrix: true,
  actionCenter: true,
  trendsHistory: true,
};

/**
 * Triggers a browser download of a generated string blob.
 */
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

/**
 * Generates a clean technical Markdown report from UnifiedDashboardVM based on selected sections.
 */
export function generateMarkdownReport(vm, sections = DEFAULT_EXPORT_SECTIONS) {
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
    history = {},
    ai = {},
    dataMode = "live",
  } = vm || {};

  const sec = { ...DEFAULT_EXPORT_SECTIONS, ...(sections || {}) };

  const lines = [
    `# Unified Quality & Testing Report — ${context.projectName || "Project"}`,
    ``,
    `> **Snapshot ID:** \`${context.snapshotId || "N/A"}\``,
    `> **Data Mode:** \`${dataMode === "demo" ? "Demo Showcase" : "Live State"}\``,
    `> **Generated:** ${new Date().toISOString()} (${fmtRelativeTime(context.updatedAt)})`,
    `> **Quality Gate Status:** **${qualityGate.label || "N/A"}** (${qualityGate.status || "N/A"})`,
    ``,
  ];

  if (sec.executive) {
    lines.push(
      `---`,
      ``,
      `## 1. Executive Summary & Quality Gate Checklist`,
      ``,
      `- **Quality Health Score:** **${health.score ?? "—"}/100** (Grade ${health.grade ?? "—"})`,
      `- **Overall Test Execution:** ${fmtCount(execution.total)} tests run (${execution.passRate}% pass rate)`,
      `  - **Passed:** ${fmtCount(execution.passed)} | **Failed:** ${fmtCount(execution.failed)} | **Skipped:** ${fmtCount(execution.skipped)} | **Flaky:** ${fmtCount(execution.flaky)} | **Uncovered APIs:** ${fmtCount(execution.uncoveredApis ?? 0)}`,
      `  - **Total Execution Duration:** ${fmtDuration(execution.durationMs)}`,
      `- **Multi-Layer Coverage Index:** ${fmtPct(coverage.overall)} average`,
      `  - **Code Coverage (Unit):** ${fmtPct(coverage.codePct)} (Branches: ${fmtPct(coverage.branchPct)})`,
      `  - **API Endpoint Coverage (Integration):** ${fmtPct(coverage.apiPct)}`,
      `  - **User Flow Coverage (System E2E):** ${fmtPct(coverage.flowPct)}`,
      `- **AI Assistance & Coverage Gaps:** ${ai.aiGenerated || 0} generated, ${ai.aiRepaired || 0} repaired, ${ai.gaps || 0} gaps remaining`,
      ``,
      `### Quality Gate Prerequisite Checklist`,
      ...(qualityGate.checklist || []).map(
        (chk) => `- [${chk.passed ? "x" : " "}] **${chk.label}** — \`${chk.currentValue}\``
      ),
      ``
    );
  }

  if (sec.pyramidPillars && pillars.unit && pillars.integration && pillars.system) {
    lines.push(
      `---`,
      ``,
      `## 2. Testing Pyramid & Three Pillar Status`,
      ``,
      `**Pyramid Assessment:** \`${pyramid.badgeTitle || pyramid.shape || "N/A"}\`${
        pyramid.warning ? ` — *${pyramid.warning}*` : ""
      }`,
      ``,
      `| Layer | Framework | Executed (P/F/Total) | Pass Rate | Coverage | Avg Latency | Source |`,
      `|---|---|---|---|---|---|---|`,
      `| **Unit Tests** | ${pillars.unit.framework} | ${pillars.unit.passedTests} / ${pillars.unit.failedTests} / ${pillars.unit.totalTests} | ${pillars.unit.passRate}% | Lines: ${fmtPct(pillars.unit.coverageMetrics?.lines)} (Branches: ${fmtPct(pillars.unit.coverageMetrics?.branches)}) | ${fmtDuration(pillars.unit.avgDurationMs)} | ${pillars.unit.source} |`,
      `| **Integration** | ${pillars.integration.framework} | ${pillars.integration.passedTests} / ${pillars.integration.failedTests} / ${pillars.integration.totalTests} (Uncovered: ${pillars.integration.coverageMetrics?.uncoveredApis ?? 0}) | ${pillars.integration.passRate}% | API: ${fmtPct(pillars.integration.coverageMetrics?.apiEndpoint)} (Code: ${fmtPct(pillars.integration.coverageMetrics?.lines)}) | ${fmtDuration(pillars.integration.avgDurationMs)} | ${pillars.integration.source} |`,
      `| **System (E2E)** | ${pillars.system.framework} | ${pillars.system.passedTests} / ${pillars.system.failedTests} / ${pillars.system.totalTests} | ${pillars.system.passRate}% | Flow: ${fmtPct(pillars.system.coverageMetrics?.flow)} | ${fmtDuration(pillars.system.avgDurationMs)} | ${pillars.system.source} |`,
      ``
    );
  }

  if (sec.traceMatrix) {
    lines.push(
      `---`,
      ``,
      `## 3. Cross-Layer Traceability Matrix`,
      ``,
      `| Module | Unit Status | Integration Status | System Status | Root Cause & Suspect Layer |`,
      `|---|---|---|---|---|`,
      ...((matrix.rows || []).length > 0
        ? matrix.rows.map(
            (r) =>
              `| **${r.moduleName}** | ${r.unit?.label} | ${r.integration?.label} | ${r.system?.label} | ${r.rootCause?.summary} (${r.rootCause?.suspectLayer}) |`
          )
        : [`| *No modules recorded* | — | — | — | — |`]),
      ``
    );
  }

  if (sec.actionCenter) {
    lines.push(
      `---`,
      ``,
      `## 4. Smart Action Center`,
      ``,
      ...((actions.items || []).length > 0
        ? actions.items.map(
            (act, idx) =>
              `${idx + 1}. **[${act.priority}] ${act.title}** (${act.pillar.toUpperCase()})\n   - Target: \`${act.targetName}\`\n   - Description: ${act.description}`
          )
        : [`*No pending actions.*`]),
      ``
    );
  }

  if (sec.trendsHistory) {
    lines.push(
      `---`,
      ``,
      `## 5. Recent Test Execution History`,
      ``,
      `| Run ID | Suite | Status | Pass / Fail | Coverage | Duration | Commit |`,
      `|---|---|---|---|---|---|---|`,
      ...((history.runs || []).length > 0
        ? history.runs.map(
            (run) =>
              `| \`${run.id}\` | ${run.type.toUpperCase()} | ${run.status.toUpperCase()} | ${run.passed} / ${run.failed} | ${fmtPct(run.coveragePct)} | ${fmtDuration(run.durationMs)} | \`${run.commitSha || "N/A"}\` |`
          )
        : [`| *No runs recorded* | — | — | — | — | — | — |`]),
      ``
    );
  }

  lines.push(`---`, ``, `*Report generated by CovAI Unified Quality & Testing Platform.*`);

  return lines.join("\n");
}

/**
 * Filter VM payload by selected sections for JSON export.
 */
export function buildFilteredJsonPayload(vm, sections = DEFAULT_EXPORT_SECTIONS) {
  const sec = { ...DEFAULT_EXPORT_SECTIONS, ...(sections || {}) };
  const payload = {
    context: vm?.context,
    dataMode: vm?.dataMode || "live",
    exportedAt: new Date().toISOString(),
  };

  if (sec.executive) {
    payload.qualityGate = vm?.qualityGate;
    payload.health = vm?.health;
    payload.execution = vm?.execution;
    payload.coverage = vm?.coverage;
    payload.ai = vm?.ai;
  }
  if (sec.pyramidPillars) {
    payload.pyramid = vm?.pyramid;
    payload.pillars = vm?.pillars;
  }
  if (sec.traceMatrix) {
    payload.matrix = vm?.matrix;
  }
  if (sec.actionCenter) {
    payload.actions = vm?.actions;
  }
  if (sec.trendsHistory) {
    payload.trend = vm?.trend;
    payload.history = vm?.history;
  }

  return payload;
}

/**
 * Export full or partial dashboard as formatted Markdown or JSON file.
 */
export function exportUnifiedDashboardReport(
  vm,
  format = "markdown",
  sections = DEFAULT_EXPORT_SECTIONS
) {
  const snapshotSlug = (vm?.context?.snapshotId || "snapshot").slice(0, 8);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (format === "json") {
    const filename = `covai-quality-report-${snapshotSlug}-${timestamp}.json`;
    const jsonStr = JSON.stringify(buildFilteredJsonPayload(vm, sections), null, 2);
    downloadBlob(jsonStr, filename, "application/json");
    return filename;
  }

  const filename = `covai-quality-report-${snapshotSlug}-${timestamp}.md`;
  const markdownStr = generateMarkdownReport(vm, sections);
  downloadBlob(markdownStr, filename, "text/markdown");
  return filename;
}

export default exportUnifiedDashboardReport;
