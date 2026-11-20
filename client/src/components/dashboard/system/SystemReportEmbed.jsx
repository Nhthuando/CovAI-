import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Download,
  Printer,
  Wand2,
  Play,
  Loader2,
  Camera,
  AlertTriangle,
} from "lucide-react";
import { downloadSystemAssessmentPdf } from "../../../services/systemTest.service.js";
import SystemTestDimensionsTable from "./SystemTestDimensionsTable.jsx";
import SystemTestReportCharts from "./SystemTestReportCharts.jsx";
import { summarizeSystemFailure } from "./systemCaseCoverage.js";

function computeGrade(score) {
  if (score >= 90) return { grade: "A", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" };
  if (score >= 80) return { grade: "B", color: "text-sky-400 border-sky-500/30 bg-sky-500/10" };
  if (score >= 65) return { grade: "C", color: "text-amber-400 border-amber-500/30 bg-amber-500/10" };
  if (score >= 45) return { grade: "D", color: "text-orange-400 border-orange-500/30 bg-orange-500/10" };
  return { grade: "F", color: "text-rose-400 border-rose-500/30 bg-rose-500/10" };
}

function isFailingStatus(status = "") {
  return ["FAIL", "FAILED", "ERROR", "TIMEDOUT", "INTERRUPTED", "FLAKY"].includes(
    String(status || "").toUpperCase(),
  );
}

export default function SystemReportEmbed({
  snapshotId,
  assessment = null,
  specGroups = [],
  summary = null,
  hasRun = false,
  canUseAi = true,
  canRunTests = true,
  fixingTarget = null,
  isRunning = false,
  onRunCoverage,
  onOpenFullReport,
  onAIFixScenario,
  onInspectScenario,
  onRunScenario,
}) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const stats = useMemo(() => {
    const scenarios = specGroups.flatMap((g) => g.scenarios || []);
    const total = Number(summary?.totalTests ?? scenarios.length ?? 0);
    const passed = Number(
      summary?.passedTests ??
        scenarios.filter((s) => ["PASS", "PASSED"].includes(String(s.status || "").toUpperCase())).length,
    );
    const failed = Number(
      summary?.failedTests ??
        scenarios.filter((s) => ["FAIL", "FAILED", "ERROR", "TIMEDOUT"].includes(String(s.status || "").toUpperCase())).length,
    );
    const flaky = Number(
      summary?.flakyTests ??
        scenarios.filter((s) => String(s.status || "").toUpperCase() === "FLAKY").length,
    );
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    const totalRequiredCases = specGroups.reduce(
      (acc, g) => acc + Number(g.caseCov?.totalRequired ?? 0),
      0,
    );
    const coveredCases = specGroups.reduce(
      (acc, g) => acc + Number(g.caseCov?.coveredCount ?? 0),
      0,
    );
    const caseRate = totalRequiredCases > 0 ? Math.round((coveredCases / totalRequiredCases) * 100) : 0;

    return {
      total,
      passed,
      failed,
      flaky,
      passRate,
      totalRequiredCases,
      coveredCases,
      caseRate,
      durationMs: Number(summary?.durationMs ?? 0),
    };
  }, [specGroups, summary]);

  const qualityScore = useMemo(() => {
    if (!hasRun && stats.total === 0) return 0;
    return Math.round(stats.passRate * 0.7 + stats.caseRate * 0.3);
  }, [hasRun, stats]);

  const gradeMeta = computeGrade(qualityScore);

  const failingScenarios = useMemo(() => {
    const items = [];
    for (const group of specGroups) {
      for (const sc of group.scenarios || []) {
        if (isFailingStatus(sc.status)) {
          items.push({ group, sc });
        }
      }
    }
    return items;
  }, [specGroups]);

  const handleDownloadPdf = async () => {
    if (!assessment?.id || !snapshotId) return;
    setDownloadingPdf(true);
    setPdfError("");
    try {
      await downloadSystemAssessmentPdf(snapshotId, assessment.id);
    } catch (err) {
      setPdfError(err.response?.data?.message || err.message || "Could not export PDF report.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Executive Score Header Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`w-14 h-14 rounded-lg border flex flex-col items-center justify-center font-mono tabular-nums ${gradeMeta.color}`}
          >
            <span className="text-xl font-bold leading-none">{gradeMeta.grade}</span>
            <span className="text-[10px] opacity-80 mt-0.5">{qualityScore}%</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              System Test Executive Report
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 font-mono tabular-nums">
              {hasRun
                ? `${stats.passed}/${stats.total} scenarios passed · ${stats.coveredCases}/${stats.totalRequiredCases} E2E cases verified`
                : "Execute system specs to compile E2E verification, browser telemetry & trace evidence."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {assessment?.id && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text)] cursor-pointer transition-colors disabled:opacity-50"
            >
              {downloadingPdf ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              <span>Download PDF</span>
            </button>
          )}

          {assessment && onOpenFullReport && (
            <button
              type="button"
              onClick={onOpenFullReport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text)] cursor-pointer transition-colors"
            >
              <Printer size={13} />
              <span>Printable Report</span>
            </button>
          )}

          {canRunTests && onRunCoverage && (
            <button
              type="button"
              onClick={onRunCoverage}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
            >
              {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
              <span>Run Full Suite</span>
            </button>
          )}
        </div>
      </div>

      {pdfError && (
        <div className="px-4 py-2.5 rounded-md border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
          {pdfError}
        </div>
      )}

      {/* Telemetry Pillars */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">Pass Rate</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {stats.passRate}%
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
            {stats.passed} passed · {stats.failed} failed · {stats.flaky} flaky
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">E2E Flow Cases</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {stats.caseRate}%
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
            {stats.coveredCases}/{stats.totalRequiredCases} cases across {specGroups.length} specs
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">Spec Files</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {specGroups.length}
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
            {stats.total} total scenarios
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="text-[11px] font-medium text-[var(--color-text-secondary)]">Total Duration</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[var(--color-text)]">
            {(stats.durationMs / 1000).toFixed(1)}s
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums">
            Full-stack E2E runtime
          </div>
        </div>
      </div>

      {/* Assessment Dimensions (Measured Frontend / Backend Tiers & Independent Runs) */}
      {assessment && (
        <div className="space-y-4">
          <SystemTestDimensionsTable assessment={assessment} />
          {assessment.presentation && <SystemTestReportCharts report={assessment.presentation} />}
        </div>
      )}

      {/* Failing / Flaky Scenarios & Root Causes */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {failingScenarios.length > 0 ? (
              <XCircle size={14} className="text-rose-400" />
            ) : (
              <CheckCircle2 size={14} className="text-emerald-400" />
            )}
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              Failing &amp; Flaky Scenarios ({failingScenarios.length})
            </h3>
          </div>
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
            Direct Playwright / Cypress root-cause triage
          </span>
        </div>

        {failingScenarios.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--color-text-muted)]">
            {hasRun
              ? "All executed E2E system scenarios passed cleanly."
              : "No failures recorded yet. Run your specs to inspect root causes."}
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {failingScenarios.map(({ group, sc }, idx) => {
              const selKey = `${sc.testFile || group.filePath}::${sc.title || sc.id}`;
              const isFixing = fixingTarget === selKey || fixingTarget === sc.id;
              const isFlaky = String(sc.status || "").toUpperCase() === "FLAKY";
              const summaryText =
                sc.failureSummary || summarizeSystemFailure(sc.failureMessages || "");
              const rawLog = Array.isArray(sc.failureMessages)
                ? sc.failureMessages.join("\n\n")
                : String(sc.failureMessages || "");
              const hasEvidence =
                sc.evidence?.hasScreenshot ||
                sc.evidence?.hasDomSnapshot ||
                Boolean(sc.failureBreakpoint);

              return (
                <div key={`${selKey}-${idx}`} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                            isFlaky
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/25"
                          }`}
                        >
                          {isFlaky ? <AlertTriangle size={10} /> : <XCircle size={10} />}
                          <span>{isFlaky ? "FLAKY" : "FAILED"}</span>
                        </span>
                        <span className="text-xs font-semibold text-[var(--color-text)]">
                          {sc.title}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)]">
                        {sc.testFile || group.filePath}
                        {sc.failureBreakpoint?.url ? ` · ${sc.failureBreakpoint.url}` : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {canUseAi && onAIFixScenario && (
                        <button
                          type="button"
                          onClick={() => onAIFixScenario(sc, group)}
                          disabled={isFixing}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-[11px] font-semibold cursor-pointer transition-colors disabled:opacity-50"
                        >
                          {isFixing ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Wand2 size={11} />
                          )}
                          <span>AI Fix</span>
                        </button>
                      )}

                      {hasEvidence && onInspectScenario && (
                        <button
                          type="button"
                          onClick={() => onInspectScenario(sc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
                        >
                          <Camera size={11} />
                          <span>Evidence</span>
                        </button>
                      )}

                      {canRunTests && onRunScenario && (
                        <button
                          type="button"
                          onClick={() => onRunScenario(sc, group)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[11px] text-[var(--color-text)] cursor-pointer transition-colors"
                        >
                          <Play size={10} fill="currentColor" />
                          <span>Rerun</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {summaryText && (
                    <p className="text-xs text-rose-300 leading-snug">{summaryText}</p>
                  )}

                  {rawLog && (
                    <details className="text-[11px] text-[var(--color-text-muted)]">
                      <summary className="cursor-pointer hover:text-[var(--color-text-secondary)] select-none">
                        Technical details
                      </summary>
                      <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-[var(--color-bg)] p-2.5 font-mono text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words border border-[var(--color-border)]">
                        {rawLog}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
