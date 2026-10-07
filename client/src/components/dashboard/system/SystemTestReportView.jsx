import { useState } from "react";
import {
  Printer,
  Download,
  ArrowLeft,
  FileCode2,
  Activity,
  Layers,
} from "lucide-react";
import Button from "../../common/Button.jsx";

function formatMs(ms) {
  if (!ms || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function SystemTestReportView({
  summary,
  testFiles = [],
  projectName = "CovAI Project",
  snapshotId,
  onBack,
}) {
  const [exporting, setExporting] = useState(false);

  const total = summary?.totalTests || 0;
  const passed = summary?.passedTests || 0;
  const flaky = summary?.flakyTests || 0;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const cov = summary?.coverageSummary || null;

  // Print Report Handler
  const handlePrint = () => {
    window.print();
  };

  // Export JSON Report Handler
  const handleExportJson = () => {
    setExporting(true);
    try {
      const reportData = {
        projectName,
        snapshotId,
        generatedAt: new Date().toISOString(),
        summary,
        testFiles: testFiles.map((file) => ({
          filePath: file.filePath,
          total: file.scenarios?.length || 0,
          scenarios: file.scenarios || [],
        })),
      };

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(reportData, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute(
        "download",
        `system-test-report-${snapshotId || "summary"}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="system-test-report min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-sans p-4 sm:p-8">
      {/* Print styles injected cleanly */}
      <style>{`
        @media print {
          body {
            background: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
          .system-test-report {
            padding: 0 !important;
            max-width: 100% !important;
          }
          .report-card {
            border: 1px solid #d1d5db !important;
            page-break-inside: avoid;
            background: #ffffff !important;
            color: #000000 !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
      `}</style>

      {/* Top Action Bar (hidden when printing) */}
      <div className="no-print max-w-5xl mx-auto flex items-center justify-between pb-6 border-b border-[var(--color-border)] mb-6">
        <Button
          variant="secondary"
          size="sm"
          icon={ArrowLeft}
          onClick={onBack}
        >
          Back to Dashboard
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={handleExportJson}
            disabled={exporting}
          >
            Export JSON
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Printer}
            onClick={handlePrint}
          >
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* Report Document Content */}
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Document Header */}
        <div className="border-b border-[var(--color-border)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold tracking-wider uppercase text-[var(--color-primary)] font-mono">
                CovAI System Testing Platform
              </span>
              <span className="text-xs px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] font-mono border border-[var(--color-border)]">
                Official Report
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--color-text)]">
              End-to-End System Test & Coverage Report
            </h1>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">
              Project: <span className="font-semibold text-[var(--color-text)]">{projectName}</span> | Snapshot:{" "}
              <span className="font-mono">{snapshotId || "N/A"}</span>
            </p>
          </div>

          <div className="text-right text-xs text-[var(--color-text-muted)] font-mono">
            <div>Generated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</div>
            <div>Runner: <span className="font-semibold uppercase text-[var(--color-primary)]">{summary?.runner || "Playwright"}</span></div>
          </div>
        </div>

        {/* High-Level Metrics Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="report-card p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-muted)] font-medium mb-1">
              Pass Rate
            </div>
            <div className="text-2xl font-bold text-[var(--color-text)]">
              {passRate}%
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] font-mono mt-1">
              {passed} of {total} passed
            </div>
          </div>

          <div className="report-card p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-muted)] font-medium mb-1">
              Line Coverage
            </div>
            <div className="text-2xl font-bold text-[var(--color-primary)]">
              {cov?.lines !== undefined ? `${Math.round(cov.lines)}%` : "N/A"}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] font-mono mt-1">
              Statements: {cov?.statements !== undefined ? `${Math.round(cov.statements)}%` : "-"}
            </div>
          </div>

          <div className="report-card p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-muted)] font-medium mb-1">
              Stability Score
            </div>
            <div className="text-2xl font-bold text-[var(--color-text)]">
              {summary?.stabilityScorePct !== undefined
                ? `${summary.stabilityScorePct}%`
                : `${passRate}%`}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] font-mono mt-1">
              Flaky tests: {flaky}
            </div>
          </div>

          <div className="report-card p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-muted)] font-medium mb-1">
              Execution Duration
            </div>
            <div className="text-2xl font-bold text-[var(--color-text)] font-mono">
              {formatMs(summary?.durationMs)}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)] font-mono mt-1">
              {testFiles.length} spec files
            </div>
          </div>
        </div>

        {/* Coverage Breakdown Section */}
        {cov && (
          <div className="report-card p-5 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <Activity size={16} className="text-[var(--color-primary)]" />
              <span>Coverage Matrix Breakdown</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div className="p-3 bg-[var(--color-surface-secondary)]/50 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[11px]">Statements</span>
                <span className="text-lg font-bold text-[var(--color-text)]">
                  {cov.statements !== undefined ? `${cov.statements.toFixed(1)}%` : "N/A"}
                </span>
              </div>
              <div className="p-3 bg-[var(--color-surface-secondary)]/50 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[11px]">Branches</span>
                <span className="text-lg font-bold text-[var(--color-text)]">
                  {cov.branches !== undefined ? `${cov.branches.toFixed(1)}%` : "N/A"}
                </span>
              </div>
              <div className="p-3 bg-[var(--color-surface-secondary)]/50 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[11px]">Functions</span>
                <span className="text-lg font-bold text-[var(--color-text)]">
                  {cov.functions !== undefined ? `${cov.functions.toFixed(1)}%` : "N/A"}
                </span>
              </div>
              <div className="p-3 bg-[var(--color-surface-secondary)]/50 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[11px]">Lines</span>
                <span className="text-lg font-bold text-[var(--color-text)]">
                  {cov.lines !== undefined ? `${cov.lines.toFixed(1)}%` : "N/A"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Test Suites & Scenarios Section */}
        <div className="report-card p-5 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
            <Layers size={16} className="text-[var(--color-primary)]" />
            <span>Executed Scenarios by Test Spec</span>
          </h3>

          {testFiles.length === 0 ? (
            <div className="text-xs text-[var(--color-text-muted)] italic py-4 text-center">
              No test spec records in this report.
            </div>
          ) : (
            <div className="space-y-6">
              {testFiles.map((file) => {
                const scenarios = file.scenarios || [];
                return (
                  <div key={file.filePath} className="border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
                    <div className="px-4 py-2.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <FileCode2 size={14} className="text-[var(--color-primary)]" />
                        <span className="font-semibold text-[var(--color-text)]">{file.filePath}</span>
                      </div>
                      <span className="text-[var(--color-text-secondary)]">
                        {scenarios.length} scenarios
                      </span>
                    </div>

                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider bg-[var(--color-surface)]">
                          <th className="py-2 px-4 font-medium">Scenario Title</th>
                          <th className="py-2 px-4 font-medium w-24">Status</th>
                          <th className="py-2 px-4 font-medium w-24">Duration</th>
                          <th className="py-2 px-4 font-medium w-28 text-right">Coverage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {scenarios.map((sc) => {
                          const isPassed = String(sc.status).toUpperCase() === "PASSED";
                          const isFailed = String(sc.status).toUpperCase() === "FAILED";
                          return (
                            <tr key={sc.id || sc.title} className="hover:bg-[var(--color-surface-secondary)]/20">
                              <td className="py-2 px-4 text-[var(--color-text)]">
                                <div className="font-medium">{sc.title}</div>
                                {isFailed && sc.errorMessage && (
                                  <div className="text-[11px] text-[var(--color-danger)] font-mono mt-0.5 whitespace-pre-wrap">
                                    {sc.errorMessage}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-4">
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] ${
                                    isPassed
                                      ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
                                      : isFailed
                                      ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                                      : "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                                  }`}
                                >
                                  {sc.status || "UNKNOWN"}
                                </span>
                              </td>
                              <td className="py-2 px-4 text-[var(--color-text-secondary)] font-mono text-[11px]">
                                {formatMs(sc.executionTimeMs || sc.durationMs)}
                              </td>
                              <td className="py-2 px-4 text-right font-mono text-[11px] text-[var(--color-primary)]">
                                {sc.coverageContributionPct !== undefined
                                  ? `${Math.round(sc.coverageContributionPct)}%`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-6 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)] font-mono">
          Report generated automatically by CovAI System Testing Engine.
        </div>
      </div>
    </div>
  );
}

