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
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
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

function getCoverageColor(pct) {
  if (pct === null || pct === undefined) return "#475569";
  if (pct >= 80) return "#22C55E";
  if (pct >= 50) return "#F59E0B";
  return "#EF4444";
}

function getCoverageTextClass(pct) {
  if (pct === null || pct === undefined) return "text-[var(--color-text-muted,#94A3B8)]";
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 50) return "text-amber-400";
  return "text-rose-400";
}

function TestOutcomeDonut({ totals }) {
  const total = totals.totalTests || 0;
  const passed = totals.passedTests || 0;
  const failed = totals.failedTests || 0;
  const skipped = totals.skippedTests || 0;

  const size = 116;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    if (total <= 0) return [];
    const items = [
      { key: "passed", count: passed, color: "#22C55E" },
      { key: "failed", count: failed, color: "#EF4444" },
      { key: "skipped", count: skipped, color: "#F59E0B" },
    ].filter((s) => s.count > 0);

    let offset = 0;
    return items.map((item) => {
      const length = (item.count / total) * circumference;
      const seg = {
        ...item,
        dashArray: `${length} ${circumference - length}`,
        dashOffset: -offset,
      };
      offset += length;
      return seg;
    });
  }, [total, passed, failed, skipped, circumference]);

  const legendItems = [
    { label: "Passed", count: passed, color: "bg-emerald-500", textClass: "text-emerald-400" },
    { label: "Failed", count: failed, color: "bg-rose-500", textClass: "text-rose-400" },
    { label: "Skipped", count: skipped, color: "bg-amber-500", textClass: "text-amber-400" },
  ];

  return (
    <div className="p-3.5 rounded-lg border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)]">
          Test Outcome Split
        </span>
        <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted,#94A3B8)]">
          {total} total
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="-rotate-90"
            aria-label={`Test pass rate ${totals.passRate}%`}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#1E2530"
              strokeWidth={strokeWidth}
            />
            {segments.map((seg) => (
              <circle
                key={seg.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={seg.dashArray}
                strokeDashoffset={seg.dashOffset}
                strokeLinecap="butt"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span
              className={`text-base font-bold font-mono tabular-nums leading-none ${
                totals.passRate >= 90
                  ? "text-emerald-400"
                  : totals.passRate >= 75
                  ? "text-[#8B7CFD]"
                  : "text-rose-400"
              }`}
            >
              {totals.passRate}%
            </span>
            <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)] mt-1">
              Pass Rate
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-2 min-w-0">
          {legendItems.map((item) => {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return (
              <div key={item.label} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-sm shrink-0 ${item.color}`} />
                  <span className="text-[var(--color-text-secondary,#CBD5E1)] truncate">
                    {item.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0">
                  <span className={`font-semibold ${item.textClass}`}>{item.count}</span>
                  <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)]">
                    ({pct}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CoverageBarChart({ coverage }) {
  const metrics = [
    { key: "linesPct", label: "Lines", value: coverage.linesPct },
    { key: "statementsPct", label: "Statements", value: coverage.statementsPct },
    { key: "functionsPct", label: "Functions", value: coverage.functionsPct },
    { key: "branchesPct", label: "Branches", value: coverage.branchesPct },
  ];

  const validValues = metrics
    .map((m) => m.value)
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const avgCoverage =
    validValues.length > 0
      ? Number((validValues.reduce((acc, v) => acc + v, 0) / validValues.length).toFixed(1))
      : null;

  return (
    <div className="p-3.5 rounded-lg border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)]">
          Code Coverage Profile
        </span>
        <span
          className={`text-[11px] font-mono tabular-nums font-semibold px-1.5 py-0.5 rounded border border-[var(--color-border,#29313D)] bg-[var(--color-bg,#0B0F14)] ${getCoverageTextClass(
            avgCoverage
          )}`}
        >
          {avgCoverage !== null ? `Avg ${avgCoverage}%` : "No Coverage"}
        </span>
      </div>

      <div className="space-y-2.5">
        {metrics.map((m) => {
          const hasVal = m.value !== null && m.value !== undefined && !Number.isNaN(m.value);
          const clamped = hasVal ? Math.max(0, Math.min(100, m.value)) : 0;
          const barColor = getCoverageColor(m.value);
          return (
            <div key={m.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-secondary,#CBD5E1)]">{m.label}</span>
                <span className={`font-mono tabular-nums font-semibold ${getCoverageTextClass(m.value)}`}>
                  {hasVal ? `${m.value}%` : "N/A"}
                </span>
              </div>
              <div className="h-2 w-full rounded-sm bg-[#1E2530] overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all duration-300"
                  style={{
                    width: `${clamped}%`,
                    backgroundColor: barColor,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuiteHealthChart({ scenarios }) {
  const suites = useMemo(() => {
    if (!Array.isArray(scenarios) || scenarios.length === 0) return [];
    const map = new Map();
    for (const s of scenarios) {
      const key = s.suite || s.file || "Unit Test Suite";
      if (!map.has(key)) {
        map.set(key, { name: key, passed: 0, failed: 0, skipped: 0, total: 0 });
      }
      const entry = map.get(key);
      entry.total += 1;
      if (s.status === "passed") entry.passed += 1;
      else if (s.status === "failed") entry.failed += 1;
      else entry.skipped += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.failed - a.failed || b.total - a.total);
  }, [scenarios]);

  const failedScenarios = useMemo(
    () => (Array.isArray(scenarios) ? scenarios.filter((s) => s.status === "failed") : []),
    [scenarios]
  );

  if (suites.length === 0) {
    return (
      <div className="p-3.5 rounded-lg border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] flex items-center gap-3">
        <div className="p-2 rounded-md bg-[var(--color-bg,#0B0F14)] border border-[var(--color-border,#29313D)] text-[var(--color-text-muted,#94A3B8)] shrink-0">
          <Layers className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text,#F8FAFC)]">
            Aggregate Run Summary
          </p>
          <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)] mt-0.5">
            Individual test case details were not emitted for this run. Execution totals and coverage metrics above are ready for export.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-3.5 rounded-lg border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted,#94A3B8)]">
            Suite Breakdown ({suites.length})
          </span>
          <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted,#94A3B8)]">
            {scenarios.length} cases
          </span>
        </div>

        <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
          {suites.map((suite) => {
            const passPct = suite.total > 0 ? (suite.passed / suite.total) * 100 : 0;
            const failPct = suite.total > 0 ? (suite.failed / suite.total) * 100 : 0;
            const skipPct = suite.total > 0 ? (suite.skipped / suite.total) * 100 : 0;
            return (
              <div key={suite.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--color-text-secondary,#CBD5E1)] truncate font-mono text-[11px]">
                    {suite.name}
                  </span>
                  <div className="flex items-center gap-1.5 font-mono tabular-nums text-[11px] shrink-0">
                    {suite.failed > 0 ? (
                      <span className="text-rose-400 font-semibold">{suite.failed} failed</span>
                    ) : (
                      <span className="text-emerald-400 font-semibold">All passed</span>
                    )}
                    <span className="text-[var(--color-text-muted,#94A3B8)]">
                      ({suite.passed}/{suite.total})
                    </span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-sm bg-[#1E2530] overflow-hidden flex">
                  {passPct > 0 && (
                    <div className="h-full bg-emerald-500" style={{ width: `${passPct}%` }} />
                  )}
                  {failPct > 0 && (
                    <div className="h-full bg-rose-500" style={{ width: `${failPct}%` }} />
                  )}
                  {skipPct > 0 && (
                    <div className="h-full bg-amber-500" style={{ width: `${skipPct}%` }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {failedScenarios.length > 0 && (
        <div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/10">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
              Failed Cases ({failedScenarios.length})
            </span>
          </div>
          <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
            {failedScenarios.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="text-[11px] p-2 rounded border border-[var(--color-border,#29313D)] bg-[var(--color-bg,#0B0F14)]"
              >
                <div className="font-mono font-semibold text-rose-300 truncate">{s.name}</div>
                {s.error?.message && (
                  <div className="text-[var(--color-text-muted,#94A3B8)] truncate mt-0.5 font-mono">
                    {s.error.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ExportUnitTestReportModal({ isOpen = false, onClose, data = {} }) {
  const { showToast, addToast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState("html");
  const [previewTab, setPreviewTab] = useState("visual");
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
      <div className="w-full max-w-5xl max-h-[90vh] rounded-lg border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[var(--color-text,#F8FAFC)] shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border,#29313D)] bg-[var(--color-surface-secondary,#171D25)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-md bg-[#8B7CFD]/15 border border-[#8B7CFD]/30 text-[#8B7CFD] shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="unit-test-export-title" className="text-sm font-bold text-[var(--color-text,#F8FAFC)]">
                  Export Unit Test Report
                </h2>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                    norm.totals.status === "PASSED"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : norm.totals.status === "FAILED"
                      ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                      : "bg-slate-500/10 text-slate-300 border-slate-500/30"
                  }`}
                >
                  {norm.totals.status === "PASSED" ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {norm.totals.status}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)] font-mono truncate mt-0.5">
                Project: {norm.projectName} • Snapshot: {snapshotSlug} • Framework: {norm.framework}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-text-muted,#94A3B8)] hover:text-[var(--color-text,#F8FAFC)] hover:bg-[var(--color-surface,#11161D)] transition-colors cursor-pointer shrink-0"
            aria-label="Close Export Dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Summary KPIs Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 px-5 py-2.5 bg-[var(--color-bg,#0B0F14)] border-b border-[var(--color-border,#29313D)] font-mono text-xs">
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
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Line Cov.</span>
            <span className={`font-bold text-sm tabular-nums ${getCoverageTextClass(norm.coverage.linesPct)}`}>
              {norm.coverage.linesPct !== null ? `${norm.coverage.linesPct}%` : "N/A"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--color-text-muted,#94A3B8)] uppercase font-semibold">Runtime</span>
            <span className="font-bold text-sm text-[var(--color-text-secondary,#CBD5E1)] tabular-nums">{norm.totals.durationMs} ms</span>
          </div>
        </div>

        {/* Modal Body: Left Format Selector + Right Visual/Raw Preview */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border,#29313D)] overflow-hidden">
          {/* Left Column: Format Cards & Filename Settings */}
          <div className="lg:col-span-4 p-4 overflow-y-auto space-y-4">
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

          {/* Right Column: Visual Overview + Raw Report Preview */}
          <div className="lg:col-span-8 p-4 flex flex-col min-h-[320px] overflow-hidden bg-[var(--color-bg,#0B0F14)]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
              <div className="inline-flex items-center p-0.5 rounded-md border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)]">
                <button
                  type="button"
                  onClick={() => setPreviewTab("visual")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    previewTab === "visual"
                      ? "bg-[#8B7CFD]/15 text-[#F8FAFC] border border-[#8B7CFD]/40"
                      : "text-[var(--color-text-muted,#94A3B8)] hover:text-[var(--color-text,#F8FAFC)] border border-transparent"
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-[#8B7CFD]" />
                  <span>Visual Overview</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("raw")}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    previewTab === "raw"
                      ? "bg-[#8B7CFD]/15 text-[#F8FAFC] border border-[#8B7CFD]/40"
                      : "text-[var(--color-text-muted,#94A3B8)] hover:text-[var(--color-text,#F8FAFC)] border border-transparent"
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5 text-[var(--color-text-muted,#94A3B8)]" />
                  <span>Raw Output ({currentFormatConfig.ext})</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopyClipboard}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[var(--color-text-secondary,#CBD5E1)] hover:text-[var(--color-text,#F8FAFC)] transition-colors cursor-pointer"
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
                    <span className="text-[11px]">Copy {currentFormatConfig.ext}</span>
                  </>
                )}
              </button>
            </div>

            {previewTab === "visual" ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <TestOutcomeDonut totals={norm.totals} />
                  <CoverageBarChart coverage={norm.coverage} />
                </div>
                <SuiteHealthChart scenarios={norm.scenarios} />
              </div>
            ) : (
              <pre className="flex-1 min-h-0 p-3 rounded-md border border-[var(--color-border,#29313D)] bg-[var(--color-surface,#11161D)] text-[11px] font-mono text-[var(--color-text,#F8FAFC)] overflow-auto whitespace-pre-wrap leading-relaxed select-text">
                {previewContent}
              </pre>
            )}
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
