import { useState, useRef, useEffect } from "react";
import { X, FileDown, FileText, Layers, CheckSquare } from "lucide-react";
import "../portfolio.css";

const LIFECYCLE_LABELS = {
  DOING: "Doing",
  NOT_STARTED: "Not Started",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDurationMs(ms = 0) {
  const n = Number(ms) || 0;
  if (n <= 0) return "0ms";
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function formatShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function polarToCartesian(cx, cy, r, angleRad) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function buildRadarPoints(values, cx, cy, maxR) {
  return values
    .map((v, idx) => {
      const angle = (Math.PI * 2 * idx) / values.length - Math.PI / 2;
      const r = (Math.max(0, Math.min(100, v)) / 100) * maxR;
      const pt = polarToCartesian(cx, cy, r, angle);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(" ");
}

function buildRadarSvg(kpis) {
  const c1 = kpis.card1Health || {};
  const c2 = kpis.card2Coverage || {};
  const c3 = kpis.card3Scale || {};

  const labels = ["Unit", "API", "E2E", "Pass", "Health"];
  const portfolioVals = [
    c2.avgUnitCoveragePct ?? 0,
    c2.avgIntegrationCoveragePct ?? 0,
    c2.avgSystemCoveragePct ?? 0,
    c3.overallPassRatePct ?? 0,
    c1.avgHealthScore ?? 0,
  ];
  const targetVals = [80, 80, 80, 90, 80];

  const cx = 135;
  const cy = 112;
  const maxR = 72;

  const rings = [25, 50, 75, 100]
    .map(
      (pct) =>
        `<polygon points="${buildRadarPoints([pct, pct, pct, pct, pct], cx, cy, maxR)}" fill="none" stroke="#e2e8f0" stroke-width="1" ${
          pct === 75 ? 'stroke-dasharray="3 3"' : ""
        } />`,
    )
    .join("");

  const spokesAndLabels = labels
    .map((lbl, idx) => {
      const angle = (Math.PI * 2 * idx) / labels.length - Math.PI / 2;
      const outer = polarToCartesian(cx, cy, maxR, angle);
      const labelPt = polarToCartesian(cx, cy, maxR + 20, angle);
      return `
        <line x1="${cx}" y1="${cy}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" />
        <text x="${labelPt.x.toFixed(1)}" y="${(labelPt.y + 3).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#334155">${lbl}</text>
        <text x="${labelPt.x.toFixed(1)}" y="${(labelPt.y + 13).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="JetBrains Mono, monospace" fill="#64748b">${portfolioVals[idx]}%</text>
      `;
    })
    .join("");

  const dots = portfolioVals
    .map((v, idx) => {
      const angle = (Math.PI * 2 * idx) / portfolioVals.length - Math.PI / 2;
      const r = (Math.max(0, Math.min(100, v)) / 100) * maxR;
      const pt = polarToCartesian(cx, cy, r, angle);
      return `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.2" fill="#3b6e9c" stroke="#ffffff" stroke-width="1.2" />`;
    })
    .join("");

  return `
    <svg width="100%" viewBox="0 0 270 226" xmlns="http://www.w3.org/2000/svg">
      ${rings}
      ${spokesAndLabels}
      <polygon points="${buildRadarPoints(targetVals, cx, cy, maxR)}" fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="4 3" />
      <polygon points="${buildRadarPoints(portfolioVals, cx, cy, maxR)}" fill="rgba(59, 110, 156, 0.16)" stroke="#3b6e9c" stroke-width="2" />
      ${dots}
    </svg>
  `;
}

function buildScatterSvg(analytics, projects) {
  const nodes = analytics?.quadrantNodes?.length
    ? analytics.quadrantNodes
    : projects.map((p) => ({
        projectId: p.id,
        name: p.name,
        x: Number(p.unifiedCoveragePct ?? 0),
        y: Number(p.passRatePct ?? 0),
        healthScore: p.healthScore ?? 0,
      }));

  const cutoffX = analytics?.coverageCutoff ?? 50;
  const cutoffY = analytics?.passRateCutoff ?? 80;

  const padL = 34;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const w = 320;
  const h = 212;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const mapX = (val) => padL + (Math.max(0, Math.min(100, val)) / 100) * plotW;
  const mapY = (val) => padT + plotH - (Math.max(0, Math.min(100, val)) / 100) * plotH;

  const cxLine = mapX(cutoffX);
  const cyLine = mapY(cutoffY);

  const gridLines = [0, 25, 50, 75, 100]
    .map((tick) => {
      const gx = mapX(tick);
      const gy = mapY(tick);
      return `
        <line x1="${gx}" y1="${padT}" x2="${gx}" y2="${padT + plotH}" stroke="#f1f5f9" stroke-width="1" />
        <line x1="${padL}" y1="${gy}" x2="${padL + plotW}" y2="${gy}" stroke="#f1f5f9" stroke-width="1" />
        <text x="${gx}" y="${padT + plotH + 12}" text-anchor="middle" font-size="8" font-family="JetBrains Mono, monospace" fill="#64748b">${tick}%</text>
        <text x="${padL - 5}" y="${gy + 3}" text-anchor="end" font-size="8" font-family="JetBrains Mono, monospace" fill="#64748b">${tick}%</text>
      `;
    })
    .join("");

  const pointsSvg = nodes
    .slice(0, 18)
    .map((n, idx) => {
      const x = mapX(n.x);
      const y = mapY(n.y);
      const isStrong = n.x >= cutoffX && n.y >= cutoffY;
      const fill = isStrong ? "#447a63" : n.x > 0 || n.y > 0 ? "#3b6e9c" : "#64748b";
      return `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${fill}" fill-opacity="0.88" stroke="#ffffff" stroke-width="1.3" />
        <text x="${x.toFixed(1)}" y="${(y + 2.5).toFixed(1)}" text-anchor="middle" font-size="7" font-weight="700" font-family="JetBrains Mono, monospace" fill="#ffffff">${idx + 1}</text>
      `;
    })
    .join("");

  return `
    <svg width="100%" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#fafafa" stroke="#e2e8f0" stroke-width="1" />
      <rect x="${cxLine}" y="${padT}" width="${padL + plotW - cxLine}" height="${cyLine - padT}" fill="rgba(68, 122, 99, 0.06)" />
      ${gridLines}
      <line x1="${cxLine}" y1="${padT}" x2="${cxLine}" y2="${padT + plotH}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" />
      <line x1="${padL}" y1="${cyLine}" x2="${padL + plotW}" y2="${cyLine}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" />
      <text x="${padL + 6}" y="${padT + 12}" font-size="7.5" fill="#64748b" font-weight="600">COVERAGE GAP</text>
      <text x="${padL + plotW - 6}" y="${padT + 12}" text-anchor="end" font-size="7.5" fill="#447a63" font-weight="700">BENCHMARK ZONE</text>
      <text x="${padL + 6}" y="${padT + plotH - 6}" font-size="7.5" fill="#64748b">EARLY STAGE</text>
      <text x="${padL + plotW - 6}" y="${padT + plotH - 6}" text-anchor="end" font-size="7.5" fill="#997b47" font-weight="600">ACTIVE REGRESSIONS</text>
      ${pointsSvg}
      <text x="${padL + plotW / 2}" y="${h - 4}" text-anchor="middle" font-size="8" fill="#475569" font-weight="600">Unified Coverage (%)</text>
    </svg>
  `;
}

function buildRepoComparisonSvg(projects) {
  if (!projects.length) return "";
  const rowH = 34;
  const svgH = Math.max(60, projects.length * rowH + 22);
  const rows = projects
    .map((p, idx) => {
      const y = idx * rowH + 10;
      const health = Math.max(0, Math.min(100, p.healthScore ?? 0));
      const unit = Math.max(0, Math.min(100, p.pillars?.unit?.coveragePct ?? 0));
      const api = Math.max(0, Math.min(100, p.pillars?.integration?.coveragePct ?? 0));
      const e2e = Math.max(0, Math.min(100, p.pillars?.system?.coveragePct ?? 0));
      const label = p.name.length > 21 ? `${p.name.slice(0, 19)}…` : p.name;

      return `
        <text x="0" y="${y + 11}" font-size="9.5" font-weight="600" fill="#0f172a">${escapeHtml(label)}</text>
        <text x="0" y="${y + 21}" font-size="8" font-family="JetBrains Mono, monospace" fill="#64748b">${escapeHtml(
          LIFECYCLE_LABELS[p.lifecycleStatus] || "Not Started",
        )} · ${escapeHtml(p.branch || "main")}</text>

        <rect x="150" y="${y + 4}" width="175" height="7" rx="3.5" fill="#e2e8f0" />
        <rect x="150" y="${y + 4}" width="${Math.max(health > 0 ? 4 : 0, (health / 100) * 175)}" height="7" rx="3.5" fill="#0f172a" />
        <text x="332" y="${y + 10.5}" font-size="8.5" font-family="JetBrains Mono, monospace" font-weight="700" fill="#0f172a">${health}/100</text>

        <rect x="385" y="${y + 2}" width="92" height="4" rx="2" fill="#e2e8f0" />
        <rect x="385" y="${y + 2}" width="${(unit / 100) * 92}" height="4" rx="2" fill="#3b6e9c" />
        <rect x="385" y="${y + 8}" width="92" height="4" rx="2" fill="#e2e8f0" />
        <rect x="385" y="${y + 8}" width="${(api / 100) * 92}" height="4" rx="2" fill="#5e658f" />
        <rect x="385" y="${y + 14}" width="92" height="4" rx="2" fill="#e2e8f0" />
        <rect x="385" y="${y + 14}" width="${(e2e / 100) * 92}" height="4" rx="2" fill="#497874" />

        <text x="486" y="${y + 6.5}" font-size="7.5" font-family="JetBrains Mono, monospace" fill="#3b6e9c">U ${unit}%</text>
        <text x="530" y="${y + 6.5}" font-size="7.5" font-family="JetBrains Mono, monospace" fill="#5e658f">A ${api}%</text>
        <text x="574" y="${y + 6.5}" font-size="7.5" font-family="JetBrains Mono, monospace" fill="#497874">E ${e2e}%</text>
        <text x="486" y="${y + 17.5}" font-size="7.5" font-family="JetBrains Mono, monospace" fill="#64748b">Pass ${p.passRatePct ?? 0}% · Saved +${Number(p.timeRoi?.totalHoursSaved ?? 0).toFixed(1)}h</text>
      `;
    })
    .join("");

  return `
    <svg width="100%" viewBox="0 0 650 ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <text x="150" y="7" font-size="7.5" font-weight="700" fill="#64748b">HEALTH SCORE (0–100)</text>
      <text x="385" y="7" font-size="7.5" font-weight="700" fill="#64748b">3-LAYER COVERAGE (UNIT / API / E2E)</text>
      ${rows}
    </svg>
  `;
}

function buildDossierTakeaway(p) {
  const unit = p.pillars?.unit?.coveragePct ?? 0;
  const api = p.pillars?.integration?.coveragePct ?? 0;
  const e2e = p.pillars?.system?.coveragePct ?? 0;
  const totalTests =
    (p.pillars?.unit?.totalTests || 0) +
    (p.pillars?.integration?.totalTests || 0) +
    (p.pillars?.system?.totalTests || 0);
  const failed =
    (p.pillars?.unit?.failedTests || 0) +
    (p.pillars?.integration?.failedTests || 0) +
    (p.pillars?.system?.failedTests || 0);
  const gaps = p.aiMetrics?.uncoveredGaps ?? 0;

  if (totalTests === 0) {
    return "No test suite runs executed on this snapshot yet. Run Unit AST coverage or API matrix discovery to establish baseline telemetry.";
  }
  if (failed > 0) {
    return `${failed} failing spec(s) detected across ${totalTests} total executed checks. Prioritize triage before expanding coverage targets.`;
  }
  if (gaps > 0) {
    return `${gaps} uncovered API endpoint(s) remain outside integration assertions despite ${unit}% unit / ${api}% API / ${e2e}% E2E coverage.`;
  }
  if ((p.healthScore ?? 0) >= 80) {
    return `Strong balanced coverage across Unit (${unit}%), API (${api}%), and E2E (${e2e}%) with clean passing execution.`;
  }
  return `Active suite (${totalTests} tests, ${p.passRatePct ?? 0}% pass). Expand thin layers toward the 80% portfolio benchmark.`;
}

function buildPrintableHtml({ vm, sections }) {
  const kpis = vm?.kpis || {};
  const projects = vm?.projects || [];
  const attention = vm?.attentionQueue || [];
  const activityFeed = vm?.activityFeed || [];
  const analytics = vm?.analytics || {};
  const infra = vm?.runnerInfrastructure || {};
  const metadata = vm?.metadata || {};

  const c1 = kpis.card1Health || {};
  const c2 = kpis.card2Coverage || {};
  const c3 = kpis.card3Scale || {};
  const c4 = kpis.card4AiImpact || {};
  const roi = vm?.timeRoiAnalytics || kpis.timeRoi || {};

  const lc = vm?.lifecycleCounts || {
    DOING: projects.filter((p) => p.lifecycleStatus === "DOING").length,
    COMPLETED: projects.filter((p) => p.lifecycleStatus === "COMPLETED").length,
    NOT_STARTED: projects.filter((p) => !p.lifecycleStatus || p.lifecycleStatus === "NOT_STARTED").length,
    PAUSED: projects.filter((p) => p.lifecycleStatus === "PAUSED").length,
    CANCELLED: projects.filter((p) => p.lifecycleStatus === "CANCELLED").length,
  };

  const totalRepos = projects.length;
  const activeCount = c1.totalProjects ?? lc.DOING ?? 0;
  const doingCount = lc.DOING || 0;
  const completedCount = lc.COMPLETED || 0;
  const notStartedCount = lc.NOT_STARTED || 0;
  const pausedCount = lc.PAUSED || 0;
  const cancelledCount = lc.CANCELLED || 0;
  const lcDenom = Math.max(1, totalRepos);

  const unitCov = c2.avgUnitCoveragePct ?? 0;
  const intCov = c2.avgIntegrationCoveragePct ?? 0;
  const sysCov = c2.avgSystemCoveragePct ?? 0;
  const unifiedCov = c2.unifiedCoveragePct ?? 0;

  const autoSeconds = Number(roi.totalAutoExecutionSeconds ?? 0);
  const manualHours = Number(roi.totalManualExecutionHours ?? 0);
  const totalSavedHours = Number(roi.totalQaHoursSaved ?? 0);
  const speedup = Number(roi.averageSpeedupMultiplier ?? 0);

  const generatedDate = new Date().toLocaleString();
  const reportId = `AUD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(totalRepos).padStart(2, "0")}`;

  const projectRowsHtml = projects
    .map((p) => {
      const unitP = p.pillars?.unit?.coveragePct ?? 0;
      const intP = p.pillars?.integration?.coveragePct ?? 0;
      const sysP = p.pillars?.system?.coveragePct ?? 0;
      const stateLabel = LIFECYCLE_LABELS[p.lifecycleStatus] || "Not Started";
      const fwList = (p.frameworks || []).slice(0, 3).join(", ") || "Node.js";
      return `
        <tr>
          <td>
            <div class="proj-name">${escapeHtml(p.name)}</div>
            <div class="proj-sub mono">${escapeHtml(p.branch || "main")} · ${escapeHtml(fwList)}</div>
          </td>
          <td><span class="badge badge-muted">${escapeHtml(stateLabel)}</span></td>
          <td class="num mono"><strong>${p.healthScore ?? 0}</strong>/100 (${escapeHtml(p.grade || "—")})</td>
          <td class="num mono">${unitP}%</td>
          <td class="num mono">${intP}%</td>
          <td class="num mono">${sysP}%</td>
          <td class="num mono">${p.passRatePct ?? 0}%</td>
          <td class="num mono">${p.aiMetrics?.aiGeneratedTests ?? 0} / ${p.aiMetrics?.aiRepairedTests ?? 0}</td>
          <td class="num mono">${p.aiMetrics?.uncoveredGaps ?? 0}</td>
          <td class="num mono">+${Number(p.timeRoi?.totalHoursSaved ?? 0).toFixed(1)}h</td>
        </tr>
      `;
    })
    .join("");

  const roiRowsHtml = [...projects]
    .sort((a, b) => (b.timeRoi?.totalHoursSaved ?? 0) - (a.timeRoi?.totalHoursSaved ?? 0))
    .map((p) => {
      const autoSec = Number((p.timeRoi?.actualAutoDurationMs || 0) / 1000).toFixed(1);
      const manualH = Number((p.timeRoi?.estimatedManualDurationMs || 0) / 3600000).toFixed(2);
      const savedH = Number(p.timeRoi?.totalHoursSaved ?? 0).toFixed(2);
      const mult = Number(p.timeRoi?.speedupMultiplier ?? 0).toFixed(1);
      return `
        <tr>
          <td><span class="proj-name">${escapeHtml(p.name)}</span></td>
          <td class="num mono">${autoSec}s</td>
          <td class="num mono">${manualH}h</td>
          <td class="num mono"><strong>+${savedH}h</strong></td>
          <td class="num mono">${mult > 0 ? `${mult}x` : "—"}</td>
          <td class="num mono">${p.aiMetrics?.aiGeneratedTests ?? 0}</td>
          <td class="num mono">${p.aiMetrics?.aiRepairedTests ?? 0}</td>
        </tr>
      `;
    })
    .join("");

  const projectDossiersHtml = projects
    .map((p) => {
      const u = p.pillars?.unit || {};
      const i = p.pillars?.integration || {};
      const s = p.pillars?.system || {};
      const stateLabel = LIFECYCLE_LABELS[p.lifecycleStatus] || "Not Started";
      const totalTests = (u.totalTests || 0) + (i.totalTests || 0) + (s.totalTests || 0);
      const failLayers = i.failureLayers || {};
      const failTypes = s.failureTypes || {};
      return `
        <div class="dossier-card">
          <div class="dossier-head">
            <div>
              <div class="dossier-title">${escapeHtml(p.name)}</div>
              <div class="dossier-meta mono">${escapeHtml(p.branch || "main")} · Updated ${escapeHtml(formatShortDate(p.updatedAt))}${p.snapshotId ? ` · Snap ${escapeHtml(String(p.snapshotId).slice(0, 8))}` : ""}</div>
            </div>
            <div class="dossier-right">
              <span class="badge badge-muted">${escapeHtml(stateLabel)}</span>
              <span class="badge badge-ink mono">Score ${p.healthScore ?? 0}/100 (${escapeHtml(p.grade || "—")})</span>
            </div>
          </div>

          <div class="dossier-kpis mono">
            <div><span>Unified Cov</span><strong>${p.unifiedCoveragePct ?? 0}%</strong></div>
            <div><span>Pass Rate</span><strong>${p.passRatePct ?? 0}%</strong></div>
            <div><span>Executed</span><strong>${totalTests}</strong></div>
            <div><span>QA Saved</span><strong>+${Number(p.timeRoi?.totalHoursSaved ?? 0).toFixed(1)}h</strong></div>
          </div>

          <table class="mini-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th class="num">Coverage</th>
                <th class="num">Passed / Total</th>
                <th class="num">Failed</th>
                <th class="num">Runtime</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Unit</strong> (${escapeHtml(u.framework || "Jest")})</td>
                <td class="num mono">${u.coveragePct ?? 0}% <span class="muted">(Br ${u.branchCoveragePct ?? 0}%)</span></td>
                <td class="num mono">${u.passedTests ?? 0}/${u.totalTests ?? 0}</td>
                <td class="num mono">${u.failedTests ?? 0}</td>
                <td class="num mono">${formatDurationMs(u.durationMs)}</td>
              </tr>
              <tr>
                <td><strong>API Matrix</strong> (${escapeHtml(i.framework || "Supertest")})</td>
                <td class="num mono">${i.coveragePct ?? 0}% <span class="muted">(${i.coveredApis ?? 0}/${i.totalApis ?? 0} APIs)</span></td>
                <td class="num mono">${i.passedTests ?? 0}/${i.totalTests ?? 0}</td>
                <td class="num mono">${i.failedTests ?? 0}</td>
                <td class="num mono">${formatDurationMs(i.durationMs)}</td>
              </tr>
              <tr>
                <td><strong>System E2E</strong> (${escapeHtml(s.framework || "Playwright")})</td>
                <td class="num mono">${s.coveragePct ?? 0}% <span class="muted">(${s.coveredJourneys ?? 0}/${s.totalJourneys ?? 0} Flows)</span></td>
                <td class="num mono">${s.passedTests ?? 0}/${s.totalTests ?? 0}</td>
                <td class="num mono">${s.failedTests ?? 0}</td>
                <td class="num mono">${formatDurationMs(s.durationMs)}</td>
              </tr>
            </tbody>
          </table>

          <div class="dossier-foot">
            <div class="mono muted">
              AI Specs: ${p.aiMetrics?.aiGeneratedTests ?? 0} generated, ${p.aiMetrics?.aiRepairedTests ?? 0} healed · Uncovered API gaps: ${p.aiMetrics?.uncoveredGaps ?? 0} · Failure breakdown (R:${failLayers.route ?? 0} M:${failLayers.middleware ?? 0} C:${failLayers.controller ?? 0} DB:${failLayers.database ?? 0} | Sel:${failTypes.selector ?? 0} Tmo:${failTypes.timeout ?? 0} Ast:${failTypes.assertion ?? 0})
            </div>
            <div class="dossier-note">${escapeHtml(buildDossierTakeaway(p))}</div>
          </div>
        </div>
      `;
    })
    .join("");

  const attentionHtml = attention
    .map(
      (a) => `
      <tr>
        <td><span class="badge ${
          a.severity === "CRITICAL"
            ? "badge-fail"
            : a.severity === "HIGH"
              ? "badge-warn"
              : "badge-muted"
        }">${escapeHtml(a.severity || "INFO")}</span></td>
        <td class="mono">${escapeHtml(a.projectName)}</td>
        <td class="mono">${escapeHtml((a.pillar || "unit").toUpperCase())}</td>
        <td>
          <div class="proj-name">${escapeHtml(a.title)}</div>
          <div class="proj-sub">${escapeHtml(a.description || "")}</div>
        </td>
      </tr>
    `,
    )
    .join("");

  const activityRowsHtml = activityFeed
    .slice(0, 14)
    .map(
      (evt) => `
      <tr>
        <td class="mono">${escapeHtml(evt.id || "—")}</td>
        <td><strong>${escapeHtml(evt.projectName)}</strong></td>
        <td class="mono">${escapeHtml((evt.pillar || "unit").toUpperCase())}</td>
        <td class="mono">${escapeHtml(evt.type === "AI_GENERATION" ? "AI Synth" : "Test Run")}</td>
        <td><span class="badge ${evt.outcome === "FAILED" ? "badge-fail" : "badge-pass"}">${escapeHtml(evt.outcome || "SUCCESS")}</span></td>
        <td class="num mono">${formatDurationMs(evt.durationMs)}</td>
        <td class="proj-sub">${escapeHtml(evt.summary || "Completed")}</td>
      </tr>
    `,
    )
    .join("");

  const scatterLegendHtml = (analytics?.quadrantNodes?.length ? analytics.quadrantNodes : projects)
    .slice(0, 18)
    .map(
      (n, idx) =>
        `<span class="legend-chip mono"><strong>#${idx + 1}</strong> ${escapeHtml(n.name)} (${n.x ?? n.unifiedCoveragePct ?? 0}% cov, ${n.y ?? n.passRatePct ?? 0}% pass)</span>`,
    )
    .join("");

  const radarSvg = buildRadarSvg(kpis);
  const scatterSvg = buildScatterSvg(analytics, projects);
  const repoComparisonSvg = buildRepoComparisonSvg(projects);

  const topProject = [...projects].sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0))[0];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CovAI Engineering Quality Audit — ${escapeHtml(reportId)}</title>
  <style>
    @page { size: A4 portrait; margin: 13mm 13mm 15mm 13mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 10.5px;
      line-height: 1.48;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .mono { font-family: "JetBrains Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
    .muted { color: #64748b; }
    .page-break { break-before: page; page-break-before: always; }

    /* Cover Editorial Header */
    .report-banner {
      border-top: 3px solid #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding: 12px 0 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .brand { display: flex; align-items: flex-start; gap: 11px; }
    .brand-eyebrow {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #3b6e9c;
      margin-bottom: 2px;
    }
    .brand-title { font-size: 19px; font-weight: 800; letter-spacing: -0.03em; color: #0f172a; line-height: 1.15; }
    .brand-sub { font-size: 10.5px; color: #475569; margin-top: 3px; }
    .meta { text-align: right; font-size: 9.5px; color: #475569; line-height: 1.55; shrink: 0; }
    .grade-pill {
      display: inline-block;
      margin-top: 5px;
      padding: 3px 9px;
      border-radius: 4px;
      background: #0f172a;
      color: #ffffff;
      font-weight: 700;
      font-size: 10.5px;
    }

    /* Section Headings */
    .chapter { margin-bottom: 18px; }
    .chapter-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 4px;
      margin-bottom: 11px;
    }
    .chapter-title {
      font-size: 11.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0f172a;
    }
    .chapter-sub { font-size: 9.5px; color: #64748b; }

    /* KPI Matrix */
    .kpi-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-bottom: 12px; }
    .kpi-card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 9px 11px;
      background: #f8fafc;
      break-inside: avoid;
    }
    .kpi-label { font-size: 9.5px; color: #475569; font-weight: 600; }
    .kpi-val { font-size: 19px; font-weight: 800; margin: 3px 0 2px; color: #0f172a; letter-spacing: -0.02em; }
    .kpi-sub { font-size: 9px; color: #64748b; }

    /* Panels & Charts */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-bottom: 12px; }
    .box {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 11px 12px;
      background: #ffffff;
      break-inside: avoid;
      margin-bottom: 11px;
    }
    .two-col .box { margin-bottom: 0; }
    .box-title {
      font-size: 10px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .box-caption { font-size: 9px; color: #64748b; font-weight: 500; }

    /* Segmented bar & layer rows */
    .seg-bar { height: 10px; border-radius: 99px; background: #e2e8f0; overflow: hidden; display: flex; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 9px; color: #475569; }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
    .layer-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; font-size: 9.5px; }
    .layer-name { width: 92px; color: #334155; font-weight: 600; }
    .layer-track { flex: 1; height: 7px; background: #e2e8f0; border-radius: 99px; overflow: hidden; }
    .layer-fill { height: 100%; border-radius: 99px; }

    /* Narrative Synthesis */
    .narrative-box {
      border-left: 3px solid #3b6e9c;
      background: #f8fafc;
      padding: 10px 13px;
      border-radius: 0 6px 6px 0;
      font-size: 10px;
      color: #334155;
      line-height: 1.55;
      break-inside: avoid;
    }
    .narrative-box strong { color: #0f172a; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 6px 7px;
      border-bottom: 1.5px solid #cbd5e1;
      font-size: 8.8px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    th.num, td.num { text-align: right; }
    td { padding: 6px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr { break-inside: avoid; }
    .proj-name { font-weight: 600; color: #0f172a; }
    .proj-sub { font-size: 8.8px; color: #64748b; margin-top: 1px; }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 1.5px 6px;
      border-radius: 4px;
      font-size: 8.5px;
      font-weight: 600;
      font-family: "JetBrains Mono", monospace;
      white-space: nowrap;
    }
    .badge-pass { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .badge-warn { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .badge-fail { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .badge-muted { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .badge-ink { background: #0f172a; color: #ffffff; }

    /* Legend Chips */
    .legend-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
    .legend-chip {
      font-size: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 2px 6px;
      border-radius: 4px;
      color: #334155;
    }

    /* Project Dossiers */
    .dossier-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .dossier-card {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 11px;
      background: #ffffff;
      break-inside: avoid;
    }
    .dossier-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .dossier-title { font-size: 11px; font-weight: 700; color: #0f172a; }
    .dossier-meta { font-size: 8.2px; color: #64748b; margin-top: 1px; }
    .dossier-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
    .dossier-kpis {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 5px 7px;
      margin-bottom: 8px;
      font-size: 8.5px;
    }
    .dossier-kpis span { display: block; color: #64748b; font-size: 7.5px; }
    .dossier-kpis strong { font-size: 10px; color: #0f172a; }
    .mini-table { font-size: 8.5px; }
    .mini-table th { padding: 4px 5px; font-size: 7.8px; }
    .mini-table td { padding: 4px 5px; }
    .dossier-foot { margin-top: 7px; padding-top: 6px; border-top: 1px dashed #e2e8f0; font-size: 8.2px; }
    .dossier-note { color: #334155; margin-top: 4px; font-size: 8.8px; line-height: 1.4; }

    /* Methodology Grid */
    .method-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
    .method-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 9px;
      color: #475569;
      break-inside: avoid;
    }
    .method-card strong { display: block; color: #0f172a; margin-bottom: 3px; font-size: 9.5px; }

    .report-footer {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 8.5px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <!-- ── REPORT HEADER BANNER ──────────────────────────────────────────────── -->
  <div class="report-banner">
    <div class="brand">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#0A0C10" stroke="#2A3244" stroke-width="1.5" />
        <path d="M8.5 16H14.2L19.8 10.5H23" stroke="#38BDF8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M14.2 16L19.8 21.5H23" stroke="#F1F5F9" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="8.5" cy="16" r="2.2" fill="#F1F5F9" />
        <circle cx="23" cy="10.5" r="2.2" fill="#38BDF8" />
        <circle cx="23" cy="21.5" r="2.2" fill="#F1F5F9" />
      </svg>
      <div>
        <div class="brand-eyebrow mono">CovAI Engineering Audit · ${escapeHtml(reportId)}</div>
        <div class="brand-title">Multi-Project Quality &amp; Coverage Audit</div>
        <div class="brand-sub">Comprehensive Unit AST, API Integration, System E2E &amp; Automation ROI Telemetry</div>
      </div>
    </div>
    <div class="meta mono">
      <div>Generated: ${escapeHtml(generatedDate)}</div>
      <div>Portfolio: ${totalRepos} Repositories · ${activeCount} Active · ${metadata.totalSnapshotsCount ?? 0} Snapshots</div>
      <div class="grade-pill">Portfolio Grade ${escapeHtml(c1.grade || "—")} · ${c1.avgHealthScore ?? 0}/100</div>
    </div>
  </div>

  <!-- ── CHAPTER 1: EXECUTIVE SUMMARY ──────────────────────────────────────── -->
  ${
    sections.kpis
      ? `
  <div class="chapter">
    <div class="chapter-head">
      <div class="chapter-title">1. Executive Summary &amp; Governance Posture</div>
      <div class="chapter-sub mono">Active Scope: ${activeCount} / ${totalRepos} Repositories</div>
    </div>

    <div class="kpi-grid-3">
      <div class="kpi-card">
        <div class="kpi-label">Portfolio Health Index</div>
        <div class="kpi-val mono">${c1.avgHealthScore ?? 0}<span style="font-size:12px;font-weight:600;color:#64748b">/100</span></div>
        <div class="kpi-sub mono">Grade ${escapeHtml(c1.grade || "—")} · ${activeCount} active in scope</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Unified Weighted Coverage</div>
        <div class="kpi-val mono" style="color:#3b6e9c">${unifiedCov}%</div>
        <div class="kpi-sub mono">35% Unit · 40% API · 25% E2E (Target 80%)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Executed Test Specs</div>
        <div class="kpi-val mono">${c3.totalExecutedTests ?? 0}</div>
        <div class="kpi-sub mono">${c3.totalPassedTests ?? 0} passed · ${c3.totalFailedTests ?? 0} failed (${c3.overallPassRatePct ?? 0}%)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">AI Synthesis &amp; Healing</div>
        <div class="kpi-val mono">${c4.totalAiTests ?? 0}</div>
        <div class="kpi-sub mono">${c4.aiGeneratedCount ?? 0} generated · ${c4.aiRepairedCount ?? 0} repaired</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">QA Automation Time Saved</div>
        <div class="kpi-val mono" style="color:#447a63">+${totalSavedHours.toFixed(1)}h</div>
        <div class="kpi-sub mono">${speedup > 0 ? `${speedup}x` : "—"} speedup vs ${manualHours.toFixed(1)}h manual</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Attention Findings &amp; Gaps</div>
        <div class="kpi-val mono">${attention.length}</div>
        <div class="kpi-sub mono">${c4.uncoveredGapsCount ?? 0} uncovered APIs · ${infra.activeWorkers ?? 0} active workers</div>
      </div>
    </div>

    <div class="two-col">
      <div class="box">
        <div class="box-title">
          <span>Lifecycle Distribution</span>
          <span class="box-caption mono">${totalRepos} Total Repositories</span>
        </div>
        <div class="seg-bar">
          <div style="width:${(doingCount / lcDenom) * 100}%;background:#3b6e9c"></div>
          <div style="width:${(completedCount / lcDenom) * 100}%;background:#447a63"></div>
          <div style="width:${(notStartedCount / lcDenom) * 100}%;background:#64748b"></div>
          <div style="width:${(pausedCount / lcDenom) * 100}%;background:#997b47"></div>
          <div style="width:${(cancelledCount / lcDenom) * 100}%;background:#cbd5e1"></div>
        </div>
        <div class="legend mono">
          <span><i class="dot" style="background:#3b6e9c"></i>Doing (${doingCount})</span>
          <span><i class="dot" style="background:#447a63"></i>Completed (${completedCount})</span>
          <span><i class="dot" style="background:#64748b"></i>Not Started (${notStartedCount})</span>
          <span><i class="dot" style="background:#997b47"></i>Paused (${pausedCount})</span>
          <span><i class="dot" style="background:#cbd5e1"></i>Cancelled (${cancelledCount})</span>
        </div>
      </div>

      <div class="box">
        <div class="box-title">
          <span>3-Layer Testing Pyramid vs. 80% Target</span>
          <span class="box-caption mono">Runtime ${escapeHtml(c3.cumulativeDurationStr || "0ms")}</span>
        </div>
        <div class="layer-row">
          <span class="layer-name">Unit Lines (${escapeHtml(c3.unitPassedStr || "0/0")})</span>
          <div class="layer-track"><div class="layer-fill" style="width:${unitCov}%;background:#3b6e9c"></div></div>
          <span class="mono" style="width:36px;text-align:right"><strong>${unitCov}%</strong></span>
        </div>
        <div class="layer-row">
          <span class="layer-name">API Matrix (${escapeHtml(c3.apiCoveredStr || "0/0")})</span>
          <div class="layer-track"><div class="layer-fill" style="width:${intCov}%;background:#5e658f"></div></div>
          <span class="mono" style="width:36px;text-align:right"><strong>${intCov}%</strong></span>
        </div>
        <div class="layer-row" style="margin-bottom:0">
          <span class="layer-name">System E2E (${escapeHtml(c3.systemVerifiedStr || "0/0")})</span>
          <div class="layer-track"><div class="layer-fill" style="width:${sysCov}%;background:#497874"></div></div>
          <span class="mono" style="width:36px;text-align:right"><strong>${sysCov}%</strong></span>
        </div>
      </div>
    </div>

    <div class="narrative-box" style="margin-top:11px">
      <strong>Executive Synthesis:</strong> Across <strong>${totalRepos} imported repositories</strong> (${doingCount} currently active in KPI calculations), CovAI recorded <strong>${c3.totalExecutedTests ?? 0} total test executions</strong> with an overall pass rate of <strong>${c3.overallPassRatePct ?? 0}%</strong> and a weighted unified coverage of <strong>${unifiedCov}%</strong>. Automated synthesis produced <strong>${c4.totalAiTests ?? 0} specs</strong>, conserving approximately <strong>+${totalSavedHours.toFixed(1)} manual QA hours</strong>.${
        topProject
          ? ` Highest benchmarked repository is <strong>${escapeHtml(topProject.name)}</strong> (${topProject.healthScore ?? 0}/100 health, ${topProject.unifiedCoveragePct ?? 0}% coverage).`
          : ""
      } ${
        attention.length > 0
          ? `<strong>${attention.length} diagnostic attention item(s)</strong> require coverage expansion or failure triage in Chapter 4.`
          : "No critical diagnostic blockers remain open in the active risk register."
      }
    </div>
  </div>`
      : ""
  }

  <!-- ── CHAPTER 2: VISUAL ANALYTICS & AUTOMATION ROI ──────────────────────── -->
  ${
    sections.diagrams
      ? `
  <div class="chapter ${sections.kpis ? "page-break" : ""}">
    <div class="chapter-head">
      <div class="chapter-title">2. Visual Quality Diagrams &amp; Automation ROI</div>
      <div class="chapter-sub mono">Radar Capability · Quadrant Posture · Per-Repo Comparison</div>
    </div>

    <div class="two-col">
      <div class="box">
        <div class="box-title">
          <span>5-Axis Quality Capability Radar</span>
          <span class="box-caption mono">Dashed = Target (80% / 90%)</span>
        </div>
        ${radarSvg}
      </div>

      <div class="box">
        <div class="box-title">
          <span>Coverage × Pass Rate Quadrant Plot</span>
          <span class="box-caption mono">Cutoffs: 50% Cov · 80% Pass</span>
        </div>
        ${scatterSvg}
        ${scatterLegendHtml ? `<div class="legend-chips">${scatterLegendHtml}</div>` : ""}
      </div>
    </div>

    ${
      projects.length > 0
        ? `
    <div class="box" style="margin-top:11px">
      <div class="box-title">
        <span>Cross-Repository Health &amp; 3-Layer Coverage Benchmark</span>
        <span class="box-caption mono">${projects.length} Repositories</span>
      </div>
      ${repoComparisonSvg}
    </div>`
        : ""
    }

    <div class="box">
      <div class="box-title">
        <span>QA Time Saved &amp; Execution Speedup Breakdown</span>
        <span class="box-caption mono">${autoSeconds.toFixed(1)}s Auto vs ${manualHours.toFixed(1)}h Manual Baseline</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th class="num">Auto Runtime</th>
            <th class="num">Manual Est.</th>
            <th class="num">Net Hours Saved</th>
            <th class="num">Speedup</th>
            <th class="num">AI Generated</th>
            <th class="num">AI Repaired</th>
          </tr>
        </thead>
        <tbody>
          ${roiRowsHtml || '<tr><td colspan="7" class="muted" style="text-align:center">No ROI telemetry recorded yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`
      : ""
  }

  <!-- ── CHAPTER 3: PORTFOLIO MATRIX & PER-PROJECT DOSSIERS ────────────────── -->
  ${
    sections.directory
      ? `
  <div class="chapter ${sections.kpis || sections.diagrams ? "page-break" : ""}">
    <div class="chapter-head">
      <div class="chapter-title">3. Portfolio Quality Matrix &amp; Repository Dossiers</div>
      <div class="chapter-sub mono">${projects.length} Complete Repositories</div>
    </div>

    <div class="box">
      <div class="box-title">
        <span>Consolidated Repository Matrix</span>
        <span class="box-caption mono">All Lifecycle States</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Repository &amp; Stack</th>
            <th>Status</th>
            <th class="num">Health</th>
            <th class="num">Unit</th>
            <th class="num">API</th>
            <th class="num">E2E</th>
            <th class="num">Pass</th>
            <th class="num">AI Gen/Fix</th>
            <th class="num">Gaps</th>
            <th class="num">Saved</th>
          </tr>
        </thead>
        <tbody>
          ${projectRowsHtml || '<tr><td colspan="10" class="muted" style="text-align:center">No repositories in portfolio</td></tr>'}
        </tbody>
      </table>
    </div>

    ${
      projects.length > 0
        ? `
    <div style="margin-top:12px">
      <div class="box-title" style="margin-bottom:8px">
        <span>Detailed Per-Repository Telemetry Dossiers</span>
        <span class="box-caption mono">${projects.length} Technical Profiles</span>
      </div>
      <div class="dossier-grid">
        ${projectDossiersHtml}
      </div>
    </div>`
        : ""
    }
  </div>`
      : ""
  }

  <!-- ── CHAPTER 4: RISK FINDINGS, RUN LOG & METHODOLOGY ───────────────────── -->
  ${
    sections.attention
      ? `
  <div class="chapter ${sections.kpis || sections.diagrams || sections.directory ? "page-break" : ""}">
    <div class="chapter-head">
      <div class="chapter-title">4. Risk Register, Execution Log &amp; Audit Methodology</div>
      <div class="chapter-sub mono">${attention.length} Findings · ${activityFeed.length} Recorded Runs</div>
    </div>

    <div class="box">
      <div class="box-title">
        <span>Priority Coverage Gaps &amp; Risk Findings</span>
        <span class="box-caption mono">${attention.length} Active Items</span>
      </div>
      ${
        attention.length > 0
          ? `
      <table>
        <thead>
          <tr>
            <th style="width:74px">Severity</th>
            <th style="width:130px">Repository</th>
            <th style="width:70px">Layer</th>
            <th>Diagnostic Finding &amp; Remediation Focus</th>
          </tr>
        </thead>
        <tbody>${attentionHtml}</tbody>
      </table>`
          : `<div class="narrative-box">No critical risk or coverage deficit findings flagged across the active portfolio baseline.</div>`
      }
    </div>

    <div class="two-col" style="margin-bottom:11px">
      <div class="box">
        <div class="box-title">
          <span>Runner Infrastructure Telemetry</span>
          <span class="box-caption mono">${infra.isRedisConnected ? "Redis Online" : "Queue Standby"}</span>
        </div>
        <div class="dossier-kpis mono" style="margin-bottom:0">
          <div><span>Workers</span><strong>${infra.activeWorkers ?? 0}</strong></div>
          <div><span>Running</span><strong>${infra.runningJobsCount ?? 0}</strong></div>
          <div><span>Queued</span><strong>${infra.queuedJobsCount ?? 0}</strong></div>
          <div><span>Snapshots</span><strong>${metadata.totalSnapshotsCount ?? 0}</strong></div>
        </div>
      </div>

      <div class="box">
        <div class="box-title">
          <span>Audit Sign-Off &amp; Scope</span>
          <span class="box-caption mono">${escapeHtml(reportId)}</span>
        </div>
        <div class="muted" style="font-size:9px;line-height:1.5">
          Data sourced directly from CovAI PostgreSQL verification snapshots and BullMQ execution telemetry. Lifecycle labels reflect read-only portfolio tracking state.
        </div>
      </div>
    </div>

    ${
      activityFeed.length > 0
        ? `
    <div class="box">
      <div class="box-title">
        <span>Recent Execution &amp; AI Synthesis Log</span>
        <span class="box-caption mono">Latest ${Math.min(14, activityFeed.length)} Events</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Run ID</th>
            <th>Repository</th>
            <th>Layer</th>
            <th>Type</th>
            <th>Outcome</th>
            <th class="num">Runtime</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>${activityRowsHtml}</tbody>
      </table>
    </div>`
        : ""
    }

    <div class="method-grid">
      <div class="method-card">
        <strong>Weighted Coverage Formula</strong>
        <span class="mono">0.35 × Unit Lines + 0.40 × API Endpoints + 0.25 × System E2E Flows</span>. Prioritizes API contract verification alongside unit isolation.
      </div>
      <div class="method-card">
        <strong>Health Score &amp; Grading</strong>
        <span class="mono">0.50 × Pass Rate + 0.50 × Unified Coverage</span>. Graded: <span class="mono">A ≥ 85</span>, <span class="mono">B ≥ 70</span>, <span class="mono">C ≥ 50</span>, <span class="mono">D &lt; 50</span>.
      </div>
      <div class="method-card">
        <strong>QA Time ROI Model</strong>
        Compares measured automated runner wall-time against standardized manual scripting &amp; exploratory execution hours per test tier.
      </div>
    </div>
  </div>`
      : ""
  }

  <div class="report-footer mono">
    <span>CovAI Autonomous Test Intelligence · ${escapeHtml(reportId)}</span>
    <span>Confidential Engineering Quality Audit Report</span>
  </div>
</body>
</html>`;
}

export function ExportPortfolioReportModal({
  isOpen = false,
  onClose,
  vm = {},
}) {
  const [sections, setSections] = useState({
    kpis: true,
    diagrams: true,
    directory: true,
    attention: true,
  });
  const printFrameRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleSection = (key) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedCount = Object.values(sections).filter(Boolean).length;
  const printableHtml = buildPrintableHtml({ vm, sections });

  const handleExportPdf = () => {
    const iframe = printFrameRef.current;
    if (!iframe) return;
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(printableHtml);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 180);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Portfolio PDF Audit Report Preview"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px] ud-no-print"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="portfolio-studio w-full max-w-5xl max-h-[92vh] rounded-[12px] border border-[var(--ps-line-strong)] bg-[var(--ps-surface)] text-[var(--ps-ink)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* ── Modal Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--ps-line)] bg-[var(--ps-surface)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--ps-surface-2)] border border-[var(--ps-line)] text-[var(--ps-cobalt)] flex items-center justify-center shrink-0">
              <FileText size={15} />
            </div>
            <div className="min-w-0">
              <h2 className="ps-display text-sm font-semibold text-[var(--ps-ink)]">
                Portfolio audit report
              </h2>
              <p className="text-[11px] text-[var(--ps-ink-muted)] truncate">
                Multi-page A4 engineering report with SVG analytics, project dossiers, and methodology
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface-2)]/60 hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <span className="hidden sm:inline text-[11px] ps-mono text-[var(--ps-ink-muted)]">
              Esc
            </span>
            <X size={14} />
          </button>
        </div>

        {/* ── Chapter Toggle Strip ──────────────────────────────────── */}
        <div className="px-5 py-2.5 border-b border-[var(--ps-line)] bg-[var(--ps-inset)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ps-ink-muted)] mr-1">
              <Layers size={12} />
              Chapters:
            </span>
            {[
              { key: "kpis", label: "1. Executive Summary" },
              { key: "diagrams", label: "2. SVG Charts & ROI" },
              { key: "directory", label: "3. Matrix & Dossiers" },
              { key: "attention", label: "4. Risks & Methodology" },
            ].map((item) => {
              const active = sections[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleSection(item.key)}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? "bg-[var(--ps-surface)] border-[var(--ps-line-strong)] text-[var(--ps-ink)]"
                      : "bg-transparent border-[var(--ps-line)] text-[var(--ps-ink-muted)] opacity-70 hover:opacity-100"
                  }`}
                >
                  <CheckSquare
                    size={12}
                    style={{
                      color: active ? "var(--ps-cobalt)" : "var(--ps-ink-muted)",
                    }}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
            {selectedCount} / 4 chapters active · {vm?.projects?.length ?? 0} repos
          </span>
        </div>

        {/* ── Drafting Tray & A4 Preview Sheet ─────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-[var(--ps-bg)] p-4 sm:p-6">
          <div className="mx-auto max-w-[820px] rounded-lg overflow-hidden shadow-xl border border-[var(--ps-line-strong)] bg-white">
            <iframe
              title="PDF Report Preview"
              srcDoc={printableHtml}
              className="w-full h-[60vh] min-h-[460px] border-0 bg-white"
            />
          </div>
        </div>

        <iframe
          ref={printFrameRef}
          title="PDF Print Frame"
          className="hidden"
        />

        {/* ── Footer ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--ps-line)] bg-[var(--ps-inset)]">
          <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
            A4 Portrait Print-Ready PDF · Enable &ldquo;Background graphics&rdquo; in print dialog
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-xs font-medium text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={selectedCount === 0}
              className="h-8 px-4 rounded-md ps-btn-contrast text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileDown size={14} />
              <span>Export PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExportPortfolioReportModal;
