import { useState, useRef, useEffect, memo } from "react";
import {
  Star,
  GitBranch,
  ArrowRight,
  MoreVertical,
  ArrowLeftRight,
  Download,
  Trash2,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";
import { ProjectSparkline } from "../primitives/ProjectSparkline.jsx";
import { PillarMiniProgressRow } from "../primitives/PillarMiniProgressRow.jsx";
import RadialHealthGauge from "../primitives/RadialHealthGauge.jsx";
import LifecycleStatusSelect from "../primitives/LifecycleStatusSelect.jsx";
import ContextualMetricTooltip from "../primitives/ContextualMetricTooltip.jsx";

function ProjectQualityCardComponent({
  project,
  isPinned = false,
  isSelectedForCompare = false,
  isHighlighted = false,
  onTogglePin,
  onToggleCompare,
  onOpenOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onExportProject,
  onAskAiAboutProject,
  onStatusChange,
  className = "",
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const {
    id,
    name,
    branch = "main",
    snapshotId = "",
    frameworks = [],
    healthScore = 0,
    grade = "—",
    delta = 0,
    gateStatus = "UNTESTED",
    gateLabel = "UNTESTED",
    unifiedCoveragePct = 0,
    sparkline = [0, 0, 0, 0, 0],
    lifecycleStatus = "NOT_STARTED",
    pillars = {},
    timeRoi = null,
    activeJob = null,
  } = project;

  const unit = pillars.unit || {};
  const int = pillars.integration || {};
  const sys = pillars.system || {};

  // Gate Badge Variant Styling
  let gateBadgeColor = "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)] border-[var(--ud-pass)]/30";
  if (gateStatus === "BLOCKED") {
    gateBadgeColor = "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)] border-[var(--ud-fail)]/30";
  } else if (gateStatus === "AT_RISK") {
    gateBadgeColor = "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)] border-[var(--ud-warn)]/30";
  } else if (gateStatus === "UNTESTED") {
    gateBadgeColor = "bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] border-[var(--ud-border)]";
  }

  // Sparkline stroke color based on health
  const sparklineStroke =
    healthScore >= 80
      ? "var(--ud-pass)"
      : healthScore >= 60
      ? "var(--ud-warn)"
      : healthScore > 0
      ? "var(--ud-fail)"
      : "var(--ud-neutral)";

  // Compute compact status label (max 4-5 words)
  const isRunning = Boolean(activeJob && activeJob.status === "RUNNING");
  let statusIcon = <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ud-pass)] shrink-0" />;
  let statusText = "All Suites Passing";

  if (isRunning) {
    statusIcon = <Loader2 className="w-3.5 h-3.5 text-[var(--ud-unit)] animate-spin shrink-0" />;
    statusText = `Running ${activeJob.pillar || "Suites"} (${activeJob.progress || 0}%)`;
  } else if (gateStatus === "BLOCKED") {
    const totalFailed = (unit.failedTests || 0) + (int.failedTests || 0) + (sys.failedTests || 0);
    statusIcon = <AlertOctagon className="w-3.5 h-3.5 text-[var(--ud-fail)] shrink-0" />;
    statusText = totalFailed > 0 ? `${totalFailed} Failures Detected` : "Release Blocked";
  } else if (gateStatus === "AT_RISK") {
    const uncovered = int.uncoveredApis || 0;
    statusIcon = <AlertTriangle className="w-3.5 h-3.5 text-[var(--ud-warn)] shrink-0" />;
    statusText = uncovered > 0 ? `${uncovered} Uncovered APIs` : "Risk Detected";
  } else if (gateStatus === "UNTESTED") {
    statusIcon = <Clock className="w-3.5 h-3.5 text-[var(--ud-text-muted)] shrink-0" />;
    statusText = "Ready for First Run";
  }

  // Time & ROI summary numbers
  const speedup = timeRoi?.speedupMultiplier || 0;
  const hoursSaved = timeRoi?.totalHoursSaved || 0;
  const autoDurationFormatted = timeRoi?.actualAutoDurationFormatted || "0s";
  const manualDurationFormatted = timeRoi?.estimatedManualDurationFormatted || "0s";

  return (
    <article
      id={`project-card-${id}`}
      className={`rounded-[var(--radius-lg)] border bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-all relative group ${
        isHighlighted
          ? "border-[var(--ud-unit)] ring-2 ring-[var(--ud-unit)]/20"
          : "border-[var(--ud-border)] hover:border-[var(--ud-border-strong)]"
      } ${className}`}
    >
      <div>
        {/* ── Layer 1: Card Header ────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2 mb-2">
          {/* Left: Star + Title + Branch */}
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin?.(id);
              }}
              className={`p-1 rounded cursor-pointer transition-colors mt-0.5 shrink-0 ${
                isPinned
                  ? "text-amber-500 bg-amber-500/10"
                  : "text-[var(--ud-text-muted)] hover:text-amber-500 hover:bg-[var(--ud-surface-2)]"
              }`}
              title={isPinned ? "Unpin project" : "Pin project"}
              aria-label={isPinned ? "Unpin project" : "Pin project"}
            >
              <Star size={13} fill={isPinned ? "currentColor" : "none"} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenOverview?.(id, project)}
                  className="text-sm font-bold text-[var(--ud-text)] hover:text-[var(--ud-unit)] transition-colors truncate text-left cursor-pointer tracking-tight"
                  title={name}
                >
                  {name}
                </button>
              </div>

              {/* Source/Branch & Snapshot Badge */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-[10px] text-[var(--ud-text-muted)]">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
                  <GitBranch size={10} className="text-[var(--ud-unit)]" />
                  {branch}
                </span>
                {snapshotId && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)] truncate max-w-[120px]"
                    title={`Active Snapshot ID: ${snapshotId}`}
                  >
                    {project.snapshotLabel || `#1 (${snapshotId.slice(0, 7)})`}
                  </span>
                )}
                {/* Detected Framework Tags */}
                {frameworks.slice(0, 2).map((fw) => (
                  <span
                    key={fw}
                    className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] border border-[var(--ud-border)]"
                  >
                    {fw}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Lifecycle Switcher + Gate Badge + Context Menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Lifecycle Selector Dropdown */}
            <LifecycleStatusSelect
              projectId={id}
              currentStatus={lifecycleStatus}
              onStatusChange={onStatusChange}
            />

            {/* Quality Gate Badge */}
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border uppercase tracking-wider ${gateBadgeColor}`}
            >
              {gateLabel}
            </span>

            {/* Context Menu Dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                className="p-1 rounded text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer"
                title="Project Actions"
                aria-label="Project Actions"
              >
                <MoreVertical size={14} />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-xl z-30 py-1 text-xs font-sans">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleCompare?.(id);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] cursor-pointer"
                  >
                    <ArrowLeftRight size={13} />
                    <span>{isSelectedForCompare ? "Deselect Comparison" : "Select for Comparison"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onAskAiAboutProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] cursor-pointer text-[var(--ud-unit)]"
                  >
                    <Sparkles size={13} />
                    <span>Ask COV AI Diagnostics</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] cursor-pointer"
                  >
                    <Download size={13} />
                    <span>Export Project Report</span>
                  </button>

                  <div className="my-1 border-t border-[var(--ud-border)]" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteProject?.(project);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--ud-surface-2)] text-[var(--ud-fail)] cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Workspace</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Layer 2: Core Health Gauge & Trend Strip ─────────────────────── */}
        <div className="flex items-center justify-between p-2.5 rounded-md bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)] my-3">
          {/* Radial Health Gauge */}
          <div className="flex items-center gap-3">
            <RadialHealthGauge
              score={healthScore}
              grade={grade}
              isTested={gateStatus !== "UNTESTED"}
              size={50}
              strokeWidth={4.5}
            />
            <div className="flex flex-col">
              <span className="text-[10px] text-[var(--ud-text-muted)] uppercase font-mono tracking-wider">Health</span>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-sm font-bold text-[var(--ud-text)] tabular-nums">{healthScore}/100</span>
                {delta !== 0 && (
                  <span
                    className={`text-[10px] font-bold ${
                      delta > 0 ? "text-[var(--ud-pass)]" : "text-[var(--ud-fail)]"
                    }`}
                  >
                    {delta > 0 ? `+${delta}%` : `${delta}%`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Unified Coverage & Sparkline */}
          <div className="flex items-center gap-3">
            <div className="text-right font-mono">
              <div className="text-[10px] text-[var(--ud-text-muted)]">Unified Cov</div>
              <div className="text-xs font-bold text-[var(--ud-text)] tabular-nums">
                {unifiedCoveragePct}%
              </div>
            </div>

            <ProjectSparkline
              data={sparkline}
              strokeColor={sparklineStroke}
              width={54}
              height={18}
            />
          </div>
        </div>

        {/* ── Layer 3: 3-Pillar Mini Progress Bars ─────────────────────────── */}
        <div className="space-y-2 my-3">
          {/* Unit Pillar */}
          <PillarMiniProgressRow
            label="Unit"
            subLabel=""
            accentColor="var(--ud-unit)"
            coveragePct={unit.coveragePct ?? 0}
            tooltipText={`${unit.framework || "Jest"}: ${unit.coveragePct ?? 0}% line coverage • ${unit.passedTests ?? 0}/${unit.totalTests ?? 0} passed`}
          />

          {/* Integration Pillar */}
          <PillarMiniProgressRow
            label="Integration"
            subLabel={`${int.coveredApis ?? 0}/${int.totalApis ?? 0} APIs`}
            accentColor="var(--ud-integration)"
            coveragePct={int.coveragePct ?? 0}
            tooltipText={`Integration APIs: ${int.coveredApis ?? 0}/${int.totalApis ?? 0} covered (${int.coveragePct ?? 0}%) • ${int.passedTests ?? 0} passed, ${int.failedTests ?? 0} failed`}
          />

          {/* System E2E Pillar */}
          <PillarMiniProgressRow
            label="System E2E"
            subLabel={`${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} Flows`}
            accentColor="var(--ud-system)"
            coveragePct={sys.coveragePct ?? 0}
            tooltipText={`System E2E: ${sys.coveredJourneys ?? 0}/${sys.totalJourneys ?? 0} flows verified (${sys.coveragePct ?? 0}%) • ${sys.passedTests ?? 0} passed, ${sys.failedTests ?? 0} failed`}
          />
        </div>

        {/* ── Layer 4: Compact Status Strip (Minimal Text, Zero Redundancy) ── */}
        <div className="flex items-center justify-between p-2 rounded border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/70 text-xs font-mono my-3 min-h-[34px]">
          {/* Left: 4-5 words status */}
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            {statusIcon}
            <span className="text-[var(--ud-text)] text-[11px] truncate">{statusText}</span>
          </div>

          {/* Right: Time Saved ROI Badge */}
          {speedup > 1 ? (
            <ContextualMetricTooltip
              title="Execution Time & QA ROI"
              meaning="Automated execution speed vs. industry manual benchmark (120s/Unit, 300s/API, 480s/E2E)."
              formula={`Speedup: ${speedup}x • Auto: ${autoDurationFormatted} • Manual Est: ${manualDurationFormatted}`}
              provenance={`Snapshots: ${snapshotId ? snapshotId.slice(0, 8) : 'Live DB'}`}
              tip="Higher speedup means faster release feedback loops for your engineering team."
              placement="top-right"
            >
              <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--ud-unit)]/10 border border-[var(--ud-unit)]/30 text-[10px] text-[var(--ud-unit)] cursor-help font-bold shrink-0">
                <Zap className="w-3 h-3 text-[var(--ud-unit)]" />
                <span>{speedup}x ({hoursSaved}h saved)</span>
              </div>
            </ContextualMetricTooltip>
          ) : (
            <span className="text-[10px] text-[var(--ud-text-muted)] shrink-0 font-mono">
              {gateStatus === "UNTESTED" ? "No run data" : "Standard Speed"}
            </span>
          )}
        </div>
      </div>

      {/* ── Layer 5: Direct Deep-Links Footer ──────────────────────────────── */}
      <div className="pt-3 border-t border-[var(--ud-border)] flex items-center justify-between gap-2 mt-auto">
        {/* Primary CTA: Open Unified Overview */}
        <button
          type="button"
          onClick={() => onOpenOverview?.(id, project)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ud-unit)] hover:opacity-85 transition-opacity cursor-pointer group-hover:translate-x-0.5 transition-transform"
        >
          <span>Open Unified Overview</span>
          <ArrowRight size={13} />
        </button>

        {/* 3 Quick Jump Pills into Test Workspaces */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "unit")}
            className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] hover:bg-[var(--ud-unit)]/15 text-[var(--ud-unit)] border border-[var(--ud-border)] transition-colors cursor-pointer"
            title="Jump to Unit Test Workspace"
          >
            Unit ↗
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "integration")}
            className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] hover:bg-[var(--ud-integration)]/15 text-[var(--ud-integration)] border border-[var(--ud-border)] transition-colors cursor-pointer"
            title="Jump to Integration Test Workspace"
          >
            Int ↗
          </button>
          <button
            type="button"
            onClick={() => onNavigateWorkspace?.(id, "system")}
            className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] hover:bg-[var(--ud-system)]/15 text-[var(--ud-system)] border border-[var(--ud-border)] transition-colors cursor-pointer"
            title="Jump to System Test Workspace"
          >
            Sys ↗
          </button>
        </div>
      </div>
    </article>
  );
}

export const ProjectQualityCard = memo(ProjectQualityCardComponent, (prev, next) => {
  return (
    prev.isPinned === next.isPinned &&
    prev.isSelectedForCompare === next.isSelectedForCompare &&
    prev.isHighlighted === next.isHighlighted &&
    prev.project?.id === next.project?.id &&
    prev.project?.healthScore === next.project?.healthScore &&
    prev.project?.unifiedCoveragePct === next.project?.unifiedCoveragePct &&
    prev.project?.gateStatus === next.project?.gateStatus &&
    prev.project?.lifecycleStatus === next.project?.lifecycleStatus &&
    prev.project?.activeJob?.progress === next.project?.activeJob?.progress &&
    prev.project?.activeJob?.status === next.project?.activeJob?.status &&
    prev.project?.timeRoi?.speedupMultiplier === next.project?.timeRoi?.speedupMultiplier
  );
});

export default ProjectQualityCard;
