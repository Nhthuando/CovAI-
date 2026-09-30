import { useRef, useEffect } from "react";
import { Check, Clock, AlertCircle } from "lucide-react";

export default function IntegrationLiveProgress({
  activeJobId,
  activeJobType,
  activeJobStatus,
  error,
  activeLogs,
  parseProgressSteps,
}) {
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeLogs]);

  if (!activeJobId && activeLogs.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)] font-sans">
        <Clock
          size={32}
          className="text-[var(--color-text-muted)] opacity-60"
        />
        <div className="text-xs">
          <p className="font-semibold text-[var(--color-text)] mb-1">
            No active pipeline execution.
          </p>
          <p>
            Run <strong>Analyze</strong>, <strong>Generate</strong>, or{" "}
            <strong>Run Tests</strong> to see live progress.
          </p>
        </div>
      </div>
    );
  }

  const steps = parseProgressSteps(activeJobType, activeLogs);

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">
            {activeJobType === "ANALYZE" && "Analyzing Project Architecture..."}
            {activeJobType === "GENERATE" && "Generating AI Test Scenarios..."}
            {activeJobType === "EXECUTE" && "Executing Test Suite..."}
          </h3>
          <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Status:{" "}
            <span className="font-semibold">
              {activeJobStatus === "FAILED"
                ? "Failed"
                : activeJobStatus === "SUCCESS"
                  ? "Completed"
                  : "Running..."}
            </span>
          </div>
        </div>

        {activeJobStatus === "FAILED" && (
          <div className="bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/25 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
            <AlertCircle size={13} />
            Job Failed
          </div>
        )}
      </div>

      <div className="p-6 flex-1 overflow-y-auto">
        {activeJobStatus === "FAILED" && error && (
          <div className="bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 p-3.5 rounded-[var(--radius-md)] text-[var(--color-danger)] text-xs mb-6 font-mono overflow-x-auto leading-relaxed">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Steps List */}
        <div className="flex flex-col gap-3.5 mb-8">
          {steps.map((step, idx) => {
            const isCurrent = !step.done && (idx === 0 || steps[idx - 1].done);
            return (
              <div
                key={idx}
                className={`flex items-center gap-3 transition-opacity ${
                  step.done || isCurrent ? "opacity-100" : "opacity-40"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border transition-colors ${
                    step.done
                      ? "bg-[var(--color-success)] text-white border-[var(--color-success)]"
                      : isCurrent
                        ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]"
                        : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                  }`}
                >
                  {step.done ? (
                    <Check size={12} strokeWidth={3} />
                  ) : isCurrent && activeJobStatus !== "FAILED" ? (
                    <div className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" />
                  ) : null}
                </div>
                <span
                  className={`text-xs ${
                    step.done
                      ? "text-[var(--color-text)] font-semibold"
                      : isCurrent
                        ? "text-[var(--color-primary)] font-semibold"
                        : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Raw Processing Logs */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] flex flex-col h-[260px] overflow-hidden">
          <div className="px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] text-[11px] uppercase tracking-wider font-semibold">
            Raw Processing Logs
          </div>
          <div className="p-3 flex-1 font-mono text-xs overflow-y-auto flex flex-col gap-1 text-[var(--color-text)]">
            {activeLogs.map((log, i) => (
              <div
                key={i}
                className={`leading-relaxed ${
                  log.level === "ERROR"
                    ? "text-[var(--color-danger)] font-semibold"
                    : log.level === "WARN"
                      ? "text-[var(--color-warning)]"
                      : "text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="text-[var(--color-text-muted)] mr-2 select-none">
                  [{new Date(log.createdAt).toLocaleTimeString()}]
                </span>
                {log.parsedMessage?.label || log.message}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
