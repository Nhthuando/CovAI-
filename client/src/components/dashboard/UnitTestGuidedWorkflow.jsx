import React from "react";
import {
  Play,
  Sparkles,
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
} from "lucide-react";

/**
 * UnitTestGuidedWorkflow
 * 
 * Re-architects the Unit Test process into a clean, intuitive 4-stage sequential workflow:
 * Stage 1: Baseline Measurement (Measure initial coverage from Jest & Vitest)
 * Stage 2: AI Gap Suggestion (Identify AST gaps & generate 4-category test matrix)
 * Stage 3: Traceability & Safe Apply (Review mappings & safely merge into test files)
 * Stage 4: Continuous Verification (Re-measure until 100% invariant is achieved)
 */
export default function UnitTestGuidedWorkflow({
  running = false,
  runProgress = 0,
  runningStatus = "",
  runStep = "",
  activeJobId = null,
  onRun,
  onBulkSuggest,
  isBulkSuggesting = false,
  pendingSuggestionsCount = 0,
  pendingFilesCount = 0,
  onApplyAll,
  isBulkApplying = false,
  bulkApplyStep = "",
  summary = null,
  rawTotals = null,
  isLatestRunFailed = false,
  hasPartialFailures = false,
  onRefresh,
  isRefreshing = false,
  onOpenJobQueue,
  onOpenReviewModal = null,
  activeTab = "guided",
  onChangeTab,
  isLight = false,
}) {
  // Determine current active step index (1-based)
  // Step 1: Baseline (no run yet or currently running initial run)
  // Step 2: Suggest (run done, coverage exists, but < 100% and no pending suggestions)
  // Step 3: Apply (has pending suggestions ready)
  // Step 4: Verify (all suggestions applied, or 100% reached across all 4 metrics)
  const linesPct = Number(summary?.coverage?.lines || summary?.linesPct || 0);
  const branchesPct = Number(summary?.coverage?.branches || summary?.branchesPct || 0);
  const functionsPct = Number(summary?.coverage?.functions || summary?.funcsPct || 0);
  const statementsPct = Number(summary?.coverage?.statements || summary?.stmtsPct || 0);
  const hasRun = Boolean(summary && (rawTotals?.lines?.total > 0 || linesPct > 0 || isLatestRunFailed));

  const is100Percent = hasRun && !isLatestRunFailed &&
    linesPct >= 100 &&
    (branchesPct >= 100 || rawTotals?.branches?.total === 0) &&
    (functionsPct >= 100 || rawTotals?.functions?.total === 0) &&
    statementsPct >= 100;

  let activeStep = 1;
  if (!hasRun) {
    activeStep = 1;
  } else if (pendingSuggestionsCount > 0) {
    activeStep = 3;
  } else if (!is100Percent) {
    activeStep = 2;
  } else {
    activeStep = 4;
  }

  const steps = [
    {
      num: 1,
      id: "baseline",
      title: "1. Baseline Measurement",
      shortTitle: "Baseline",
      desc: "Execute Jest & Vitest to measure initial code coverage metrics",
      icon: Activity,
      isDone: hasRun && !isLatestRunFailed,
      isActive: activeStep === 1,
      badge: hasRun ? "✓ Completed" : "Action Required"
    },
    {
      num: 2,
      id: "suggest",
      title: "2. AI Gap Suggestion",
      shortTitle: "AI Suggestion",
      desc: "Detect AST coverage gaps & generate 4-category test matrix",
      icon: Sparkles,
      isDone: pendingSuggestionsCount > 0 || is100Percent,
      isActive: activeStep === 2,
      badge: pendingSuggestionsCount > 0 ? `${pendingSuggestionsCount} tests ready` : (is100Percent ? "Fully Optimized" : "Ready to Suggest")
    },
    {
      num: 3,
      id: "apply",
      title: "3. Traceability & Apply",
      shortTitle: "Review & Apply",
      desc: "Review business logic mappings & safely merge into test suites",
      icon: Layers,
      isDone: hasRun && pendingSuggestionsCount === 0 && (linesPct > 0 || is100Percent),
      isActive: activeStep === 3,
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
      isActive: activeStep === 4,
      badge: is100Percent ? "🏆 100% Verified" : "Continuous Loop"
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
                {is100Percent ? "✓ 100% VERIFIED" : `STEP ${activeStep} / 4`}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: isLight ? "#64748b" : "#94a3b8", marginTop: 2 }}>
              {activeStep === 1 && "Step 1: Execute initial baseline test run to record coverage metrics from Jest and Vitest."}
              {activeStep === 2 && "Step 2: AI automatically identifies uncovered branches and generates complementary tests across 4 categories."}
              {activeStep === 3 && `Step 3: ${pendingSuggestionsCount} generated unit tests ready. Review business logic mappings and click Apply.`}
              {activeStep === 4 && (is100Percent ? "All 4 metrics (Statements, Branches, Functions, Lines) have reached 100% verified coverage!" : "Step 4: Running background verification to confirm actual test coverage gains.")}
            </div>
          </div>
        </div>

      </div>

      {/* ── Middle: Visual 4-Stage Stepper Track ── */}
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

          return (
            <div
              key={st.num}
              style={{
                borderRadius: 8,
                padding: "10px 14px",
                background: isActive
                  ? (isLight ? "#f5f3ff" : "rgba(99, 102, 241, 0.12)")
                  : isDone
                    ? (isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.07)")
                    : (isLight ? "#f8fafc" : "rgba(255, 255, 255, 0.02)"),
                border: isActive
                  ? (isLight ? "1.5px solid #a5b4fc" : "1.5px solid rgba(139, 124, 253, 0.5)")
                  : isDone
                    ? (isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)")
                    : (isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.06)"),
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 8,
                transition: "all 0.2s ease",
                position: "relative",
              }}
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
                      background: isActive
                        ? "#6366f1"
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
                      fontWeight: isActive ? 750 : 650,
                      color: isActive
                        ? (isLight ? "#4338ca" : "#c7d2fe")
                        : isDone
                          ? (isLight ? "#15803d" : "#86efac")
                          : (isLight ? "#475569" : "#94a3b8"),
                    }}
                  >
                    {st.shortTitle}
                  </span>
                </div>

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
            ? (activeStep === 3 ? "#f0fdf4" : "#f8fafc")
            : (activeStep === 3 ? "rgba(34, 197, 94, 0.08)" : "rgba(255, 255, 255, 0.03)"),
          border: isLight
            ? (activeStep === 3 ? "1px solid #bbf7d0" : "1px solid #e2e8f0")
            : (activeStep === 3 ? "1px solid rgba(34, 197, 94, 0.25)" : "1px solid rgba(255, 255, 255, 0.06)"),
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
              <Sparkles size={16} className="animate-spin text-purple-400" />
              <span style={{ fontSize: 12.5, fontWeight: 650, color: isLight ? "#6d28d9" : "#d8b4fe" }}>
                AI is scanning AST branch gaps and generating hermetic test suites...
              </span>
            </div>
          ) : activeStep === 3 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} style={{ color: "#16a34a" }} />
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: isLight ? "#15803d" : "#4ade80" }}>
                  {pendingSuggestionsCount} generated unit tests ready
                </span>
                <span style={{ fontSize: 11.5, color: isLight ? "#166534" : "#86efac", marginLeft: 6 }}>
                  across {pendingFilesCount} files. Click Apply All to safely merge into project:
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
                {hasRun
                  ? `Current coverage: Lines ${linesPct}%, Branches ${branchesPct}%. Click Suggest to cover missing branches.`
                  : "No test execution recorded yet. Click Run Baseline Analysis to start the workflow."}
              </span>
            </div>
          )}
        </div>

        {/* Unified Primary CTA Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Quick tab switcher link to Traceability */}
          {onChangeTab && activeTab !== "traceability" && (
            <button
              onClick={() => onChangeTab("traceability")}
              style={{
                background: "transparent",
                border: "none",
                color: isLight ? "#4f46e5" : "#a5b4fc",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                padding: "6px 10px",
                display: "flex",
                alignItems: "center",
                gap: 5,
                textDecoration: "underline",
              }}
              title="Open Business Logic Traceability & Decision Table Explorer"
            >
              <span>View Business Logic Traceability</span>
              <ArrowRight size={12} />
            </button>
          )}

          {activeStep === 3 ? (
            /* Action Group for Stage 3: Review Diff + Apply All */
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {onOpenReviewModal && (
                <button
                  onClick={onOpenReviewModal}
                  disabled={isBulkApplying || running}
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
                  <span>🔍 Review Diffs ({pendingSuggestionsCount})</span>
                </button>
              )}

              {onApplyAll && (
                <button
                  onClick={onApplyAll}
                  disabled={isBulkApplying || running}
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
                      <span>⚡ 3. Apply All Generated Tests ({pendingSuggestionsCount})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          ) : activeStep === 2 && onBulkSuggest ? (
            /* Primary CTA for Stage 2: AI Suggest Missing Tests */
            <button
              onClick={onBulkSuggest}
              disabled={isBulkSuggesting || running}
              style={{
                background: isLight ? "#4f46e5" : "#6d5dfb",
                border: isLight ? "1px solid #4338ca" : "1px solid #5b4be7",
                color: "#ffffff",
                borderRadius: 7,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: isBulkSuggesting || running ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 7,
                boxShadow: isLight
                  ? "0 2px 6px rgba(79, 70, 229, 0.25)"
                  : "0 2px 10px rgba(109, 93, 251, 0.35)",
                transition: "all 0.15s ease",
                opacity: isBulkSuggesting || running ? 0.6 : 1,
              }}
              className="hover:opacity-90"
              title="Identify AST gaps and generate 4-category unit test matrix"
            >
              <Sparkles size={14} className={isBulkSuggesting ? "animate-spin" : ""} />
              <span>{isBulkSuggesting ? "Analyzing & suggesting..." : "✨ 2. Suggest Missing Tests"}</span>
            </button>
          ) : (
            /* Primary CTA for Stage 1 or Re-run / Verify: Run Analysis */
            <button
              onClick={onRun}
              disabled={running}
              style={{
                background: running
                  ? (isLight ? "#e0e7ff" : "rgba(99, 102, 241, 0.2)")
                  : (isLight ? "#4f46e5" : "#6d5dfb"),
                border: running
                  ? (isLight ? "1px solid #c7d2fe" : "1px solid rgba(99, 102, 241, 0.4)")
                  : (isLight ? "1px solid #4338ca" : "1px solid #5b4be7"),
                color: running
                  ? (isLight ? "#4338ca" : "#c7d2fe")
                  : "#ffffff",
                borderRadius: 7,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: running ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 7,
                boxShadow: running
                  ? "none"
                  : (isLight ? "0 2px 6px rgba(79, 70, 229, 0.25)" : "0 2px 10px rgba(109, 93, 251, 0.35)"),
                transition: "all 0.15s ease",
              }}
              className="hover:opacity-90"
              title="Run Jest and Vitest to measure source code coverage"
            >
              <Play size={13} fill={running ? "currentColor" : "#ffffff"} />
              <span>
                {running
                  ? `Running (${Math.max(5, Math.min(100, Math.round(runProgress)))}%)...`
                  : hasRun
                    ? "🔄 Re-run Analysis"
                    : "▶ 1. Run Baseline Analysis"}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
