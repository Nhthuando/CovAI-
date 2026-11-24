import { useState } from "react";
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Network,
  FileCode,
  Database,
  GitBranch,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Send,
  ExternalLink,
  Layers,
} from "lucide-react";
import {
  useIntegrationSimulation,
  getScenarioSelectionKey,
} from "../../../hooks/useIntegrationSimulation.js";
import IntegrationFlowCanvas from "./IntegrationFlowCanvas.jsx";

function StatusBadge({ status, code }) {
  if (status === "ERROR" || Number(code) >= 500) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 tabular-nums">
        <XCircle className="w-3 h-3" />
        {code ? `HTTP ${code}` : "Error"}
      </span>
    );
  }
  if (status === "BLOCKED" || (Number(code) >= 400 && Number(code) < 500)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 tabular-nums">
        <AlertTriangle className="w-3 h-3" />
        {code ? `HTTP ${code}` : "Rejected"}
      </span>
    );
  }
  if (status === "PASS") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tabular-nums">
        <CheckCircle2 className="w-3 h-3" />
        {code ? `HTTP ${code}` : "Pass"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 tabular-nums">
      <Send className="w-3 h-3" />
      {code ? `HTTP ${code}` : "Request"}
    </span>
  );
}

/**
 * IntegrationSimulationStudioModal
 *
 * Displays ONE shared API flow diagram for an endpoint (Client -> Router ->
 * Middleware(s) -> Controller -> Service -> Database -> Response -> Assertion)
 * and animates an HTTP request packet across the flow according to the selected
 * Test Scenario's logic (0 AI tokens).
 */
export default function IntegrationSimulationStudioModal({
  isOpen = false,
  onClose,
  snapshotId = null,
  endpoint = null,
  initialScenario = null,
  autoPlayOnOpen = true,
  onOpenSourceFile = null,
}) {
  const [inspectorTab, setInspectorTab] = useState("flow"); // "flow" | "code"

  const {
    scenarios,
    selectedScenarioKey,
    selectedScenario,
    traceData,
    steps,
    currentStep,
    currentStepIndex,
    isPlaying,
    playbackSpeed,
    loading,
    error,
    actions,
  } = useIntegrationSimulation({
    isOpen,
    snapshotId,
    endpoint,
    initialScenario,
    autoPlayOnOpen,
    onClose,
  });

  if (!isOpen || !endpoint) return null;

  const method = (endpoint.method || "GET").toUpperCase();
  const path = endpoint.path || endpoint.fullPath || "/";
  const isRecorded = traceData?.mode === "RECORDED";
  const outcome = traceData?.outcome || {};
  const totalSteps = steps.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5 no-print"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-7xl h-[88vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg flex flex-col overflow-hidden"
      >
        {/* ── HEADER: API IDENTITY + SHARED SCENARIO SWITCHER ── */}
        <div className="shrink-0 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <Network className="w-4 h-4 text-[var(--color-primary)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--color-bg)] border border-[var(--color-border-strong)] text-[var(--color-text)]">
                  {method}
                </span>
                <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate">
                  {path}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    isRecorded
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                  }`}
                >
                  {isRecorded ? "Recorded (Supertest)" : "AST Simulated"}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                  0 AI Tokens
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] font-mono truncate mt-0.5">
                {method} {path} Pipeline ({traceData?.graph?.nodes?.length || 0} nodes) • Scenarios of this API share this flow
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {scenarios.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                  Scenario:
                </span>
                <select
                  value={selectedScenarioKey}
                  onChange={(e) => actions.selectScenario(e.target.value)}
                  className="max-w-[280px] px-2.5 py-1 rounded-md text-xs font-mono bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)]/40 cursor-pointer"
                >
                  {scenarios.map((sc, idx) => {
                    const key = getScenarioSelectionKey(sc, idx);
                    const st = String(sc.status || "READY").toUpperCase();
                    const prefix =
                      st === "PASSED" || st === "PASS"
                        ? "[PASS]"
                        : st === "FAILED" || st === "FAIL"
                          ? "[FAIL]"
                          : "[READY]";
                    return (
                      <option key={key} value={key}>
                        {prefix} {sc.title || sc.testName || `Scenario #${idx + 1}`}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={actions.resetAndReplay}
              disabled={loading || totalSteps === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-primary-foreground)] transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run Simulation</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] border border-transparent hover:border-[var(--color-border)] transition-colors duration-150 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── MAIN BODY: LEFT GRAPH CANVAS + RIGHT INSPECTOR ── */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left ~65%: Interactive API Flow Diagram */}
          <div className="lg:w-[65%] h-[52%] lg:h-full flex flex-col border-b lg:border-b-0 lg:border-r border-[var(--color-border)] min-w-0">
            {/* Active Step Banner */}
            <div className="shrink-0 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between gap-3">
              {loading ? (
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary)]" />
                  <span>Building shared API flow & scenario trace...</span>
                </div>
              ) : error ? (
                <div className="text-xs text-rose-400 font-mono truncate">
                  {error}
                </div>
              ) : currentStep ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusBadge
                      status={currentStep.status}
                      code={currentStep.statusCode}
                    />
                    <span className="text-xs font-semibold text-[var(--color-text)] truncate">
                      {currentStep.title}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums shrink-0">
                    Step {currentStepIndex + 1} / {totalSteps}
                  </span>
                </>
              ) : (
                <span className="text-xs text-[var(--color-text-muted)] font-mono">
                  Ready to simulate API execution flow
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 relative">
              {loading && !traceData ? (
                <div className="w-full h-full flex items-center justify-center bg-[var(--color-bg)] text-xs font-mono text-[var(--color-text-muted)]">
                  <Loader2 className="w-5 h-5 animate-spin mr-2 text-[var(--color-primary)]" />
                  Analyzing Express route, middleware, controller & DB graph...
                </div>
              ) : (
                <IntegrationFlowCanvas
                  key={traceData?.endpointKey || `${method}:${path}`}
                  graph={traceData?.graph}
                  steps={steps}
                  currentStepIndex={currentStepIndex}
                  activeNodeIds={traceData?.activeNodeIds || []}
                  activeEdgeIds={traceData?.activeEdgeIds || []}
                  isPlaying={isPlaying}
                  playbackSpeed={playbackSpeed}
                  onSelectNode={actions.jumpToNode}
                />
              )}
            </div>
          </div>

          {/* Right ~35%: Inspector Panel */}
          <div className="lg:w-[35%] h-[48%] lg:h-full flex flex-col bg-[var(--color-surface)] min-w-0">
            {/* Inspector Tabs */}
            <div className="shrink-0 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1 p-0.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
                <button
                  type="button"
                  onClick={() => setInspectorTab("flow")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors duration-150 cursor-pointer ${
                    inspectorTab === "flow"
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Flow & Payload</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab("code")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors duration-150 cursor-pointer ${
                    inspectorTab === "code"
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Code Trace</span>
                </button>
              </div>

              {outcome.expectedStatus && (
                <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
                  Exp{" "}
                  <strong className="text-[var(--color-text)]">
                    {outcome.expectedStatus}
                  </strong>
                  {outcome.actualStatus ? (
                    <>
                      {" · "}Actual{" "}
                      <strong
                        className={
                          outcome.passed ? "text-emerald-400" : "text-rose-400"
                        }
                      >
                        {outcome.actualStatus}
                      </strong>
                    </>
                  ) : null}
                </span>
              )}
            </div>

            {/* Inspector Content */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar text-xs">
              {inspectorTab === "flow" ? (
                <>
                  {/* Step Narrative */}
                  {currentStep && (
                    <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                          Active Step ({currentStep.phase})
                        </span>
                        <StatusBadge
                          status={currentStep.status}
                          code={currentStep.statusCode}
                        />
                      </div>
                      <div className="text-xs font-semibold text-[var(--color-text)]">
                        {currentStep.title}
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed m-0">
                        {currentStep.summary}
                      </p>
                    </div>
                  )}

                  {/* Branch Condition Evaluation */}
                  {currentStep?.branchEvaluation && (
                    <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-400">
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>Branch Decision</span>
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-text)] bg-[var(--color-surface)] p-2 rounded border border-[var(--color-border)] break-words">
                        if ({currentStep.branchEvaluation.condition})
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                        Evaluated:{" "}
                        <span className="text-[var(--color-text)] font-semibold">
                          {currentStep.branchEvaluation.result}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Database Operation */}
                  {currentStep?.dbOperation && (
                    <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-sky-400">
                        <Database className="w-3.5 h-3.5" />
                        <span>Database Interaction ({currentStep.dbOperation.orm})</span>
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-text)]">
                        Operation: {currentStep.dbOperation.operation}
                      </div>
                      {currentStep.dbOperation.models?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {currentStep.dbOperation.models.map((m) => (
                            <span
                              key={m}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)]">
                        Result:{" "}
                        <span className="text-[var(--color-text)]">
                          {currentStep.dbOperation.result}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Request Packet State */}
                  {currentStep?.requestState && (
                    <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-2">
                      <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                        Request Packet Payload
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-text)]">
                        {currentStep.requestState.method} {currentStep.requestState.path}
                      </div>
                      {currentStep.requestState.headers &&
                        Object.keys(currentStep.requestState.headers).length > 0 && (
                          <div>
                            <div className="text-[10px] font-mono text-[var(--color-text-muted)] mb-1">
                              Headers
                            </div>
                            <pre className="p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-secondary)] overflow-x-auto">
                              {JSON.stringify(currentStep.requestState.headers, null, 2)}
                            </pre>
                          </div>
                        )}
                      {currentStep.requestState.queryParams && (
                        <div>
                          <div className="text-[10px] font-mono text-[var(--color-text-muted)] mb-1">
                            Query Params
                          </div>
                          <pre className="p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-secondary)] overflow-x-auto">
                            {JSON.stringify(currentStep.requestState.queryParams, null, 2)}
                          </pre>
                        </div>
                      )}
                      {currentStep.requestState.payload && (
                        <div>
                          <div className="text-[10px] font-mono text-[var(--color-text-muted)] mb-1">
                            Request Body
                          </div>
                          <pre className="p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-secondary)] overflow-x-auto">
                            {JSON.stringify(currentStep.requestState.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step Timeline List */}
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Execution Trace ({totalSteps} steps)
                    </div>
                    <div className="rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
                      {steps.map((s, idx) => {
                        const isActive = idx === currentStepIndex;
                        return (
                          <button
                            key={s.stepIndex}
                            type="button"
                            onClick={() => actions.jumpToStep(idx)}
                            className={`w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 transition-colors duration-150 cursor-pointer ${
                              isActive
                                ? "bg-[var(--color-primary)]/10 text-[var(--color-text)]"
                                : "bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] text-[var(--color-text-muted)] tabular-nums w-4">
                                {idx + 1}.
                              </span>
                              <span className="text-[11px] font-medium truncate">
                                {s.title}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] text-[var(--color-text-muted)] shrink-0">
                              {s.statusCode || s.phase}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Active Layer Source Snippet */}
                  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                    <div className="px-3 py-2 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between gap-2 text-[11px] font-mono">
                      <span className="text-[var(--color-text-secondary)] truncate">
                        {currentStep?.filePath
                          ? `${currentStep.filePath}${currentStep.line ? `:${currentStep.line}` : ""}`
                          : "Layer Source Snippet"}
                      </span>
                      {onOpenSourceFile && currentStep?.filePath && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSourceFile(
                              currentStep.filePath,
                              currentStep.line || 1,
                            )
                          }
                          className="inline-flex items-center gap-1 text-[10px] text-[var(--color-primary)] hover:underline cursor-pointer shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Open File</span>
                        </button>
                      )}
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto max-h-60 custom-scrollbar leading-relaxed">
                      {currentStep?.codeSnippet ||
                        "// No inline source snippet captured for this step."}
                    </pre>
                  </div>

                  {/* Test Scenario Code */}
                  {selectedScenario?.code && (
                    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                      <div className="px-3 py-2 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-muted)] truncate">
                        Scenario Test: {selectedScenario.title || selectedScenario.testName}
                      </div>
                      <pre className="p-3 text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto max-h-60 custom-scrollbar leading-relaxed">
                        {selectedScenario.code}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── FOOTER: FLAT PLAYBACK BAR ── */}
        <div className="shrink-0 px-4 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex flex-col gap-2">
          {/* Scrubber Track */}
          <div className="relative h-2 flex items-center">
            <div
              onClick={(e) => {
                if (totalSteps <= 1) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(
                  0,
                  Math.min(1, (e.clientX - rect.left) / rect.width),
                );
                actions.jumpToStep(Math.round(ratio * (totalSteps - 1)));
              }}
              className="relative w-full h-1.5 rounded bg-[var(--color-border)] cursor-pointer"
            >
              <div
                style={{
                  width: `${
                    totalSteps > 1
                      ? Math.round((currentStepIndex / (totalSteps - 1)) * 100)
                      : totalSteps === 1
                        ? 100
                        : 0
                  }%`,
                }}
                className="h-full rounded bg-[var(--color-primary)] transition-all duration-150"
              />
              {steps.map((s, idx) => {
                const posPct =
                  totalSteps > 1 ? (idx / (totalSteps - 1)) * 100 : 50;
                const isActive = idx === currentStepIndex;
                const dotColor =
                  s.status === "ERROR"
                    ? "bg-rose-400"
                    : s.status === "BLOCKED"
                      ? "bg-amber-400"
                      : s.status === "PASS"
                        ? "bg-emerald-400"
                        : "bg-sky-400";
                return (
                  <button
                    key={s.stepIndex}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.jumpToStep(idx);
                    }}
                    title={`Step ${idx + 1}: ${s.title}`}
                    style={{ left: `${posPct}%` }}
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-surface)] transition-all cursor-pointer ${
                      isActive ? "w-3.5 h-3.5 ring-2 ring-[var(--color-primary)]/50" : "w-2.5 h-2.5"
                    } ${idx <= currentStepIndex ? dotColor : "bg-[var(--color-text-muted)]/40"}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={actions.resetToStart}
                disabled={currentStepIndex === 0 && !isPlaying}
                title="Reset (R)"
                className="p-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors duration-150 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={actions.stepBackward}
                disabled={currentStepIndex <= 0}
                title="Previous Step (Left Arrow)"
                className="p-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors duration-150 cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={actions.togglePlay}
                disabled={totalSteps <= 1}
                title="Play / Pause (Space)"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-primary-foreground)] disabled:opacity-40 transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Play</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={actions.stepForward}
                disabled={currentStepIndex >= totalSteps - 1}
                title="Next Step (Right Arrow)"
                className="p-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:opacity-40 transition-colors duration-150 cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--color-text-muted)]">
              <div className="flex items-center gap-1">
                <span>Speed:</span>
                {[0.5, 1, 2].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => actions.setPlaybackSpeed(sp)}
                    className={`px-1.5 py-0.5 rounded border text-[10px] tabular-nums transition-colors duration-150 cursor-pointer ${
                      playbackSpeed === sp
                        ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/40 font-semibold"
                        : "bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
              <span className="hidden sm:inline text-[10px]">
                Space: Play/Pause · ←/→: Step · R: Replay · Esc: Close
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
