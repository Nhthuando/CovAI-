import React, { useState } from "react";
import {
  Play,
  FileCode2,
  Zap,
  RotateCcw,
  CheckCircle2,
  RefreshCw,
  Loader2,
  ShieldCheck,
  Activity,
  Layers,
  Check,
  FileDiff,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";

/**
 * UnitTestGuidedWorkflow
 *
 * Re-architects the Unit Test process into a clean, intuitive 4-stage sequential workflow:
 * Stage 1: Baseline Measurement (Measure initial coverage from Jest & Vitest)
 * Stage 2: AI Gap Suggestion (Identify AST gaps & generate 4-category test matrix)
 * Stage 3: Traceability & Safe Apply (Review mappings & safely merge into test files)
 * Stage 4: Continuous Verification (Re-measure until 100% invariant is achieved)
 *
 * Invariant: Users can click and navigate back to ANY stage at any time to inspect
 * baseline metrics, AI suggestions, diffs, and verification guarantees.
 */
export default function UnitTestGuidedWorkflow({
  snapshotId = null,
  running = false,
  runProgress = 0,
  runningStatus = "",
  runStep = "",
  onRun,
  onBulkSuggest,
  onOpenSuggestModal = null,
  isBulkSuggesting = false,
  pendingSuggestionsCount = 0,
  pendingFilesCount = 0,
  onApplyAll,
  isBulkApplying = false,
  bulkApplyStep = "",
  summary = null,
  rawTotals = null,
  testTotals = null,
  hasExecuted = false,
  isLatestRunFailed = false,
  onOpenReviewModal = null,
  isLight = false,
}) {
  const linesPct = Number(summary?.coverage?.lines || summary?.linesPct || 0);
  const branchesPct = Number(summary?.coverage?.branches || summary?.branchesPct || 0);
  const functionsPct = Number(summary?.coverage?.functions || summary?.funcsPct || 0);
  const statementsPct = Number(summary?.coverage?.statements || summary?.stmtsPct || 0);

  const hasCoveredItems = Boolean(
    linesPct > 0 ||
    statementsPct > 0 ||
    functionsPct > 0 ||
    branchesPct > 0 ||
    Number(rawTotals?.lines?.covered || 0) > 0 ||
    Number(rawTotals?.statements?.covered || 0) > 0
  );

  const isStatusCompleted =
    summary?.latestRunStatus &&
    !["RUNNING", "PENDING", "running", "pending"].includes(summary.latestRunStatus);
  const hasBaselineRun = Boolean(
    summary && (
      hasCoveredItems ||
      (hasExecuted && !running) ||
      (Number(testTotals?.total || 0) > 0 && !running) ||
      isLatestRunFailed ||
      isStatusCompleted ||
      summary?.hasRun
    )
  );

  const is100Percent =
    hasBaselineRun &&
    !isLatestRunFailed &&
    linesPct >= 100 &&
    (branchesPct >= 100 || rawTotals?.branches?.total === 0) &&
    (functionsPct >= 100 || rawTotals?.functions?.total === 0) &&
    statementsPct >= 100;

  const getInitialActiveStage = () => {
    if (is100Percent) return 4;
    if (pendingSuggestionsCount > 0) return 3;
    if (hasBaselineRun) return 2;
    return 1;
  };

  const [currentStage, setCurrentStage] = useState(getInitialActiveStage);
  const [selectedStage, setSelectedStage] = useState(null);
  const currentViewStep = selectedStage !== null ? selectedStage : currentStage;

  React.useEffect(() => {
    setCurrentStage(getInitialActiveStage());
    setSelectedStage(null);
  }, [snapshotId]);

  const prevRunningRef = React.useRef(running);
  React.useEffect(() => {
    if (prevRunningRef.current && !running && !isLatestRunFailed) {
      if (is100Percent) {
        setCurrentStage(4);
        setSelectedStage(null);
      } else if (currentStage === 1) {
        setCurrentStage(2);
        setSelectedStage(null);
      } else if (currentStage === 3 && pendingSuggestionsCount === 0) {
        setCurrentStage(4);
        setSelectedStage(null);
      }
    }
    prevRunningRef.current = running;
  }, [running, isLatestRunFailed, currentStage, pendingSuggestionsCount, is100Percent]);

  const prevPendingCountRef = React.useRef(pendingSuggestionsCount);
  React.useEffect(() => {
    if (prevPendingCountRef.current === 0 && pendingSuggestionsCount > 0) {
      setCurrentStage(3);
      setSelectedStage(null);
    }
    prevPendingCountRef.current = pendingSuggestionsCount;
  }, [pendingSuggestionsCount]);

  React.useEffect(() => {
    if (is100Percent) {
      setCurrentStage(4);
    }
  }, [is100Percent]);

  const steps = [
    {
      num: 1,
      id: "baseline",
      title: "1. Baseline Measurement",
      shortTitle: "Baseline",
      desc: "Execute Jest & Vitest to measure initial code coverage metrics",
      icon: Activity,
      isDone: hasBaselineRun && !isLatestRunFailed && !running,
      isActive: currentStage === 1,
      isViewing: currentViewStep === 1,
      badge: running
        ? "In progress"
        : hasBaselineRun && !isLatestRunFailed
          ? "Completed"
          : isLatestRunFailed
            ? "Failed"
            : "Action required",
    },
    {
      num: 2,
      id: "suggest",
      title: "2. Suggest Unit Tests",
      shortTitle: "Suggest Tests",
      desc: "Analyze AST coverage gaps and generate targeted unit tests",
      icon: FileCode2,
      isDone: pendingSuggestionsCount > 0 || is100Percent,
      isActive: currentStage === 2,
      isViewing: currentViewStep === 2,
      badge:
        pendingSuggestionsCount > 0
          ? `${pendingSuggestionsCount} ready`
          : is100Percent
            ? "Optimized"
            : "Ready",
    },
    {
      num: 3,
      id: "apply",
      title: "3. Traceability & Apply",
      shortTitle: "Review & Apply",
      desc: "Review business logic mappings & safely merge into test suites",
      icon: Layers,
      isDone:
        hasBaselineRun &&
        pendingSuggestionsCount === 0 &&
        (linesPct > 0 || is100Percent),
      isActive: currentStage === 3,
      isViewing: currentViewStep === 3,
      badge:
        pendingSuggestionsCount > 0
          ? `Review (${pendingSuggestionsCount})`
          : "Merged",
    },
    {
      num: 4,
      id: "verify",
      title: "4. Continuous Verification",
      shortTitle: "100% Verified",
      desc: "Re-run test suites to verify coverage gains until 100% threshold",
      icon: ShieldCheck,
      isDone: is100Percent,
      isActive: currentStage === 4,
      isViewing: currentViewStep === 4,
      badge: is100Percent ? "100% verified" : "Verification",
    },
  ];

  return (
    <section
      data-light={isLight ? "true" : "false"}
      className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3.5"
    >
      {/* Top Bar: Workflow Header & Stage Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center shrink-0 mt-0.5 text-[var(--color-text-secondary)]">
            <ShieldCheck size={14} />
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-semibold text-[var(--color-text)] m-0">
                Unit Test Workflow
              </h2>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono tabular-nums bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    is100Percent ? "bg-emerald-500/65" : "bg-[var(--color-primary)]/75"
                  }`}
                />
                {is100Percent ? "100% verified" : `Stage ${currentStage} of 4`}
              </span>

              {selectedStage !== null && selectedStage !== currentStage && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--color-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                  <Eye size={10} />
                  <span>Inspecting stage {currentViewStep}</span>
                </span>
              )}
            </div>

            <p className="text-[11px] text-[var(--color-text-muted)] m-0 leading-relaxed">
              {currentViewStep === 1 &&
                "Stage 1: Execute initial baseline test run to record coverage metrics from Jest and Vitest."}
              {currentViewStep === 2 &&
                "Stage 2: Identify uncovered branches and generate complementary tests across 4 categories."}
              {currentViewStep === 3 &&
                (pendingSuggestionsCount > 0
                  ? `Stage 3: ${pendingSuggestionsCount} generated unit tests ready across ${pendingFilesCount} files. Review diffs and apply.`
                  : "Stage 3: Review applied test files, diffs, and syntax validation details.")}
              {currentViewStep === 4 &&
                (is100Percent
                  ? "Stage 4: All 4 metrics (Statements, Branches, Functions, Lines) have reached 100% verified coverage."
                  : "Stage 4: Re-run verification to confirm actual test coverage gains.")}
            </p>
          </div>
        </div>

        {/* Stage Navigation Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSelectedStage(Math.max(1, currentViewStep - 1))}
            disabled={currentViewStep <= 1}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Go to previous stage"
          >
            <ChevronLeft size={12} />
            <span>Prev</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStage(Math.min(4, currentViewStep + 1))}
            disabled={currentViewStep >= 4}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Go to next stage"
          >
            <span>Next</span>
            <ChevronRight size={12} />
          </button>

          {selectedStage !== null && selectedStage !== currentStage && (
            <button
              type="button"
              onClick={() => setSelectedStage(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text)] text-[11px] font-medium transition-colors cursor-pointer"
              title="Return view to current active workflow step"
            >
              <RotateCcw size={11} />
              <span>Stage {currentStage}</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive 4-Stage Stepper */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {steps.map((st) => {
          const isDone = st.isDone;
          const isActive = st.isActive;
          const isViewing = st.isViewing;

          return (
            <div
              key={st.num}
              onClick={() => setSelectedStage(st.num)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedStage(st.num);
                }
              }}
              title={`Click to view Stage ${st.num} details`}
              className={`rounded-md p-3 cursor-pointer transition-colors duration-150 flex flex-col justify-between gap-2 border ${
                isViewing
                  ? "bg-[var(--color-surface-secondary)] border-[var(--color-primary)]/50"
                  : isActive
                    ? "bg-[var(--color-bg)] border-[var(--color-border-strong)]"
                    : "bg-[var(--color-bg)]/60 border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-5 h-5 rounded-md text-[11px] font-mono font-semibold flex items-center justify-center shrink-0 border ${
                      isViewing
                        ? "bg-[var(--color-primary)]/90 text-[var(--color-primary-foreground)] border-transparent"
                        : isDone
                          ? "bg-[var(--color-surface-secondary)] text-emerald-500/80 border-[var(--color-border)]"
                          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                    }`}
                  >
                    {isDone ? <Check size={11} strokeWidth={2.5} /> : st.num}
                  </span>
                  <span
                    className={`text-xs font-semibold truncate ${
                      isViewing || isActive
                        ? "text-[var(--color-text)]"
                        : "text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {st.shortTitle}
                  </span>
                </div>

                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)] shrink-0">
                  {st.badge}
                </span>
              </div>

              <div className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                {st.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Unified Action Bar */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 text-xs">
          {running ? (
            <>
              <Loader2 size={14} className="animate-spin text-[var(--color-primary)] shrink-0" />
              <span className="font-medium text-[var(--color-text)]">
                {runningStatus || runStep || `Running test analysis (${Math.round(runProgress || 0)}%)...`}
              </span>
            </>
          ) : isBulkApplying ? (
            <>
              <Loader2 size={14} className="animate-spin text-[var(--color-primary)] shrink-0" />
              <span className="font-medium text-[var(--color-text)]">
                {bulkApplyStep || "Merging test suites with AST syntax auto-healing..."}
              </span>
            </>
          ) : isBulkSuggesting ? (
            <>
              <Loader2 size={14} className="animate-spin text-[var(--color-primary)] shrink-0" />
              <span className="font-medium text-[var(--color-text)]">
                Scanning AST branch gaps and generating test suites...
              </span>
            </>
          ) : currentViewStep === 3 ? (
            <>
              <CheckCircle2 size={14} className="text-emerald-500/75 shrink-0" />
              <span className="text-[var(--color-text-secondary)]">
                <strong className="font-medium text-[var(--color-text)]">
                  {pendingSuggestionsCount > 0
                    ? `${pendingSuggestionsCount} generated unit tests ready`
                    : "All generated unit tests merged"}
                </strong>{" "}
                {pendingSuggestionsCount > 0
                  ? `across ${pendingFilesCount} files. Review diffs or apply to project.`
                  : "into project test suites."}
              </span>
            </>
          ) : is100Percent ? (
            <>
              <CheckCircle2 size={14} className="text-emerald-500/75 shrink-0" />
              <span className="text-[var(--color-text-secondary)]">
                Source code has reached 100% coverage across all 4 metrics.
              </span>
            </>
          ) : (
            <>
              <Activity size={14} className="text-[var(--color-text-muted)] shrink-0" />
              <span className="text-[var(--color-text-secondary)]">
                {hasBaselineRun
                  ? `Current coverage: Lines ${linesPct}%, Branches ${branchesPct}%. Suggest tests to cover missing branches.`
                  : "No test execution recorded yet. Run baseline analysis to start."}
              </span>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {currentViewStep === 3 ? (
            <>
              {onOpenReviewModal && (
                <button
                  type="button"
                  onClick={onOpenReviewModal}
                  disabled={isBulkApplying}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  title="Inspect side-by-side test file changes and assertions in Monaco Diff Editor"
                >
                  <FileDiff size={13} className="text-[var(--color-text-muted)]" />
                  <span>
                    {pendingSuggestionsCount > 0
                      ? `Review Diffs (${pendingSuggestionsCount})`
                      : "Review Merged Diffs"}
                  </span>
                </button>
              )}

              {pendingSuggestionsCount > 0 && onApplyAll && (
                <button
                  type="button"
                  onClick={onApplyAll}
                  disabled={isBulkApplying}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  title="Safely merge all generated unit tests into their corresponding test files"
                >
                  {isBulkApplying ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Applying...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={13} />
                      <span>3. Apply All Generated Tests ({pendingSuggestionsCount})</span>
                    </>
                  )}
                </button>
              )}

              {pendingSuggestionsCount === 0 &&
                !is100Percent &&
                (onOpenSuggestModal || onBulkSuggest) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenSuggestModal) {
                        onOpenSuggestModal({ isBulk: true });
                      } else if (onBulkSuggest) {
                        onBulkSuggest();
                      }
                    }}
                    disabled={isBulkSuggesting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                    title="Identify uncovered code and generate unit tests for remaining gaps"
                  >
                    {isBulkSuggesting ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <FileCode2 size={13} />
                    )}
                    <span>
                      {isBulkSuggesting ? "Analyzing & suggesting..." : "Suggest Next Missing Tests"}
                    </span>
                  </button>
                )}
            </>
          ) : currentViewStep === 2 && onBulkSuggest ? (
            <button
              type="button"
              onClick={() => {
                if (onOpenSuggestModal) {
                  onOpenSuggestModal({ isBulk: true });
                } else if (onBulkSuggest) {
                  onBulkSuggest();
                }
              }}
              disabled={isBulkSuggesting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
              title="Identify uncovered code and generate unit tests"
            >
              {isBulkSuggesting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FileCode2 size={13} />
              )}
              <span>{isBulkSuggesting ? "Analyzing & suggesting..." : "2. Suggest Missing Tests"}</span>
            </button>
          ) : currentViewStep === 4 ? (
            <>
              {onOpenReviewModal && (
                <button
                  type="button"
                  onClick={onOpenReviewModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer"
                  title="Inspect merged test file diffs in Monaco Diff Editor"
                >
                  <FileDiff size={13} className="text-[var(--color-text-muted)]" />
                  <span>Review Merged Diffs</span>
                </button>
              )}
              {onBulkSuggest && !is100Percent && (
                <button
                  type="button"
                  onClick={onBulkSuggest}
                  disabled={isBulkSuggesting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  title="Suggest more tests to cover remaining branch gaps"
                >
                  {isBulkSuggesting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <FileCode2 size={13} />
                  )}
                  <span>Suggest Next Missing Tests</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onRun && onRun({ restart: true })}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
                title="Re-run tests to continuously verify coverage"
              >
                {running ? (
                  <RotateCcw size={13} className="animate-spin" />
                ) : is100Percent ? (
                  <ShieldCheck size={13} />
                ) : (
                  <RefreshCw size={13} />
                )}
                <span>
                  {running
                    ? `Verifying Tests (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)`
                    : is100Percent
                      ? "Re-run Verification (100%)"
                      : "4. Run Continuous Verification"}
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onRun && onRun({ restart: Boolean(hasBaselineRun || running) })}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              title={
                running
                  ? "Analysis is running. Click to restart test execution."
                  : "Run Jest and Vitest to measure source code coverage"
              }
            >
              {running ? (
                <RotateCcw size={13} className="animate-spin" />
              ) : hasBaselineRun ? (
                <RefreshCw size={13} />
              ) : (
                <Play size={13} fill="currentColor" />
              )}
              <span>
                {running
                  ? `Running Analysis (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)`
                  : hasBaselineRun
                    ? "1. Re-run Baseline Analysis"
                    : "1. Run Baseline Analysis"}
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
