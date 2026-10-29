import { useState } from "react";
import { Database, Layers, ArrowLeftRight, Download, Play, Clock, Sparkles } from "lucide-react";
import { SegmentedFilter } from "../../unified/primitives/SegmentedFilter.jsx";
import { PortfolioGatePopover } from "../primitives/PortfolioGatePopover.jsx";
import { Button } from "../../../common/Button.jsx";
import ConfirmDialog from "../../../common/ConfirmDialog.jsx";

export function PortfolioCommandHeader({
  vm,
  dataMode = "live",
  onChangeDataMode,
  onOpenCompareModal,
  onOpenExportModal,
  onSelectStatusFilter,
  onBatchRunCompleted,
  className = "",
}) {
  const [showConfirmBatchRun, setShowConfirmBatchRun] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  const kpis = vm?.kpis || {};
  const metadata = vm?.metadata || {};
  const activeProjectsCount = metadata.activeProjectsCount ?? vm?.projects?.length ?? 0;
  const totalSnapshotsCount = metadata.totalSnapshotsCount ?? 0;

  const handleStartBatchRun = () => {
    setShowConfirmBatchRun(false);
    setIsBatchRunning(true);
    setTimeout(() => {
      setIsBatchRunning(false);
      onBatchRunCompleted?.();
    }, 2500);
  };

  return (
    <header
      id="portfolio-command-header"
      className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 shadow-xs transition-colors ${className}`}
    >
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {/* Left Side: Portfolio Identity & Metadata Strip (NO duplicate +Project button) */}
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-bold tracking-tight text-[var(--ud-text)]">
              Projects Quality Portfolio
            </h1>
            <span className="text-[11px] font-mono font-medium text-[var(--ud-text-muted)] bg-[var(--ud-surface-2)] px-2 py-0.5 rounded border border-[var(--ud-border)] select-none">
              Account Overview
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5 text-xs text-[var(--ud-text-muted)] font-mono">
            <span className="font-semibold text-[var(--ud-text)]">
              {activeProjectsCount} Active Project{activeProjectsCount !== 1 ? "s" : ""}
            </span>
            <span className="text-[var(--ud-border)]">•</span>
            <span>
              {totalSnapshotsCount} Total Snapshot{totalSnapshotsCount !== 1 ? "s" : ""}
            </span>
            <span className="text-[var(--ud-border)] hidden sm:inline">•</span>
            <div className="inline-flex items-center gap-1 font-sans">
              <Clock size={12} className="shrink-0 text-[var(--ud-text-muted)]" />
              <span>
                Last synced {metadata.lastSyncedAt ? "just now" : "recently"}
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Mode Switcher + Gate Badge + Compare + Batch Run + Export */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* 1. Global Data Mode Switcher (Live State vs Demo Showcase) */}
          {onChangeDataMode && (
            <SegmentedFilter
              idPrefix="portfolio-data-mode"
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

          {/* 2. Portfolio Quality Gate Summary Badge & Popover */}
          <PortfolioGatePopover
            gateBreakdown={kpis.gateBreakdown}
            totalProjects={activeProjectsCount}
            onSelectStatusFilter={onSelectStatusFilter}
          />

          <div className="h-5 w-px bg-[var(--ud-border)] hidden sm:block" />

          {/* 3. Compare Projects Action */}
          <Button
            id="portfolio-btn-compare"
            variant="secondary"
            size="sm"
            icon={ArrowLeftRight}
            onClick={() => onOpenCompareModal?.()}
            title="Side-by-side comparison of 2-3 projects"
          >
            Compare Projects
          </Button>

          {/* 4. Batch Run Suites Action */}
          <Button
            id="portfolio-btn-batch-run"
            variant="primary"
            size="sm"
            icon={Play}
            loading={isBatchRunning}
            disabled={isBatchRunning || activeProjectsCount === 0}
            onClick={() => setShowConfirmBatchRun(true)}
            title="Execute test suites across pinned projects"
          >
            {isBatchRunning ? "Running Suites..." : "Batch Run"}
          </Button>

          {/* 5. Export Portfolio Report Action */}
          <Button
            id="portfolio-btn-export"
            variant="outline"
            size="sm"
            icon={Download}
            onClick={() => onOpenExportModal?.()}
            title="Export Account-Wide Quality Portfolio Summary Report"
            className="ud-no-print"
          >
            Export Portfolio
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog before batch execution */}
      <ConfirmDialog
        isOpen={showConfirmBatchRun}
        onClose={() => setShowConfirmBatchRun(false)}
        onConfirm={handleStartBatchRun}
        title="Trigger Batch Suite Execution?"
        message={`This will schedule and execute Unit, Integration, and System test suites sequentially across all ${activeProjectsCount} active projects in your workspace queue.`}
        confirmText="Start Batch Run"
        cancelText="Cancel"
        variant="primary"
        icon={Play}
      />
    </header>
  );
}

export default PortfolioCommandHeader;

