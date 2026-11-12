import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  FileText,
  Code2,
  Globe,
  Copy,
  Check,
  X,
  Printer,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
} from "lucide-react";
import { Button } from "../../common/Button.jsx";
import {
  formatUnitTestMarkdownReport,
  formatUnitTestJsonReport,
  formatUnitTestHtmlReport,
  downloadUnitTestReport,
  normalizeUnitTestData,
} from "../../../services/unitTestExport.service.js";
import { useToast } from "../ToastContext.jsx";

const FORMAT_OPTIONS = [
  {
    key: "html",
    ext: ".html",
    mime: "text/html",
    title: "Standalone HTML",
    tag: "Print & PDF Ready",
    icon: Globe,
    description:
      "Interactive self-contained report with embedded CovAI dark styling and print-to-PDF (@media print) support.",
  },
  {
    key: "markdown",
    ext: ".md",
    mime: "text/markdown",
    title: "GitHub Markdown",
    tag: "PR & Docs",
    icon: FileText,
    description:
      "Structured GFM with summary tables and fenced error diagnostics for PR descriptions, documentation, and issues.",
  },
  {
    key: "json",
    ext: ".json",
    mime: "application/json",
    title: "Normalized JSON",
    tag: "CI/CD & Automation",
    icon: Code2,
    description:
      "Machine-readable schema containing metrics, coverage, and scenario error stacks for CI/CD pipelines.",
  },
];

export function ExportUnitTestReportModal({ isOpen = false, onClose, data = {} }) {
  const { showToast, addToast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState("html");
  const [copied, setCopied] = useState(false);
  const [customFilename, setCustomFilename] = useState("");

  const norm = useMemo(() => normalizeUnitTestData(data), [data]);
  const snapshotSlug = (norm.snapshotId || "snapshot").slice(0, 8);

  // Initialize or update default filename when format or snapshot changes
  useEffect(() => {
    if (!isOpen) return;
    const formatConfig = FORMAT_OPTIONS.find((f) => f.key === selectedFormat) || FORMAT_OPTIONS[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    setCustomFilename(`covai-unit-test-report-${snapshotSlug}-${timestamp}${formatConfig.ext}`);
  }, [isOpen, selectedFormat, snapshotSlug]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Generate preview content based on selected format
  const previewContent = useMemo(() => {
    if (!isOpen) return "";
    switch (selectedFormat) {
      case "json":
        return formatUnitTestJsonReport(norm);
      case "markdown":
        return formatUnitTestMarkdownReport(norm);
      case "html":
      default:
        return formatUnitTestHtmlReport(norm);
    }
  }, [isOpen, selectedFormat, norm]);

  if (!isOpen) return null;

  const currentFormatConfig =
    FORMAT_OPTIONS.find((f) => f.key === selectedFormat) || FORMAT_OPTIONS[0];

  const handleDownload = () => {
    try {
      const filename = customFilename || `covai-unit-test-report-${Date.now()}${currentFormatConfig.ext}`;
      const success = downloadUnitTestReport(previewContent, filename, currentFormatConfig.mime);

      if (success) {
        const notify = showToast || addToast;
        if (notify) {
          notify({
            type: "success",
            title: "Report Exported",
            message: `Downloaded ${filename} successfully.`,
          });
        }
        onClose();
      }
    } catch (err) {
      const notify = showToast || addToast;
      if (notify) {
        notify({
          type: "error",
          title: "Export Failed",
          message: err.message || "Could not generate report file.",
        });
      }
    }
  };

  const handleCopyClipboard = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(previewContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);

        const notify = showToast || addToast;
        if (notify) {
          notify({
            type: "success",
            title: "Copied to Clipboard",
            message: `Unit test report copied as ${currentFormatConfig.title}.`,
          });
        }
      }
    } catch (err) {
      console.error("[ExportModal] Copy failed:", err);
    }
  };

  const handlePrint = () => {
    try {
      const printWin = window.open("", "_blank");
      if (printWin) {
        const htmlDoc = formatUnitTestHtmlReport(norm);
        printWin.document.open();
        printWin.document.write(htmlDoc);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => {
          printWin.print();
        }, 300);
      } else {
        window.print();
      }
    } catch (_) {
      window.print();
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unit-test-export-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl max-h-[90vh] rounded-lg border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[var(--color-text,#F8FAFC)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border,#29313D)] bg-[var(--color-surface-secondary,#171D25)]">
          <div className="flex items-center gap-2.5">
            <Download className="w-4 h-4 text-[#8B7CFD]" />
            <div>
              <h2 id="unit-test-export-title" className="text-sm font-bold text-[var(--color-text,#F8FAFC)]">
                Export Unit Test Report
              </h2>
              <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)] font-mono">
                Project: {norm.projectName} • Snapshot: {snapshotSlug} • Framework: {norm.framework}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-text-muted,#94A3B8)] hover:text-[var(--color-text,#F8FAFC)] hover:bg-[var(--color-surface,#11161D)] transition-colors cursor-pointer"
            aria-label="Close Export Dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Summary KPIs Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 py-2.5 bg-[var(--color-bg,#0B0F14)] border-b border-[var(--color-border,#29313D)] font-mono text-xs">
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Total Tests</span>
            <span className="font-bold text-sm text-[var(--color-text,#F8FAFC)] tabular-nums">{norm.totals.totalTests}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Passed</span>
            <span className="font-bold text-sm text-emerald-400 tabular-nums">{norm.totals.passedTests}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Failed</span>
            <span className="font-bold text-sm text-rose-400 tabular-nums">{norm.totals.failedTests}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Pass Rate</span>
            <span className={`font-bold text-sm tabular-nums ${norm.totals.passRate >= 90 ? "text-emerald-400" : norm.totals.passRate >= 75 ? "text-[#8B7CFD]" : "text-rose-400"}`}>
              {norm.totals.passRate}%
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Runtime</span>
            <span className="font-bold text-sm text-[var(--color-text-secondary,#CBD5E1)] tabular-nums">{norm.totals.durationMs} ms</span>
          </div>
        </div>

        {/* Modal Body: Left Format Selector + Right Live Preview */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border,#29313D)] overflow-hidden">
          {/* Left Column: Format Cards & Filename Settings */}
          <div className="lg:col-span-5 p-4 overflow-y-auto space-y-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)] block mb-2">
                Select Export Format
              </span>
              <div className="space-y-2">
                {FORMAT_OPTIONS.map((fmt) => {
                  const isSelected = selectedFormat === fmt.key;
                  const Icon = fmt.icon;
                  return (
                    <button
                      key={fmt.key}
                      type="button"
                      onClick={() => setSelectedFormat(fmt.key)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors flex items-start gap-3 cursor-pointer ${
                        isSelected
                          ? "border-[#8B7CFD] bg-[#8B7CFD]/10"
                          : "border-[var(--color-border,#29313D)] bg-[var(--color-surface-secondary,#171D25)]/50 hover:bg-[var(--color-surface-secondary,#171D25)]"
                      }`}
                    >
                      <div className={`p-1.5 rounded-md mt-0.5 shrink-0 ${isSelected ? "bg-[#8B7CFD]/20 text-[#8B7CFD]" : "bg-[var(--color-border,#29313D)] text-[var(--color-text-muted,#94A3B8)]"}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[var(--color-text,#F8FAFC)]">
                            {fmt.title}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface,#11161D)] text-[var(--color-text-muted,#94A3B8)] border border-[var(--color-border,#29313D)]">
                            {fmt.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)] leading-snug mt-1">
                          {fmt.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Filename Input */}
            <div className="pt-2">
              <label htmlFor="custom-filename-input" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)] block mb-1.5">
                Output File Name
              </label>
              <input
                id="custom-filename-input"
                type="text"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                className="w-full px-3 py-1.5 rounded-md border border-[var(--color-border,#29313D)] bg-[var(--color-bg,#0B0F14)] text-xs font-mono text-[var(--color-text,#F8FAFC)] focus:outline-none focus:border-[#8B7CFD]"
                placeholder={`report${currentFormatConfig.ext}`}
              />
            </div>
          </div>

          {/* Right Column: Live Report Preview */}
          <div className="lg:col-span-7 p-4 flex flex-col min-h-[280px] overflow-hidden bg-[var(--color-bg,#0B0F14)]">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)]">
                Live Output Preview ({currentFormatConfig.ext})
              </span>
              <button
                type="button"
                onClick={handleCopyClipboard}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[var(--color-text-secondary,#CBD5E1)] hover:text-[var(--color-text,#F8FAFC)] transition-colors cursor-pointer"
                title="Copy formatted report to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-mono text-[11px]">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[var(--color-text-muted,#94A3B8)]" />
                    <span className="text-[11px]">Copy to Clipboard</span>
                  </>
                )}
              </button>
            </div>

            <pre className="flex-1 min-h-0 p-3 rounded-md border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[11px] font-mono text-[var(--color-text,#F8FAFC)] overflow-auto whitespace-pre-wrap leading-relaxed select-text font-mono">
              {previewContent}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-[var(--color-border,#29313D)] bg-[var(--color-surface-secondary,#171D25)]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={Printer}
            onClick={handlePrint}
            title="Open browser print dialog for PDF saving"
          >
            Print / Save PDF
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={Download}
              onClick={handleDownload}
            >
              Download {currentFormatConfig.ext} Report
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ExportUnitTestReportModal;
