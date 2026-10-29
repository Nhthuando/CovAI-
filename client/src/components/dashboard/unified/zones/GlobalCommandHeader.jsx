import { useState } from "react";
import { Play, Sparkles, Download, GitBranch, Clock, Database, Layers } from "lucide-react";
import { QualityGateBadge } from "../primitives/QualityGateBadge.jsx";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ExportReportModal } from "../modals/ExportReportModal.jsx";
import { Button } from "../../../common/Button.jsx";
import ConfirmDialog from "../../../common/ConfirmDialog.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import { MOCK_SNAPSHOT_PRESETS } from "../../../../services/unifiedDashboard/unifiedDashboard.mock.js";

export function GlobalCommandHeader({
  vm,
  dataMode = "live",
  onChangeDataMode,
  onSelectSnapshot,
  runAllState,
  onNavigateWorkspace,
  className = "",
}) {
  const [showConfirmRun, setShowConfirmRun] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const context = vm?.context || {};
  const qualityGate = vm?.qualityGate || {
    status: "PASSED",
    label: "READY TO RELEASE",
    reasons: [],
    checklist: [],
  };

  // Merge project snapshots with preset snapshots so the Snapshot Selector Dropdown is always interactive
  const rawSnapshots = Array.isArray(context.snapshots) && context.snapshots.length > 0
    ? context.snapshots
    : MOCK_SNAPSHOT_PRESETS;

  const snapshotOptions = [...rawSnapshots];
  if (
    context.snapshotId &&
    !snapshotOptions.some((s) => s.id === context.snapshotId)
  ) {
    snapshotOptions.unshift({
      id: context.snapshotId,
      label: context.snapshotId.slice(0, 8),
      branch: "active",
    });
  }
  for (const preset of MOCK_SNAPSHOT_PRESETS) {
    if (!snapshotOptions.some((s) => s.id === preset.id)) {
      snapshotOptions.push(preset);
    }
  }

  const { runAll, isRunning, stepStates, cancelRemaining } = runAllState || {};

  const handleAiOptimize = () => {
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
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {/* Left: Project title, Snapshot Dropdown & Data Mode Switcher */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-[var(--ud-text)] tracking-tight">
                {context.projectName || "CovAI Project"}
              </h1>
              <span className="text-[11px] font-mono text-[var(--ud-text-muted)] bg-[var(--ud-surface-2)] px-1.5 py-0.5 rounded border border-[var(--ud-border)] select-none">
                Unified Quality Overview
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-[var(--ud-text-muted)]">
              {/* Interactive Snapshot Selector Dropdown */}
              <div className="inline-flex items-center gap-1.5">
                <GitBranch size={13} className="shrink-0 text-[var(--ud-unit)]" />
                <label htmlFor="ud-snapshot-select" className="text-[11px] font-sans text-[var(--ud-text-muted)]">
                  Snapshot:
                </label>
                <select
                  id="ud-snapshot-select"
                  value={context.snapshotId || snapshotOptions[0]?.id || ""}
                  onChange={(e) => onSelectSnapshot?.(e.target.value)}
                  className="font-mono text-xs rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] py-0.5 px-2 focus:outline-hidden focus:border-[var(--ud-unit)] cursor-pointer"
                >
                  {snapshotOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.label || s.id).slice(0, 8)} {s.branch ? `(${s.branch})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <span className="text-[var(--ud-border)] hidden sm:inline">•</span>

              {/* Last Updated */}
              <div className="inline-flex items-center gap-1">
                <Clock size={12} className="shrink-0" />
                <span>Updated {fmtRelativeTime(context.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Data Mode Switcher + Quality Gate Badge + Command Actions */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Data Mode Switcher: Live State vs. Demo Showcase */}
          {onChangeDataMode && (
            <SegmentedFilter
              idPrefix="ud-data-mode"
              options={[
                { label: "Live State", value: "live", icon: Database },
                { label: "Demo Showcase", value: "demo", icon: Layers },
              ]}
              value={dataMode}
              onChange={onChangeDataMode}
              size="sm"
            />
          )}

          <div className="h-5 w-px bg-[var(--ud-border)] hidden sm:block" />

          {/* Quality Gate Status with 4-Condition Prerequisite Checklist Popover */}
          <QualityGateBadge
            id="ud-header-quality-gate"
            status={qualityGate.status}
            label={qualityGate.label}
            reasons={qualityGate.reasons}
            checklist={qualityGate.checklist}
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

          {/* Action 3: Export Report Modal Trigger */}
          <Button
            id="ud-header-export"
            variant="outline"
            size="sm"
            icon={Download}
            onClick={() => setShowExportModal(true)}
            className="ud-no-print"
          >
            Export Report
          </Button>
        </div>
      </div>

      {/* Sequential Run Progress Banner */}
      {isRunning && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--ud-surface-2)]/50 p-2.5 rounded-[var(--radius-md)]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-[var(--ud-text)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-ping" />
              Running Suites:
            </span>
            <div className="flex items-center gap-2">
              <PillarBadge pillar="unit" size="sm" />
              <StatusPill status={stepStates?.unit} size="sm" />
            </div>
            <span className="text-[var(--ud-text-muted)]">→</span>
            <div className="flex items-center gap-2">
              <PillarBadge pillar="integration" size="sm" />
              <StatusPill status={stepStates?.integration} size="sm" />
            </div>
            <span className="text-[var(--ud-text-muted)]">→</span>
            <div className="flex items-center gap-2">
              <PillarBadge pillar="system" size="sm" />
              <StatusPill status={stepStates?.system} size="sm" />
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
          runAll?.();
        }}
        title="Execute All Testing Suites?"
        message="This will run Unit Tests, Integration API Tests, and System E2E Scenarios sequentially against this snapshot. Depending on project size, this may take a few minutes."
        confirmText="Start Execution"
        cancelText="Cancel"
        variant="primary"
        icon={Play}
      />

      {/* Export Report Modal */}
      <ExportReportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        vm={vm}
      />
    </header>
  );
}

export default GlobalCommandHeader;
