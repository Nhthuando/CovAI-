import {
  Sparkles,
  FileText,
  Code2,
  GitBranch,
  Clock,
  RefreshCw,
  X,
  ChevronDown,
  FileCode2,
  Printer,
} from "lucide-react";
import { useToast } from "../../ToastContext.jsx";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { Button } from "../../../common/Button.jsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../../../ui/dropdown-menu.jsx";
import { fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";
import {
  DEFAULT_EXPORT_SECTIONS,
  buildDashboardAiAnalysisPrompt,
  exportUnifiedDashboardPdf,
  exportUnifiedDashboardReport,
} from "../../../../services/unifiedDashboard/unifiedDashboard.export.js";
import { activateProjectSnapshotApi } from "../../../../services/project.service.js";

export function GlobalCommandHeader({
  vm,
  loading = false,
  fallbackProject = null,
  fallbackSnapshotId = "",
  onSelectSnapshot,
  runAllState,
  onAskAi = null,
  isSyncing = false,
  onForceRefresh = null,
  liveRuns = {},
  className = "",
}) {
  const { addToast } = useToast?.() || {};

  const {
    isRunning,
    activeStep,
    stepStates,
    stepProgress,
    overallPercent = 0,
    cancelRemaining,
  } = runAllState || {};

  const handleSnapshotChange = async (e) => {
    const newSnapshotId = e.target.value;
    if (!newSnapshotId || newSnapshotId === context.snapshotId) return;

    if (context.projectId) {
      try {
        await activateProjectSnapshotApi(context.projectId, newSnapshotId);
      } catch (err) {
        console.warn(
          "[GlobalCommandHeader] Failed to activate snapshot on backend:",
          err,
        );
      }
    }
    onSelectSnapshot?.(newSnapshotId);
  };

  const handleManualRefresh = async () => {
    if (onForceRefresh) {
      await onForceRefresh();
      addToast?.({
        title: "Metrics Synchronized",
        message:
          "Unified quality dashboard refreshed with latest testing data.",
        type: "success",
      });
    }
  };

  const handleAiAnalyze = () => {
    if (!vm) return;
    const promptText = buildDashboardAiAnalysisPrompt(vm);
    if (typeof onAskAi === "function") {
      onAskAi(promptText);
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("covai:prefill-prompt", {
          detail: { promptText },
        }),
      );
    }
  };

  const handleQuickExportPdf = () => {
    if (!vm) return;
    try {
      exportUnifiedDashboardPdf(vm, DEFAULT_EXPORT_SECTIONS);
      addToast?.({
        title: "PDF Print Ready",
        message:
          "Prepared formatted A4 quality report for printing or saving as PDF.",
        type: "success",
      });
    } catch (err) {
      addToast?.({
        title: "PDF Export Failed",
        message: err.message || "Could not prepare PDF report.",
        type: "error",
      });
    }
  };

  const handleQuickExportFormat = (format) => {
    if (!vm) return;
    const formatNames = {
      html: "HTML",
      markdown: "Markdown",
      json: "JSON",
    };
    const label = formatNames[format] || format.toUpperCase();
    try {
      const filename = exportUnifiedDashboardReport(
        vm,
        format,
        DEFAULT_EXPORT_SECTIONS,
      );
      addToast?.({
        title: `${label} Exported`,
        message: `Downloaded ${filename}`,
        type: "success",
      });
    } catch (err) {
      addToast?.({
        title: `${label} Export Failed`,
        message: err.message || `Could not export ${label} report.`,
        type: "error",
      });
    }
  };

  const fallbackSnapshots = fallbackProject?.snapshots || [];
  const fallbackSnap = fallbackSnapshots.find(
    (s) => s.id === fallbackSnapshotId,
  );
  const context = vm?.context || {
    projectId: fallbackProject?.id || "",
    projectName: fallbackProject?.name || "CovAI Platform",
    snapshotId: fallbackSnapshotId || "",
    snapshotLabel: fallbackSnap?.label || "",
    snapshots: fallbackSnapshots,
    branch: fallbackProject?.branch || "main",
    updatedAt: null,
  };

  return (
    <header
      id="ud-zone-header"
      data-guide="ud-header"
      className={`relative bg-[var(--ud-surface)] border border-[var(--ud-border)] rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] transition-colors duration-150 ${className}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Left Column: Context Metadata & Project/Snapshot Switcher */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ud-text-muted)]">
            <span className="font-semibold text-[var(--ud-text)] text-sm">
              {context.projectName}
            </span>

            <span className="text-[var(--ud-border)]">•</span>

            {/* Branch Badge */}
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch size={12} className="text-[var(--ud-text-muted)]" />
              <span>{context.branch || "main"}</span>
            </span>

            <span className="text-[var(--ud-border)]">•</span>

            {/* Snapshot Switcher / Version Badge */}
            <div className="inline-flex items-center gap-1.5 font-mono">
              <span className="text-[var(--ud-text-muted)]">Snapshot:</span>
              {Array.isArray(context.snapshots) &&
              context.snapshots.length > 1 ? (
                <select
                  aria-label="Select Snapshot"
                  value={context.snapshotId || ""}
                  onChange={handleSnapshotChange}
                  className="bg-[var(--ud-surface-2)] border border-[var(--ud-border)] text-[var(--ud-text)] rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-mono font-medium hover:border-[var(--color-primary)] transition-colors cursor-pointer focus:outline-none"
                >
                  {context.snapshots.map((s) => (
                    <option
                      key={s.id}
                      value={s.id}
                      className="bg-[var(--ud-surface)] text-[var(--ud-text)]"
                    >
                      {s.label ||
                        `Snapshot #${s.versionNumber || s.id.slice(0, 7)}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold text-[var(--ud-text)]">
                  {context.snapshotLabel ||
                    context.snapshotId?.slice(0, 7) ||
                    "None"}
                </span>
              )}
            </div>

            <span className="text-[var(--ud-border)]">•</span>

            {/* Last Synced / Updated At */}
            <span className="inline-flex items-center gap-1 text-[11px]">
              <Clock size={11} />
              <span>
                {loading || !context.updatedAt
                  ? "Loading metrics..."
                  : `Updated ${fmtRelativeTime(context.updatedAt)}`}
              </span>
            </span>

            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isSyncing}
              aria-label="Refresh dashboard metrics"
              className="inline-flex items-center justify-center p-1 rounded-[var(--radius-sm)] border border-[var(--ud-border)] hover:bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh dashboard metrics immediately"
            >
              <RefreshCw
                size={11}
                className={
                  isSyncing ? "animate-spin text-[var(--ud-unit)]" : ""
                }
              />
            </button>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ud-text)]">
            Testing Quality & Reliability Overview
          </h1>
        </div>

        {/* Right Column: Reporting & AI Analysis Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Action 1: AI Analyze (passes full dashboard context to AI Chatbot) */}
          <Button
            id="ud-header-ai-analyze"
            variant="primary"
            size="sm"
            icon={Sparkles}
            disabled={!vm}
            onClick={handleAiAnalyze}
            className="!bg-[var(--ps-ink)] !text-[var(--ps-bg)] hover:!opacity-90 border-0"
            title="Send full dashboard metrics, coverage gaps, and failing modules to AI Assistant"
          >
            AI Analyze
          </Button>

          {/* Action 2: Direct Export PDF */}
          <Button
            id="ud-header-export-pdf"
            variant="secondary"
            size="sm"
            icon={FileText}
            disabled={!vm}
            onClick={handleQuickExportPdf}
            className="ud-no-print"
            title="Export formatted A4 PDF report"
          >
            Export PDF
          </Button>

          {/* Action 3: Quick Export Format Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="ud-header-quick-export"
                variant="outline"
                size="sm"
                icon={ChevronDown}
                iconPosition="right"
                disabled={!vm}
                className="ud-no-print"
                title="Download Overview report in HTML, Markdown, JSON, or PDF"
              >
                Quick Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 bg-[var(--ud-surface)] border-[var(--ud-border)] text-[var(--ud-text)]"
            >
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-[var(--ud-text-muted)]">
                Export Format
              </DropdownMenuLabel>
              <DropdownMenuItem
                id="ud-header-export-html"
                onSelect={() => handleQuickExportFormat("html")}
              >
                <FileCode2 className="text-[var(--ud-unit)]" />
                <span>Download HTML (.html)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                id="ud-header-export-md"
                onSelect={() => handleQuickExportFormat("markdown")}
              >
                <FileText className="text-[var(--ud-integration)]" />
                <span>Download Markdown (.md)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                id="ud-header-export-json"
                onSelect={() => handleQuickExportFormat("json")}
              >
                <Code2 className="text-[var(--ud-system)]" />
                <span>Download JSON (.json)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                id="ud-header-export-pdf-menu"
                onSelect={handleQuickExportPdf}
              >
                <Printer className="text-[var(--ud-text-muted)]" />
                <span>Print / Save PDF (.pdf)</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Real-time Socket Background Execution Telemetry Banner */}
      {!isRunning && Object.keys(liveRuns).length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--ud-surface-2)]/50 p-2.5 rounded-[var(--radius-md)]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-[var(--ud-text)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--ud-unit)] animate-pulse" />
              Live Background Run:
            </span>
            {Object.values(liveRuns).map((run) => (
              <div
                key={run.jobId}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--ud-border)] bg-[var(--ud-surface)]"
              >
                <PillarBadge pillar={run.pillar || "unit"} size="sm" />
                <span className="font-mono text-[11px] font-semibold text-[var(--ud-text)]">
                  {run.status}{" "}
                  {run.progress !== undefined ? `(${run.progress}%)` : ""}
                </span>
                {run.stage && (
                  <span className="text-[10px] text-[var(--ud-text-muted)] truncate max-w-[140px]">
                    {run.stage}
                  </span>
                )}
              </div>
            ))}
          </div>
          <span className="text-[11px] font-mono text-[var(--ud-text-muted)]">
            Socket.IO live
          </span>
        </div>
      )}

      {/* Real-Time Sequential Run Progress & Telemetry Bar */}
      {isRunning && (
        <div className="mt-4 pt-3 border-t border-[var(--ud-border)] flex flex-col gap-3 bg-[var(--ud-surface-2)]/60 p-3 rounded-[var(--radius-md)] border border-[var(--color-primary)]/20 animate-in fade-in duration-200">
          {/* Top row: Overall progress percentage & Cancel CTA */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-primary)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--color-primary)]" />
              </span>
              <span className="text-xs font-semibold text-[var(--ud-text)]">
                Executing Suites Pipeline — Overall Progress: {overallPercent}%
              </span>
            </div>

            <button
              type="button"
              onClick={cancelRemaining}
              className="text-xs font-mono text-[var(--ud-fail)] hover:underline cursor-pointer flex items-center gap-1 bg-[var(--ud-fail)]/10 px-2 py-0.5 rounded border border-[var(--ud-fail)]/30 hover:bg-[var(--ud-fail)]/20 transition-colors"
            >
              <X size={12} />
              <span>Cancel Remaining</span>
            </button>
          </div>

          {/* Master Progress Bar */}
          <div className="w-full bg-[var(--ud-border)] h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--ud-unit)] transition-all duration-300 ease-out"
              style={{ width: `${overallPercent}%` }}
            />
          </div>

          {/* Three Suites Progress Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {/* Unit */}
            <div
              className={`p-2 rounded border text-xs flex flex-col gap-1.5 transition-colors ${
                activeStep === "unit"
                  ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm"
                  : stepStates?.unit === "done"
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : stepStates?.unit === "failed"
                      ? "bg-rose-500/10 border-rose-500/30"
                      : "bg-[var(--ud-surface)] border-[var(--ud-border)] opacity-75"
              }`}
            >
              <div className="flex items-center justify-between">
                <PillarBadge pillar="unit" size="sm" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px]">
                    {stepStates?.unit === "done"
                      ? "100%"
                      : `${stepProgress?.unit?.progress || 0}%`}
                  </span>
                  <StatusPill status={stepStates?.unit} size="sm" />
                </div>
              </div>
              <div className="w-full bg-[var(--ud-border)]/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary)] transition-all duration-300"
                  style={{
                    width: `${stepStates?.unit === "done" ? 100 : stepProgress?.unit?.progress || 0}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-[var(--ud-text-muted)] truncate">
                {stepProgress?.unit?.stage ||
                  (activeStep === "unit"
                    ? "Executing Unit tests..."
                    : stepStates?.unit === "done"
                      ? "Completed"
                      : "Queued")}
              </span>
            </div>

            {/* Integration */}
            <div
              className={`p-2 rounded border text-xs flex flex-col gap-1.5 transition-colors ${
                activeStep === "integration"
                  ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm"
                  : stepStates?.integration === "done"
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : stepStates?.integration === "skipped"
                      ? "bg-amber-500/10 border-amber-500/30"
                      : stepStates?.integration === "failed"
                        ? "bg-rose-500/10 border-rose-500/30"
                        : "bg-[var(--ud-surface)] border-[var(--ud-border)] opacity-75"
              }`}
            >
              <div className="flex items-center justify-between">
                <PillarBadge pillar="integration" size="sm" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px]">
                    {stepStates?.integration === "done"
                      ? "100%"
                      : `${stepProgress?.integration?.progress || 0}%`}
                  </span>
                  <StatusPill status={stepStates?.integration} size="sm" />
                </div>
              </div>
              <div className="w-full bg-[var(--ud-border)]/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-300"
                  style={{
                    width: `${stepStates?.integration === "done" ? 100 : stepProgress?.integration?.progress || 0}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-[var(--ud-text-muted)] truncate">
                {stepProgress?.integration?.stage ||
                  (activeStep === "integration"
                    ? "Executing Supertest..."
                    : stepStates?.integration === "done"
                      ? "Completed"
                      : stepStates?.integration === "skipped"
                        ? "Skipped (Action Required)"
                        : "Queued")}
              </span>
            </div>

            {/* System */}
            <div
              className={`p-2 rounded border text-xs flex flex-col gap-1.5 transition-colors ${
                activeStep === "system"
                  ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 shadow-sm"
                  : stepStates?.system === "done"
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : stepStates?.system === "skipped"
                      ? "bg-amber-500/10 border-amber-500/30"
                      : stepStates?.system === "failed"
                        ? "bg-rose-500/10 border-rose-500/30"
                        : "bg-[var(--ud-surface)] border-[var(--ud-border)] opacity-75"
              }`}
            >
              <div className="flex items-center justify-between">
                <PillarBadge pillar="system" size="sm" />
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-[11px]">
                    {stepStates?.system === "done"
                      ? "100%"
                      : `${stepProgress?.system?.progress || 0}%`}
                  </span>
                  <StatusPill status={stepStates?.system} size="sm" />
                </div>
              </div>
              <div className="w-full bg-[var(--ud-border)]/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{
                    width: `${stepStates?.system === "done" ? 100 : stepProgress?.system?.progress || 0}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-[var(--ud-text-muted)] truncate">
                {stepProgress?.system?.stage ||
                  (activeStep === "system"
                    ? "Running E2E tests..."
                    : stepStates?.system === "done"
                      ? "Completed"
                      : stepStates?.system === "skipped"
                        ? "Skipped (Action Required)"
                        : "Queued")}
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default GlobalCommandHeader;
