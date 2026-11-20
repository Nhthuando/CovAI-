import { FileDown, RefreshCw } from "lucide-react";
import { useToast } from "../../ToastContext.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";

export function PortfolioCommandHeader({
  vm,
  onOpenExportModal,
  isSyncing = false,
  onForceRefresh = null,
  className = "",
}) {
  const { addToast } = useToast?.() || {};

  const metadata = vm?.metadata || {};
  const activeProjectsCount = metadata.activeProjectsCount ?? 0;
  const totalSnapshotsCount = metadata.totalSnapshotsCount ?? 0;

  const handleManualRefresh = async () => {
    if (onForceRefresh) {
      await onForceRefresh();
      addToast?.({
        title: "Synced",
        message: "Portfolio metrics updated.",
        type: "success",
      });
    }
  };

  return (
    <header
      id="portfolio-command-header"
      className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-1 ${className}`}
    >
      <div>
        <h1 className="ps-display text-2xl sm:text-[26px] font-bold text-[var(--ps-ink)] leading-tight">
          Projects Portfolio
        </h1>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--ps-ink-muted)] ps-mono">
          <span className="text-[var(--ps-ink-secondary)] font-medium">
            {activeProjectsCount} active
          </span>
          <span>·</span>
          <span>{totalSnapshotsCount} snapshots</span>
          <span>·</span>
          <span>
            {fmtRelativeTime(metadata.lastSyncedAt || new Date().toISOString())}
          </span>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isSyncing}
            aria-label="Refresh portfolio metrics"
            title="Refresh metrics"
            className="inline-flex items-center justify-center p-1 rounded-md hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              className={isSyncing ? "animate-spin text-[var(--ps-cobalt)]" : ""}
            />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          id="portfolio-btn-export"
          type="button"
          onClick={() => onOpenExportModal?.()}
          className="ud-no-print h-8 px-3 rounded-lg border border-[var(--ps-line-strong)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-xs font-medium text-[var(--ps-ink)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <FileDown size={13} className="text-[var(--ps-cobalt)]" />
          <span>Export PDF</span>
        </button>
      </div>
    </header>
  );
}

export default PortfolioCommandHeader;
