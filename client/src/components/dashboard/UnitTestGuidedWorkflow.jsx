import React, { useState } from "react";
import {
  Play,
  FileCode2,
  Code2,
  Zap,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Terminal,
  RefreshCw,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Activity,
  Layers,
  FileCheck,
  Check,
  FileDiff,
  ChevronLeft,
  ChevronRight,
  Eye,
  Info,
  ExternalLink,
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
  activeJobId = null,
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
  executions = null,
  testTotals = null,
  hasExecuted = false,
  isLatestRunFailed = false,
  hasPartialFailures = false,
  onRefresh,
  isRefreshing = false,
  onOpenJobQueue,
  onOpenReviewModal = null,
  hasReviewableDiffs = false,
  activeTab = "guided",
  onChangeTab,
  isLight = false,
}) {
  // Determine current active workflow step index (1-based)
  const linesPct = Number(summary?.coverage?.lines || summary?.linesPct || 0);
  const branchesPct = Number(summary?.coverage?.branches || summary?.branchesPct || 0);
  const functionsPct = Number(summary?.coverage?.functions || summary?.funcsPct || 0);
  const statementsPct = Number(summary?.coverage?.statements || summary?.stmtsPct || 0);

  // Accurate baseline execution detection:
  // rawTotals?.lines?.total > 0 alone NEVER indicates that tests have run (total is merely AST line count).
  const hasCoveredItems = Boolean(
    linesPct > 0 ||
    statementsPct > 0 ||
    functionsPct > 0 ||
    branchesPct > 0 ||
    Number(rawTotals?.lines?.covered || 0) > 0 ||
    Number(rawTotals?.statements?.covered || 0) > 0
  );

  const hasBaselineRun = Boolean(
    summary && (
      hasCoveredItems ||
      hasExecuted ||
      Number(testTotals?.total || 0) > 0 ||
      isLatestRunFailed ||
      summary?.latestRunStatus ||
      summary?.hasRun
    )
  );

  const is100Percent = hasBaselineRun && !isLatestRunFailed &&
    linesPct >= 100 &&
    (branchesPct >= 100 || rawTotals?.branches?.total === 0) &&
    (functionsPct >= 100 || rawTotals?.functions?.total === 0) &&
    statementsPct >= 100;

  // Determine initial workflow stage:
  // If already 100% verified -> Stage 4
  // If pending suggestions exist -> Stage 3
  // If baseline has already run -> Stage 2 (Suggest Tests)
  // Otherwise -> Stage 1 (Baseline Measurement)
  const getInitialActiveStage = () => {
    if (is100Percent) return 4;
    if (pendingSuggestionsCount > 0) return 3;
    if (hasBaselineRun) return 2;
    return 1;
  };

  const [currentStage, setCurrentStage] = useState(getInitialActiveStage);
  const [selectedStage, setSelectedStage] = useState(null);
  const currentViewStep = selectedStage !== null ? selectedStage : currentStage;

  // Reset workflow view when switching snapshots
  React.useEffect(() => {
    setCurrentStage(getInitialActiveStage());
    setSelectedStage(null);
  }, [snapshotId]);

  // When analysis completes while user is on Stage 1, auto-advance to Stage 2
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

  // When AI finishes generating suggestions, auto-advance to Stage 3 for review & apply
  const prevPendingCountRef = React.useRef(pendingSuggestionsCount);
  React.useEffect(() => {
    if (prevPendingCountRef.current === 0 && pendingSuggestionsCount > 0) {
      setCurrentStage(3);
      setSelectedStage(null);
    }
    prevPendingCountRef.current = pendingSuggestionsCount;
  }, [pendingSuggestionsCount]);

  // When 100% is verified across all dimensions, update to Stage 4
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
      isDone: hasBaselineRun && !isLatestRunFailed,
      isActive: currentStage === 1,
      isViewing: currentViewStep === 1,
      badge: hasBaselineRun ? "✓ Completed" : "Action Required"
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
      badge: pendingSuggestionsCount > 0 ? `${pendingSuggestionsCount} tests ready` : (is100Percent ? "Fully Optimized" : "Ready to Suggest")
    },
    {
      num: 3,
      id: "apply",
      title: "3. Traceability & Apply",
      shortTitle: "Review & Apply",
      desc: "Review business logic mappings & safely merge into test suites",
      icon: Layers,
      isDone: hasBaselineRun && pendingSuggestionsCount === 0 && (linesPct > 0 || is100Percent),
      isActive: currentStage === 3,
      isViewing: currentViewStep === 3,
      badge: pendingSuggestionsCount > 0 ? `Review (${pendingSuggestionsCount})` : "Merged"
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
      badge: is100Percent ? "100% Verified" : "Continuous Loop"
    }
  ];

  return (
    <div
      style={{
        marginBottom: 20,
        background: isLight ? "#ffffff" : "var(--color-surface, #11161d)",
        border: isLight ? "1px solid #e2e8f0" : "1px solid var(--color-border, #29313d)",
        borderRadius: 12,
        padding: "16px 20px",
        boxShadow: isLight
          ? "0 2px 8px -2px rgba(15, 23, 42, 0.06), 0 1px 3px -1px rgba(15, 23, 42, 0.04)"
          : "0 4px 18px rgba(0, 0, 0, 0.25)",
      }}
    >
      {/* ── Top Bar: Workflow Stepper Header & Next Action Context ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          paddingBottom: 14,
          borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: isLight ? "#eef2ff" : "rgba(99, 102, 241, 0.15)",
              border: isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isLight ? "#4f46e5" : "#a5b4fc",
            }}
          >
            <ShieldCheck size={18} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: isLight ? "#0f172a" : "#f8fafc", display: "flex", alignItems: "center", gap: 8 }}>
              <span>Guided Unit Test Workflow</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 12,
                  background: is100Percent
                    ? (isLight ? "#ecfdf5" : "rgba(34, 197, 94, 0.15)")
                    : (isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.15)"),
                  color: is100Percent
                    ? (isLight ? "#059669" : "#4ade80")
                    : (isLight ? "#2563eb" : "#60a5fa"),
                  border: is100Percent
                    ? (isLight ? "1px solid #a7f3d0" : "1px solid rgba(34, 197, 94, 0.35)")
                    : (isLight ? "1px solid #bfdbfe" : "1px solid rgba(59, 130, 246, 0.35)"),
                  letterSpacing: "0.4px"
                }}
              >
                {is100Percent ? "✓ 100% VERIFIED" : `ACTIVE STAGE: ${currentStage} / 4`}
              </span>

              {selectedStage !== null && selectedStage !== currentStage && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 7px",
                    borderRadius: 12,
                    background: isLight ? "#fef3c7" : "rgba(245, 158, 11, 0.18)",
                    color: isLight ? "#b45309" : "#fbbf24",
                    border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.35)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Eye size={10} />
                  <span>INSPECTING STAGE {currentViewStep}</span>
                </span>
              )}
            </div>

            <div style={{ fontSize: 11.5, color: isLight ? "#64748b" : "#94a3b8", marginTop: 2 }}>
              {currentViewStep === 1 && "Stage 1: Execute initial baseline test run to record coverage metrics from Jest and Vitest."}
              {currentViewStep === 2 && "Stage 2: AI automatically identifies uncovered branches and generates complementary tests across 4 categories."}
              {currentViewStep === 3 && (pendingSuggestionsCount > 0 ? `Stage 3: ${pendingSuggestionsCount} generated unit tests ready across ${pendingFilesCount} files. Review business logic mappings and diffs.` : "Stage 3: Review applied test files, diffs, and AST syntax auto-healing details.")}
              {currentViewStep === 4 && (is100Percent ? "Stage 4: All 4 metrics (Statements, Branches, Functions, Lines) have reached 100% verified coverage!" : "Stage 4: Running background verification to confirm actual test coverage gains.")}
            </div>
          </div>
        </div>

        {/* Stage Navigation Quick Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => setSelectedStage(Math.max(1, currentViewStep - 1))}
            disabled={currentViewStep <= 1}
            style={{
              padding: "4px 8px",
              borderRadius: 5,
              background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
              color: isLight ? "#475569" : "#cbd5e1",
              fontSize: 11,
              fontWeight: 600,
              cursor: currentViewStep <= 1 ? "not-allowed" : "pointer",
              opacity: currentViewStep <= 1 ? 0.4 : 1,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
            title="Go to previous stage"
          >
            <ChevronLeft size={12} />
            <span>Prev Stage</span>
          </button>

          <button
            onClick={() => setSelectedStage(Math.min(4, currentViewStep + 1))}
            disabled={currentViewStep >= 4}
            style={{
              padding: "4px 8px",
              borderRadius: 5,
              background: isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.04)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
              color: isLight ? "#475569" : "#cbd5e1",
              fontSize: 11,
              fontWeight: 600,
              cursor: currentViewStep >= 4 ? "not-allowed" : "pointer",
              opacity: currentViewStep >= 4 ? 0.4 : 1,
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
            title="Go to next stage"
          >
            <span>Next Stage</span>
            <ChevronRight size={12} />
          </button>

          {selectedStage !== null && selectedStage !== currentStage && (
            <button
              onClick={() => setSelectedStage(null)}
              style={{
                padding: "4px 9px",
                borderRadius: 5,
                background: isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.2)",
                border: isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.4)",
                color: isLight ? "#4338ca" : "#c7d2fe",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Return view to current active workflow step"
            >
              <RotateCcw size={11} />
              <span>Jump to Stage {currentStage}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Middle: Interactive 4-Stage Stepper Track ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
          marginTop: 14,
          marginBottom: 16,
        }}
      >
        {steps.map((st) => {
          const StepIcon = st.icon;
          const isDone = st.isDone;
          const isActive = st.isActive;
          const isViewing = st.isViewing;

          return (
            <div
              key={st.num}
              onClick={() => setSelectedStage(st.num)}
              role="button"
              tabIndex={0}
              style={{
                borderRadius: 8,
                padding: "10px 14px",
                cursor: "pointer",
                background: isViewing
                  ? (isLight ? "#f5f3ff" : "rgba(99, 102, 241, 0.16)")
                  : isActive
                    ? (isLight ? "#f0f9ff" : "rgba(56, 189, 248, 0.08)")
                    : isDone
                      ? (isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.07)")
                      : (isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)"),
                border: isViewing
                  ? (isLight ? "2px solid #6366f1" : "2px solid #818cf8")
                  : isActive
                    ? (isLight ? "1.5px solid #38bdf8" : "1.5px solid rgba(56, 189, 248, 0.5)")
                    : isDone
                      ? (isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)")
                      : (isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)"),
                boxShadow: isViewing
                  ? (isLight ? "0 0 0 3px rgba(99, 102, 241, 0.15)" : "0 0 12px rgba(129, 140, 248, 0.25)")
                  : "none",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 8,
                transition: "all 0.18s ease",
                position: "relative",
              }}
              className="hover:scale-[1.01]"
              title={`Click to view Stage ${st.num} details`}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      fontSize: 11,
                      fontWeight: 750,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isViewing
                        ? "#6366f1"
                        : isActive
                          ? "#0284c7"
                          : isDone
                            ? "#16a34a"
                            : (isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.12)"),
                      color: "#ffffff",
                    }}
                  >
                    {isDone ? <Check size={12} strokeWidth={3} /> : st.num}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isViewing || isActive ? 750 : 650,
                      color: isViewing
                        ? (isLight ? "#4338ca" : "#c7d2fe")
                        : isActive
                          ? (isLight ? "#0369a1" : "#38bdf8")
                          : isDone
                            ? (isLight ? "#15803d" : "#86efac")
                            : (isLight ? "#475569" : "#94a3b8"),
                    }}
                  >
                    {st.shortTitle}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {isViewing && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.3)",
                        color: isLight ? "#4338ca" : "#c7d2fe",
                      }}
                    >
                      Viewing
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: isActive
                        ? (isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.25)")
                        : isDone
                          ? (isLight ? "#dcfce7" : "rgba(34, 197, 94, 0.2)")
                          : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.06)"),
                      color: isActive
                        ? (isLight ? "#4338ca" : "#a5b4fc")
                        : isDone
                          ? (isLight ? "#166534" : "#4ade80")
                          : (isLight ? "#64748b" : "#64748b"),
                    }}
                  >
                    {st.badge}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e", lineHeight: 1.4 }}>
                {st.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Bottom Bar: Unified Smart Call-to-Action Bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "12px 16px",
          borderRadius: 8,
          background: isLight
            ? (currentStage === 3 ? "#f0fdf4" : "#f8fafc")
            : (currentStage === 3 ? "rgba(34, 197, 94, 0.08)" : "rgba(255, 255, 255, 0.03)"),
          border: isLight
            ? (currentStage === 3 ? "1px solid #bbf7d0" : "1px solid #e2e8f0")
            : (currentStage === 3 ? "1px solid rgba(34, 197, 94, 0.25)" : "1px solid rgba(255, 255, 255, 0.06)"),
        }}
      >
        {/* Context Status Message */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {running ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={16} className={`animate-spin ${isLight ? "text-indigo-600" : "text-indigo-400"}`} />
              <span style={{ fontSize: 12.5, fontWeight: 650, color: isLight ? "#4338ca" : "#c7d2fe" }}>
                {runningStatus || runStep || `Running test analysis (${Math.round(runProgress || 0)}%)...`}
              </span>
            </div>
          ) : isBulkApplying ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={16} className="animate-spin text-green-500" />
              <span style={{ fontSize: 12.5, fontWeight: 650, color: isLight ? "#15803d" : "#86efac" }}>
                {bulkApplyStep || "Merging test suites with AST syntax auto-healing & TDZ sanitization..."}
              </span>
            </div>
          ) : isBulkSuggesting ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={16} className="animate-spin text-indigo-500" />
              <span style={{ fontSize: 12.5, fontWeight: 650, color: isLight ? "#4f46e5" : "#c7d2fe" }}>
                Scanning AST branch gaps and generating hermetic test suites...
              </span>
            </div>
          ) : currentViewStep === 3 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={16} style={{ color: "#16a34a" }} />
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: isLight ? "#15803d" : "#4ade80" }}>
                  {pendingSuggestionsCount > 0
                    ? `${pendingSuggestionsCount} generated unit tests ready`
                    : "All generated unit tests merged"}
                </span>
                <span style={{ fontSize: 11.5, color: isLight ? "#166534" : "#86efac", marginLeft: 6 }}>
                  {pendingSuggestionsCount > 0
                    ? `across ${pendingFilesCount} files. Click Apply All to safely merge into project:`
                    : "into project test suites. Review merged diffs or run verification below:"}
                </span>
              </div>
            </div>
          ) : is100Percent ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={17} style={{ color: "#16a34a" }} />
              <span style={{ fontSize: 12.5, fontWeight: 650, color: isLight ? "#15803d" : "#4ade80" }}>
                Source code has reached 100% coverage across all 4 metrics. Verified hermetic test suite!
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={15} style={{ color: isLight ? "#4f46e5" : "#a5b4fc" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: isLight ? "#334155" : "#cbd5e1" }}>
                {hasBaselineRun
                  ? `Current coverage: Lines ${linesPct}%, Branches ${branchesPct}%. Click Suggest to cover missing branches.`
                  : "No test execution recorded yet. Click Run Baseline Analysis to start the workflow."}
              </span>
            </div>
          )}
        </div>

        {/* Unified Primary CTA Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {currentViewStep === 3 ? (
            /* Action Group for Stage 3: Review Diff + Apply All + Re-run */
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {onRun && (
                <button
                  onClick={() => onRun({ restart: !!running })}
                  style={{
                    background: running ? (isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.2)") : (isLight ? "#f1f5f9" : "var(--color-surface-secondary)"),
                    border: running ? "1px solid #818cf8" : (isLight ? "1px solid #cbd5e1" : "1px solid var(--color-border)"),
                    color: isLight ? "#1e293b" : "#f1f5f9",
                    borderRadius: 7,
                    padding: "9px 14px",
                    fontSize: 12.5,
                    fontWeight: 650,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                  title={running ? "Analysis is running. Click to restart execution." : "Re-run test runner"}
                >
                  {running ? <RotateCcw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                  <span>{running ? "Re-run Tests" : "Re-run Tests"}</span>
                </button>
              )}

              {onOpenReviewModal && (
                <button
                  onClick={onOpenReviewModal}
                  disabled={isBulkApplying}
                  style={{
                    background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
                    border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.16)",
                    color: isLight ? "#1e293b" : "#f1f5f9",
                    borderRadius: 7,
                    padding: "9px 16px",
                    fontSize: 13,
                    fontWeight: 650,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                  className="hover:opacity-90"
                  title="Inspect side-by-side test file changes and assertions in Monaco Diff Editor"
                >
                  <FileDiff size={14} style={{ color: isLight ? "#4f46e5" : "#818cf8" }} />
                  <span>
                    {pendingSuggestionsCount > 0
                      ? `Review Diffs (${pendingSuggestionsCount})`
                      : "Review Merged Diffs"}
                  </span>
                </button>
              )}

              {pendingSuggestionsCount > 0 && onApplyAll && (
                <button
                  onClick={onApplyAll}
                  disabled={isBulkApplying}
                  style={{
                    background: "#16a34a",
                    border: "1px solid #15803d",
                    color: "#ffffff",
                    borderRadius: 7,
                    padding: "9px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: isBulkApplying ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    boxShadow: isLight
                      ? "0 2px 6px rgba(22, 163, 74, 0.25)"
                      : "0 2px 10px rgba(22, 163, 74, 0.35)",
                    transition: "all 0.15s ease",
                  }}
                  className="hover:opacity-90"
                  title="Safely merge all generated unit tests into their corresponding test files"
                >
                  {isBulkApplying ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{bulkApplyStep || "Applying all..."}</span>
                    </>
                  ) : (
                    <>
                      <Zap size={14} />
                      <span>3. Apply All Generated Tests ({pendingSuggestionsCount})</span>
                    </>
                  )}
                </button>
              )}

              {pendingSuggestionsCount === 0 && !is100Percent && (onOpenSuggestModal || onBulkSuggest) && (
                <button
                  onClick={() => {
                    if (onOpenSuggestModal) {
                      onOpenSuggestModal({ isBulk: true });
                    } else if (onBulkSuggest) {
                      onBulkSuggest();
                    }
                  }}
                  disabled={isBulkSuggesting}
                  style={{
                    background: isLight ? "#4f46e5" : "#6d5dfb",
                    border: isLight ? "1px solid #4338ca" : "1px solid #5b4be7",
                    color: "#ffffff",
                    borderRadius: 7,
                    padding: "9px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: isBulkSuggesting ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    boxShadow: isLight
                      ? "0 2px 6px rgba(79, 70, 229, 0.25)"
                      : "0 2px 10px rgba(109, 93, 251, 0.35)",
                    transition: "all 0.15s ease",
                  }}
                  className="hover:opacity-90"
                  title="Identify uncovered code and generate unit tests for remaining gaps"
                >
                  {isBulkSuggesting ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />}
                  <span>{isBulkSuggesting ? "Analyzing & suggesting..." : "Suggest Next Missing Tests"}</span>
                </button>
              )}
            </div>
          ) : currentViewStep === 2 && onBulkSuggest ? (
            /* Action Group for Stage 2: Suggest Missing Tests + Re-run */
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {onRun && (
                <button
                  onClick={() => onRun({ restart: !!running })}
                  style={{
                    background: running ? (isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.2)") : (isLight ? "#f1f5f9" : "var(--color-surface-secondary)"),
                    border: running ? "1px solid #818cf8" : (isLight ? "1px solid #cbd5e1" : "1px solid var(--color-border)"),
                    color: isLight ? "#1e293b" : "#f1f5f9",
                    borderRadius: 7,
                    padding: "9px 14px",
                    fontSize: 12.5,
                    fontWeight: 650,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                  title={running ? "Analysis is running. Click to restart execution." : "Re-run test runner"}
                >
                  {running ? <RotateCcw size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                  <span>{running ? "Re-run Tests" : "Re-run Tests"}</span>
                </button>
              )}

              <button
                onClick={() => {
                  if (onOpenSuggestModal) {
                    onOpenSuggestModal({ isBulk: true });
                  } else if (onBulkSuggest) {
                    onBulkSuggest();
                  }
                }}
                disabled={isBulkSuggesting}
                style={{
                  background: isLight ? "#4f46e5" : "#6d5dfb",
                  border: isLight ? "1px solid #4338ca" : "1px solid #5b4be7",
                  color: "#ffffff",
                  borderRadius: 7,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isBulkSuggesting ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  boxShadow: isLight
                    ? "0 2px 6px rgba(79, 70, 229, 0.25)"
                    : "0 2px 10px rgba(109, 93, 251, 0.35)",
                  transition: "all 0.15s ease",
                  opacity: isBulkSuggesting ? 0.7 : 1,
                }}
                className="hover:opacity-90"
                title="Identify uncovered code and generate unit tests"
              >
                {isBulkSuggesting ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />}
                <span>{isBulkSuggesting ? "Analyzing & suggesting..." : "2. Suggest Missing Tests"}</span>
              </button>
            </div>
          ) : currentViewStep === 4 ? (
            /* Action for Stage 4: Continuous Verification */
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {onOpenReviewModal && (
                <button
                  onClick={onOpenReviewModal}
                  style={{
                    background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
                    border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.16)",
                    color: isLight ? "#1e293b" : "#f1f5f9",
                    borderRadius: 7,
                    padding: "9px 14px",
                    fontSize: 12.5,
                    fontWeight: 650,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                  className="hover:opacity-90"
                  title="Inspect merged test file diffs in Monaco Diff Editor"
                >
                  <FileDiff size={14} style={{ color: isLight ? "#4f46e5" : "#818cf8" }} />
                  <span>Review Merged Diffs</span>
                </button>
              )}
              {onBulkSuggest && !is100Percent && (
                <button
                  onClick={onBulkSuggest}
                  disabled={isBulkSuggesting}
                  style={{
                    background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
                    border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.16)",
                    color: isLight ? "#4f46e5" : "#a5b4fc",
                    borderRadius: 7,
                    padding: "9px 16px",
                    fontSize: 12.5,
                    fontWeight: 650,
                    cursor: isBulkSuggesting ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                  title="Suggest more tests to cover remaining branch gaps"
                >
                  {isBulkSuggesting ? <Loader2 size={13} className="animate-spin" /> : <FileCode2 size={13} />}
                  <span>Suggest Next Missing Tests</span>
                </button>
              )}
              <button
                onClick={() => onRun && onRun({ restart: !!running })}
                style={{
                  background: is100Percent ? "#16a34a" : (isLight ? "#4f46e5" : "#6d5dfb"),
                  border: is100Percent ? "1px solid #15803d" : (isLight ? "1px solid #4338ca" : "1px solid #5b4be7"),
                  color: "#ffffff",
                  borderRadius: 7,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  boxShadow: is100Percent
                    ? "0 2px 10px rgba(22, 163, 74, 0.35)"
                    : (isLight ? "0 2px 6px rgba(79, 70, 229, 0.25)" : "0 2px 10px rgba(109, 93, 251, 0.35)"),
                  transition: "all 0.15s ease",
                }}
                className="hover:opacity-90"
                title="Re-run tests to continuously verify coverage"
              >
                {running ? (
                  <RotateCcw size={14} className="animate-spin" />
                ) : is100Percent ? (
                  <ShieldCheck size={14} />
                ) : (
                  <RefreshCw size={14} />
                )}
                <span>
                  {running
                    ? `Verifying Tests (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)`
                    : is100Percent
                      ? "Re-run Verification (100% Guaranteed)"
                      : "4. Run Continuous Verification"}
                </span>
              </button>
            </div>
          ) : (
            /* Primary CTA for Stage 1: Run Baseline Analysis */
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => onRun && onRun({ restart: !!running })}
                style={{
                  background: running
                    ? (isLight ? "#4f46e5" : "#6d5dfb")
                    : (isLight ? "#4f46e5" : "#6d5dfb"),
                  border: isLight ? "1px solid #4338ca" : "1px solid #5b4be7",
                  color: "#ffffff",
                  borderRadius: 7,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  boxShadow: running
                    ? "0 0 10px rgba(99, 102, 241, 0.4), 0 2px 6px rgba(79, 70, 229, 0.25)"
                    : (isLight ? "0 2px 6px rgba(79, 70, 229, 0.25)" : "0 2px 10px rgba(109, 93, 251, 0.35)"),
                  transition: "all 0.15s ease",
                }}
                className="hover:opacity-90"
                title={running ? "Analysis is running. Click to restart test execution." : "Run Jest and Vitest to measure source code coverage"}
              >
                {running ? (
                  <RotateCcw size={14} className="animate-spin" />
                ) : hasBaselineRun ? (
                  <RefreshCw size={14} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                <span>
                  {running
                    ? `Running Analysis (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)`
                    : hasBaselineRun
                      ? "1. Re-run Baseline Analysis"
                      : "1. Run Baseline Analysis"}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
