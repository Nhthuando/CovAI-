import { useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  Download,
  Wand2,
  Play,
  Loader2,
  GitBranch,
  FileCode,
  AlertTriangle,
} from "lucide-react";
import {
  diagnoseUnitFailure,
  isUnitTestFailed,
  summarizeUnitFailure,
} from "./unitTestCaseCoverage.js";

function computeGrade(score) {
  if (score >= 90) return { grade: "A", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" };
  if (score >= 80) return { grade: "B", color: "text-sky-400 border-sky-500/30 bg-sky-500/10" };
  if (score >= 65) return { grade: "C", color: "text-amber-400 border-amber-500/30 bg-amber-500/10" };
  if (score >= 45) return { grade: "D", color: "text-orange-400 border-orange-500/30 bg-orange-500/10" };
  return { grade: "F", color: "text-rose-400 border-rose-500/30 bg-rose-500/10" };
}

export default function UnitReportEmbed({
  coverageSummary,
  rawTotals,
  fileEntries = [],
  executedScenarios = [],
  testStats = { total: 0, passed: 0, failed: 0, durationMs: 0 },
  hasExecuted = false,
  isPeakReport = false,
  peakMeta = null,
  onRunCoverage,
  onOpenExportModal,
  onAIFixTestCase,
  onRunTestCase,
  onOpenFileAnalysis,
  onNavigateTab,
  fixingTestId = null,
  isRunning = false,
}) {
  const linesPct = Number(coverageSummary?.lines ?? 0);
  const branchesPct = Number(coverageSummary?.branches ?? 0);
  const funcsPct = Number(coverageSummary?.functions ?? 0);
  const stmtsPct = Number(coverageSummary?.statements ?? 0);

  const weightedScore = useMemo(() => {
    if (!hasExecuted && testStats.total === 0) return 0;
    const covPart = linesPct * 0.4 + branchesPct * 0.3 + funcsPct * 0.2 + stmtsPct * 0.1;
    const passRate = testStats.total > 0 ? (testStats.passed / testStats.total) * 100 : 100;
    return Math.round(covPart * 0.7 + passRate * 0.3);
  }, [hasExecuted, linesPct, branchesPct, funcsPct, stmtsPct, testStats]);

  const gradeMeta = computeGrade(weightedScore);

  const failingTests = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const entry of fileEntries) {
      for (const tc of entry.testCases || []) {
        if (isUnitTestFailed(tc)) {
          const key = `${tc.testFile || ""}::${tc.title || tc.testName || tc.id}`;
          seen.add(key);
          list.push({ ...tc, sourceFile: entry.filePath, entry });
        }
      }
    }
    for (const sc of executedScenarios || []) {
      if (isUnitTestFailed(sc)) {
        const key = `${sc.testFile || ""}::${sc.title || sc.testName || sc.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({ ...sc, sourceFile: sc.testFile || "", entry: null });
        }
      }
    }
    return list;
  }, [fileEntries, executedScenarios]);

  const sortedLowCoverageFiles = useMemo(() => {
    return [...(fileEntries || [])].sort(
      (a, b) => Number(a.linesPct ?? 0) - Number(b.linesPct ?? 0),
    );
  }, [fileEntries]);

  const pillars = [
    {
      label: "Lines",
      pct: linesPct,
      covered: rawTotals?.lines?.covered ?? 0,
      total: rawTotals?.lines?.total ?? 0,
    },
    {
      label: "Branches",
      pct: branchesPct,
      covered: rawTotals?.branches?.covered ?? 0,
      total: rawTotals?.branches?.total ?? 0,
    },
    {
      label: "Functions",
      pct: funcsPct,
      covered: rawTotals?.functions?.covered ?? 0,
      total: rawTotals?.functions?.total ?? 0,
    },
    {
      label: "Statements",
      pct: stmtsPct,
      covered: rawTotals?.statements?.covered ?? 0,
      total: rawTotals?.statements?.total ?? 0,
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Top Executive Score + 4 Coverage Pillars ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
                Unit Quality Score
              </span>
              {isPeakReport && (
                <span
                  className="px-1.5 py-0.5 rounded-md text-[10px] font-mono tabular-nums bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
                  title="Preserves the highest unit coverage snapshot achieved after analysis runs."
                >
                  Peak snapshot · {Number(peakMeta?.linesPct ?? linesPct).toFixed(1)}% lines
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-3xl font-bold text-[var(--color-text)]">{weightedScore}</span>
              <span className="text-xs text-[var(--color-text-muted)]">/ 100</span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] m-0">
              Weighted: 70% Code Cov (L/B/F/S) · 30% Pass Rate
            </p>
            {onOpenExportModal && (
              <button
                type="button"
                onClick={onOpenExportModal}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[11px] font-medium text-[var(--color-text)] cursor-pointer"
              >
                <Download size={12} />
                <span>Export Report</span>
              </button>
            )}
          </div>

          <div
            className={`w-14 h-14 rounded-lg border flex items-center justify-center font-mono text-2xl font-bold shrink-0 ${gradeMeta.color}`}
          >
            {hasExecuted || testStats.total > 0 ? gradeMeta.grade : "—"}
          </div>
        </div>

        <div className="lg:col-span-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {pillars.map((p) => (
            <div key={p.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary)] font-medium">{p.label}</span>
                <span className="font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                  {p.covered}/{p.total}
                </span>
              </div>
              <div className="font-mono tabular-nums text-xl font-bold text-[var(--color-text)]">
                {p.pct.toFixed(1)}%
              </div>
              <div className="h-1.5 rounded-sm bg-[var(--color-surface-secondary)] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    p.pct >= 80
                      ? "bg-emerald-500"
                      : p.pct >= 50
                        ? "bg-amber-500"
                        : "bg-rose-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, p.pct))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Failing Unit Tests & Clean Root Causes ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {failingTests.length > 0 ? (
              <XCircle size={15} className="text-rose-400" />
            ) : (
              <CheckCircle2 size={15} className="text-emerald-400" />
            )}
            <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
              Failing Unit Tests & Root Causes ({failingTests.length})
            </h3>
          </div>
          {!hasExecuted && onRunCoverage && (
            <button
              type="button"
              onClick={onRunCoverage}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold cursor-pointer"
            >
              <Play size={11} fill="currentColor" />
              <span>Run Coverage</span>
            </button>
          )}
        </div>

        {failingTests.length === 0 ? (
          <div className="p-4 text-xs text-[var(--color-text-muted)]">
            {hasExecuted
              ? "All executed unit tests are passing cleanly."
              : "No test execution recorded yet. Click Run Coverage to evaluate existing unit tests."}
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]/70">
            {failingTests.map((tc, idx) => {
              const diag = diagnoseUnitFailure(tc);
              const summary = diag?.summary || tc.failureSummary || summarizeUnitFailure(tc.failureMessages);
              const rawErr = Array.isArray(tc.failureMessages)
                ? tc.failureMessages.join("\n").trim()
                : "";
              return (
                <div key={tc.id || idx} className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text)]">
                          {tc.title || tc.testName}
                        </span>
                        {diag?.label && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-[10px] font-mono text-rose-300">
                            {diag.label}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[var(--color-text-muted)]">
                        <span className="truncate">{tc.testFile || tc.sourceFile}</span>
                        {diag?.locationHint && (
                          <span className="text-[10px] text-[var(--color-text-secondary)]">
                            @ {diag.locationHint}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {onAIFixTestCase && (
                        <button
                          type="button"
                          onClick={() => onAIFixTestCase(tc, tc.entry)}
                          disabled={fixingTestId === tc.id || isRunning}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium cursor-pointer disabled:opacity-50"
                        >
                          {fixingTestId === tc.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Wand2 size={12} />
                          )}
                          <span>AI Fix</span>
                        </button>
                      )}
                      {onRunTestCase && (
                        <button
                          type="button"
                          onClick={() => onRunTestCase(tc, tc.entry)}
                          disabled={isRunning}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs text-[var(--color-text)] cursor-pointer disabled:opacity-50"
                        >
                          <Play size={11} fill="currentColor" />
                          <span>Rerun</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs space-y-1">
                    <div className="flex items-start gap-2 text-rose-300">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5 text-rose-400" />
                      <span className="font-medium leading-snug">
                        {diag?.explanation || summary}
                      </span>
                    </div>
                    {diag?.suggestedFix && (
                      <div className="pl-5 text-[11px] text-[var(--color-text-secondary)]">
                        <span className="text-[var(--color-text-muted)] font-mono mr-1">Fix hint:</span>
                        {diag.suggestedFix}
                      </div>
                    )}
                  </div>

                  {rawErr && (
                    <details className="text-[11px] text-[var(--color-text-muted)]">
                      <summary className="cursor-pointer hover:text-[var(--color-text-secondary)]">
                        Technical details
                      </summary>
                      <pre className="mt-1.5 p-2.5 rounded bg-[#0B0F14] border border-[var(--color-border)] overflow-x-auto font-mono text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words max-h-48">
                        {rawErr}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Source File Coverage Breakdown Matrix ── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[var(--color-text)] m-0">
            Source File Coverage Breakdown ({sortedLowCoverageFiles.length} files)
          </h3>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab("files")}
              className="text-xs text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Inspect in Files & Tests Matrix →
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]/50 text-[11px] text-[var(--color-text-muted)]">
                <th className="py-2 px-4">File</th>
                <th className="py-2 px-3 text-right">Statements</th>
                <th className="py-2 px-3 text-right">Branches</th>
                <th className="py-2 px-3 text-right">Functions</th>
                <th className="py-2 px-3 text-right">Lines</th>
                <th className="py-2 px-4 text-right">Analysis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/60 font-mono tabular-nums">
              {sortedLowCoverageFiles.slice(0, 30).map((f) => (
                <tr key={f.filePath} className="hover:bg-[var(--color-surface-secondary)]/35">
                  <td className="py-2 px-4 text-[var(--color-text)] truncate max-w-[340px]">
                    <span className="inline-flex items-center gap-1.5">
                      <FileCode size={12} className="text-[var(--color-text-muted)] shrink-0" />
                      {f.filePath}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">{Number(f.stmtsPct ?? 0).toFixed(1)}%</td>
                  <td className="py-2 px-3 text-right">{Number(f.branchesPct ?? 0).toFixed(1)}%</td>
                  <td className="py-2 px-3 text-right">{Number(f.funcsPct ?? 0).toFixed(1)}%</td>
                  <td className="py-2 px-3 text-right font-semibold">{Number(f.linesPct ?? 0).toFixed(1)}%</td>
                  <td className="py-2 px-4 text-right">
                    {onOpenFileAnalysis && (
                      <button
                        type="button"
                        onClick={() => onOpenFileAnalysis(f)}
                        className="inline-flex items-center gap-1 text-[11px] font-sans text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] cursor-pointer"
                      >
                        <GitBranch size={11} />
                        <span>CFG</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
