import { FileDown, RefreshCw, X, RotateCcw } from "lucide-react";
import { useToast } from "../../ToastContext.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";

export function PortfolioCommandHeader({
  vm,
  onOpenExportModal,
  isSyncing = false,
  onForceRefresh = null,
  isFiltered = false,
  activeFilterTags = [],
  onRemoveFilterTag = null,
  onResetFilters = null,
  className = "",
}) {
  const { addToast } = useToast?.() || {};

  const metadata = vm?.metadata || {};
  const activeProjectsCount = metadata.activeProjectsCount ?? 0;
  const totalSnapshotsCount = metadata.totalSnapshotsCount ?? 0;
  const matchingProjectsCount =
    metadata.matchingProjectsCount ?? vm?.projects?.length ?? 0;
  const totalProjectsCount = metadata.totalProjectsCount ?? matchingProjectsCount;

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
      className={`space-y-2.5 pb-1 ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="ps-display text-2xl sm:text-[26px] font-bold text-[var(--ps-ink)] leading-tight">
            Projects Portfolio
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--ps-ink-muted)] ps-mono">
            {isFiltered && (
              <>
                <span className="text-[var(--ps-cobalt)] font-semibold tabular-nums">
                  Showing {matchingProjectsCount} of {totalProjectsCount}
                </span>
                <span>·</span>
              </>
            )}
            <span className="text-[var(--ps-ink-secondary)] font-medium tabular-nums">
              {activeProjectsCount} active
            </span>
            <span>·</span>
            <span className="tabular-nums">{totalSnapshotsCount} snapshots</span>
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
      </div>

      {isFiltered && activeFilterTags.length > 0 && (
        <div
          aria-label="Active portfolio filters"
          className="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)] mr-1">
            Filtered scope:
          </span>
          {activeFilterTags.map((tag) => (
            <button
              key={tag.key}
              type="button"
              onClick={() => onRemoveFilterTag?.(tag.key)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-[var(--ps-cobalt)]/10 border border-[var(--ps-cobalt)]/30 text-[11px] ps-mono text-[var(--ps-cobalt)] hover:bg-[var(--ps-cobalt)]/15 transition-colors duration-150 cursor-pointer"
              title={`Remove ${tag.label}`}
            >
              <span>{tag.label}</span>
              <X size={11} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onResetFilters?.()}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-[11px] ps-mono text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors duration-150 cursor-pointer"
          >
            <RotateCcw size={10} />
            <span>Reset filters</span>
          </button>
        </div>
      )}
    </header>
  );
}

export default PortfolioCommandHeader;
