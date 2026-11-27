import { useState, useEffect, useMemo } from "react";
import {
  X,
  FileDown,
  FileText,
  FileSpreadsheet,
  FileJson,
  Loader2,
  AlertCircle,
  Info,
  Check,
} from "lucide-react";
import {
  PORTFOLIO_EXPORT_CANONICAL_SCOPES,
  PORTFOLIO_EXPORT_SCOPE_META,
  PORTFOLIO_ROI_BASELINE,
} from "../../../../../../shared/portfolioGovernance.js";
import {
  exportPortfolioReportApi,
  triggerPortfolioFileDownload,
} from "../../../../services/portfolio.service.js";
import { computeExportScopePreview } from "../../../../services/portfolioDashboard/portfolioExport.utils.js";
import { useToast } from "../../ToastContext.jsx";

const FORMAT_OPTIONS = [
  {
    id: "pdf",
    label: "PDF Report",
    ext: ".pdf",
    desc: "Formatted A4 audit with vector Risk Quadrant, table pagination & findings",
    icon: FileText,
  },
  {
    id: "csv",
    label: "CSV Spreadsheet",
    ext: ".csv",
    desc: "Excel-ready UTF-8 table of project coverage, pass rates & ROI metrics",
    icon: FileSpreadsheet,
  },
  {
    id: "json",
    label: "JSON Data",
    ext: ".json",
    desc: "Canonical raw payload (KPIs, distributions, matrix & findings) for CI",
    icon: FileJson,
  },
];

const PDF_SECTION_OPTIONS = [
  { id: "executiveKpis", label: "Executive KPI Summary" },
  { id: "lifecycleAndRisk", label: "Lifecycle & Risk Quadrant" },
  { id: "projectMatrix", label: "Detailed Project Quality Matrix" },
  { id: "priorityFindings", label: "Rule-Based Priority Findings" },
];

export function ExportPortfolioReportModal({
  isOpen = false,
  onClose = null,
  allVm = null,
  filteredVm = null,
  vm = null,
  isFiltered = false,
  activeFilterTags = [],
}) {
  const { addToast, showToast } = useToast?.() || {};

  const [format, setFormat] = useState("pdf");
  const [scope, setScope] = useState("active_kpi");
  const [sections, setSections] = useState({
    executiveKpis: true,
    lifecycleAndRisk: true,
    projectMatrix: true,
    priorityFindings: true,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !isExporting) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isExporting, onClose]);

  const effectiveAllProjects = useMemo(
    () => allVm?.projects || filteredVm?.projects || vm?.projects || [],
    [allVm?.projects, filteredVm?.projects, vm?.projects],
  );
  const effectiveFilteredProjects = useMemo(
    () => filteredVm?.projects || vm?.projects || effectiveAllProjects,
    [filteredVm?.projects, vm?.projects, effectiveAllProjects],
  );

  const preview = useMemo(
    () =>
      computeExportScopePreview({
        scope,
        allProjects: effectiveAllProjects,
        filteredProjects: effectiveFilteredProjects,
        isFiltered,
      }),
    [scope, effectiveAllProjects, effectiveFilteredProjects, isFiltered],
  );

  const filterSummaryText = useMemo(() => {
    if (!Array.isArray(activeFilterTags) || activeFilterTags.length === 0) {
      return isFiltered ? "Custom directory filter" : null;
    }
    return activeFilterTags.map((t) => t.label).join(" · ");
  }, [activeFilterTags, isFiltered]);

  if (!isOpen) return null;

  const notifyToast = (payload) => {
    if (typeof showToast === "function") showToast(payload);
    else if (typeof addToast === "function") addToast(payload);
  };

  const toggleSection = (sectionId) => {
    setSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleExport = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);
      setErrorMsg("");

      const result = await exportPortfolioReportApi({
        format,
        scope,
        projectIds:
          scope === "filtered" ? preview.selectedProjectIds : undefined,
        sections: format === "pdf" ? sections : undefined,
        filterSummary: scope === "filtered" ? filterSummaryText : undefined,
      });

      triggerPortfolioFileDownload(result.blob, result.filename);
      notifyToast({
        type: "success",
        title: "Portfolio report exported",
        message: `Downloaded ${result.filename}`,
      });
      onClose?.();
    } catch (err) {
      const msg = err?.message || "Failed to export portfolio report.";
      setErrorMsg(msg);
      notifyToast({
        type: "error",
        title: "Export failed",
        message: msg,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-portfolio-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExporting) onClose?.();
      }}
    >
      <div className="w-full max-w-xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h2
              id="export-portfolio-modal-title"
              className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2"
            >
              <FileDown size={16} className="text-[var(--color-primary)] shrink-0" />
              <span>Export Portfolio Quality Report</span>
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Generated directly from live PostgreSQL Portfolio telemetry — deterministic, zero AI fabrication.
            </p>
          </div>
          <button
            type="button"
            disabled={isExporting}
            onClick={() => onClose?.()}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Close export modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* 1. Export Format */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              1. Output Format
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = format === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isExporting}
                    onClick={() => {
                      setFormat(opt.id);
                      setErrorMsg("");
                    }}
                    className={`p-3 rounded-lg border text-left transition-colors duration-150 cursor-pointer flex flex-col justify-between gap-1.5 ${
                      active
                        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]"
                        : "bg-[var(--color-bg)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-secondary)]/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
                        <Icon
                          size={14}
                          className={
                            active
                              ? "text-[var(--color-primary)]"
                              : "text-[var(--color-text-muted)]"
                          }
                        />
                        {opt.label}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                        {opt.ext}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Export Scope */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              2. Project Scope
            </div>
            <div className="space-y-1.5" role="radiogroup" aria-label="Export project scope">
              {PORTFOLIO_EXPORT_CANONICAL_SCOPES.map((scopeId) => {
                const meta = PORTFOLIO_EXPORT_SCOPE_META[scopeId];
                const isSelected = scope === scopeId;
                return (
                  <button
                    key={scopeId}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={isExporting}
                    onClick={() => {
                      setScope(scopeId);
                      setErrorMsg("");
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg border text-left transition-colors duration-150 flex items-start gap-2.5 cursor-pointer ${
                      isSelected
                        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]"
                        : "bg-[var(--color-bg)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-secondary)]/50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                          : "border-[var(--color-border-strong)] bg-[var(--color-surface)]"
                      }`}
                    >
                      {isSelected && <Check size={10} strokeWidth={3} />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-2">
                        <span>{meta.label}</span>
                        {scopeId === "filtered" && filterSummaryText && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)] truncate max-w-[230px]">
                            {filterSummaryText}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                        {meta.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. PDF Section Toggles */}
          {format === "pdf" && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                3. PDF Sections
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PDF_SECTION_OPTIONS.map((sec) => {
                  const checked = Boolean(sections[sec.id]);
                  return (
                    <label
                      key={sec.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-xs text-[var(--color-text)] cursor-pointer hover:bg-[var(--color-surface-secondary)]/40"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isExporting}
                        onChange={() => toggleSection(sec.id)}
                        className="accent-[var(--color-primary)] rounded cursor-pointer"
                      />
                      <span>{sec.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Live Scope Summary Preview */}
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              <span>Live Scope Preview</span>
              <span className="font-mono text-[10px] normal-case text-[var(--color-text-muted)]">
                {PORTFOLIO_ROI_BASELINE.label}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
              <div className="p-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="text-[10px] text-[var(--color-text-muted)]">In Export</div>
                <div className="text-sm font-bold text-[var(--color-text)] mt-0.5">
                  {preview.projectCount}
                </div>
              </div>
              <div className="p-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="text-[10px] text-[var(--color-text-muted)]">Doing (KPI)</div>
                <div className="text-sm font-bold text-[var(--color-primary)] mt-0.5">
                  {preview.doingCount}
                </div>
              </div>
              <div className="p-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="text-[10px] text-[var(--color-text-muted)]">Excluded</div>
                <div className="text-sm font-bold text-[var(--color-text-secondary)] mt-0.5">
                  {preview.excludedCount}
                </div>
              </div>
            </div>

            {preview.warningMessage && (
              <div className="flex items-start gap-2 text-[11px] text-[var(--color-text-secondary)] pt-0.5">
                <Info size={13} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
                <span>{preview.warningMessage}</span>
              </div>
            )}
          </div>

          {/* Inline Error Box */}
          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 text-xs text-[var(--color-danger)]"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => onClose?.()}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            id="portfolio-export-submit-btn"
            type="button"
            disabled={isExporting}
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium border border-transparent bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] transition-colors duration-150 cursor-pointer disabled:opacity-60 active:scale-[0.98]"
          >
            {isExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileDown size={14} />
            )}
            <span>
              {isExporting ? "Generating..." : `Download ${format.toUpperCase()}`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportPortfolioReportModal;
