import { useState } from "react";
import { ArrowLeftRight, Download, Play, Clock, RefreshCw } from "lucide-react";
import { useToast } from "../../ToastContext.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import { PortfolioGatePopover } from "../primitives/PortfolioGatePopover.jsx";
import { Button } from "../../../common/Button.jsx";
import ConfirmDialog from "../../../common/ConfirmDialog.jsx";
import { batchRunSuitesApi } from "../../../../services/portfolio.service.js";

export function PortfolioCommandHeader({
  vm,
  onOpenCompareModal,
  onOpenExportModal,
  onSelectStatusFilter,
  onBatchRunCompleted,
  isSyncing = false,
  onForceRefresh = null,
  className = "",
}) {
  const { addToast } = useToast?.() || {};
  const [showConfirmBatchRun, setShowConfirmBatchRun] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  const kpis = vm?.kpis || {};
  const metadata = vm?.metadata || {};
  const totalProjectsCount = vm?.projects?.length ?? 0;
  const activeProjectsCount = metadata.activeProjectsCount ?? 0;
  const totalSnapshotsCount = metadata.totalSnapshotsCount ?? 0;
  const runnableProjectsCount =
    (vm?.lifecycleCounts?.DOING || 0) + (vm?.lifecycleCounts?.NOT_STARTED || 0) || totalProjectsCount;

  const canCompare = totalProjectsCount >= 2;
  const canBatchRun = runnableProjectsCount > 0 && !isBatchRunning;

  const handleManualRefresh = async () => {
    if (onForceRefresh) {
      await onForceRefresh();
      addToast?.({
        title: "Metrics Synchronized",
        message: "Projects quality portfolio refreshed with latest testing data.",
        type: "success",
      });
    }
  };

  const handleStartBatchRun = async () => {
    setShowConfirmBatchRun(false);
    setIsBatchRunning(true);
    try {
      await batchRunSuitesApi({ pillars: ["unit", "integration"] });
      onBatchRunCompleted?.();
    } catch (err) {
      console.error("Batch test execution failed:", err);
    } finally {
      setIsBatchRunning(false);
    }
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
            <div className="inline-flex items-center gap-1.5 font-sans">
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ud-text-muted)]">
                <Clock size={11} className="shrink-0" />
                <span>
                  Updated {fmtRelativeTime(metadata.lastSyncedAt || new Date().toISOString())}
                </span>
              </span>

              {/* Manual Refresh Button matching GlobalCommandHeader exactly */}
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isSyncing}
                aria-label="Refresh portfolio metrics"
                className="inline-flex items-center justify-center p-1 rounded-[var(--radius-sm)] border border-[var(--ud-border)] hover:bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh portfolio metrics immediately"
              >
                <RefreshCw size={11} className={isSyncing ? "animate-spin text-[var(--color-primary)]" : ""} />
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Gate Badge + Compare + Batch Run + Export */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* 1. Portfolio Quality Gate Summary Badge & Popover */}
          <PortfolioGatePopover
            gateBreakdown={kpis.gateBreakdown}
            totalProjects={activeProjectsCount}
            onSelectStatusFilter={onSelectStatusFilter}
          />

          <div className="h-5 w-px bg-[var(--ud-border)] hidden sm:block" />

          {/* 2. Compare Projects Action */}
          <span
            title={
              !canCompare
                ? "Need at least 2 projects to compare"
                : "Side-by-side comparison of 2-3 projects"
            }
          >
            <Button
              id="portfolio-btn-compare"
              variant="secondary"
              size="sm"
              icon={ArrowLeftRight}
              disabled={!canCompare}
              onClick={() => canCompare && onOpenCompareModal?.()}
              title={
                !canCompare
                  ? "Need at least 2 projects to compare"
                  : "Side-by-side comparison of 2-3 projects"
              }
            >
              Compare Projects
            </Button>
          </span>

          {/* 3. Batch Run Suites Action */}
          <span
            title={
              activeProjectsCount === 0
                ? "No active projects in Doing/Not Started state to run"
                : "Execute test suites across active projects"
            }
          >
            <Button
              id="portfolio-btn-batch-run"
              variant="primary"
              size="sm"
              icon={Play}
              loading={isBatchRunning}
              disabled={!canBatchRun}
              onClick={() => canBatchRun && setShowConfirmBatchRun(true)}
              title={
                activeProjectsCount === 0
                  ? "No active projects in Doing/Not Started state to run"
                  : "Execute test suites across active projects"
              }
            >
              {isBatchRunning ? "Running Suites..." : "Batch Run"}
            </Button>
          </span>

          {/* 4. Export Portfolio Report Action */}
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
