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
  } = vm || {};

  const sec = { ...DEFAULT_EXPORT_SECTIONS, ...(sections || {}) };

  const lines = [
    `# Unified Quality & Testing Report — ${context.projectName || "Project"}`,
    ``,
    `> **Branch:** \`${context.branch || "main"}\` | **Snapshot:** \`${context.snapshotLabel || context.snapshotId || "N/A"}\` (\`${context.snapshotId || "N/A"}\`)`,
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
      `| Layer | Framework | Executed (P/F/Total) | Pass Rate | Coverage | Avg Latency |`,
      `|---|---|---|---|---|---|`,
      `| **Unit Tests** | ${pillars.unit.framework} | ${pillars.unit.passedTests} / ${pillars.unit.failedTests} / ${pillars.unit.totalTests} | ${pillars.unit.passRate}% | Lines: ${fmtPct(pillars.unit.coverageMetrics?.lines)} (Branches: ${fmtPct(pillars.unit.coverageMetrics?.branches)}) | ${fmtDuration(pillars.unit.avgDurationMs)} |`,
      `| **Integration** | ${pillars.integration.framework} | ${pillars.integration.passedTests} / ${pillars.integration.failedTests} / ${pillars.integration.totalTests} (Uncovered: ${pillars.integration.coverageMetrics?.uncoveredApis ?? 0}) | ${pillars.integration.passRate}% | API: ${fmtPct(pillars.integration.coverageMetrics?.apiEndpoint)} (Code: ${fmtPct(pillars.integration.coverageMetrics?.lines)}) | ${fmtDuration(pillars.integration.avgDurationMs)} |`,
      `| **System (E2E)** | ${pillars.system.framework} | ${pillars.system.passedTests} / ${pillars.system.failedTests} / ${pillars.system.totalTests} | ${pillars.system.passRate}% | Flow: ${fmtPct(pillars.system.coverageMetrics?.flow)} | ${fmtDuration(pillars.system.avgDurationMs)} |`,
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
              `| \`${run.shortId || run.id}\` | ${run.type.toUpperCase()} | ${run.status.toUpperCase()} | ${run.passed} / ${run.failed} | ${fmtPct(run.coveragePct)} | ${fmtDuration(run.durationMs)} | \`${run.commitSha || "N/A"}\` |`
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
    reportMeta: {
      schemaVersion: "1.0",
      generator: "CovAI Unified Quality Analytics",
      exportedAt: new Date().toISOString(),
      projectName: vm?.context?.projectName || "Project",
      branch: vm?.context?.branch || "main",
      snapshotId: vm?.context?.snapshotId || null,
      snapshotLabel: vm?.context?.snapshotLabel || null,
      qualityGateStatus: vm?.qualityGate?.status || "NOT_RUN",
    },
    context: vm?.context,
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStatusBadgeHtml(status, label) {
  const s = String(status || "").toUpperCase();
  let bg = "#f1f5f9";
  let fg = "#475569";
  let bd = "#cbd5e1";
  if (s === "PASS" || s === "PASSED" || s === "COMPLETED") {
    bg = "#ecfdf5";
    fg = "#047857";
    bd = "#a7f3d0";
  } else if (s === "FAIL" || s === "FAILED" || s === "BLOCKED") {
    bg = "#fff1f2";
    fg = "#be123c";
    bd = "#fecdd3";
  } else if (s === "WARN" || s === "WARNING" || s === "PARTIAL") {
    bg = "#fffbeb";
    fg = "#b45309";
    bd = "#fde68a";
  }
  return `<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:${bg};color:${fg};border:1px solid ${bd};">${escapeHtml(label || s || "N/A")}</span>`;
}

function renderPdfHealthRingSvg(score, grade) {
  const num = Number(score);
  const valid = Number.isFinite(num);
  const clamped = valid ? Math.max(0, Math.min(100, num)) : 0;
  const r = 24;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  const stroke = clamped >= 80 ? "#10b981" : clamped >= 60 ? "#f59e0b" : "#ef4444";

  return `
    <div style="display:flex;align-items:center;gap:10px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:7px 12px;">
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="5.5"/>
        <circle cx="30" cy="30" r="${r}" fill="none" stroke="${stroke}" stroke-width="5.5"
          stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round"
          transform="rotate(-90 30 30)"/>
        <text x="30" y="34" text-anchor="middle" font-size="13" font-weight="700" font-family="ui-monospace,monospace" fill="#0f172a">${valid ? clamped : "—"}</text>
      </svg>
      <div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;">Health Score</div>
        <div style="font-size:15px;font-weight:700;color:#0f172a;">Grade ${escapeHtml(grade || "—")}</div>
        <div style="font-size:9.5px;color:#475569;">Scale 0–100</div>
      </div>
    </div>
  `;
}

function renderPdfCoverageSvg(pillars = {}) {
  const tiers = [
    {
      label: "Unit Tests",
      cov: Number(pillars?.unit?.coverageMetrics?.lines ?? 0) || 0,
      pass: Number(pillars?.unit?.passRate ?? 0) || 0,
    },
    {
      label: "Integration",
      cov: Number(pillars?.integration?.coverageMetrics?.apiEndpoint ?? 0) || 0,
      pass: Number(pillars?.integration?.passRate ?? 0) || 0,
    },
    {
      label: "System E2E",
      cov: Number(pillars?.system?.coverageMetrics?.flow ?? 0) || 0,
      pass: Number(pillars?.system?.passRate ?? 0) || 0,
    },
  ];

  const width = 420;
  const height = 172;
  const padL = 78;
  const padR = 54;
  const chartW = width - padL - padR;
  const targetX = padL + (80 / 100) * chartW;

  const gridLines = [0, 25, 50, 75, 100]
    .map((pct) => {
      const gx = padL + (pct / 100) * chartW;
      return `
        <line x1="${gx}" y1="24" x2="${gx}" y2="${height - 22}" stroke="#e2e8f0" stroke-width="0.8"/>
        <text x="${gx}" y="${height - 8}" text-anchor="middle" font-size="8.5" font-family="ui-monospace,monospace" fill="#64748b">${pct}%</text>
      `;
    })
    .join("");

  const rows = tiers
    .map((t, i) => {
      const yBase = 30 + i * 40;
      const covW = Math.max(0, Math.min(100, t.cov)) * (chartW / 100);
      const passW = Math.max(0, Math.min(100, t.pass)) * (chartW / 100);
      return `
        <text x="${padL - 8}" y="${yBase + 16}" text-anchor="end" font-size="10" font-weight="600" fill="#1e293b">${escapeHtml(t.label)}</text>
        <rect x="${padL}" y="${yBase}" width="${chartW}" height="9" rx="2" fill="#f1f5f9"/>
        <rect x="${padL}" y="${yBase}" width="${covW.toFixed(1)}" height="9" rx="2" fill="#2563eb"/>
        <text x="${width - 6}" y="${yBase + 8}" text-anchor="end" font-size="9.5" font-weight="600" font-family="ui-monospace,monospace" fill="#1d4ed8">${t.cov.toFixed(1)}%</text>
        <rect x="${padL}" y="${yBase + 13}" width="${chartW}" height="9" rx="2" fill="#f1f5f9"/>
        <rect x="${padL}" y="${yBase + 13}" width="${passW.toFixed(1)}" height="9" rx="2" fill="#10b981"/>
        <text x="${width - 6}" y="${yBase + 21}" text-anchor="end" font-size="9.5" font-weight="600" font-family="ui-monospace,monospace" fill="#047857">${t.pass.toFixed(1)}%</text>
      `;
    })
    .join("");

  return `
    <div style="border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 12px;">
      <div style="font-size:10.5px;font-weight:700;color:#1e293b;margin-bottom:6px;">Multi-Tier Coverage vs Pass Rate</div>
      <svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;">
        <g>
          <rect x="${padL}" y="4" width="9" height="8" rx="2" fill="#2563eb"/>
          <text x="${padL + 13}" y="11.5" font-size="9" fill="#475569">Coverage %</text>
          <rect x="${padL + 84}" y="4" width="9" height="8" rx="2" fill="#10b981"/>
          <text x="${padL + 97}" y="11.5" font-size="9" fill="#475569">Pass Rate %</text>
          <line x1="${targetX}" y1="22" x2="${targetX}" y2="${height - 20}" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="3 2.5"/>
          <text x="${targetX + 4}" y="11.5" font-size="8.5" font-family="ui-monospace,monospace" fill="#b45309">Target 80%</text>
        </g>
        ${gridLines}
        ${rows}
      </svg>
    </div>
  `;
}

function renderPdfExecutionDonutSvg(execution = {}, pillars = {}) {
  const passed = Number(execution.passed || 0);
  const failed = Number(execution.failed || 0);
  const skipped = Number(execution.skipped || 0) + Number(execution.flaky || 0);
  const total = Math.max(0, passed + failed + skipped);

  const r = 30;
  const c = 2 * Math.PI * r;
  const pLen = total > 0 ? (passed / total) * c : 0;
  const fLen = total > 0 ? (failed / total) * c : 0;
  const sLen = total > 0 ? (skipped / total) * c : 0;

  const uCnt = Number(pillars?.unit?.totalTests || 0);
  const iCnt = Number(pillars?.integration?.totalTests || 0);
  const sCnt = Number(pillars?.system?.totalTests || 0);
  const maxTier = Math.max(1, uCnt, iCnt, sCnt);

  const barRow = (label, cnt, color) => {
    const pct = total > 0 ? ((cnt / total) * 100).toFixed(0) : "0";
    const w = Math.round((cnt / maxTier) * 100);
    return `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:9.5px;">
        <span style="width:66px;color:#334155;font-weight:600;">${label}</span>
        <div style="flex:1;height:7px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
          <div style="width:${w}%;height:100%;background:${color};"></div>
        </div>
        <span style="width:46px;text-align:right;font-family:ui-monospace,monospace;color:#0f172a;">${cnt} (${pct}%)</span>
      </div>
    `;
  };

  return `
    <div style="border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 12px;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="font-size:10.5px;font-weight:700;color:#1e293b;margin-bottom:6px;">Outcome &amp; Pyramid Distribution</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <svg width="78" height="78" viewBox="0 0 80 80" style="shrink:0;">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="10"/>
          ${total > 0 ? `<circle cx="40" cy="40" r="${r}" fill="none" stroke="#10b981" stroke-width="10" stroke-dasharray="${pLen.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>` : ""}
          ${failed > 0 ? `<circle cx="40" cy="40" r="${r}" fill="none" stroke="#ef4444" stroke-width="10" stroke-dasharray="${fLen.toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-pLen).toFixed(1)}" transform="rotate(-90 40 40)"/>` : ""}
          ${skipped > 0 ? `<circle cx="40" cy="40" r="${r}" fill="none" stroke="#94a3b8" stroke-width="10" stroke-dasharray="${sLen.toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-(pLen + fLen)).toFixed(1)}" transform="rotate(-90 40 40)"/>` : ""}
          <text x="40" y="38" text-anchor="middle" font-size="13" font-weight="700" font-family="ui-monospace,monospace" fill="#0f172a">${total}</text>
          <text x="40" y="49" text-anchor="middle" font-size="8" fill="#64748b">TESTS</text>
        </svg>
        <div style="font-size:9.5px;line-height:1.6;color:#334155;">
          <div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#10b981;margin-right:5px;"></span>Passed: <strong class="mono">${passed}</strong></div>
          <div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#ef4444;margin-right:5px;"></span>Failed: <strong class="mono">${failed}</strong></div>
          <div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#94a3b8;margin-right:5px;"></span>Skipped: <strong class="mono">${skipped}</strong></div>
        </div>
      </div>
      <div style="border-top:1px solid #f1f5f9;padding-top:7px;">
        ${barRow("Unit", uCnt, "#3b82f6")}
        ${barRow("Integration", iCnt, "#8b5cf6")}
        ${barRow("System E2E", sCnt, "#06b6d4")}
      </div>
    </div>
  `;
}

function renderPdfTrendOrTargetSvg(trend = {}, coverage = {}) {
  const series = Array.isArray(trend?.series) ? trend.series : [];
  if (series.length >= 2) {
    const width = 680;
    const height = 135;
    const padL = 40;
    const padR = 16;
    const padT = 18;
    const padB = 24;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;
    const pts = series.slice(-10);

    const toX = (idx) => padL + (pts.length === 1 ? 0 : (idx / (pts.length - 1)) * chartW);
    const toY = (val) => padT + chartH - (Math.max(0, Math.min(100, Number(val) || 0)) / 100) * chartH;

    const lineFor = (getter, color) => {
      const coords = pts.map((p, i) => `${toX(i).toFixed(1)},${toY(getter(p)).toFixed(1)}`).join(" ");
      const dots = pts
        .map((p, i) => `<circle cx="${toX(i).toFixed(1)}" cy="${toY(getter(p)).toFixed(1)}" r="2.6" fill="${color}"/>`)
        .join("");
      return `<polyline fill="none" stroke="${color}" stroke-width="1.8" points="${coords}"/>${dots}`;
    };

    const labels = pts
      .map(
        (p, i) =>
          `<text x="${toX(i).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="8.5" font-family="ui-monospace,monospace" fill="#64748b">${escapeHtml(p.runLabel || p.label || p.snapshotLabel || `#${i + 1}`)}</text>`
      )
      .join("");

    return `
      <div style="border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 12px;margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:10.5px;font-weight:700;color:#1e293b;">Historical Coverage Trend</span>
          <span style="font-size:9px;color:#475569;">
            <span style="color:#2563eb;font-weight:700;">● Overall</span> ·
            <span style="color:#0ea5e9;font-weight:700;">● Unit</span> ·
            <span style="color:#8b5cf6;font-weight:700;">● API</span> ·
            <span style="color:#10b981;font-weight:700;">● Flow</span>
          </span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;">
          ${[0, 50, 80, 100]
            .map((v) => {
              const y = toY(v);
              return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="${v === 80 ? "#f59e0b" : "#e2e8f0"}" stroke-width="0.9" ${v === 80 ? 'stroke-dasharray="4 3"' : ""}/><text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="8.5" font-family="ui-monospace,monospace" fill="#64748b">${v}%</text>`;
            })
            .join("")}
          ${lineFor((p) => p.overallCoverage ?? p.overall ?? p.coveragePct ?? 0, "#2563eb")}
          ${lineFor((p) => p.unitCoverage ?? p.codePct ?? p.unit ?? 0, "#0ea5e9")}
          ${lineFor((p) => p.integrationCoverage ?? p.apiPct ?? p.integration ?? 0, "#8b5cf6")}
          ${lineFor((p) => p.systemCoverage ?? p.flowPct ?? p.system ?? 0, "#10b981")}
          ${labels}
        </svg>
      </div>
    `;
  }

  const metrics = [
    { label: "Unit Lines", val: Number(coverage.codePct || 0), target: 80, color: "#2563eb" },
    { label: "Unit Branches", val: Number(coverage.branchPct || 0), target: 75, color: "#0ea5e9" },
    { label: "API Endpoints", val: Number(coverage.apiPct || 0), target: 80, color: "#8b5cf6" },
    { label: "System Flows", val: Number(coverage.flowPct || 0), target: 80, color: "#10b981" },
  ];

  return `
    <div style="border:1px solid #e2e8f0;border-radius:6px;background:#ffffff;padding:10px 12px;margin-top:10px;">
      <div style="font-size:10.5px;font-weight:700;color:#1e293b;margin-bottom:8px;">Coverage Baseline vs Quality Gate Targets</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
        ${metrics
          .map((m) => {
            const gap = Math.max(0, m.target - m.val).toFixed(1);
            return `
              <div style="border:1px solid #f1f5f9;border-radius:5px;padding:7px 9px;background:#f8fafc;">
                <div style="font-size:9.5px;font-weight:600;color:#475569;">${m.label}</div>
                <div style="font-size:15px;font-weight:700;font-family:ui-monospace,monospace;color:#0f172a;margin:2px 0;">${m.val.toFixed(1)}%</div>
                <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin:4px 0;">
                  <div style="width:${Math.min(100, m.val)}%;height:100%;background:${m.color};"></div>
                </div>
                <div style="font-size:8.5px;color:${Number(gap) > 0 ? "#b45309" : "#047857"};font-family:ui-monospace,monospace;">Target ${m.target}% · ${Number(gap) > 0 ? `Gap -${gap}%` : "On Target"}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

/**
 * Generates a clean, publication-grade A4 HTML report and triggers browser Print / Save as PDF
 * via an isolated hidden iframe (never captures dark-mode UI or triggers popup blockers).
 */
export function exportUnifiedDashboardPdf(vm, sections = DEFAULT_EXPORT_SECTIONS) {
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
    trend = {},
    history = {},
    ai = {},
  } = vm || {};

  const sec = { ...DEFAULT_EXPORT_SECTIONS, ...(sections || {}) };
  const generatedAt = new Date().toLocaleString();

  const executiveHtml = sec.executive
    ? `
      <section class="sec">
        <h2>1. Executive Summary &amp; Quality Gate</h2>
        <p class="summary-banner">
          Project <strong>${escapeHtml(context.projectName || "Project")}</strong> currently holds a Quality Health Score of
          <strong>${escapeHtml(health.score ?? "—")}/100 (Grade ${escapeHtml(health.grade ?? "—")})</strong> across
          <strong>${escapeHtml(fmtCount(execution.total))}</strong> executed tests (${escapeHtml(execution.passRate ?? 0)}% pass rate).
          Multi-layer coverage stands at <strong>${escapeHtml(fmtPct(coverage.overall))}</strong>
          (Unit: ${escapeHtml(fmtPct(coverage.codePct))}, API: ${escapeHtml(fmtPct(coverage.apiPct))}, Flow: ${escapeHtml(fmtPct(coverage.flowPct))}),
          with <strong>${escapeHtml(ai.gaps ?? 0)}</strong> open coverage gaps and <strong>${escapeHtml(execution.uncoveredApis ?? 0)}</strong> uncovered API endpoints.
        </p>
        <div class="kpi-grid">
          <div class="kpi-card" style="border-top:3px solid #2563eb;">
            <div class="kpi-label">Quality Health Score</div>
            <div class="kpi-val">${escapeHtml(health.score ?? "—")}<span class="kpi-sub">/100 (Grade ${escapeHtml(health.grade ?? "—")})</span></div>
            <div class="kpi-foot">${escapeHtml(qualityGate.label || "Pending")}</div>
          </div>
          <div class="kpi-card" style="border-top:3px solid #10b981;">
            <div class="kpi-label">Total Test Execution</div>
            <div class="kpi-val">${escapeHtml(fmtCount(execution.total))}<span class="kpi-sub"> (${escapeHtml(execution.passRate ?? 0)}% pass)</span></div>
            <div class="kpi-foot">Passed: ${escapeHtml(fmtCount(execution.passed))} · Failed: ${escapeHtml(fmtCount(execution.failed))} · Skipped: ${escapeHtml(fmtCount(execution.skipped))}</div>
          </div>
          <div class="kpi-card" style="border-top:3px solid #6366f1;">
            <div class="kpi-label">Multi-Layer Coverage Index</div>
            <div class="kpi-val">${escapeHtml(fmtPct(coverage.overall))}</div>
            <div class="kpi-foot">Code: ${escapeHtml(fmtPct(coverage.codePct))} · API: ${escapeHtml(fmtPct(coverage.apiPct))} · Flow: ${escapeHtml(fmtPct(coverage.flowPct))}</div>
          </div>
          <div class="kpi-card" style="border-top:3px solid #f59e0b;">
            <div class="kpi-label">AI Assistance &amp; Gaps</div>
            <div class="kpi-val">${escapeHtml(ai.gaps ?? 0)}<span class="kpi-sub"> gaps open</span></div>
            <div class="kpi-foot">AI Generated: ${escapeHtml(ai.aiGenerated ?? 0)} · Repaired: ${escapeHtml(ai.aiRepaired ?? 0)} · Uncovered APIs: ${escapeHtml(execution.uncoveredApis ?? 0)}</div>
          </div>
        </div>
        ${
          (qualityGate.checklist || []).length > 0
            ? `<table>
                <thead><tr><th>Quality Gate Prerequisite</th><th>Current Value</th><th>Status</th></tr></thead>
                <tbody>
                  ${qualityGate.checklist
                    .map(
                      (chk) => `<tr>
                        <td><strong>${escapeHtml(chk.label)}</strong></td>
                        <td class="mono">${escapeHtml(chk.currentValue)}</td>
                        <td>${renderStatusBadgeHtml(chk.passed ? "PASS" : "FAIL", chk.passed ? "PASSED" : "BLOCKED")}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : ""
        }
      </section>
    `
    : "";

  const lowCovSections = [
    { title: "Unit Low-Coverage Targets", items: pillars?.unit?.lowCoverageItems || [] },
    { title: "Integration Uncovered / Failing APIs", items: pillars?.integration?.lowCoverageItems || [] },
    { title: "System E2E Flow Gaps", items: pillars?.system?.lowCoverageItems || [] },
  ].filter((g) => Array.isArray(g.items) && g.items.length > 0);

  const pyramidHtml =
    sec.pyramidPillars && pillars.unit && pillars.integration && pillars.system
      ? `
      <section class="sec">
        <h2>2. Visual Quality Analytics &amp; Three-Pillar Breakdown</h2>
        <p class="note"><strong>Pyramid Assessment:</strong> ${escapeHtml(pyramid.badgeTitle || pyramid.shape || "N/A")}${pyramid.warning ? ` — ${escapeHtml(pyramid.warning)}` : ""}</p>
        <div class="charts-grid">
          ${renderPdfCoverageSvg(pillars)}
          ${renderPdfExecutionDonutSvg(execution, pillars)}
        </div>
        ${renderPdfTrendOrTargetSvg(trend, coverage)}
        <table style="margin-top:12px;">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Framework</th>
              <th>Executed (P / F / Total)</th>
              <th>Pass Rate</th>
              <th>Coverage</th>
              <th>Avg Latency</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Unit Tests</strong></td>
              <td class="mono">${escapeHtml(pillars.unit.framework)}</td>
              <td class="mono">${escapeHtml(pillars.unit.passedTests)} / ${escapeHtml(pillars.unit.failedTests)} / ${escapeHtml(pillars.unit.totalTests)}</td>
              <td class="mono">${escapeHtml(pillars.unit.passRate)}%</td>
              <td class="mono">Lines: ${escapeHtml(fmtPct(pillars.unit.coverageMetrics?.lines))} · Branches: ${escapeHtml(fmtPct(pillars.unit.coverageMetrics?.branches))}</td>
              <td class="mono">${escapeHtml(fmtDuration(pillars.unit.avgDurationMs))}</td>
            </tr>
            <tr>
              <td><strong>Integration</strong></td>
              <td class="mono">${escapeHtml(pillars.integration.framework)}</td>
              <td class="mono">${escapeHtml(pillars.integration.passedTests)} / ${escapeHtml(pillars.integration.failedTests)} / ${escapeHtml(pillars.integration.totalTests)}</td>
              <td class="mono">${escapeHtml(pillars.integration.passRate)}%</td>
              <td class="mono">API: ${escapeHtml(fmtPct(pillars.integration.coverageMetrics?.apiEndpoint))} · Code: ${escapeHtml(fmtPct(pillars.integration.coverageMetrics?.lines))}</td>
              <td class="mono">${escapeHtml(fmtDuration(pillars.integration.avgDurationMs))}</td>
            </tr>
            <tr>
              <td><strong>System (E2E)</strong></td>
              <td class="mono">${escapeHtml(pillars.system.framework)}</td>
              <td class="mono">${escapeHtml(pillars.system.passedTests)} / ${escapeHtml(pillars.system.failedTests)} / ${escapeHtml(pillars.system.totalTests)}</td>
              <td class="mono">${escapeHtml(pillars.system.passRate)}%</td>
              <td class="mono">Flow: ${escapeHtml(fmtPct(pillars.system.coverageMetrics?.flow))}</td>
              <td class="mono">${escapeHtml(fmtDuration(pillars.system.avgDurationMs))}</td>
            </tr>
          </tbody>
        </table>
        ${
          lowCovSections.length > 0
            ? `<div class="hotspot-grid">
                ${lowCovSections
                  .map(
                    (g) => `
                  <div class="hotspot-card">
                    <div class="hotspot-title">${escapeHtml(g.title)}</div>
                    <ul>
                      ${g.items
                        .slice(0, 5)
                        .map(
                          (it) =>
                            `<li><span class="mono">${escapeHtml(it.label || it.path || it.name || "Item")}</span> <strong class="mono">${escapeHtml(it.value ?? it.coverage ?? "")}</strong></li>`
                        )
                        .join("")}
                    </ul>
                  </div>`
                  )
                  .join("")}
              </div>`
            : ""
        }
      </section>
    `
      : "";

  const matrixHtml = sec.traceMatrix
    ? `
      <section class="sec">
        <h2>3. Cross-Layer Traceability Matrix</h2>
        <table>
          <thead>
            <tr><th>Module</th><th>Unit</th><th>Integration</th><th>System</th><th>Root Cause &amp; Suspect Layer</th></tr>
          </thead>
          <tbody>
            ${
              (matrix.rows || []).length > 0
                ? matrix.rows
                    .map(
                      (r) => `<tr>
                        <td><strong>${escapeHtml(r.moduleName)}</strong></td>
                        <td>${renderStatusBadgeHtml(r.unit?.status, r.unit?.label)}</td>
                        <td>${renderStatusBadgeHtml(r.integration?.status, r.integration?.label)}</td>
                        <td>${renderStatusBadgeHtml(r.system?.status, r.system?.label)}</td>
                        <td>${escapeHtml(r.rootCause?.summary || "—")} <span class="mono" style="color:#64748b;">(${escapeHtml(r.rootCause?.suspectLayer || "none")})</span></td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" style="text-align:center;color:#64748b;">No modules recorded for this snapshot.</td></tr>`
            }
          </tbody>
        </table>
      </section>
    `
    : "";

  const actionsHtml = sec.actionCenter
    ? `
      <section class="sec">
        <h2>4. Prioritized Remediation Actions</h2>
        ${
          (actions.items || []).length > 0
            ? `<table>
                <thead><tr><th>Priority</th><th>Pillar</th><th>Action</th><th>Target</th></tr></thead>
                <tbody>
                  ${actions.items
                    .map(
                      (act) => `<tr>
                        <td>${renderStatusBadgeHtml(
                          ["CRITICAL", "P0"].includes(act.priority)
                            ? "FAIL"
                            : ["HIGH", "P1", "MEDIUM"].includes(act.priority)
                              ? "WARN"
                              : "NEUTRAL",
                          act.priority
                        )}</td>
                        <td class="mono">${escapeHtml(String(act.pillar || "").toUpperCase())}</td>
                        <td><strong>${escapeHtml(act.title)}</strong><div style="font-size:10.5px;color:#475569;margin-top:2px;">${escapeHtml(act.description)}</div></td>
                        <td class="mono">${escapeHtml(act.targetName)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<p class="note">No pending remediation actions.</p>`
        }
      </section>
    `
    : "";

  const historyHtml = sec.trendsHistory
    ? `
      <section class="sec">
        <h2>5. Recent Test Execution History</h2>
        <table>
          <thead><tr><th>Run ID</th><th>Suite</th><th>Status</th><th>Pass / Fail</th><th>Coverage</th><th>Duration</th><th>Commit</th></tr></thead>
          <tbody>
            ${
              (history.runs || []).length > 0
                ? history.runs
                    .slice(0, 15)
                    .map(
                      (run) => `<tr>
                        <td class="mono">${escapeHtml(run.shortId || run.id)}</td>
                        <td class="mono">${escapeHtml(String(run.type || "").toUpperCase())}</td>
                        <td>${renderStatusBadgeHtml(run.status, String(run.status || "").toUpperCase())}</td>
                        <td class="mono">${escapeHtml(run.passed)} / ${escapeHtml(run.failed)}</td>
                        <td class="mono">${escapeHtml(fmtPct(run.coveragePct))}</td>
                        <td class="mono">${escapeHtml(fmtDuration(run.durationMs))}</td>
                        <td class="mono">${escapeHtml(run.commitSha || "N/A")}</td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="7" style="text-align:center;color:#64748b;">No runs recorded for this snapshot.</td></tr>`
            }
          </tbody>
        </table>
      </section>
    `
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CovAI Quality Report — ${escapeHtml(context.projectName || "Project")}</title>
  <style>
    @page { size: A4; margin: 13mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 11.5px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #2563eb; margin-bottom: 3px; }
    h1 { margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; }
    .meta { margin-top: 5px; font-size: 10px; color: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .summary-banner { margin: 0 0 12px 0; padding: 9px 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; border-radius: 6px; font-size: 11px; color: #1e293b; }
    .sec { margin-bottom: 18px; page-break-inside: avoid; }
    h2 { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #1e293b; border-left: 3px solid #2563eb; padding-left: 8px; margin: 0 0 10px 0; }
    .note { margin: 0 0 8px 0; font-size: 11px; color: #334155; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .kpi-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; background: #f8fafc; }
    .kpi-label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    .kpi-val { font-size: 18px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #0f172a; }
    .kpi-sub { font-size: 10.5px; font-weight: 500; color: #475569; }
    .kpi-foot { font-size: 9.5px; color: #475569; margin-top: 4px; }
    .charts-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 10px; }
    .hotspot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin-top: 10px; }
    .hotspot-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
    .hotspot-title { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #334155; margin-bottom: 5px; }
    .hotspot-card ul { margin: 0; padding-left: 14px; font-size: 10px; color: #334155; }
    .hotspot-card li { margin-bottom: 2px; display: flex; justify-content: space-between; gap: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; color: #334155; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <div class="brand">CovAI Unified Quality &amp; Testing Report</div>
      <h1>${escapeHtml(context.projectName || "Project")}</h1>
      <div class="meta">Branch: ${escapeHtml(context.branch || "main")} · Snapshot: ${escapeHtml(context.snapshotLabel || context.snapshotId || "N/A")} · Generated: ${escapeHtml(generatedAt)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      ${renderPdfHealthRingSvg(health.score, health.grade)}
    </div>
  </header>
  ${executiveHtml}
  ${pyramidHtml}
  ${matrixHtml}
  ${actionsHtml}
  ${historyHtml}
  <footer class="footer">
    <span>Generated by CovAI Quality Analytics Platform</span>
    <span class="mono">Snapshot ${escapeHtml((context.snapshotId || "").slice(0, 12) || "N/A")}</span>
  </footer>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Could not initialize PDF print frame.");
  }

  doc.open();
  doc.write(html);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    }
  };

  setTimeout(triggerPrint, 120);
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
    .map((item) => `- ${item.label || item.path || item.name}: ${item.value ?? item.coverage ?? "—"}`);

  const topActions = (actions.items || [])
    .slice(0, 5)
    .map((a) => `- [${a.priority}] (${a.pillar}) ${a.title} -> ${a.targetName}: ${a.description}`);

  return [
    `Analyze the Unified Quality Dashboard for project "${context.projectName || "Project"}" (branch: ${context.branch || "main"}, snapshot: ${context.snapshotLabel || context.snapshotId || "active"}).`,
    ``,
    `Current Metrics:`,
    `- Quality Gate: ${qualityGate.label || qualityGate.status || "PENDING"}`,
    `- Health Score: ${health.score ?? "—"}/100 (Grade ${health.grade ?? "—"})`,
    `- Test Execution: ${execution.total ?? 0} total (${execution.passed ?? 0} passed, ${execution.failed ?? 0} failed, ${execution.skipped ?? 0} skipped, pass rate ${execution.passRate ?? 0}%)`,
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
