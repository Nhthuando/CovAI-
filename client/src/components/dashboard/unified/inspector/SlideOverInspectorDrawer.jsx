import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Bot,
  ExternalLink,
  Copy,
  Check,
  Terminal,
  Clock,
  GitCommit,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  Layers,
} from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { Button } from "../../../common/Button.jsx";
import { fmtDuration, fmtPct, fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import { useToast } from "../../ToastContext.jsx";

export function SlideOverInspectorDrawer({
  item = null,
  onClose,
  onNavigateWorkspace,
  onAskAi,
}) {
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!item) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  // Normalize whether `item` is an Action Item, Matrix Module, or Recent Execution Run
  const isRun = item.inspectorType === "run" || Boolean(item.startedAt && item.type);
  const pillar = isRun ? item.type : item.pillar || item.diagnostics?.suspectLayer || "unit";
  const status = isRun
    ? item.status
    : item.priority === "HIGH"
    ? "fail"
    : item.priority === "MEDIUM"
    ? "warn"
    : "pass";

  const title = isRun
    ? `Execution Run ${item.id}`
    : item.title || item.moduleName || "Diagnostic Inspector";

  const subtitle = isRun
    ? `Commit ${item.commitSha || "HEAD"} • Executed ${fmtRelativeTime(item.startedAt)}`
    : `Target: ${item.targetName || item.diagnostics?.filePath || "Module"}`;

  const diag = item.diagnostics || {};
  const failureLayerLabel = isRun
    ? item.failureLayer || "Execution Layer"
    : `${(diag.suspectLayer || pillar).toUpperCase()} • ${diag.failureCategory || "Defect"}`;

  const stackTrace =
    (isRun ? item.stackTrace : diag.stackTrace) ||
    `// No failure stack trace captured for ${title}`;

  const testCases = (isRun ? item.testCases : diag.testCases) || [];

  const aiPrompt =
    (isRun ? item.aiPrompt : diag.aiPrompt) ||
    `Please diagnose "${title}" in the ${pillar.toUpperCase()} testing layer:\n${stackTrace}\nSuggest the root cause and code fix.`;

  const handleCopyStack = () => {
    navigator.clipboard.writeText(stackTrace);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleTriggerAiDiagnosis = () => {
    if (onAskAi) {
      onAskAi(aiPrompt);
    }
    window.dispatchEvent(
      new CustomEvent("covai:prefill-prompt", {
        detail: { promptText: aiPrompt },
      })
    );
    addToast({
      title: "Sent Context to COV AI Agent",
      message: "Diagnostic prompt pre-filled in the right-hand AI Assistant.",
      type: "info",
    });
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ud-inspector-drawer-title"
      className="unified-dashboard fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="w-full max-w-xl h-full bg-[var(--ud-surface)] border-l border-[var(--ud-border)] text-[var(--ud-text)] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-150">
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 shrink-0">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <PillarBadge pillar={pillar} size="sm" />
              <StatusPill status={status} size="sm" />
              {item.priority && (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text-muted)]">
                  {item.priority} PRIORITY
                </span>
              )}
            </div>
            <h2
              id="ud-inspector-drawer-title"
              className="text-sm font-bold text-[var(--ud-text)] leading-snug"
            >
              {title}
            </h2>
            <p className="text-[11px] font-mono text-[var(--ud-text-muted)] truncate">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer shrink-0"
            aria-label="Close Inspector Drawer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {/* 1. Metadata & Failure Layer Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50">
              <span className="text-[10px] uppercase tracking-wider text-[var(--ud-text-muted)] flex items-center gap-1">
                <Layers size={11} />
                <span>Failure Layer</span>
              </span>
              <span className="font-mono text-xs font-semibold text-[var(--ud-text)] mt-1 block truncate">
                {failureLayerLabel}
              </span>
            </div>

            {isRun ? (
              <>
                <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--ud-text-muted)] flex items-center gap-1">
                    <GitCommit size={11} />
                    <span>Pass / Fail</span>
                  </span>
                  <span className="font-mono text-xs font-semibold mt-1 block">
                    <span className="text-[var(--ud-pass)]">{item.passed} passed</span>
                    <span className="text-[var(--ud-text-muted)]"> / </span>
                    <span className={item.failed > 0 ? "text-[var(--ud-fail)]" : "text-[var(--ud-text-muted)]"}>
                      {item.failed} failed
                    </span>
                  </span>
                </div>
                <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--ud-text-muted)] flex items-center gap-1">
                    <Clock size={11} />
                    <span>Coverage & Time</span>
                  </span>
                  <span className="font-mono text-xs font-semibold text-[var(--ud-text)] mt-1 block">
                    {fmtPct(item.coveragePct)} • {fmtDuration(item.durationMs)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--ud-text-muted)] block">
                    Source / Endpoint
                  </span>
                  <span
                    className="font-mono text-xs font-semibold text-[var(--ud-text)] mt-1 block truncate"
                    title={diag.endpoint !== "N/A" ? diag.endpoint : diag.filePath}
                  >
                    {diag.endpoint && diag.endpoint !== "N/A" ? diag.endpoint : diag.filePath || "N/A"}
                  </span>
                </div>
                <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--ud-text-muted)] block">
                    HTTP / Step Status
                  </span>
                  <span className="font-mono text-xs font-semibold text-[var(--ud-warn)] mt-1 block truncate">
                    {diag.httpStatus ? `HTTP ${diag.httpStatus}` : diag.failedStep || "Needs Fix"}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Description / Root Cause Box */}
          {(item.description || diag.summary) && (
            <div className="p-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 space-y-1">
              <div className="text-xs font-semibold text-[var(--ud-text)]">
                {diag.summary || "Root Cause Assessment"}
              </div>
              {item.description && (
                <p className="text-xs text-[var(--ud-text-muted)] leading-relaxed">
                  {item.description}
                </p>
              )}
              {diag.failedStep && (
                <div className="text-[11px] font-mono text-[var(--ud-warn)] pt-1">
                  ↳ Stopped Step: {diag.failedStep}
                </div>
              )}
            </div>
          )}

          {/* 2. Stack Trace / Failure Trace Output */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ud-text-muted)] flex items-center gap-1.5">
                <Terminal size={13} className="text-[var(--ud-unit)]" />
                <span>Diagnostic Stack Trace & Runner Log</span>
              </span>
              <button
                type="button"
                onClick={handleCopyStack}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] px-2 py-0.5 rounded border border-[var(--ud-border)] bg-[var(--ud-surface-2)] cursor-pointer"
              >
                {copied ? <Check size={11} className="text-[var(--ud-pass)]" /> : <Copy size={11} />}
                <span>{copied ? "Copied" : "Copy Log"}</span>
              </button>
            </div>

            <pre className="p-3.5 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-bg)] text-[11px] font-mono text-[var(--ud-text)] overflow-x-auto custom-scrollbar whitespace-pre-wrap leading-relaxed">
              {stackTrace}
            </pre>
          </div>

          {/* 3. Individual Test Case / Step Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                Executed Test Cases & Step Timings ({testCases.length})
              </span>
            </div>

            {testCases.length > 0 ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] divide-y divide-[var(--ud-border)] overflow-hidden">
                {testCases.map((tc, idx) => {
                  const isFail = tc.status === "fail";
                  const isPass = tc.status === "pass";
                  return (
                    <div
                      key={idx}
                      className="p-2.5 bg-[var(--ud-surface)] hover:bg-[var(--ud-surface-2)]/60 transition-colors flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {isFail ? (
                          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-[var(--ud-fail)]" />
                        ) : isPass ? (
                          <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-[var(--ud-pass)]" />
                        ) : (
                          <MinusCircle size={14} className="shrink-0 mt-0.5 text-[var(--ud-text-muted)]" />
                        )}
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-[var(--ud-text)] break-words">
                            {tc.name}
                          </div>
                          {tc.step && (
                            <div
                              className={`text-[11px] font-sans mt-0.5 ${
                                isFail ? "text-[var(--ud-fail)]" : "text-[var(--ud-text-muted)]"
                              }`}
                            >
                              {tc.step}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-[11px] tabular-nums text-[var(--ud-text-muted)] shrink-0">
                        {tc.durationMs > 0 ? fmtDuration(tc.durationMs) : "0ms"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 text-center text-xs text-[var(--ud-text-muted)]">
                No granular test case steps recorded for this item.
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 border-t border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <Button
            id="ud-drawer-ask-ai"
            type="button"
            variant="primary"
            size="sm"
            icon={Bot}
            onClick={handleTriggerAiDiagnosis}
          >
            Ask COV AI to Diagnose
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              id="ud-drawer-open-workspace"
              type="button"
              variant="secondary"
              size="sm"
              icon={ExternalLink}
              iconPosition="right"
              onClick={() => {
                onClose();
                onNavigateWorkspace?.(pillar, item.focusParams || {});
              }}
            >
              Open Workspace
            </Button>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
}

export default SlideOverInspectorDrawer;

