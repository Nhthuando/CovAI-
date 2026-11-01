import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, FileText, Code2, Printer, CheckSquare, Square, Download } from "lucide-react";
import { Button } from "../../../common/Button.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import {
  DEFAULT_EXPORT_SECTIONS,
  generateMarkdownReport,
  buildFilteredJsonPayload,
  exportUnifiedDashboardReport,
} from "../../../../services/unifiedDashboard/unifiedDashboard.export.js";
import { useToast } from "../../ToastContext.jsx";

const SECTION_CONFIGS = [
  {
    key: "executive",
    title: "Executive KPIs & Quality Gate Checklist",
    description: "Health score, pass rate totals, multi-layer coverage index, and 4 gate prerequisites",
  },
  {
    key: "pyramidPillars",
    title: "Testing Pyramid & Three-Pillar Breakdown",
    description: "Architecture distribution and Unit / Integration / System metrics",
  },
  {
    key: "traceMatrix",
    title: "Cross-Layer Traceability Matrix",
    description: "Module-by-module feature alignment and root cause diagnosis",
  },
  {
    key: "actionCenter",
    title: "Smart Action Center",
    description: "Prioritized remediation items and coverage gap targets",
  },
  {
    key: "trendsHistory",
    title: "Coverage Trends & Execution History",
    description: "Recent multi-suite test execution runs and commit metadata",
  },
];

export function ExportReportModal({ isOpen, onClose, vm }) {
  const { addToast } = useToast();
  const [sections, setSections] = useState(DEFAULT_EXPORT_SECTIONS);
  const [previewFormat, setPreviewFormat] = useState("markdown"); // 'markdown' | 'json'

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const toggleSection = (key) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedCount = Object.values(sections).filter(Boolean).length;

  const previewContent = useMemo(() => {
    if (!vm) return "";
    if (previewFormat === "json") {
      return JSON.stringify(buildFilteredJsonPayload(vm, sections), null, 2);
    }
    return generateMarkdownReport(vm, sections);
  }, [vm, sections, previewFormat]);

  if (!isOpen) return null;

  const handleDownload = (format) => {
    try {
      const filename = exportUnifiedDashboardReport(vm, format, sections);
      addToast({
        title: "Report Exported",
        message: `Downloaded ${filename} (${selectedCount} sections).`,
        type: "success",
      });
      onClose();
    } catch (err) {
      addToast({
        title: "Export Failed",
        message: err.message || "Could not generate report file.",
        type: "error",
      });
    }
  };

  const handlePrint = () => {
    onClose();
    setTimeout(() => {
      window.print();
    }, 120);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ud-export-modal-title"
      className="unified-dashboard fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl max-h-[88vh] rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
          <div className="flex items-center gap-2.5">
            <Download size={16} className="text-[var(--ud-unit)]" />
            <div>
              <h2 id="ud-export-modal-title" className="text-sm font-bold text-[var(--ud-text)]">
                Export Unified Quality Report
              </h2>
              <p className="text-[11px] text-[var(--ud-text-muted)] font-mono">
                Project: {vm?.context?.projectName || "CovAI"} • Snapshot: {(vm?.context?.snapshotId || "N/A").slice(0, 8)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
            aria-label="Close Export Modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body: Left Section Selector + Right Live Preview */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--ud-border)] overflow-hidden">
          {/* Left 5 Cols: Section Checkboxes */}
          <div className="lg:col-span-5 p-4 overflow-y-auto space-y-3 custom-scrollbar">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                Include Report Sections ({selectedCount}/5)
              </span>
              <button
                type="button"
                onClick={() => {
                  const allSelected = selectedCount === SECTION_CONFIGS.length;
                  setSections({
                    executive: !allSelected,
                    pyramidPillars: !allSelected,
                    traceMatrix: !allSelected,
                    actionCenter: !allSelected,
                    trendsHistory: !allSelected,
                  });
                }}
                className="text-[11px] font-mono text-[var(--ud-unit)] hover:underline cursor-pointer"
              >
                {selectedCount === SECTION_CONFIGS.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="space-y-2">
              {SECTION_CONFIGS.map((sec) => {
                const checked = Boolean(sections[sec.key]);
                return (
                  <button
                    key={sec.key}
                    type="button"
                    onClick={() => toggleSection(sec.key)}
                    className={`w-full text-left p-2.5 rounded-[var(--radius-md)] border transition-colors flex items-start gap-2.5 cursor-pointer ${
                      checked
                        ? "border-[var(--ud-unit)]/50 bg-[var(--ud-unit)]/8"
                        : "border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 opacity-75 hover:opacity-100"
                    }`}
                  >
                    {checked ? (
                      <CheckSquare size={15} className="shrink-0 mt-0.5 text-[var(--ud-unit)]" />
                    ) : (
                      <Square size={15} className="shrink-0 mt-0.5 text-[var(--ud-text-muted)]" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--ud-text)]">
                        {sec.title}
                      </div>
                      <div className="text-[11px] text-[var(--ud-text-muted)] leading-snug mt-0.5">
                        {sec.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right 7 Cols: Live Summary Preview */}
          <div className="lg:col-span-7 p-4 flex flex-col min-h-[280px] overflow-hidden bg-[var(--ud-bg)]">
            <div className="flex items-center justify-between mb-2.5 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
                Live Report Preview
              </span>
              <SegmentedFilter
                idPrefix="ud-export-preview"
                options={[
                  { label: "Markdown (.md)", value: "markdown" },
                  { label: "JSON (.json)", value: "json" },
                ]}
                value={previewFormat}
                onChange={setPreviewFormat}
                size="sm"
              />
            </div>

            <pre className="flex-1 min-h-0 p-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[11px] font-mono text-[var(--ud-text)] overflow-auto custom-scrollbar whitespace-pre-wrap leading-relaxed select-text">
              {selectedCount > 0
                ? previewContent
                : "// Select at least one report section on the left to preview output."}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={Printer}
            onClick={handlePrint}
            title="Print clean technical report via browser print dialog"
          >
            Print / Save PDF
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Code2}
              disabled={selectedCount === 0}
              onClick={() => handleDownload("json")}
            >
              Export .json
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={FileText}
              disabled={selectedCount === 0}
              onClick={() => handleDownload("markdown")}
            >
              Export .md
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ExportReportModal;

