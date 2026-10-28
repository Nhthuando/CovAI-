import React, { useState, useEffect } from "react";
import {
  FileText,
  Printer,
  Download,
  Database,
  BarChart2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Activity,
  Code2,
} from "lucide-react";
import MetricProvenancePopover from "./MetricProvenancePopover.jsx";
import IntegrationGuidancePanel from "./IntegrationGuidancePanel.jsx";

const METHOD_STYLES = {
  GET: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  POST: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const formatDate = (val) => {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return String(val);
  }
};

export default function IntegrationReportEmbed({
  projectId,
  snapshotId,
  report,
  workspace,
  loading = false,
  onRefreshReport = () => {},
}) {
  const handlePrint = () => {
    window.print();
  };

  const handleExportJson = () => {
    if (!report && !workspace) return;
    const jsonStr = JSON.stringify(
      {
        projectId,
        snapshotId,
        exportedAt: new Date().toISOString(),
        overview: report?.overview || workspace?.summary,
        latestExecution: report?.latestExecution || workspace?.execution,
        apiCoverage: report?.apiCoverage,
        routeMatrix: report?.routeMatrix || (workspace?.endpoints || []).map((e) => ({
          method: e.method,
          path: e.path,
          handler: e.controllerName || e.handler,
          sourceFile: e.sourceFile || e.filePath,
          status: e.failedCount > 0 ? "FAILED" : e.passedCount > 0 ? "COVERED" : "UNCOVERED",
        })),
        failureLogs: report?.failureLogs || [],
        history: report?.history,
      },
      null,
      2
    );

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `integration-report-${projectId || "project"}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const overview = report?.overview || workspace?.summary || {};
  const latestExecution = report?.latestExecution || workspace?.execution || {};
  const apiCoverage = report?.apiCoverage || {};
  const routeMatrix = report?.routeMatrix || (workspace?.endpoints || []).map((e) => ({
    method: e.method,
    path: e.path,
    handler: e.controllerName || e.handler,
    sourceFile: e.sourceFile || e.filePath,
    status: e.failedCount > 0 ? "FAILED" : e.passedCount > 0 ? "COVERED" : "UNCOVERED",
  }));
  const history = report?.history || {};

  const totalDiscovered = apiCoverage?.discoveredApis ?? overview?.discoveredApis ?? routeMatrix.length;
  const totalTested = apiCoverage?.testedApis ?? overview?.testedApis ?? 0;
  const totalUncovered = Math.max(0, totalDiscovered - totalTested);

  return (
    <div className="space-y-6 font-sans">
      {/* Print-specific style overrides */}
      <style>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .no-print, header, nav, .sticky {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .print-break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>

      {/* Report Section Header */}
      <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-[var(--color-text)] m-0 flex items-center gap-2">
              Báo Cáo Kiểm Thử Tích Hợp API (Integration Test Report)
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)] font-mono m-0 mt-0.5">
              Project #{projectId?.substring(0, 8) || "active"} • Snapshot: #{snapshotId?.substring(0, 8) || "latest"} • Báo cáo tự động tổng hợp
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 no-print">
          <button
            type="button"
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer shadow-xs"
            title="Tải toàn bộ báo cáo về máy dưới dạng JSON"
          >
            <Download size={13} />
            <span>Xuất JSON Summary</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            title="In hoặc xuất file PDF báo cáo này"
          >
            <Printer size={13} />
            <span>In báo cáo / Xuất PDF</span>
          </button>
        </div>
      </div>

      {/* 1. Overview Metric KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 print-break-inside-avoid">
        {/* Total Scenarios */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <MetricProvenancePopover provenance={overview?.provenance?.scenarioCount}>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
              Total Scenarios
            </p>
          </MetricProvenancePopover>
          <p className="text-2xl font-bold font-mono text-[var(--color-text)]">
            {overview.totalScenarios || (workspace?.endpoints || []).reduce((acc, ep) => acc + (ep.scenarios?.length || 0), 0)}
          </p>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
            AI: {overview.unmodifiedAiScenarios || 0} • Custom: {overview.modifiedScenarios || 0}
          </div>
        </div>

        {/* API Coverage */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <MetricProvenancePopover provenance={apiCoverage?.provenance}>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
              API Coverage
            </p>
          </MetricProvenancePopover>
          <p className="text-2xl font-bold font-mono text-[var(--color-primary)]">
            {apiCoverage.coveragePercentage != null ? `${apiCoverage.coveragePercentage.toFixed(1)}%` : `${overview.apiCoverageRate || 0}%`}
          </p>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
            {totalTested} / {totalDiscovered} Endpoints
          </div>
        </div>

        {/* Pass Rate */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <MetricProvenancePopover provenance={latestExecution?.provenance}>
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
              Test Pass Rate
            </p>
          </MetricProvenancePopover>
          <p className="text-2xl font-bold font-mono text-[var(--color-success)]">
            {latestExecution && latestExecution.totalTests > 0
              ? `${((latestExecution.passedTests / latestExecution.totalTests) * 100).toFixed(1)}%`
              : overview.passRate != null
                ? `${overview.passRate}%`
                : "N/A"}
          </p>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
            Pass: {latestExecution?.passedTests ?? overview.passed ?? 0} • Fail: {latestExecution?.failedTests ?? overview.failed ?? 0}
          </div>
        </div>

        {/* Uncovered Endpoints */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
            Uncovered Endpoints
          </p>
          <p className={`text-2xl font-bold font-mono ${totalUncovered > 0 ? "text-amber-400" : "text-[var(--color-success)]"}`}>
            {totalUncovered}
          </p>
          <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
            Chưa có kịch bản kiểm thử API
          </div>
        </div>
      </div>

      {/* 2. Route Matrix Summary Table */}
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden shadow-xs print-break-inside-avoid">
        <div className="px-4 py-3 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-[var(--color-primary)]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
              Tóm Tắt Ma Trận Độ Bao Phủ Endpoint ({routeMatrix.length} Routes)
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto max-h-72 custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                <th className="py-2 px-3">Method</th>
                <th className="py-2 px-3">Endpoint Route</th>
                <th className="py-2 px-3">Handler</th>
                <th className="py-2 px-3">Source File</th>
                <th className="py-2 px-3 text-center">Trạng Thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/60 font-mono">
              {routeMatrix.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-[var(--color-text-muted)] italic">
                    Chưa phát hiện route nào trong snapshot này.
                  </td>
                </tr>
              ) : (
                routeMatrix.map((r, idx) => {
                  const methodClass = METHOD_STYLES[r.method] || METHOD_STYLES.DEFAULT;
                  const isCovered = r.status === "COVERED" || r.status === "PASS";
                  const isFailed = r.status === "FAILED" || r.status === "FAIL";

                  return (
                    <tr key={idx} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                      <td className="py-1.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-tight ${methodClass}`}>
                          {r.method}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 font-semibold text-[var(--color-text)]">
                        {r.path}
                      </td>
                      <td className="py-1.5 px-3 text-[var(--color-text-secondary)] text-[11px]">
                        {r.handler || "-"}
                      </td>
                      <td className="py-1.5 px-3 text-[var(--color-text-muted)] text-[11px] truncate max-w-[200px]">
                        {r.sourceFile || "-"}
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        {isCovered ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                            ✓ PASS
                          </span>
                        ) : isFailed ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25">
                            ✗ FAIL
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                            UNCOVERED
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Execution History & Coverage Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print-break-inside-avoid">
        {/* Execution History */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
            <span>Lịch Sử Chạy Test (Executions)</span>
            <Activity size={14} className="text-[var(--color-text-muted)]" />
          </h3>
          {!history?.executions || history.executions.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-xs italic py-2">Không có lịch sử chạy test.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] text-[10px] uppercase font-bold">
                  <tr>
                    <th className="py-1.5 px-2">Thời gian</th>
                    <th className="py-1.5 px-2">Trạng thái</th>
                    <th className="py-1.5 px-2">Passed / Total</th>
                    <th className="py-1.5 px-2 text-right">Thời lượng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px]">
                  {history.executions.slice(-5).reverse().map((run) => (
                    <tr key={run.testRunId || run.id}>
                      <td className="py-1.5 px-2">{formatDate(run.timestamp || run.createdAt)}</td>
                      <td className="py-1.5 px-2">
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${run.status === "SUCCESS" || run.status === "PASSED" ? "text-[var(--color-success)] bg-emerald-500/10" : "text-[var(--color-danger)] bg-rose-500/10"}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="py-1.5 px-2">{run.passedTests}/{run.totalTests}</td>
                      <td className="py-1.5 px-2 text-right">{((run.durationMs || 0) / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Coverage Trend History */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3 flex items-center justify-between">
            <span>Xu Hướng Độ Bao Phủ API (Coverage Trend)</span>
            <BarChart2 size={14} className="text-[var(--color-text-muted)]" />
          </h3>
          {!history?.coverage || history.coverage.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-xs italic py-2">Không có lịch sử đo độ bao phủ.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] text-[10px] uppercase font-bold">
                  <tr>
                    <th className="py-1.5 px-2">Thời gian</th>
                    <th className="py-1.5 px-2">Snapshot</th>
                    <th className="py-1.5 px-2 text-right">API Coverage %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px]">
                  {history.coverage.slice(-5).reverse().map((cov, idx) => (
                    <tr key={idx}>
                      <td className="py-1.5 px-2">{formatDate(cov.timestamp)}</td>
                      <td className="py-1.5 px-2">{cov.snapshotId?.substring(0, 8)}</td>
                      <td className="py-1.5 px-2 text-right font-bold text-[var(--color-primary)]">
                        {cov.apiCoveragePct != null ? cov.apiCoveragePct : (cov.stmtsPct || 0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 4. Guidance Panel */}
      <div className="no-print">
        <IntegrationGuidancePanel projectId={projectId} />
      </div>
    </div>
  );
}
