import { useState } from "react";
import { Play, Sparkles, Download, GitBranch, Clock, FileText, Code2 } from "lucide-react";
import { QualityGateBadge } from "../primitives/QualityGateBadge.jsx";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { Button } from "../../../common/Button.jsx";
import ConfirmDialog from "../../../common/ConfirmDialog.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import { exportUnifiedDashboardReport } from "../../../../services/unifiedDashboard/unifiedDashboard.export.js";
import { useToast } from "../../ToastContext.jsx";

export function GlobalCommandHeader({
  vm,
  onSelectSnapshot,
  runAllState,
  onNavigateWorkspace,
  className = "",
}) {
  const { addToast } = useToast();
  const [showConfirmRun, setShowConfirmRun] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const context = vm?.context || {};
  const qualityGate = vm?.qualityGate || { status: "PASSED", label: "READY TO RELEASE", reasons: [] };
  const snapshots = context.snapshots || [];

  const { runAll, isRunning, stepStates, cancelRemaining } = runAllState;

  const handleExport = (format) => {
    setShowExportMenu(false);
    try {
      const filename = exportUnifiedDashboardReport(vm, format);
      addToast({
        title: "Report Exported",
        message: `Downloaded ${filename} successfully.`,
        type: "success",
      });
    } catch (err) {
      addToast({
        title: "Export Failed",
        message: err.message || "Could not generate export report.",
        type: "error",
      });
    }
  };

  const handleAiOptimize = () => {
    // Navigate to the top priority action item's workspace or unit by default
    const topAction = vm?.actions?.items?.[0];
    if (topAction) {
      onNavigateWorkspace(topAction.pillar, topAction.focusParams);
    } else {
      onNavigateWorkspace("unit");
    }
  };

  return (
    <header
      id="ud-global-header"
      className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 shadow-xs transition-colors ${className}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Project title & Snapshot selector */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[var(--ud-text)] tracking-tight">
                {context.projectName || "CovAI Project"}
              </h1>
              <span className="text-[11px] font-mono text-[var(--ud-text-muted)] bg-[var(--ud-surface-2)] px-1.5 py-0.5 rounded border border-[var(--ud-border)] select-none">
                Overview
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--ud-text-muted)]">
              {/* Snapshot selector */}
              {snapshots.length > 0 ? (
                <div className="inline-flex items-center gap-1.5">
                  <GitBranch size={13} className="shrink-0 text-[var(--ud-text-muted)]" />
                  <label htmlFor="ud-snapshot-select" className="sr-only">
                    Select Snapshot
                  </label>
                  <select
                    id="ud-snapshot-select"
                    value={context.snapshotId || ""}
                    onChange={(e) => onSelectSnapshot(e.target.value)}
                    className="font-mono text-xs rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] py-0.5 px-2 focus:outline-hidden focus:border-[var(--color-focus)] cursor-pointer"
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.id.slice(0, 8)} {s.branch ? `(${s.branch})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="font-mono text-xs text-[var(--ud-text-muted)]">
                  {context.snapshotId ? `Snapshot: ${context.snapshotId.slice(0, 8)}` : "No active snapshot"}
                </span>
              )}

              <span className="text-[var(--ud-border)]">•</span>

              {/* Last Updated */}
              <div className="inline-flex items-center gap-1">
                <Clock size={12} className="shrink-0" />
                <span>Updated {fmtRelativeTime(context.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quality Gate Badge + Command Actions */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Quality Gate Status */}
          <QualityGateBadge
            id="ud-header-quality-gate"
            status={qualityGate.status}
            label={qualityGate.label}
            reasons={qualityGate.reasons}
          />

          <div className="h-5 w-px bg-[var(--ud-border)] hidden sm:block" />

          {/* Action 1: Run All Suites */}
          <Button
            id="ud-header-run-all"
            variant="primary"
            size="sm"
            icon={Play}
            loading={isRunning}
            disabled={!context.snapshotId || isRunning}
            onClick={() => setShowConfirmRun(true)}
            title={!context.snapshotId ? "Select a snapshot first" : "Execute Unit, Integration, and System tests"}
          >
            {isRunning ? "Running Suites..." : "Run All Suites"}
          </Button>

          {/* Action 2: AI Optimize */}
          <Button
            id="ud-header-ai-optimize"
            variant="secondary"
            size="sm"
            icon={Sparkles}
            onClick={handleAiOptimize}
            title="Jump to the highest priority test gap or failure"
          >
            AI Optimize
          </Button>

          {/* Action 3: Export Report Dropdown */}
          <div className="relative">
            <Button
              id="ud-header-export"
              variant="outline"
              size="sm"
              icon={Download}
              onClick={() => setShowExportMenu((prev) => !prev)}
            >
              Export Report
            </Button>

            {showExportMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-1 text-[var(--ud-text)] shadow-lg text-xs"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport("markdown")}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-left hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
                >
                  <FileText size={14} className="text-[var(--ud-unit)]" />
                  <span>Markdown (.md)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport("json")}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-left hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
                >
                  <Code2 size={14} className="text-[var(--ud-integration)]" />
                  <span>Raw Data (.json)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sequential Run Progress Banner (renders when running or newly finished) */}
      {isRunning && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--ud-surface-2)]/50 p-2.5 rounded-[var(--radius-md)]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-[var(--ud-text)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-ping" />
              Running Suites:
            </span>
            <div className="flex items-center gap-2">
              <PillarBadge pillar="unit" size="sm" />
              <StatusPill status={stepStates.unit} size="sm" />
            </div>
            <span className="text-[var(--ud-text-muted)]">→</span>
            <div className="flex items-center gap-2">
              <PillarBadge pillar="integration" size="sm" />
              <StatusPill status={stepStates.integration} size="sm" />
            </div>
            <span className="text-[var(--ud-text-muted)]">→</span>
            <div className="flex items-center gap-2">
              <PillarBadge pillar="system" size="sm" />
              <StatusPill status={stepStates.system} size="sm" />
            </div>
          </div>
          <button
            type="button"
            onClick={cancelRemaining}
            className="text-xs font-mono text-[var(--ud-fail)] hover:underline cursor-pointer"
          >
            Cancel Remaining
          </button>
        </div>
      )}

      {/* Confirmation Dialog before triggering full execution */}
      <ConfirmDialog
        isOpen={showConfirmRun}
        onClose={() => setShowConfirmRun(false)}
        onConfirm={() => {
          setShowConfirmRun(false);
          runAll();
        }}
        title="Execute All Testing Suites?"
        message="This will run Unit Tests, Integration API Tests, and System E2E Scenarios sequentially against this snapshot. Depending on project size, this may take a few minutes."
        confirmText="Start Execution"
        cancelText="Cancel"
        variant="primary"
        icon={Play}
      />
    </header>
  );
}

export default GlobalCommandHeader;
