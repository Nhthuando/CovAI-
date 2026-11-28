import { Bot, ArrowUpRight, ShieldAlert, Clock3, Repeat2, CheckCircle2 } from "lucide-react";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { fmtDuration, fmtPct, fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import { criterionLabel } from "../../trustworthiness/criterionLabels.js";

function resolveVerdictPill(aiEval) {
  if (!aiEval?.hasRun || aiEval.status === "NOT_RUN") {
    return { status: "not_run", label: "Not Run" };
  }
  const status = String(aiEval.status || "").toUpperCase();
  if (["QUEUED", "RUNNING", "PROCESSING"].includes(status)) {
    return { status: "warn", label: status === "QUEUED" ? "Queued" : "Running" };
  }
  if (["ERROR", "FAILED"].includes(status)) {
    return { status: "fail", label: "Stopped Early" };
  }
  if (status === "CANCELLED" || status === "CANCELED") {
    return { status: "not_run", label: "Cancelled" };
  }
  const verdict = String(aiEval.verdict || "").toUpperCase();
  if (verdict === "PASSED") return { status: "pass", label: "Passed" };
  if (verdict === "FAILED") return { status: "fail", label: "Failed" };
  return { status: "warn", label: "Incomplete" };
}

function criterionToneClass(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) {
    return "text-[var(--ud-text-muted)]";
  }
  const num = Number(score);
  if (num >= 80) return "text-[var(--ud-pass)]";
  if (num >= 50) return "text-[var(--ud-warn)]";
  return "text-[var(--ud-fail)]";
}

export function AiTrustworthinessSummaryPanel({
  aiTrustworthiness = null,
  onOpenWorkspace = null,
  className = "",
}) {
  const evalData = aiTrustworthiness || { hasRun: false, status: "NOT_RUN", verdict: "NOT_RUN" };
  const hasRun = Boolean(evalData.hasRun && evalData.status !== "NOT_RUN");
  const verdictPill = resolveVerdictPill(evalData);
  const designAudit = evalData.designAudit || null;

  const scoreText = evalData.scoreHidden
    ? "Hidden (Partial)"
    : evalData.score !== null && evalData.score !== undefined
      ? `${Number(evalData.score).toFixed(1)}/100`
      : "—";

  const passRate = evalData.scenarioPassRate;
  const stability = evalData.stability;
  const latency = evalData.latency;
  const criteria = Array.isArray(evalData.criteriaSummary) ? evalData.criteriaSummary : [];

  return (
    <ZonePanel
      id="ud-zone-ai-trustworthiness"
      title="AI Trustworthiness Evaluation"
      description="Chatbot reliability, groundedness, safety, and latency benchmark"
      className={className}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={verdictPill.status} label={verdictPill.label} size="sm" />
          {onOpenWorkspace && (
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] hover:border-[var(--ud-unit)] transition-colors duration-150 cursor-pointer"
            >
              <span>{hasRun ? "Open Evaluation Report" : "Open AI Evaluation"}</span>
              <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      }
    >
      {!hasRun ? (
        <div className="border border-dashed border-[var(--ud-border)] rounded-[var(--radius-md)] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--ud-surface-2)]/30">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] flex items-center justify-center text-[var(--ud-text-muted)] shrink-0">
              <Bot size={18} />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[var(--ud-text)]">
                  AI Trustworthiness Evaluation: Not Run
                </span>
                {designAudit?.status === "READY" && (
                  <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text-muted)]">
                    Design Audit: {designAudit.detected ? `Chatbot Detected (${designAudit.designScore ?? "—"}/100, ${designAudit.findingsCount} findings)` : "No Chatbot Detected"}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--ud-text-muted)]">
                No chatbot trustworthiness benchmark has been executed for this project yet. Configure a target and run an evaluation to measure groundedness, refusal safety, stability, and SLA latency.
              </p>
            </div>
          </div>

          {onOpenWorkspace && (
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] hover:border-[var(--ud-unit)] transition-colors duration-150 cursor-pointer shrink-0 self-start sm:self-center"
            >
              <span>Run AI Evaluation</span>
              <ArrowUpRight size={13} />
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                <span>Trust Score</span>
                <Bot size={13} />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-[var(--ud-text)]">
                {scoreText}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--ud-text-muted)]">
                {evalData.passMark !== null
                  ? `Pass Mark: ${evalData.passMark}/100`
                  : "Pass Mark: —"}
                {evalData.criticalSafetyFailure ? " · Critical Safety Failure" : ""}
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                <span>Scenario Pass Rate</span>
                <CheckCircle2 size={13} />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-[var(--ud-text)]">
                {passRate?.rate !== null && passRate?.rate !== undefined
                  ? fmtPct(passRate.rate)
                  : "—"}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--ud-text-muted)]">
                {passRate
                  ? `${passRate.passed}/${passRate.evaluated} passed${passRate.wilson95 ? ` (95% CI ${(passRate.wilson95.lower * 100).toFixed(0)}–${(passRate.wilson95.upper * 100).toFixed(0)}%)` : ""}`
                  : "No evaluated scenarios"}
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                <span>Response Stability</span>
                <Repeat2 size={13} />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-[var(--ud-text)]">
                {stability?.stabilityRate !== null && stability?.stabilityRate !== undefined
                  ? fmtPct(stability.stabilityRate)
                  : "—"}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--ud-text-muted)]">
                {stability && stability.eligibleCases > 0
                  ? `${stability.stableCases}/${stability.eligibleCases} stable across repeats`
                  : "Single-repetition run"}
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                <span>Response Latency</span>
                <Clock3 size={13} />
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-[var(--ud-text)]">
                {latency?.avgMs !== null && latency?.avgMs !== undefined
                  ? fmtDuration(latency.avgMs)
                  : "—"}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[var(--ud-text-muted)]">
                {latency?.p95Ms !== null && latency?.p95Ms !== undefined
                  ? `P95 ${fmtDuration(latency.p95Ms)}${latency.slaMs ? ` · SLA ${fmtDuration(latency.slaMs)}` : ""}`
                  : "No latency observations"}
              </div>
            </div>
          </div>

          {/* Criteria Summary Table */}
          {criteria.length > 0 && (
            <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] overflow-hidden">
              <div className="px-3.5 py-2 border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                  Evaluation Criteria Summary
                </span>
                <span className="text-[11px] font-mono tabular-nums text-[var(--ud-text-muted)]">
                  {evalData.targetName ? `Target: ${evalData.targetName}` : ""}
                  {evalData.targetName && evalData.profileName ? " · " : ""}
                  {evalData.profileName ? `Profile: ${evalData.profileName}` : ""}
                  {(evalData.targetName || evalData.profileName) && evalData.lastRunAt ? " · " : ""}
                  {evalData.lastRunAt ? `Updated ${fmtRelativeTime(evalData.lastRunAt)}` : ""}
                  {evalData.totalRuns > 0 ? ` (${evalData.totalRuns} run${evalData.totalRuns > 1 ? "s" : ""})` : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[var(--ud-border)]">
                {criteria.map((c) => (
                  <div key={c.criterionKey} className="p-3 space-y-1">
                    <div className="text-xs font-medium text-[var(--ud-text)] leading-snug">
                      {c.label || criterionLabel(c.criterionKey)}
                    </div>
                    <div
                      className={`text-base font-bold font-mono tabular-nums ${criterionToneClass(c.score)}`}
                    >
                      {c.score !== null && c.score !== undefined ? fmtPct(c.score) : "—"}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[var(--ud-text-muted)]">
                      {c.applicable > 0 ? `${c.scored}/${c.applicable} scored` : "Not checked"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {evalData.criticalSafetyFailure && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--ud-fail)]/30 bg-[var(--ud-fail)]/10 text-xs text-[var(--ud-fail)]">
              <ShieldAlert size={14} className="shrink-0" />
              <span>
                Critical safety gate failed during adversarial evaluation; review blocked scenarios in the AI Evaluation workspace.
              </span>
            </div>
          )}
        </div>
      )}
    </ZonePanel>
  );
}

export default AiTrustworthinessSummaryPanel;
