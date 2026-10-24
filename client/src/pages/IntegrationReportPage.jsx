import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchIntegrationReport } from "../services/report.service";
import {
  ArrowLeft,
  Database,
  BarChart2,
  AlertCircle,
  FileText,
  Activity,
  Printer,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Code2,
  FileCode,
} from "lucide-react";
import IntegrationGuidancePanel from "../components/dashboard/integration/IntegrationGuidancePanel";
import MetricProvenancePopover from "../components/dashboard/integration/MetricProvenancePopover";

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

const FAILURE_LAYER_STYLES = {
  ROUTER_NOT_FOUND: {
    label: "Router",
    code: "[ROUTER_NOT_FOUND]",
    color: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  },
  MIDDLEWARE_REJECTED: {
    label: "Middleware",
    code: "[MIDDLEWARE_REJECTED]",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  CONTROLLER_CRASH: {
    label: "Controller",
    code: "[CONTROLLER_CRASH]",
    color: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
  DATABASE_FAILURE: {
    label: "Database",
    code: "[DATABASE_FAILURE]",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  ASSERTION_FAILED: {
    label: "Assertion",
    code: "[ASSERTION_FAILED]",
    color: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  },
};

const METHOD_STYLES = {
  GET: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  PATCH: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  DELETE: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

export default function IntegrationReportPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchIntegrationReport(projectId);
      setReport(res.data);
    } catch (err) {
      setError(err.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportJson = () => {
    if (!report) return;
    const jsonStr = JSON.stringify(
      {
        projectId,
        exportedAt: new Date().toISOString(),
        overview: report.overview,
        latestExecution: report.latestExecution,
        apiCoverage: report.apiCoverage,
        projectCodeCoverage: report.projectCodeCoverage,
        routeMatrix: report.routeMatrix || [],
        failureLogs: report.failureLogs || [],
        history: report.history,
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] flex items-center justify-center">
        <div className="animate-spin text-[var(--color-primary)]">
          <Activity size={32} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] p-8">
        <div className="max-w-4xl mx-auto bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-8 text-center">
          <AlertCircle size={48} className="mx-auto text-[var(--color-danger)] mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Report</h2>
          <p className="text-[var(--color-text-secondary)] mb-6">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] rounded font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const routeMatrix = report.routeMatrix || [];
  const failureLogs = report.failureLogs || [];

  return (
    <div className="min-h-screen bg-[var(--color-surface)] text-[var(--color-text)] p-6 sm:p-8 overflow-y-auto font-sans print:bg-white print:text-black print:p-0">
      {/* Print-specific style overrides */}
      <style>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .print-break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .print-shadow-none {
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header & Export Controls */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--color-border)] print:border-b-2 print:border-black">
          <div>
            <div className="no-print">
              <button
                type="button"
                onClick={() => navigate(`/main-editor?projectId=${projectId}&tab=integration-tests`)}
                className="flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] mb-2 text-xs font-semibold transition-colors cursor-pointer"
              >
                <ArrowLeft size={14} className="mr-1" /> Quay lại Integration Workbench
              </button>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)] print:text-black flex items-center gap-2.5">
              <FileText className="text-[var(--color-primary)] print:text-black" size={24} />
              <span>Báo Cáo Kiểm Thử Tích Hợp API (Integration Test Report)</span>
            </h1>
            <p className="text-xs text-[var(--color-text-secondary)] print:text-gray-600 mt-1 font-mono">
              Project #{projectId?.substring(0, 8) || "active"} • Snapshot: #{report.overview?.snapshotId?.substring(0, 8) || "latest"} • Xuất ngày: {new Date().toLocaleString()}
            </p>
          </div>

          <div className="flex items-center gap-2.5 no-print">
            <button
              type="button"
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer shadow-xs"
              title="Xuất dữ liệu báo cáo dạng JSON"
            >
              <Download size={13} />
              <span>Xuất JSON Summary</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
              title="In báo cáo hoặc lưu ra file PDF"
            >
              <Printer size={13} />
              <span>In báo cáo / Xuất PDF</span>
            </button>
          </div>
        </header>

        {/* 1. Overview Metric KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 print-break-inside-avoid">
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs print:border-gray-300">
            <MetricProvenancePopover provenance={report.overview?.provenance?.scenarioCount}>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                Total Scenarios
              </p>
            </MetricProvenancePopover>
            <p className="text-2xl font-bold font-mono text-[var(--color-text)] print:text-black">
              {report.overview ? report.overview.totalScenarios : 0}
            </p>
            <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
              AI: {report.overview?.unmodifiedAiScenarios || 0} • Modified: {report.overview?.modifiedScenarios || 0}
            </div>
          </div>

          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs print:border-gray-300">
            <MetricProvenancePopover provenance={report.apiCoverage?.provenance}>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                API Coverage
              </p>
            </MetricProvenancePopover>
            <p className="text-2xl font-bold font-mono text-[var(--color-primary)] print:text-black">
              {report.apiCoverage ? `${report.apiCoverage.coveragePercentage.toFixed(1)}%` : "0%"}
            </p>
            <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
              {report.apiCoverage?.testedApis || 0} / {report.apiCoverage?.discoveredApis || 0} Endpoints
            </div>
          </div>

          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs print:border-gray-300">
            <MetricProvenancePopover provenance={report.latestExecution?.provenance}>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                Pass Rate
              </p>
            </MetricProvenancePopover>
            <p className="text-2xl font-bold font-mono text-[var(--color-success)] print:text-black">
              {report.latestExecution && report.latestExecution.totalTests > 0
                ? `${((report.latestExecution.passedTests / report.latestExecution.totalTests) * 100).toFixed(1)}%`
                : "N/A"}
            </p>
            <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono">
              Pass: {report.latestExecution?.passedTests || 0} • Fail: {report.latestExecution?.failedTests || 0}
            </div>
          </div>

          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs print:border-gray-300">
            <MetricProvenancePopover provenance={report.projectCodeCoverage?.provenance}>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                Uncovered Endpoints
              </p>
            </MetricProvenancePopover>
            <p className="text-2xl font-bold font-mono text-amber-400 print:text-black">
              {report.uncoveredEndpointsCount ?? (routeMatrix.filter(r => !r.tested).length)}
            </p>
            <div className="text-[10px] text-[var(--color-text-secondary)] mt-1 font-mono truncate">
              / {routeMatrix.length} routes discovered
            </div>
          </div>
        </div>

        {/* 2. Route Coverage Matrix Table */}
        <section className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden shadow-xs print-break-inside-avoid print:border-gray-300">
          <div className="px-4 py-3 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-[var(--color-primary)] print:text-black" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] print:text-black m-0">
                Ma Trận Độ Bao Phủ Endpoint (Route Coverage Matrix)
              </h2>
            </div>
            <span className="text-xs font-mono text-[var(--color-text-secondary)]">
              {routeMatrix.length} routes discovered
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 text-[10px] uppercase font-bold text-[var(--color-text-muted)] print:bg-gray-100">
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Route Endpoint</th>
                  <th className="py-2.5 px-3">Handler</th>
                  <th className="py-2.5 px-3">Source File</th>
                  <th className="py-2.5 px-3 text-center">Trạng Thái Test</th>
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
                    const isCovered = r.status === "COVERED";
                    const isFailed = r.status === "FAILED";

                    return (
                      <tr key={idx} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-tight ${methodClass}`}>
                            {r.method}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-semibold text-[var(--color-text)] print:text-black">
                          {r.path}
                        </td>
                        <td className="py-2 px-3 text-[var(--color-text-secondary)]">
                          {r.handler}
                        </td>
                        <td className="py-2 px-3 text-[var(--color-text-muted)] text-[11px]">
                          {r.sourceFile}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isCovered ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                              ✓ PASS
                            </span>
                          ) : isFailed ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25">
                              ✗ FAIL
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
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

        {/* 3. Failure Logs & Diagnostics Section */}
        {failureLogs.length > 0 && (
          <section className="bg-[var(--color-surface-raised)] border border-rose-500/30 rounded-[var(--radius-md)] overflow-hidden shadow-xs print-break-inside-avoid print:border-gray-300">
            <div className="px-4 py-3 bg-rose-500/10 border-b border-rose-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-[var(--color-danger)] print:text-black" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)] print:text-black m-0">
                  Chi Tiết Kịch Bản Thất Bại & Điểm Lỗi Từng Tầng ({failureLogs.length} failures)
                </h2>
              </div>
            </div>

            <div className="divide-y divide-[var(--color-border)]/60">
              {failureLogs.map((log) => {
                const layer = FAILURE_LAYER_STYLES[log.failureLayer] || FAILURE_LAYER_STYLES.ASSERTION_FAILED;

                return (
                  <div key={log.id} className="p-4 flex flex-col gap-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${layer.color}`}>
                          {layer.code}
                        </span>
                        <span className="font-semibold text-[var(--color-text)] print:text-black">
                          {log.title}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                        Target: {log.targetEndpoint}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                      <div className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <span className="text-[10px] font-semibold text-[var(--color-text-secondary)]">Expected Status:</span>
                        <div className="font-mono font-bold text-xs text-[var(--color-success)] mt-0.5">
                          HTTP {log.expectedStatus || 200}
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <span className="text-[10px] font-semibold text-[var(--color-text-secondary)]">Actual Status Received:</span>
                        <div className="font-mono font-bold text-xs text-[var(--color-danger)] mt-0.5">
                          HTTP {log.responseStatus || "500 / CRASH"}
                        </div>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] font-mono text-[11px] text-rose-400 print:text-red-700 whitespace-pre-wrap">
                      {log.errorMessage}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. Execution & Coverage History Tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print-break-inside-avoid">
          {/* Execution History */}
          <section className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3">
              Lịch Sử Chạy Test (Execution History)
            </h3>
            {report.history?.executions?.length === 0 ? (
              <p className="text-[var(--color-text-muted)] text-xs italic py-2">Không có lịch sử chạy test.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] text-[10px] uppercase font-bold">
                    <tr>
                      <th className="py-2 px-2">Thời gian</th>
                      <th className="py-2 px-2">Trạng thái</th>
                      <th className="py-2 px-2">Passed / Total</th>
                      <th className="py-2 px-2 text-right">Thời lượng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px]">
                    {(report.history?.executions || []).slice(-5).reverse().map((run) => (
                      <tr key={run.testRunId}>
                        <td className="py-2 px-2">{formatDate(run.timestamp)}</td>
                        <td className="py-2 px-2">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${run.status === "SUCCESS" || run.status === "PASSED" ? "text-[var(--color-success)] bg-emerald-500/10" : "text-[var(--color-danger)] bg-rose-500/10"}`}>
                            {run.status}
                          </span>
                        </td>
                        <td className="py-2 px-2">{run.passedTests}/{run.totalTests}</td>
                        <td className="py-2 px-2 text-right">{(run.durationMs / 1000).toFixed(1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Coverage History */}
          <section className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0 pb-2 border-b border-[var(--color-border)] mb-3">
              Xu Hướng Độ Bao Phủ Code (Coverage Trend)
            </h3>
            {report.history?.coverage?.length === 0 ? (
              <p className="text-[var(--color-text-muted)] text-xs italic py-2">Không có lịch sử đo độ bao phủ.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] text-[10px] uppercase font-bold">
                    <tr>
                      <th className="py-2 px-2">Thời gian</th>
                      <th className="py-2 px-2">Snapshot</th>
                      <th className="py-2 px-2 text-right">Statements %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)] font-mono text-[11px]">
                    {(report.history?.coverage || []).slice(-5).reverse().map((cov, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-2">{formatDate(cov.timestamp)}</td>
                        <td className="py-2 px-2">{cov.snapshotId?.substring(0, 8)}</td>
                        <td className="py-2 px-2 text-right font-bold text-[var(--color-success)]">
                          {cov.stmtsPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="no-print">
          <IntegrationGuidancePanel projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
